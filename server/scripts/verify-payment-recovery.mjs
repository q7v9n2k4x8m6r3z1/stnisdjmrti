/**
 * Read-only verification of the failed-payment RECOVERY path.
 *
 * THE QUESTION THIS ANSWERS
 * -------------------------
 * When a customer pays an outstanding invoice — from the hosted Stripe invoice
 * link we send over WhatsApp, from the emailed link, or from the customer
 * portal — does TodoDJS restore their access automatically and immediately,
 * with nobody touching the admin panel?
 *
 * The code path is handleInvoicePaid in controllers/stripeController.js, and
 * reading it is not enough to answer the question. Three things decide it that
 * live outside the repository:
 *
 *   1. Whether the webhook endpoint in the Stripe dashboard is ENABLED. Stripe
 *      auto-disables an endpoint after repeated delivery failures, which is
 *      what happened during the outages behind the "paid but still Free"
 *      incidents. A disabled endpoint means no event, no restore, no error —
 *      the customer simply stays locked out.
 *
 *   2. Whether that endpoint SUBSCRIBES to invoice.paid /
 *      invoice.payment_succeeded. An endpoint listening only to
 *      checkout.session.completed handles new signups perfectly and never
 *      restores a single recovered payment.
 *
 *   3. Whether the API version the endpoint serializes with still carries the
 *      fields the handler reads. Production is on 2026-01-28.clover, where
 *      `invoice.subscription` was removed in favour of
 *      `invoice.parent.subscription_details.subscription`.
 *
 * So this script asks Stripe directly, and then — the strongest evidence
 * available — replays real history: every invoice that FAILED and was later
 * PAID is a completed instance of the exact flow in question. If our record
 * restored those accounts, the flow works. If it did not, this names who.
 *
 * SAFETY
 * ------
 * STRICTLY READ-ONLY. No --apply flag, no write path, no email is sent. It
 * opens the database connection, reads, and disconnects.
 *
 * USAGE
 *   cd /var/www/tododjs/server
 *   node scripts/verify-payment-recovery.mjs
 *   node scripts/verify-payment-recovery.mjs --days 90
 *   node scripts/verify-payment-recovery.mjs --email cliente@example.com
 *
 * Run from the SERVER directory, not the repo root: `import 'dotenv/config'`
 * reads .env from the current working directory, and the credentials live in
 * server/.env.
 *
 * Needs MONGODB_URI and STRIPE_SECRET_KEY. On staging (APP_ENV=staging) it
 * talks to the Stripe TEST account, because config/stripe.js switches keys —
 * so the same command verifies staging before production.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import stripe from '../config/stripe.js';
import { isStaging } from '../config/stripeTest.js';
import User, { hasActiveWindow } from '../models/User.js';

const argv = process.argv.slice(2);
const value = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 ? argv[i + 1] : null;
};

const days = value('days') ? parseInt(value('days'), 10) : 60;
const onlyEmail = value('email');

const iso = (d) => (d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') : '—');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Mirrors the readers in controllers/stripeController.js. Kept local and
// deliberately duplicated: this script's job is to CHECK that code, so sharing
// a helper with it would hide exactly the class of bug being looked for (a
// field rename that returns undefined on every live event).
function invoiceSubscriptionId(invoice) {
  const raw = invoice?.subscription ?? invoice?.parent?.subscription_details?.subscription ?? null;
  return (raw && typeof raw === 'object' ? raw.id : raw) || null;
}

// The events the recovery path depends on. invoice.paid and
// invoice.payment_succeeded both map to handleInvoicePaid, so EITHER is
// sufficient for restore — but at least one must be present.
const RESTORE_EVENTS = ['invoice.paid', 'invoice.payment_succeeded'];
const SUPPORTING_EVENTS = [
  'invoice.payment_failed',        // marks past_due + sends the notification
  'customer.subscription.updated', // keeps status in step with Stripe
  'customer.subscription.deleted',
  'checkout.session.completed',
];

const problems = [];
const note = (s) => problems.push(s);

await mongoose.connect(process.env.MONGODB_URI);

console.log('READ-ONLY — no writes, no emails.');
console.log(`Stripe mode: ${isStaging ? 'TEST (APP_ENV=staging)' : 'LIVE'}`);
console.log(`Window: last ${days} days\n`);

// ── A. Webhook endpoint health ──────────────────────────────────────────────
console.log('─'.repeat(72));
console.log('A. WEBHOOK ENDPOINTS');
console.log('─'.repeat(72));

let anyEndpointCanRestore = false;

try {
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });

  if (!endpoints.data.length) {
    note('No webhook endpoint exists at all — nothing can restore access automatically.');
    console.log('  NONE CONFIGURED.');
  }

  for (const ep of endpoints.data) {
    const listensToAll = ep.enabled_events.includes('*');
    const restore = listensToAll ? RESTORE_EVENTS : RESTORE_EVENTS.filter(e => ep.enabled_events.includes(e));
    const missingSupport = listensToAll ? [] : SUPPORTING_EVENTS.filter(e => !ep.enabled_events.includes(e));
    const live = ep.status === 'enabled';
    const canRestore = live && restore.length > 0;
    if (canRestore) anyEndpointCanRestore = true;

    console.log(`\n  ${ep.url}`);
    console.log(`    status        : ${ep.status}${live ? '' : '   <-- DISABLED'}`);
    console.log(`    api_version   : ${ep.api_version || '(account default)'}`);
    console.log(`    restore events: ${restore.length ? restore.join(', ') : 'NONE'}`);
    if (missingSupport.length) console.log(`    also missing  : ${missingSupport.join(', ')}`);

    if (!live) {
      note(`Endpoint ${ep.url} is ${ep.status}. Stripe disables endpoints after repeated delivery failures; while disabled, recovered payments are never delivered and access is never restored.`);
    } else if (!restore.length) {
      note(`Endpoint ${ep.url} does not subscribe to ${RESTORE_EVENTS.join(' or ')}. Paying an outstanding invoice will not restore access through this endpoint.`);
    }
  }
} catch (e) {
  note(`Could not read webhook endpoints: ${e.message}. (A restricted API key may not have this permission — check the dashboard by hand.)`);
  console.log(`  ERROR: ${e.message}`);
}

if (!anyEndpointCanRestore) {
  console.log('\n  >> No enabled endpoint is subscribed to a restore event.');
}

// ── B. Who is unpaid right now ──────────────────────────────────────────────
console.log(`\n${'─'.repeat(72)}`);
console.log('B. OUTSTANDING INVOICES (pay links to send)');
console.log('─'.repeat(72));

let openCount = 0;

for await (const inv of stripe.invoices.list({ status: 'open', limit: 100 })) {
  const subId = invoiceSubscriptionId(inv);
  if (!subId) continue; // one-off invoice, not a subscription lapse

  const or = [{ 'subscription.stripeSubscriptionId': subId }];
  if (inv.customer) or.push({ 'subscription.stripeCustomerId': inv.customer });
  const user = await User.findOne({ $or: or }).select('email subscription').lean();

  if (onlyEmail && user?.email?.toLowerCase() !== onlyEmail.toLowerCase()) continue;

  openCount++;
  const sub = user?.subscription || {};
  console.log(`\n  ${user?.email || `(no account for customer ${inv.customer})`}`);
  console.log(`    invoice   : ${inv.id}  ${(inv.amount_due / 100).toFixed(2)} ${inv.currency.toUpperCase()}  attempts=${inv.attempt_count}`);
  console.log(`    our record: status=${sub.status || '—'}  endDate=${iso(sub.endDate)}  access=${user ? (hasActiveWindow(sub) ? 'YES' : 'no') : '—'}`);
  console.log(`    pay link  : ${inv.hosted_invoice_url || '(none — invoice has no hosted page)'}`);
}

if (!openCount) console.log('\n  None. No customer currently owes an open invoice.');

// ── C. Replay: did past recoveries actually restore access? ─────────────────
console.log(`\n${'─'.repeat(72)}`);
console.log('C. RECOVERY REPLAY — invoices that FAILED, then were PAID');
console.log('─'.repeat(72));
console.log('Each row below is a completed run of the exact flow in question.\n');

const since = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
let replayed = 0;
let restored = 0;

for await (const inv of stripe.invoices.list({ status: 'paid', created: { gte: since }, limit: 100 })) {
  // attempt_count > 1 means Stripe tried, failed, and only later succeeded —
  // whether by its own retry, the emailed link, or the link sent by hand.
  // Those are the only invoices that exercise the recovery path.
  if (!(inv.attempt_count > 1)) continue;

  const subId = invoiceSubscriptionId(inv);
  const or = [];
  if (subId) or.push({ 'subscription.stripeSubscriptionId': subId });
  if (inv.customer) or.push({ 'subscription.stripeCustomerId': inv.customer });
  if (!or.length) continue;

  const user = await User.findOne({ $or: or }).select('email subscription subscriptionHistory').lean();
  if (!user) {
    note(`Invoice ${inv.id} was recovered at Stripe but matches NO account (customer ${inv.customer}).`);
    continue;
  }
  if (onlyEmail && user.email.toLowerCase() !== onlyEmail.toLowerCase()) continue;

  replayed++;
  const sub = user.subscription || {};

  // Three independent signs the webhook did its job:
  //   recorded — handleInvoicePaid wrote a history row keyed on the invoice id
  //   covered  — endDate reaches the period this invoice paid for
  //   access   — the real entitlement predicate says yes right now
  const recorded = (user.subscriptionHistory || [])
    .some(h => h.stripePaymentIntentId === inv.id);
  const paidThrough = inv.lines?.data?.[0]?.period?.end
    ? new Date(inv.lines.data[0].period.end * 1000)
    : null;
  const dbEnd = sub.endDate ? new Date(sub.endDate) : null;
  const covered = !paidThrough || (dbEnd && dbEnd.getTime() >= paidThrough.getTime() - 60_000);
  const access = hasActiveWindow(sub);

  const ok = recorded && covered;
  if (ok) restored++;

  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${user.email}`);
  console.log(`       invoice ${inv.id}  paid ${iso(inv.status_transitions?.paid_at * 1000)}  after ${inv.attempt_count} attempts`);
  console.log(`       stripe paid through ${iso(paidThrough)} | our endDate ${iso(dbEnd)} | status ${sub.status || '—'}`);
  console.log(`       history row ${recorded ? 'written' : 'MISSING'} | period ${covered ? 'covered' : 'NOT COVERED'} | access now ${access ? 'YES' : 'NO'}`);

  if (!recorded) {
    note(`${user.email}: invoice ${inv.id} was paid at Stripe but handleInvoicePaid never recorded it — the webhook did not arrive or did not process.`);
  } else if (!covered) {
    note(`${user.email}: invoice ${inv.id} recorded, but endDate ${iso(dbEnd)} does not reach the paid-through date ${iso(paidThrough)}.`);
  }
}

if (!replayed) {
  console.log('  No failed-then-paid invoices in this window.');
  console.log('  Nothing to confirm from history — exercise the flow in staging instead');
  console.log('  (card 4000 0000 0000 0341 authorises, then fails on renewal).');
} else {
  console.log(`\n  ${restored}/${replayed} recovered payments restored access automatically.`);
}

// ── Verdict ─────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(72)}`);
if (!problems.length) {
  console.log('VERDICT: no problems found in the recovery path.');
  if (!replayed) {
    console.log('Note: confirmed by configuration only — no real recovery occurred in this');
    console.log('window to confirm it end to end.');
  }
} else {
  console.log(`VERDICT: ${problems.length} problem(s) found.\n`);
  problems.forEach((p, i) => console.log(`  ${i + 1}. ${p}\n`));
}
console.log('═'.repeat(72));

await mongoose.disconnect();
