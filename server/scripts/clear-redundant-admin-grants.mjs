/**
 * Clear `grantedByAdmin` on accounts that no longer need it.
 *
 * WHAT THE FLAG ACTUALLY DOES
 * ---------------------------
 * In middleware/subscription.js the bypass is:
 *
 *     if (!user.subscription.planId && user.subscription.grantedByAdmin) next()
 *
 * Note the `!planId`. The flag only short-circuits the gate for accounts with
 * NO planId. On an account that has one, it does nothing at all — that
 * customer is being admitted by the ordinary paid path.
 *
 * That splits the granted accounts in two, and they need opposite handling:
 *
 *   REDUNDANT   planId set AND a live paid Stripe subscription. The flag is
 *               inert. Clearing it changes nothing today, and removes a trap
 *               for later: planId DOES get cleared in practice (an admin
 *               reverting an account to free, a shared member losing their
 *               primary), and the moment it does, a dormant flag becomes a
 *               permanent bypass nobody chose. These are cleared.
 *
 *   LOAD-BEARING  No planId, or no live subscription. The grant is the only
 *               reason the person has access. Clearing it CUTS THEM OFF.
 *               These are reported and never touched — each is somebody's
 *               deliberate decision and needs a human to revisit it.
 *
 * WHY IT RE-DERIVES THE LIST
 * --------------------------
 * The flag is not trusted as a proxy for anything. For every candidate this
 * asks Stripe whether the subscription is really active and paid through a
 * future date, then simulates requireSubscription WITH THE FLAG OFF and only
 * writes when the answer is still "allowed". No account can lose access
 * because a list was stale or a name was typed wrong.
 *
 * SAFETY
 * ------
 * Dry run is the default. Nothing is written without --apply.
 * Only ever sets grantedByAdmin to false — no other field is touched, so the
 * change is reversible by setting it back.
 *
 * USAGE
 *   cd /var/www/tododjs/server
 *   node scripts/clear-redundant-admin-grants.mjs            # DRY RUN
 *   node scripts/clear-redundant-admin-grants.mjs --csv g.csv
 *   node scripts/clear-redundant-admin-grants.mjs --apply    # write
 */
import 'dotenv/config';
import fs from 'fs';
import mongoose from 'mongoose';
import stripe from '../config/stripe.js';
import User, { PAST_DUE_GRACE_MS } from '../models/User.js';
import { hasPaidPlan } from '../utils/stripeTruth.js';

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const csvPath = (() => { const i = argv.indexOf('--csv'); return i === -1 ? null : argv[i + 1]; })();

const iso = (d) => (d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') : '—');

/**
 * Would requireSubscription admit this subscription, ignoring the admin
 * bypass? Mirrors middleware/subscription.js in its real order.
 */
function allowedWithoutGrant(sub = {}) {
  if (!hasPaidPlan(sub)) return false;
  const end = sub.endDate ? new Date(sub.endDate).getTime() : null;
  const now = Date.now();
  const within = end !== null && now <= end;
  const since = end === null ? null : now - end;
  const inGrace = sub.status === 'past_due' && since !== null && since >= 0 && since < PAST_DUE_GRACE_MS;
  if (!inGrace && end !== null && now > end) return false;
  if (sub.status === 'active') return within || end === null;
  if ((sub.status === 'past_due' || sub.status === 'cancelled') && within) return true;
  return inGrace;
}

await mongoose.connect(process.env.MONGODB_URI);

console.log(APPLY
  ? 'APPLY MODE — grantedByAdmin will be set to false on qualifying accounts.'
  : 'DRY RUN — no writes. Re-run with --apply to act on this list.');
console.log('Only accounts that KEEP access without the grant are ever touched.\n');

const granted = await User.find({ 'subscription.grantedByAdmin': true })
  .select('email role subscription').lean();

console.log(`${granted.length} account(s) carry grantedByAdmin.\n`);

const redundant = [];
const loadBearing = [];

for (const u of granted) {
  const sub = u.subscription || {};

  // Ask Stripe directly rather than trusting the local record.
  let stripeStatus = null;
  let stripePeriodEnd = null;
  try {
    if (sub.stripeSubscriptionId) {
      const s = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
      stripeStatus = s.status;
      stripePeriodEnd = s.current_period_end ? new Date(s.current_period_end * 1000) : null;
    } else if (sub.stripeCustomerId) {
      const list = await stripe.subscriptions.list({ customer: sub.stripeCustomerId, status: 'active', limit: 1 });
      if (list.data.length) {
        stripeStatus = list.data[0].status;
        stripePeriodEnd = list.data[0].current_period_end
          ? new Date(list.data[0].current_period_end * 1000) : null;
      }
    }
  } catch (e) {
    stripeStatus = `lookup failed: ${e.message}`;
  }

  const stripeLive = ['active', 'trialing'].includes(stripeStatus)
    && stripePeriodEnd !== null && stripePeriodEnd.getTime() > Date.now();
  const keepsAccess = allowedWithoutGrant(sub);
  // The bypass only fires without a planId — that is what makes a grant
  // load-bearing rather than decorative.
  const bypassActive = !sub.planId;

  const row = {
    email: u.email, role: u.role, planId: sub.planId || null, status: sub.status || null,
    endDate: sub.endDate || null, stripeStatus, stripePeriodEnd, stripeLive, keepsAccess, bypassActive,
  };

  // Both conditions required. Stripe being live is not enough on its own:
  // the local record is what the gate reads, and it must independently pass.
  if (stripeLive && keepsAccess && !bypassActive) redundant.push(row);
  else loadBearing.push(row);
}

console.log('='.repeat(76));
console.log(`REDUNDANT — flag is inert, clearing changes nothing today  (${redundant.length})`);
console.log('='.repeat(76));
for (const r of redundant) {
  console.log(`\n  ${r.email}`);
  console.log(`    local : plan=${r.planId}  status=${r.status}  endDate=${iso(r.endDate)}`);
  console.log(`    stripe: ${r.stripeStatus}, paid through ${iso(r.stripePeriodEnd)}`);
  console.log(`    keeps access with the flag off: YES`);
}
if (!redundant.length) console.log('\n  none');

console.log(`\n${'='.repeat(76)}`);
console.log(`LOAD-BEARING — NOT TOUCHED, clearing would remove access  (${loadBearing.length})`);
console.log('='.repeat(76));
for (const r of loadBearing) {
  const why = r.bypassActive
    ? 'no planId — the grant IS the access'
    : !r.stripeLive ? `no live Stripe subscription (${r.stripeStatus || 'none'})`
    : 'local record would not pass the gate';
  console.log(`\n  ${r.email}`);
  console.log(`    local : plan=${r.planId || 'NONE'}  status=${r.status}  endDate=${iso(r.endDate)}`);
  console.log(`    reason: ${why}`);
}
if (!loadBearing.length) console.log('\n  none');

if (APPLY && redundant.length) {
  const ids = await User.find({ email: { $in: redundant.map(r => r.email) } }).select('_id').lean();
  const res = await User.updateMany(
    { _id: { $in: ids.map(i => i._id) } },
    { $set: { 'subscription.grantedByAdmin': false } }
  );
  console.log(`\n${'='.repeat(76)}`);
  console.log(`CLEARED grantedByAdmin on ${res.modifiedCount} account(s).`);
  console.log('Reversible: set subscription.grantedByAdmin back to true to restore.');
  console.log('='.repeat(76));
}

if (csvPath) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  fs.writeFileSync(csvPath, [
    'email,category,planId,local_status,local_end_date,stripe_status,stripe_paid_through,bypass_was_active',
    ...[...redundant.map(r => ({ ...r, cat: 'redundant' })), ...loadBearing.map(r => ({ ...r, cat: 'load-bearing' }))]
      .map(r => [r.email, r.cat, r.planId || '', r.status || '', iso(r.endDate),
        r.stripeStatus || '', iso(r.stripePeriodEnd), r.bypassActive ? 'yes' : 'no'].map(esc).join(',')),
  ].join('\n'));
  console.log(`\nCSV written to ${csvPath}`);
}

if (!APPLY) console.log('\nNo changes were made. Re-run with --apply to write.');
await mongoose.disconnect();
