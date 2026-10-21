/**
 * Who can still download while their payment is failing — and WHY.
 *
 * THE COMPLAINT THIS ANSWERS
 * --------------------------
 * "Customers with failed payments can still download songs."
 *
 * That can be true for several completely different reasons, and they need
 * opposite responses, so a list of names is not enough. This reports the
 * reason the gate let each person through:
 *
 *   PAID THROUGH LATER   Legitimate. An old invoice is unpaid, but a later one
 *                        was paid and covers today. Not a bug; Stripe leaves
 *                        the stale invoice open. Nothing to do.
 *
 *   INSIDE PAID PERIOD   Legitimate and deliberate. A failed RENEWAL concerns
 *                        the NEXT period; the customer keeps what they already
 *                        bought until endDate. Looks wrong from the Stripe
 *                        dashboard, is correct.
 *
 *   ADMIN GRANT          A human decision, not a payment. grantedByAdmin was
 *                        widely applied as a workaround during the webhook
 *                        outage, and those grants outlive the problem they
 *                        fixed — the account keeps access however the payment
 *                        goes. This is the likely answer to the complaint.
 *
 *   ADMIN ROLE           role === 'admin' bypasses every subscription check.
 *
 *   OVER-GRANTED         A real defect: endDate reaches beyond anything Stripe
 *                        was ever paid for. scripts/revoke-overgranted-access
 *                        exists for exactly this.
 *
 * Access is decided by replicating middleware/subscription.js in the same
 * order it runs, so the verdict here is what the download endpoint actually
 * does, not an approximation of it.
 *
 * It also counts downloads taken SINCE the payment first failed, which is the
 * number that tells you whether any of this cost anything.
 *
 * SAFETY
 * ------
 * STRICTLY READ-ONLY. No --apply, no write path, no email.
 *
 * USAGE
 *   cd /var/www/tododjs/server
 *   node scripts/track-unpaid-downloaders.mjs
 *   node scripts/track-unpaid-downloaders.mjs --csv unpaid.csv
 *
 * Run from the SERVER directory — dotenv reads .env from the working
 * directory, and the credentials live in server/.env.
 */
import 'dotenv/config';
import fs from 'fs';
import mongoose from 'mongoose';
import stripe from '../config/stripe.js';
import User, { PAST_DUE_GRACE_MS } from '../models/User.js';
import Download from '../models/Download.js';
import { truePaidThrough, hasPaidPlan } from '../utils/stripeTruth.js';

const argv = process.argv.slice(2);
const csvPath = (() => { const i = argv.indexOf('--csv'); return i === -1 ? null : argv[i + 1]; })();

const iso = (d) => (d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') : '—');
const DAY = 24 * 60 * 60 * 1000;

/**
 * Replicates requireSubscription (middleware/subscription.js) branch for
 * branch, in its real order, and names the branch that decided it.
 */
function accessVerdict(user) {
  const s = user.subscription || {};
  if (user.role === 'admin') return { allowed: true, reason: 'ADMIN ROLE' };
  if (!s.planId && s.grantedByAdmin) return { allowed: true, reason: 'ADMIN GRANT' };

  if (!hasPaidPlan(s)) return { allowed: false, reason: 'no paid plan' };

  const end = s.endDate ? new Date(s.endDate).getTime() : null;
  const now = Date.now();
  const within = end !== null && now <= end;
  const since = end === null ? null : now - end;
  const inGrace = s.status === 'past_due' && since !== null && since >= 0 && since < PAST_DUE_GRACE_MS;

  if (!inGrace && end !== null && now > end) return { allowed: false, reason: 'expired' };

  if (s.status === 'active') return { allowed: true, reason: 'STATUS ACTIVE' };
  if (s.status === 'past_due' && within) return { allowed: true, reason: 'INSIDE PAID PERIOD' };
  if (s.status === 'cancelled' && within) return { allowed: true, reason: 'INSIDE PAID PERIOD' };
  if (inGrace) return { allowed: true, reason: 'past-due grace' };
  return { allowed: false, reason: `status ${s.status || 'none'}` };
}

await mongoose.connect(process.env.MONGODB_URI);

console.log('READ-ONLY — no writes, no emails.');
console.log(`Past-due grace: ${PAST_DUE_GRACE_MS === 0 ? 'zero (policy)' : Math.round(PAST_DUE_GRACE_MS / DAY) + 'd'}\n`);

// Every customer with money outstanding right now. Open invoices are the
// authority rather than subscription status: a subscription Stripe has since
// cancelled still leaves its unpaid invoice behind, and that customer is
// exactly who the complaint is about.
const owing = new Map(); // customerId -> { amount, attempts, oldestFailed, invoices[] }

for await (const inv of stripe.invoices.list({ status: 'open', limit: 100 })) {
  if (!inv.customer || !inv.attempt_count) continue;
  const cur = owing.get(inv.customer) || { amount: 0, attempts: 0, oldestFailed: null, invoices: [] };
  cur.amount += (inv.amount_due || 0) / 100;
  cur.attempts = Math.max(cur.attempts, inv.attempt_count || 0);
  const failedAt = inv.status_transitions?.finalized_at
    ? new Date(inv.status_transitions.finalized_at * 1000)
    : new Date(inv.created * 1000);
  if (!cur.oldestFailed || failedAt < cur.oldestFailed) cur.oldestFailed = failedAt;
  cur.invoices.push({ id: inv.id, url: inv.hosted_invoice_url, currency: inv.currency });
  owing.set(inv.customer, cur);
}

console.log(`${owing.size} customer(s) with an unpaid invoice at Stripe.\n`);

const rows = [];

for (const [customerId, debt] of owing) {
  const user = await User.findOne({ 'subscription.stripeCustomerId': customerId })
    .select('email role subscription').lean();

  if (!user) {
    rows.push({
      email: `(no account — stripe customer ${customerId})`,
      allowed: null, reason: 'NO ACCOUNT', debt, downloads: 0, paidThrough: null,
    });
    continue;
  }

  const verdict = accessVerdict(user);

  // Downloads taken since the payment started failing — the actual cost.
  const downloads = debt.oldestFailed
    ? await Download.countDocuments({ userId: user._id, createdAt: { $gte: debt.oldestFailed } })
    : 0;

  // Is the access window backed by a real payment, or beyond anything Stripe
  // ever received? This is what separates a defect from a stale open invoice.
  let paidThrough = null;
  try {
    const t = await truePaidThrough(user.subscription || {});
    paidThrough = t?.paidThrough ? new Date(t.paidThrough) : null;
  } catch { /* leave null — reported as unknown */ }

  let reason = verdict.reason;
  const end = user.subscription?.endDate ? new Date(user.subscription.endDate) : null;
  if (verdict.allowed && reason === 'STATUS ACTIVE') {
    if (paidThrough && end && end.getTime() > paidThrough.getTime() + 60_000) reason = 'OVER-GRANTED';
    else if (paidThrough) reason = 'PAID THROUGH LATER';
  }
  if (verdict.allowed && user.subscription?.grantedByAdmin && reason !== 'ADMIN ROLE') {
    reason += ' + admin grant';
  }

  rows.push({ email: user.email, allowed: verdict.allowed, reason, debt, downloads, paidThrough, end });
}

// Worst first: people downloading while owing, most downloads at the top.
rows.sort((a, b) => (b.allowed === true) - (a.allowed === true) || b.downloads - a.downloads);

const canDownload = rows.filter(r => r.allowed === true);
const blocked = rows.filter(r => r.allowed === false);
const orphans = rows.filter(r => r.allowed === null);

console.log('='.repeat(76));
console.log(`CAN STILL DOWNLOAD WHILE OWING  (${canDownload.length})`);
console.log('='.repeat(76));
for (const r of canDownload) {
  console.log(`\n  ${r.email}`);
  console.log(`    reason      : ${r.reason}`);
  console.log(`    owes        : ${r.debt.amount.toFixed(2)} ${r.debt.invoices[0]?.currency?.toUpperCase() || ''}  after ${r.debt.attempts} attempts, failing since ${iso(r.debt.oldestFailed)}`);
  console.log(`    our endDate : ${iso(r.end)}   stripe paid through: ${iso(r.paidThrough)}`);
  console.log(`    DOWNLOADS SINCE PAYMENT FAILED: ${r.downloads}`);
  for (const i of r.debt.invoices) console.log(`    pay link    : ${i.url || '(none)'}`);
}
if (!canDownload.length) console.log('\n  none');

console.log(`\n${'='.repeat(76)}`);
console.log(`CORRECTLY BLOCKED  (${blocked.length})`);
console.log('='.repeat(76));
for (const r of blocked) {
  console.log(`  ${r.email}  — ${r.reason}, owes ${r.debt.amount.toFixed(2)}, ${r.downloads} downloads since failure`);
}
if (!blocked.length) console.log('  none');

if (orphans.length) {
  console.log(`\n${'='.repeat(76)}`);
  console.log(`UNPAID WITH NO ACCOUNT  (${orphans.length})  — nobody to contact, no access to revoke`);
  console.log('='.repeat(76));
  for (const r of orphans) console.log(`  ${r.email}  owes ${r.debt.amount.toFixed(2)}`);
}

// Reason rollup — this is the line that answers the complaint.
console.log(`\n${'='.repeat(76)}`);
console.log('WHY THEY HAVE ACCESS');
console.log('='.repeat(76));
const byReason = {};
for (const r of canDownload) byReason[r.reason] = (byReason[r.reason] || 0) + 1;
for (const [reason, n] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(3)}  ${reason}`);
}
const leaked = canDownload.reduce((n, r) => n + r.downloads, 0);
console.log(`\n  ${leaked} download(s) taken while owing money.`);

if (csvPath) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  fs.writeFileSync(csvPath, [
    'email,access,reason,owes,attempts,failing_since,our_end_date,stripe_paid_through,downloads_since_failure,pay_link',
    ...rows.map(r => [
      r.email, r.allowed === null ? 'no account' : r.allowed ? 'YES' : 'no', r.reason,
      r.debt.amount.toFixed(2), r.debt.attempts, iso(r.debt.oldestFailed),
      iso(r.end), iso(r.paidThrough), r.downloads, r.debt.invoices[0]?.url || '',
    ].map(esc).join(',')),
  ].join('\n'));
  console.log(`\nCSV written to ${csvPath}`);
}

console.log('\nNo changes were made. This script cannot write.');
await mongoose.disconnect();
