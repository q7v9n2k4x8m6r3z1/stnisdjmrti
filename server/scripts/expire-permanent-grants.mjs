/**
 * Give the never-expiring admin grants an end date.
 *
 * WHY THESE FOUR WERE DIFFERENT
 * -----------------------------
 * Of 47 admin grants, four had `endDate: null`. That is not the
 * grantedByAdmin bypass — all four carry a planId, so that branch never
 * fires. It is simpler and easier to miss: requireSubscription skips the
 * expiry check entirely when endDate is null, then admits anyone whose
 * status is 'active'. Permanent access, with nothing in the record saying
 * so and nothing that will ever end it.
 *
 * WHO IS NOT HERE
 * ---------------
 * clientes.tododjs@gmail.com is deliberately left permanent. It is an
 * internal company account, dormant since July with no downloads in the
 * last 30 days, so it costs nothing — and expiring your own account to
 * tidy a report is the wrong trade.
 *
 * ABOUT THE DATE
 * --------------
 * 2026-11-21, end of day, chosen by the account owner. These three have had
 * free access since June and all three still use the platform; the most
 * recent downloaded yesterday. Thirty days' notice gives them a chance to
 * convert rather than discovering it mid-set.
 *
 * They keep full access until then. Afterwards requireSubscription sees a
 * past endDate, flips the status to 'expired' and returns 403 — the ordinary
 * path, no special handling.
 *
 * SAFETY
 * ------
 * Dry run is the default; nothing is written without --apply. Targets three
 * named addresses and nothing else. Refuses any account that has acquired a
 * Stripe subscription since this was written, because Stripe owns the period
 * for those and a hand-set date would be overwritten or would lie.
 *
 * Reversible: set subscription.endDate back to null.
 *
 * USAGE
 *   cd /var/www/tododjs/server
 *   node scripts/expire-permanent-grants.mjs            # DRY RUN
 *   node scripts/expire-permanent-grants.mjs --apply
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../models/User.js';

const APPLY = process.argv.includes('--apply');

const TARGETS = [
  'kobomartinezdj@gmail.com',
  'djrodriigomez@gmail.com',
  'info.mykedj@gmail.com',
];

// End of day, so they get the whole of the 21st rather than losing access
// at midnight on a date they were told was theirs.
const EXPIRY = new Date('2026-11-21T23:59:59.000Z');

await mongoose.connect(process.env.MONGODB_URI);

console.log(APPLY ? 'APPLY — endDate will be written.' : 'DRY RUN — no writes.');
console.log(`Expiry: ${EXPIRY.toISOString()}\n`);

let changed = 0, skipped = 0;

for (const email of TARGETS) {
  const u = await User.findOne({ email }).select('email subscription').lean();
  if (!u) {
    console.log(`  SKIP  ${email} — no such account`);
    skipped++;
    continue;
  }

  const s = u.subscription || {};

  if (s.stripeSubscriptionId) {
    console.log(`  SKIP  ${email} — now has a Stripe subscription (${s.stripeSubscriptionId}); Stripe owns the period`);
    skipped++;
    continue;
  }

  if (s.endDate) {
    console.log(`  SKIP  ${email} — already expires ${new Date(s.endDate).toISOString().slice(0, 10)}`);
    skipped++;
    continue;
  }

  console.log(`  ${APPLY ? 'SET ' : 'WOULD SET'}  ${email}`);
  console.log(`        plan=${s.planId} status=${s.status} endDate=null -> ${EXPIRY.toISOString().slice(0, 10)}`);

  if (APPLY) {
    // Guarded on endDate still being null, so a concurrent change made in
    // the admin panel while this runs is not silently overwritten.
    const res = await User.updateOne(
      { _id: u._id, 'subscription.endDate': null },
      { $set: { 'subscription.endDate': EXPIRY } }
    );
    if (res.modifiedCount !== 1) {
      console.log('        NOT WRITTEN — endDate changed since it was read; re-run to see current state');
      skipped++;
      continue;
    }
    changed++;
  }
}

console.log(`\n${APPLY ? `written: ${changed}` : `would write: ${TARGETS.length - skipped}`}, skipped: ${skipped}`);
console.log('clientes.tododjs@gmail.com deliberately untouched — internal account, stays permanent.');
if (!APPLY) console.log('\nNothing written. Re-run with --apply.');

await mongoose.disconnect();
