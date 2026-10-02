/**
 * Read-only audit: accounts whose record grants access that Stripe never paid for.
 *
 * WHY THIS EXISTS
 * ---------------
 * Stripe advances `current_period_end` when it ATTEMPTS a renewal, not when the
 * renewal succeeds. Until 0b7591f (31 Aug 2026) handleSubscriptionUpdated copied
 * it unconditionally, so a renewal that FAILED on 17 Aug still wrote
 * endDate = 17 Sep. That fix stops new damage. It repairs nothing already
 * written, and no code path in the backend ever moves endDate backward — not
 * handleSubscriptionDeleted, not handleInvoicePaymentFailed, not the reconciler.
 *
 * The access gate is therefore working correctly on data that is lying to it:
 * `past_due`/`cancelled` INSIDE the paid period legitimately keeps access, and a
 * poisoned endDate makes every such account look like it is inside one.
 *
 * This finds those accounts by asking Stripe the only question that matters:
 * what is the latest period the customer ACTUALLY PAID for? A paid invoice is
 * the durable record of payment — it survives the subscription being cancelled,
 * unpaid, or deleted, which is exactly the state these accounts are in.
 *
 * SAFETY
 * ------
 * STRICTLY READ-ONLY. There is no --apply flag and no write path in this file.
 * It opens the database connection, reads, and disconnects. Revocation is a
 * separate, deliberate step — run this first and read the blast radius.
 *
 * WHAT IT CANNOT TELL YOU
 * -----------------------
 * Production is currently running pre-2c9b9a0 webhook handlers, which misread
 * live invoice payloads. Some accounts may be in the wrong state for that reason
 * rather than this one. Stripe is the source of truth here either way, but
 * deploy before drawing conclusions about *why* a given account drifted.
 *
 * USAGE
 *   cd /var/www/tododjs/server
 *   node scripts/audit-overgranted-access.mjs
 *   node scripts/audit-overgranted-access.mjs --email customer@example.com
 *   node scripts/audit-overgranted-access.mjs --csv over-granted.csv
 *   node scripts/audit-overgranted-access.mjs --limit 50
 *
 * Run from the SERVER directory, not the repo root:
 *
 *   cd /var/www/tododjs/server && node scripts/audit-overgranted-access.mjs
 *
 * `import 'dotenv/config'` reads .env from the CURRENT WORKING DIRECTORY, and
 * the credentials live in server/.env — from the repo root it would load
 * /var/www/tododjs/.env, find no MONGODB_URI, and fail on connect. The relative
 * imports below are file-relative (ESM), so they resolve either way.
 *
 * Needs MONGODB_URI and STRIPE_SECRET_KEY.
 */
import 'dotenv/config';
import fs from 'fs';
import mongoose from 'mongoose';
import stripe from '../config/stripe.js';
import User, { hasActiveWindow, PAST_DUE_GRACE_MS } from '../models/User.js';
import Download from '../models/Download.js';
import { hasPaidPlan, truePaidThrough } from '../utils/stripeTruth.js';

const argv = process.argv.slice(2);
const value = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 ? argv[i + 1] : null;
};

const onlyEmail = value('email');
const csvPath = value('csv');
const limit = value('limit') ? parseInt(value('limit'), 10) : null;

const DAY = 24 * 60 * 60 * 1000;
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 16) : '—');
const days = (ms) => Math.round(ms / DAY);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');


// ── Scan ────────────────────────────────────────────────────────────────────
await mongoose.connect(process.env.MONGODB_URI);

const graceNote = PAST_DUE_GRACE_MS === 0
  ? 'zero (policy)'
  : `${days(PAST_DUE_GRACE_MS)}d (SUBSCRIPTION_GRACE_DAYS is set)`;

console.log('READ-ONLY AUDIT — no writes will be made.');
console.log(`Past-due grace in effect: ${graceNote}`);
if (onlyEmail) console.log(`Filtered to ${onlyEmail}`);
console.log('');

// Deliberately does not pre-filter on status — the whole point is that status
// looks fine. Entitlement is decided per user below, by the real predicate.
const userQuery = onlyEmail
  ? { email: new RegExp(`^${escapeRe(onlyEmail)}$`, 'i') }
  : {};

const users = await User.find(userQuery)
  .select('email role subscription downloads createdAt')
  .lean();

const findings = {
  overGranted: [], adminGranted: [], sharedMember: [], noEvidence: [], unverifiable: [],
  ok: 0, admins: 0, noAccess: 0, scanned: 0,
};

for (const user of users) {
  if (limit && findings.scanned >= limit) break;
  const sub = user.subscription || {};

  // Admins bypass every subscription gate by design — not a finding.
  if (user.role === 'admin') { findings.admins++; continue; }

  // Does the record grant access RIGHT NOW? Uses the exported predicate from
  // models/User.js so this audit agrees with the gate by construction rather
  // than through a hand-copied duplicate — the drift that caused this whole
  // class of bug in the first place.
  const grantsAccess = hasActiveWindow(sub) && hasPaidPlan(sub);
  if (!grantsAccess) { findings.noAccess++; continue; }

  findings.scanned++;

  const base = {
    email: user.email,
    status: sub.status || 'none',
    planId: sub.planId || sub.plan || null,
    dbEnd: sub.endDate || null,
    totalDownloads: user.downloads?.total ?? 0,
  };

  // Admin-granted access is not Stripe-controlled and has no expiry: updateUser
  // nulls endDate, requireSubscription returns next() unconditionally, and the
  // status endpoint reports daysRemaining -1. Nothing can ever revoke it.
  if (sub.grantedByAdmin) {
    findings.adminGranted.push({ ...base, hasStripeSub: !!sub.stripeSubscriptionId });
    continue;
  }

  // Shared-plan members hold no Stripe subscription of their own; their access
  // is a copy of the primary's. Judge them by the primary.
  if (sub.sharedBy) {
    const primary = await User.findById(sub.sharedBy).select('email subscription').lean();
    findings.sharedMember.push({
      ...base,
      primaryEmail: primary?.email || '(primary not found)',
      primaryEnd: primary?.subscription?.endDate || null,
      primaryStatus: primary?.subscription?.status || 'none',
    });
    continue;
  }

  let paid;
  try {
    paid = await truePaidThrough(sub);
  } catch (e) {
    findings.unverifiable.push({ ...base, reason: e.message });
    continue;
  }

  if (paid.paidThrough === null) {
    findings.noEvidence.push({ ...base, reason: paid.source });
    continue;
  }

  // The finding: the record grants access past the last period Stripe was paid for.
  if (paid.paidThrough < Date.now()) {
    const grantedUntil = sub.endDate ? new Date(sub.endDate).getTime() : Date.now();
    const after = await Download.countDocuments({
      userId: user._id,
      createdAt: { $gt: new Date(paid.paidThrough) },
    });
    const last = await Download.findOne({ userId: user._id })
      .sort({ createdAt: -1 }).select('createdAt').lean();

    findings.overGranted.push({
      ...base,
      paidThrough: paid.paidThrough,
      invoice: paid.invoice,
      overGrantDays: days(grantedUntil - paid.paidThrough),
      unpaidDays: days(Date.now() - paid.paidThrough),
      downloadsAfterExpiry: after,
      lastDownload: last?.createdAt || null,
    });
  } else {
    findings.ok++;
  }
}

// ── Report ──────────────────────────────────────────────────────────────────
const section = (t) => console.log(`\n${'='.repeat(76)}\n${t}\n${'='.repeat(76)}`);

findings.overGranted.sort((a, b) => b.downloadsAfterExpiry - a.downloadsAfterExpiry);

section(`OVER-GRANTED — access continues past the last period Stripe was paid for  (${findings.overGranted.length})`);
console.log('  These are the poisoned-endDate accounts. The gate is allowing them');
console.log('  because endDate says they are inside a paid period. Stripe says otherwise.\n');
if (!findings.overGranted.length) console.log('  none');
for (const r of findings.overGranted) {
  console.log(`  ! ${r.email}   status=${r.status}  plan=${r.planId ?? 'null'}`);
  console.log(`      paid through ${iso(r.paidThrough)}   record grants until ${iso(r.dbEnd)}   (+${r.overGrantDays}d unpaid access)`);
  console.log(`      unpaid for ${r.unpaidDays}d   downloads since true expiry: ${r.downloadsAfterExpiry}   last download ${iso(r.lastDownload)}   [invoice ${r.invoice}]`);
}

section(`ADMIN-GRANTED — permanent access, not controlled by Stripe  (${findings.adminGranted.length})`);
console.log('  grantedByAdmin bypasses requireSubscription unconditionally and has no');
console.log('  endDate. Nothing expires these. Each needs a human decision.\n');
if (!findings.adminGranted.length) console.log('  none');
for (const r of findings.adminGranted) {
  console.log(`  · ${r.email}   plan=${r.planId ?? 'null'}  status=${r.status}  endDate=${iso(r.dbEnd)}  stripeSub=${r.hasStripeSub ? 'yes' : 'NONE'}  downloads=${r.totalDownloads}`);
}

section(`SHARED-PLAN MEMBERS — access inherited from a primary  (${findings.sharedMember.length})`);
console.log('  Judge these by the primary account; they hold no Stripe subscription.\n');
if (!findings.sharedMember.length) console.log('  none');
for (const r of findings.sharedMember) {
  console.log(`  · ${r.email}   until ${iso(r.dbEnd)}   primary ${r.primaryEmail} (${r.primaryStatus}, until ${iso(r.primaryEnd)})`);
}

section(`NO STRIPE EVIDENCE — access granted, no paid invoice found  (${findings.noEvidence.length})`);
console.log('  Unknown provenance: not admin-granted, not shared, no payment on record.\n');
if (!findings.noEvidence.length) console.log('  none');
for (const r of findings.noEvidence) {
  console.log(`  ? ${r.email}   status=${r.status}  plan=${r.planId ?? 'null'}  until ${iso(r.dbEnd)}  downloads=${r.totalDownloads}  (${r.reason})`);
}

section(`UNVERIFIABLE — Stripe lookup failed  (${findings.unverifiable.length})`);
if (!findings.unverifiable.length) console.log('  none');
for (const r of findings.unverifiable) console.log(`  ? ${r.email}: ${r.reason}`);

section('SUMMARY');
console.log(`  accounts examined (currently granted access)  ${findings.scanned}`);
console.log(`  paid up — correct                            ${findings.ok}`);
console.log(`  OVER-GRANTED                                 ${findings.overGranted.length}   <- revoke candidates`);
console.log(`  admin-granted, no expiry                     ${findings.adminGranted.length}   <- human decision`);
console.log(`  shared members                               ${findings.sharedMember.length}`);
console.log(`  no Stripe evidence                           ${findings.noEvidence.length}`);
console.log(`  unverifiable                                 ${findings.unverifiable.length}`);
console.log(`  skipped: admins ${findings.admins}, no access ${findings.noAccess}`);
const stolen = findings.overGranted.reduce((n, r) => n + r.downloadsAfterExpiry, 0);
if (stolen) console.log(`\n  ${stolen} download(s) taken after the paid period ended, across ${findings.overGranted.length} account(s).`);
console.log('\n  No changes were made. This script cannot write.');

if (csvPath) {
  const rows = [
    ['category', 'email', 'status', 'planId', 'dbEndDate', 'paidThrough', 'overGrantDays', 'unpaidDays', 'downloadsAfterExpiry', 'totalDownloads', 'note'],
    ...findings.overGranted.map(r => ['over_granted', r.email, r.status, r.planId, iso(r.dbEnd), iso(r.paidThrough), r.overGrantDays, r.unpaidDays, r.downloadsAfterExpiry, r.totalDownloads, r.invoice]),
    ...findings.adminGranted.map(r => ['admin_granted', r.email, r.status, r.planId, iso(r.dbEnd), '', '', '', '', r.totalDownloads, r.hasStripeSub ? 'has stripe sub' : 'no stripe sub']),
    ...findings.sharedMember.map(r => ['shared_member', r.email, r.status, r.planId, iso(r.dbEnd), '', '', '', '', r.totalDownloads, `primary ${r.primaryEmail} (${r.primaryStatus})`]),
    ...findings.noEvidence.map(r => ['no_evidence', r.email, r.status, r.planId, iso(r.dbEnd), '', '', '', '', r.totalDownloads, r.reason]),
    ...findings.unverifiable.map(r => ['unverifiable', r.email, r.status, r.planId, iso(r.dbEnd), '', '', '', '', r.totalDownloads, r.reason]),
  ];
  fs.writeFileSync(csvPath, rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n'));
  console.log(`\n  CSV written to ${csvPath}`);
}

await mongoose.disconnect();
