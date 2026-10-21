/**
 * Email the customers whose payment has failed, with a link to settle it.
 *
 * WHY THIS IS A SCRIPT AND NOT A CAMPAIGN
 * ---------------------------------------
 * A campaign sends one body to an audience. Each person here needs their OWN
 * Stripe hosted-invoice URL, which is unguessable and specific to their
 * unpaid invoice. There is no audience rule that produces that.
 *
 * WHY IT RUNS BEFORE THE REVOCATION
 * ---------------------------------
 * 22 accounts currently hold access a month beyond what they paid for, and
 * every corrected date is already in the past — so revoking cuts all of them
 * off the same afternoon. Mailing a working pay link first turns that from a
 * churn event into a collection. Customers who pay keep their access and
 * never know; the rest can be revoked with a clear conscience.
 *
 * It reuses getPaymentFailedEmailTemplate rather than inventing a near
 * duplicate: that template already takes a payUrl, already has the Spanish
 * copy, and is already in production.
 *
 * SAFETY
 * ------
 * Dry run is the default. Nothing is sent without --apply.
 *   - the suppression list is checked per recipient, so anyone who
 *     unsubscribed or hard-bounced is skipped
 *   - subscription.overdueNoticeSentAt is stamped on success, so re-running
 *     to catch stragglers does not mail the same person twice
 *     (--resend-after <hours> deliberately overrides that)
 *   - sends are paced, and a send that throws stops nothing else
 *   - only customers with an OPEN invoice and a real pay link are contacted
 *
 * USAGE
 *   cd /var/www/tododjs/server
 *   node scripts/notify-overdue-customers.mjs                  # DRY RUN
 *   node scripts/notify-overdue-customers.mjs --limit 1 --apply # one, as a test
 *   node scripts/notify-overdue-customers.mjs --apply
 *   node scripts/notify-overdue-customers.mjs --apply --resend-after 72
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import stripe from '../config/stripe.js';
import User from '../models/User.js';
import Suppression from '../models/Suppression.js';
import { sendPaymentFailedEmail } from '../services/emailService.js';
import { currentPeriodIsPaid } from '../utils/stripeTruth.js';

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const num = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return dflt;
  const v = parseInt(argv[i + 1], 10);
  return Number.isFinite(v) ? v : dflt;
};
const limit = num('limit', Infinity);
const resendAfterHours = num('resend-after', null);

// --to <address>: send ONE email to that address instead of to a customer.
//
// `--limit 1 --apply` is not a test — it mails a real customer who has not
// yet heard from us. This exists so the admin can read the thing that is
// about to go out, and click the pay link, before anyone else receives it.
//
// It borrows the first candidate's REAL invoice URL, because a test with a
// fake link proves nothing about the part most likely to be wrong. It does
// not stamp overdueNoticeSentAt: that customer has still not been notified,
// and must not be skipped on the real run.
const testTo = (() => {
  const i = argv.indexOf('--to');
  return i === -1 ? null : (argv[i + 1] || null);
})();

const SEND_INTERVAL_MS = 800;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') : '—');

await mongoose.connect(process.env.MONGODB_URI);

console.log(APPLY ? 'APPLY — emails WILL be sent.' : 'DRY RUN — nothing will be sent.');
console.log(`Pacing ${SEND_INTERVAL_MS}ms between sends.\n`);

// Open invoices are the source of truth for "owes money right now". A
// subscription Stripe has since cancelled still leaves its unpaid invoice
// behind, and that customer is exactly who should hear from us.
const candidates = [];
for await (const inv of stripe.invoices.list({ status: 'open', limit: 100 })) {
  if (!inv.customer || !inv.attempt_count) continue;
  if (!inv.hosted_invoice_url) continue; // nothing actionable to send

  const user = await User.findOne({ 'subscription.stripeCustomerId': inv.customer })
    .select('email name preferredLanguage subscription').lean();
  if (!user) continue; // no account — nobody to contact

  // An open invoice does not always mean the customer owes anything today.
  // Stripe leaves an old failed invoice open even after a LATER one is paid,
  // so some of these people are fully paid up with a stale document behind
  // them. Telling a paying customer their payment failed is worse than
  // saying nothing — same test the webhook now uses before extending access.
  const subId = user.subscription?.stripeSubscriptionId;
  if (subId && await currentPeriodIsPaid(subId)) {
    console.log(`  SKIP  ${user.email} — current period IS paid; open invoice ${inv.id} is stale`);
    continue;
  }

  candidates.push({
    user,
    invoiceId: inv.id,
    amount: (inv.amount_due || 0) / 100,
    currency: String(inv.currency || '').toUpperCase(),
    attempts: inv.attempt_count,
    payUrl: inv.hosted_invoice_url,
  });
}

// Oldest debt first — those have been failing longest and are closest to
// being cut off.
candidates.sort((a, b) => b.attempts - a.attempts);

if (testTo) {
  const sample = candidates[0];
  if (!sample) {
    console.log('No candidates, so there is nothing to render a test from.');
    await mongoose.disconnect();
    process.exit(0);
  }
  console.log(`TEST SEND to ${testTo}`);
  console.log(`Rendered from ${sample.user.email} — their real pay link, their amount.`);
  console.log(`That customer is NOT being notified and will still be included in the real run.\n`);

  if (!APPLY) {
    console.log('DRY RUN — add --apply to actually send this test.');
    await mongoose.disconnect();
    process.exit(0);
  }

  // Their language, so the test shows what they will really receive.
  const res = await sendPaymentFailedEmail(
    { ...sample.user, email: testTo },
    sample.payUrl
  );
  console.log(res?.success
    ? `SENT to ${testTo} (id ${res.id}). Open it, read the Spanish, and click the pay button — it should load a Stripe invoice for ${sample.amount.toFixed(2)} ${sample.currency}.`
    : `FAILED: ${res?.error || 'unknown error'}`);
  await mongoose.disconnect();
  process.exit(res?.success ? 0 : 1);
}

const suppressed = await Suppression.filterSuppressed(candidates.map(c => c.user.email));

let sent = 0, skippedSuppressed = 0, skippedAlready = 0, failed = 0, considered = 0;

for (const c of candidates) {
  if (considered >= limit) break;

  const email = String(c.user.email).toLowerCase();

  if (suppressed.has(email)) {
    skippedSuppressed++;
    console.log(`  SKIP  ${c.user.email} — unsubscribed or bounced`);
    continue;
  }

  const already = c.user.subscription?.overdueNoticeSentAt;
  if (already) {
    const hrs = (Date.now() - new Date(already).getTime()) / 3600000;
    if (resendAfterHours === null || hrs < resendAfterHours) {
      skippedAlready++;
      console.log(`  SKIP  ${c.user.email} — already notified ${iso(already)}` +
        (resendAfterHours === null ? ' (use --resend-after <hours> to send again)' : ` (${Math.round(hrs)}h ago)`));
      continue;
    }
  }

  considered++;

  if (!APPLY) {
    console.log(`  WOULD SEND  ${c.user.email}  owes ${c.amount.toFixed(2)} ${c.currency} after ${c.attempts} attempts`);
    console.log(`              link ${c.payUrl.slice(0, 72)}...`);
    continue;
  }

  if (sent > 0) await sleep(SEND_INTERVAL_MS);

  try {
    const res = await sendPaymentFailedEmail(c.user, c.payUrl);
    if (res?.success) {
      // Stamped only on a confirmed send, so a failure is retried next run
      // rather than silently counted as delivered.
      await User.updateOne(
        { _id: c.user._id },
        { $set: { 'subscription.overdueNoticeSentAt': new Date() } }
      );
      sent++;
      console.log(`  SENT  ${c.user.email}  (${c.amount.toFixed(2)} ${c.currency})`);
    } else {
      failed++;
      console.log(`  FAIL  ${c.user.email} — ${res?.error || 'unknown error'}`);
    }
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${c.user.email} — ${e.message}`);
  }
}

console.log(`\n${'='.repeat(70)}`);
console.log(`candidates with an open invoice and an account : ${candidates.length}`);
console.log(`  skipped, suppressed                          : ${skippedSuppressed}`);
console.log(`  skipped, already notified                    : ${skippedAlready}`);
console.log(APPLY ? `  SENT                                         : ${sent}` : `  would send                                   : ${considered}`);
if (failed) console.log(`  failed                                       : ${failed}`);
console.log('='.repeat(70));

if (!APPLY) {
  console.log('\nNothing was sent. Re-run with --apply.');
  console.log('Consider --limit 1 --apply first and read the email that arrives.');
}

await mongoose.disconnect();
