/**
 * Subscription reconciler — a webhook-independent safety net.
 *
 * Activation normally happens via Stripe webhooks, but that path has proven
 * fragile in production: Stripe auto-disables an endpoint after repeated
 * delivery failures (which happens during any server outage), and every event
 * missed while it is disabled is simply never retried. Customers then pay
 * successfully and stay on the free plan — several paid two to six times
 * believing the first attempt failed.
 *
 * Checkout has a user-facing fallback (verify-payment activates inline), but
 * RENEWALS have no page to fall back on: a renewal happens while nobody is
 * looking. This job closes that gap by periodically treating Stripe as the
 * source of truth and repairing any account that disagrees.
 *
 * Safety: only RESTORES access that Stripe says the customer has paid for.
 * The reverse case (active here, gone at Stripe) is logged for admin review
 * rather than auto-downgraded — wrongly cutting off a paying customer is far
 * worse than briefly over-granting, and that direction deserves a human look.
 */
import stripe from '../config/stripe.js';
import User from '../models/User.js';
import SubscriptionPlan from '../models/SubscriptionPlan.js';
import { currentPeriodIsPaid } from '../utils/stripeTruth.js';

const STALE_TOLERANCE_MS = 60 * 1000; // ignore sub-minute endDate drift

/**
 * @param {{ dryRun?: boolean }} opts
 * @returns {Promise<{checked:number, repaired:Array, orphans:Array, suspect:Array}>}
 */
export async function reconcileSubscriptions({ dryRun = false } = {}) {
  const report = { checked: 0, repaired: [], orphans: [], suspect: [] };

  // Map Stripe price -> our plan, so the plan is resolved from what the
  // customer is actually being billed for rather than guessed.
  const priceToPlan = {};
  for (const p of await SubscriptionPlan.find({}).lean()) {
    if (p.stripePriceId) priceToPlan[p.stripePriceId] = p;
  }

  // Walk Stripe (not the DB): a DB-first walk misses users whose record has
  // no stripeSubscriptionId at all — exactly the broken ones we need to find.
  for await (const s of stripe.subscriptions.list({
    status: 'active',
    limit: 100,
    expand: ['data.customer'],
  })) {
    report.checked++;
    const email = typeof s.customer === 'object' ? s.customer?.email : null;
    const customerId = typeof s.customer === 'object' ? s.customer?.id : s.customer;

    // Match on the Stripe IDs as well as the email.
    //
    // People routinely pay with a different address than the one on their
    // account — a work address, a PayPal-linked Gmail, a partner's card. An
    // email-only lookup reported every one of those as "paying at Stripe, no
    // TodoDJS account" on every hourly run, when the account was there all
    // along, correctly linked by customer id.
    //
    // That is worse than noise. A recurring false alarm is indistinguishable
    // from a real one, so a customer genuinely paying for nothing would sit
    // unnoticed in the same list. The IDs are the authoritative link; the
    // email is only a convenience for accounts predating them.
    const or = [];
    if (s.id) or.push({ 'subscription.stripeSubscriptionId': s.id });
    if (customerId) or.push({ 'subscription.stripeCustomerId': customerId });
    if (email) {
      or.push({ email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
    }
    if (!or.length) continue;

    const user = await User.findOne({ $or: or }).select('email subscription maxDevices').lean();

    if (!user) {
      report.orphans.push({ email: email || `(no email) ${customerId}`, subscriptionId: s.id });
      continue;
    }

    const sub = user.subscription || {};
    const periodEnd = s.current_period_end ? new Date(s.current_period_end * 1000) : null;
    const periodStart = s.current_period_start ? new Date(s.current_period_start * 1000) : null;
    const dbEnd = sub.endDate ? new Date(sub.endDate) : null;

    const isActive = sub.status === 'active' && sub.planId && sub.planId !== 'free';
    const expired = !dbEnd || dbEnd.getTime() < Date.now();
    const stale = periodEnd && dbEnd && periodEnd.getTime() - dbEnd.getTime() > STALE_TOLERANCE_MS;
    if (isActive && !expired && !stale) continue;

    // Stripe listing this subscription as 'active' is not evidence the
    // current period was paid for.
    //
    // At the period rollover Stripe advances current_period_end BEFORE it
    // attempts the charge, and the subscription stays 'active' until that
    // attempt fails. This job runs hourly, so it lands in that window
    // routinely — and the `stale` test above fires precisely because
    // periodEnd has just jumped ahead of dbEnd. Writing it here granted a
    // month nobody paid for, and would have kept re-granting it every hour
    // even after the webhook handler was fixed.
    //
    // This job exists to RESTORE access Stripe was paid for. If the period
    // is not paid, there is nothing to restore.
    if (!(await currentPeriodIsPaid(s))) {
      report.suspect.push({
        email,
        reason: `current period not paid (Stripe status '${s.status}', latest invoice unpaid) — not extending endDate`,
      });
      continue;
    }

    const priceId = s.items?.data?.[0]?.price?.id;
    const plan = priceToPlan[priceId];
    const planId = plan?.planId || sub.planId;
    if (!planId || planId === 'free') {
      report.suspect.push({ email, reason: `unresolvable plan for price ${priceId}` });
      continue;
    }

    const set = {
      'subscription.planId': planId,
      'subscription.plan': planId,
      'subscription.status': 'active',
      'subscription.endDate': periodEnd,
      'subscription.stripeSubscriptionId': s.id,
      'subscription.stripeCustomerId': typeof s.customer === 'object' ? s.customer.id : s.customer,
      'subscription.autoRenew': !s.cancel_at_period_end,
      'subscription.cancelAtPeriodEnd': !!s.cancel_at_period_end,
    };
    if (periodStart) set['subscription.startDate'] = periodStart;
    if (plan?.features?.maxDevices) set.maxDevices = plan.features.maxDevices;

    if (!dryRun) await User.updateOne({ _id: user._id }, { $set: set });

    report.repaired.push({
      email,
      from: `${sub.planId || 'free'}/${sub.status || 'none'}`,
      to: `${planId}/active until ${periodEnd ? periodEnd.toISOString().slice(0, 16) : '?'}`,
    });
  }

  // Shared-plan members hold no Stripe subscription of their own — their
  // access is a copy of the primary's, extended by handleInvoicePaid on each
  // renewal. If that webhook is missed the member silently expires, and the
  // Stripe walk above can never see them. Re-sync them from their primary.
  const primaries = await User.find({ 'subscription.sharedWith.0': { $exists: true } })
    .select('email subscription.sharedWith subscription.planId subscription.plan subscription.endDate subscription.status')
    .lean();

  for (const primary of primaries) {
    const p = primary.subscription || {};
    // Only propagate from a primary that is itself healthy, so a stale primary
    // can never push a bad endDate onto its members.
    if (p.status !== 'active' || !p.endDate || new Date(p.endDate).getTime() < Date.now()) continue;

    const members = await User.find({ _id: { $in: p.sharedWith } })
      .select('email subscription.endDate subscription.status subscription.planId').lean();

    for (const m of members) {
      const ms = m.subscription || {};
      const mEnd = ms.endDate ? new Date(ms.endDate) : null;
      const behind = !mEnd || mEnd.getTime() < new Date(p.endDate).getTime() - STALE_TOLERANCE_MS;
      const inactive = ms.status !== 'active' || !ms.planId || ms.planId === 'free';
      if (!behind && !inactive) continue;

      if (!dryRun) {
        await User.updateOne({ _id: m._id }, {
          $set: {
            'subscription.planId': p.planId,
            'subscription.plan': p.plan || p.planId,
            'subscription.status': 'active',
            'subscription.endDate': p.endDate,
          },
        });
      }
      report.repaired.push({
        email: m.email,
        from: `${ms.planId || 'free'}/${ms.status || 'none'} (shared member)`,
        to: `${p.planId}/active until ${new Date(p.endDate).toISOString().slice(0, 16)} — synced from ${primary.email}`,
      });
    }
  }

  if (report.repaired.length || report.orphans.length || report.suspect.length) {
    console.log(
      `[reconciler] checked=${report.checked} repaired=${report.repaired.length} ` +
      `orphans=${report.orphans.length} suspect=${report.suspect.length}${dryRun ? ' (DRY RUN)' : ''}`
    );
    for (const r of report.repaired) console.log(`[reconciler]   ✓ ${r.email}: ${r.from} -> ${r.to}`);
    for (const o of report.orphans) console.log(`[reconciler]   ! ${o.email}: paying at Stripe, no TodoDJS account (${o.subscriptionId})`);
    for (const x of report.suspect) console.log(`[reconciler]   ? ${x.email}: ${x.reason}`);
  }

  return report;
}

/**
 * Start the periodic reconciliation loop.
 * In PM2 cluster mode only one instance should run it — the writes are
 * idempotent so a double-run is harmless, but there is no point paying for
 * the Stripe API calls twice.
 */
// Hourly, not six-hourly. This is the only backstop when a webhook does not
// activate an account, and six hours on Free is a long time for someone who
// has just been told twice that their card failed. A pass is a single Stripe
// list plus one lookup per active subscription, so the cost is small.
export function startSubscriptionReconciler({ intervalMs = 60 * 60 * 1000, startupDelayMs = 60 * 1000 } = {}) {
  const instance = process.env.NODE_APP_INSTANCE;
  if (instance !== undefined && instance !== '0') {
    console.log(`[reconciler] instance ${instance} — not the designated runner, skipping`);
    return;
  }

  const run = () => reconcileSubscriptions().catch(e => console.error('[reconciler] run failed:', e.message));
  // Delay the first pass so it never competes with boot (DB connect, etc.).
  setTimeout(run, startupDelayMs).unref?.();
  setInterval(run, intervalMs).unref?.();
  console.log(`[reconciler] scheduled every ${Math.round(intervalMs / 3600000)}h (first run in ${Math.round(startupDelayMs / 1000)}s)`);
}
