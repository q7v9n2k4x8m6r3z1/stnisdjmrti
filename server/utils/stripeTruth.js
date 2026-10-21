/**
 * What Stripe was ACTUALLY PAID for — the one implementation.
 *
 * Shared by the audit script, the revocation script and the scheduled drift
 * monitor, so the three can never answer "is this account paid up?"
 * differently. A revoker that disagreed with the auditor by even a rounding
 * rule would cut off paying customers, and this codebase has already paid the
 * price for letting one rule live in several places (the nine copies of the
 * access window, e5f9626).
 *
 * Nothing here writes. Callers decide what to do with the answer.
 */
import stripe from '../config/stripe.js';

/**
 * Read an invoice's subscription id under BOTH shapes.
 *
 * Production's endpoints are on 2026-01-28.clover, where invoice.subscription
 * was removed; reading only the old name returns undefined on every live
 * object. See the note in controllers/stripeController.js.
 */
export const subIdOf = (inv) => {
  const raw = inv?.subscription ?? inv?.parent?.subscription_details?.subscription ?? null;
  return (raw && typeof raw === 'object' ? raw.id : raw) || null;
};

/**
 * Is this subscription's CURRENT period actually paid for?
 *
 * The question every writer of `endDate` has to answer, and the one that
 * `subscription.status === 'active'` does NOT answer.
 *
 * Stripe advances `current_period_end` at the period rollover and fires
 * customer.subscription.updated THEN — before it has attempted the charge. At
 * that instant the status is legitimately 'active' and the period end is
 * already a month further out. A writer gated on status therefore records a
 * month the customer has not paid for; seconds later the charge fails, the
 * status becomes past_due, and nothing ever moves endDate back.
 *
 * That is how 22 accounts ended up with endDate exactly one month beyond
 * their last paid invoice, to the minute, and kept downloading. The 31 Aug
 * fix tested status, which is the wrong signal — this tests the invoice.
 *
 * Returns true only on positive evidence of payment. Every failure mode
 * (lookup error, no invoice, unexpected shape) returns FALSE, because the
 * cost of wrongly advancing endDate is unpaid access that nothing reverses,
 * while the cost of wrongly withholding it is a delay until invoice.paid or
 * the reconciler corrects it.
 *
 * @param {object|string} subscription - a Stripe subscription or its id
 * @returns {Promise<boolean>}
 */
export async function currentPeriodIsPaid(subscription) {
  try {
    const id = typeof subscription === 'string' ? subscription : subscription?.id;
    if (!id) return false;

    // A trial has no invoice to pay and is legitimately entitled.
    if (typeof subscription === 'object' && subscription?.status === 'trialing') return true;

    const sub = await stripe.subscriptions.retrieve(id, { expand: ['latest_invoice'] });
    const inv = sub?.latest_invoice;
    if (!inv || typeof inv !== 'object') return false;

    // `paid` is the durable flag; status is checked too because a zero-amount
    // invoice (100% coupon, credit balance) settles without a payment.
    return inv.paid === true || inv.status === 'paid' || inv.amount_due === 0;
  } catch (e) {
    console.error(`[stripeTruth] currentPeriodIsPaid lookup failed: ${e.message} — treating as UNPAID`);
    return false;
  }
}

/**
 * The plan half of the entitlement question. hasActiveWindow deliberately does
 * NOT consider the plan, and 'free' must be excluded on BOTH fields — the string
 * is truthy, which is how a free-plan account once downloaded (f4f79ce).
 */
export const hasPaidPlan = (s = {}) =>
  Boolean((s.planId && s.planId !== 'free') || (s.plan && s.plan !== 'free'));

/**
 * The latest period the customer actually PAID for, according to Stripe.
 *
 * Walks paid invoices rather than the subscription object, because
 * handleSubscriptionDeleted nulls stripeSubscriptionId on cancellation — so a
 * cancelled account has no subscription id left to look up, only a customer id.
 * Invoices survive that.
 *
 * @returns {Promise<{paidThrough: number|null, invoice: string|null, source: string}>}
 */
export async function truePaidThrough(sub) {
  const customerId = sub.stripeCustomerId || null;
  const subscriptionId = sub.stripeSubscriptionId || null;

  let query;
  let source;
  if (customerId) {
    query = { customer: customerId, status: 'paid', limit: 100 };
    source = 'customer invoices';
  } else if (subscriptionId) {
    query = { subscription: subscriptionId, status: 'paid', limit: 100 };
    source = 'subscription invoices';
  } else {
    return { paidThrough: null, invoice: null, source: 'no Stripe ids on record' };
  }

  let best = null;
  let bestInvoice = null;
  for await (const inv of stripe.invoices.list(query)) {
    // Ignore invoices belonging to some OTHER subscription on the same customer.
    const invSub = subIdOf(inv);
    if (subscriptionId && invSub && invSub !== subscriptionId) continue;
    const end = inv.lines?.data?.[0]?.period?.end;
    if (!end) continue;
    if (best === null || end * 1000 > best) {
      best = end * 1000;
      bestInvoice = inv.id;
    }
  }
  return { paidThrough: best, invoice: bestInvoice, source };
}
