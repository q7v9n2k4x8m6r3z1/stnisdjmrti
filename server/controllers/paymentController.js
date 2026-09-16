import stripe from '../config/stripe.js';
import { isStaging, testConfig } from '../config/stripeTest.js';

// Strip trailing slashes so FRONTEND_URL=https://site.com/ doesn't produce
// https://site.com//subscription/success — the double slash breaks the SPA's
// route matching, so the success page never renders after checkout.
const FRONTEND_BASE = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
import User from '../models/User.js';
import { notifyAdminNewPayment, notifyAdminCancelledSubscription, sendPaymentReceiptEmail, sendSubscriptionCancelledEmail, sendPaymentFailedEmail } from '../services/emailService.js';
import SubscriptionPlan from '../models/SubscriptionPlan.js';
import { customerLocaleFields, syncCustomerLocale } from '../utils/stripeLocale.js';
import { resolvePromotionCode } from './couponController.js';

/**
 * Turn a typed discount code into the `discounts` array Stripe expects.
 *
 * Uses the same resolver as the validate endpoint, so a code accepted on the
 * checkout page cannot be rejected — or silently ignored — at payment time.
 * An invalid code is refused rather than dropped: a customer who typed a code
 * and was charged full price without being told would have a fair complaint.
 */
async function buildDiscounts(promotionCode, userId) {
  if (!promotionCode || !String(promotionCode).trim()) return { ok: true, discounts: undefined };

  // userId matters for campaign codes: BIENVENIDA10 is only valid for the
  // person it was emailed to, and only for 24 hours after that send.
  const result = await resolvePromotionCode(promotionCode, { userId });
  if (!result.ok) return { ok: false, message: result.message };

  return { ok: true, discounts: [{ promotion_code: result.promo.id }] };
}

// On staging, resolve the Stripe price ID from the test-mode config instead
// of the shared production DB's SubscriptionPlan.stripePriceId (a live-mode
// price ID would be rejected outright by the test-mode secret key anyway).
// Production is unaffected — isStaging is false there, so this always falls
// through to dbPriceId exactly as before.
function resolvePriceId(planId, dbPriceId) {
  if (isStaging) return testConfig.priceIds[planId] || dbPriceId;
  return dbPriceId;
}

// @desc    Subscribe using saved default payment method (skips hosted checkout form)
// @route   POST /api/payment/subscribe-with-saved-card
// @access  Private
export const subscribeWithSavedCard = async (req, res) => {
  try {
    const { planId } = req.body;
    if (!planId) {
      return res.status(400).json({ success: false, message: 'planId is required' });
    }

    const plan = await SubscriptionPlan.findOne({ planId, isActive: true });
    if (!plan) {
      return res.status(400).json({ success: false, message: 'Invalid subscription plan' });
    }
    const stripePriceId = resolvePriceId(plan.planId, plan.stripePriceId);
    if (!stripePriceId) {
      return res.status(400).json({ success: false, message: 'Plan not configured for online payment' });
    }

    const user = await User.findById(req.user.id);

    // Guard: block if user already has a Stripe subscription (active or past_due — prevents double-billing)
    const blockedStatuses = ['active', 'past_due'];
    if (user.subscription?.stripeSubscriptionId && blockedStatuses.includes(user.subscription?.status)) {
      return res.status(400).json({ success: false, message: 'You already have an active subscription.' });
    }

    const customerId = user.subscription?.stripeCustomerId;
    if (!customerId) {
      return res.status(400).json({ success: false, message: 'No saved payment method found. Please use the checkout form.' });
    }

    // Same Stripe-side duplicate guard as createCheckoutSession: the local
    // check above is blind whenever our record is stale, which is exactly when
    // customers retry and get billed twice.
    try {
      const [active, pastDue] = await Promise.all([
        stripe.subscriptions.list({ customer: customerId, status: 'active', limit: 1 }),
        stripe.subscriptions.list({ customer: customerId, status: 'past_due', limit: 1 }),
      ]);
      const existing = active.data[0] || pastDue.data[0];
      if (existing) {
        console.warn(
          `[subscribeWithSavedCard] blocked duplicate for user ${user._id}: Stripe already has ` +
          `${existing.status} subscription ${existing.id} (local record said ${user.subscription?.status || 'none'})`
        );
        return res.status(400).json({
          success: false,
          message: 'You already have an active subscription. If you cannot access your account, please reload the page or contact support — you have not been charged again.',
          alreadySubscribed: true,
        });
      }
    } catch (e) {
      console.error('[subscribeWithSavedCard] Stripe duplicate-check failed, allowing:', e.message);
    }

    // Verify customer exists (guards against live→test mode switch)
    let customer;
    try {
      customer = await stripe.customers.retrieve(customerId, {
        expand: ['invoice_settings.default_payment_method']
      });
    } catch (e) {
      if (e.code === 'resource_missing') {
        return res.status(400).json({ success: false, message: 'No saved payment method found. Please use the checkout form.' });
      }
      throw e;
    }

    // Opportunistic locale repair for customers created before preferred_locales
    // was set. Free — we already hold the customer object, so this costs no
    // extra read. Fire-and-forget: it must never delay or fail a payment.
    syncCustomerLocale(stripe, customerId, user, customer);

    const defaultPm = customer.invoice_settings?.default_payment_method;
    const pmId = typeof defaultPm === 'object' ? defaultPm?.id : defaultPm;

    if (!pmId) {
      return res.status(400).json({ success: false, message: 'No default payment method on file. Please add a card first.' });
    }

    // Resolve the discount code before charging, so an invalid one is refused
    // rather than quietly dropped and the customer billed the full price.
    const savedCardPromo = await buildDiscounts(req.body.promotionCode, req.user.id);
    if (!savedCardPromo.ok) {
      return res.status(400).json({ success: false, message: savedCardPromo.message, invalidCode: true });
    }

    // Create Stripe subscription directly using saved card
    let subscription;
    try {
      subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: stripePriceId }],
        default_payment_method: pmId,
        payment_behavior: 'error_if_incomplete',
        ...(savedCardPromo.discounts ? { discounts: savedCardPromo.discounts } : {}),
        metadata: {
          userId: user._id.toString(),
          planId: plan.planId,
          durationDays: plan.durationDays.toString()
        }
      });
    } catch (stripeErr) {
      console.error('Direct subscription creation failed:', stripeErr.message);
      return res.status(400).json({ success: false, message: stripeErr.message });
    }

    if (subscription.status !== 'active' && subscription.status !== 'trialing') {
      return res.status(400).json({ success: false, message: 'Payment could not be completed. Please try a different card.' });
    }

    // Activate subscription in DB immediately (invoice.paid for subscription_create is skipped by webhook)
    const startDate = new Date();
    const endDate = subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000)
      : (() => { const d = new Date(); d.setDate(d.getDate() + plan.durationDays); return d; })();

    user.subscription.planId = planId;
    user.subscription.plan = planId;
    user.subscription.status = 'active';
    user.subscription.startDate = startDate;
    user.subscription.endDate = endDate;
    user.subscription.stripeCustomerId = customerId;
    user.subscription.stripeSubscriptionId = subscription.id;
    user.subscription.paymentMethod = 'card';
    user.subscription.autoRenew = true;
    user.subscription.cancelAtPeriodEnd = false;
    user.maxDevices = plan.features?.maxDevices || (plan.type === 'shared' ? 2 : 1);

    // Dedup history entry (use subscription.id as key)
    const alreadyRecorded = user.subscriptionHistory?.some(h => h.stripePaymentIntentId === subscription.id);
    if (!alreadyRecorded) {
      user.subscriptionHistory.push({
        planId,
        startDate,
        endDate,
        amount: plan.price,
        currency: plan.currency,
        status: 'completed',
        stripePaymentIntentId: subscription.id
      });
    }

    await user.save();
    console.log(`Direct subscription activated for user ${user._id}, plan ${planId}`);

    sendPaymentReceiptEmail(user, plan.name, plan.price, plan.currency, endDate)
      .catch(err => console.error('Receipt email failed:', err));
    notifyAdminNewPayment(user, plan.name, plan.price, plan.currency)
      .catch(err => console.error('Admin notification failed:', err));

    res.status(200).json({
      success: true,
      message: 'Subscription activated',
      data: { subscriptionId: subscription.id, endDate }
    });
  } catch (error) {
    console.error('subscribeWithSavedCard error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Create checkout session
// @route   POST /api/payment/create-checkout-session
// @access  Private
export const createCheckoutSession = async (req, res) => {
  try {
    const { planId } = req.body;

    if (!planId) {
      return res.status(400).json({
        success: false,
        message: 'Plan ID is required'
      });
    }

    const planDoc = await SubscriptionPlan.findOne({ planId, isActive: true });

    if (!planDoc) {
      return res.status(400).json({
        success: false,
        message: 'Invalid subscription plan'
      });
    }

    const stripePriceId = resolvePriceId(planDoc.planId, planDoc.stripePriceId);
    if (!stripePriceId) {
      return res.status(400).json({
        success: false,
        message: 'This plan is not configured for online payment. Please contact support.'
      });
    }

    // Guard: block if user already has a Stripe subscription (active or past_due — prevents double-billing)
    const blockedStatuses = ['active', 'past_due'];
    if (req.user.subscription?.stripeSubscriptionId && blockedStatuses.includes(req.user.subscription?.status)) {
      return res.status(400).json({
        success: false,
        message: 'You already have an active subscription.'
      });
    }

    // Get or create Stripe customer
    let stripeCustomerId = req.user.subscription.stripeCustomerId;

    // SECOND guard, against Stripe rather than our own record. The check above
    // can only see what we stored, and the whole failure mode here is that our
    // record is stale — when activation did not land, the customer sees "Free",
    // retries checkout, and the local guard waves each attempt through. That is
    // how one customer ended up with 7 subscriptions and 7 charges in 2.5 hours,
    // and two others with 2 each. Stripe is the authority on what they already
    // pay for, so ask Stripe before creating another subscription.
    if (stripeCustomerId) {
      try {
        const [active, pastDue] = await Promise.all([
          stripe.subscriptions.list({ customer: stripeCustomerId, status: 'active', limit: 1 }),
          stripe.subscriptions.list({ customer: stripeCustomerId, status: 'past_due', limit: 1 }),
        ]);
        const existing = active.data[0] || pastDue.data[0];
        if (existing) {
          console.warn(
            `[checkout] blocked duplicate for user ${req.user._id}: Stripe already has ` +
            `${existing.status} subscription ${existing.id} (local record said ` +
            `${req.user.subscription?.status || 'none'})`
          );
          return res.status(400).json({
            success: false,
            message: 'You already have an active subscription. If you cannot access your account, please reload the page or contact support — you have not been charged again.',
            alreadySubscribed: true,
          });
        }
      } catch (e) {
        // Never block a genuine purchase because this lookup failed.
        console.error('[checkout] Stripe duplicate-check failed, allowing checkout:', e.message);
      }
    }

    if (stripeCustomerId) {
      // Verify the customer still exists in Stripe (guards against test/live mode switches)
      try {
        await stripe.customers.retrieve(stripeCustomerId);
      } catch (e) {
        if (e.code === 'resource_missing') {
          console.warn(`Stale stripeCustomerId ${stripeCustomerId} cleared for user ${req.user._id}`);
          stripeCustomerId = null;
          req.user.subscription.stripeCustomerId = null;
        } else {
          throw e;
        }
      }
    }

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: req.user.email,
        name: req.user.name,
        // Localises the emails Stripe sends itself (failed payment, receipts).
        ...customerLocaleFields(req.user),
        metadata: {
          userId: req.user._id.toString()
        }
      });
      stripeCustomerId = customer.id;

      // Update user with Stripe customer ID
      req.user.subscription.stripeCustomerId = stripeCustomerId;
      await req.user.save();
    }

    // Create recurring subscription checkout session.
    // Omitting payment_method_types lets Stripe Checkout show all methods enabled
    // in the Dashboard (Google Pay, Apple Pay, Link, card, etc.) automatically.
    const promo = await buildDiscounts(req.body.promotionCode, req.user._id);
    if (!promo.ok) {
      return res.status(400).json({ success: false, message: promo.message, invalidCode: true });
    }

    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      line_items: [
        {
          price: stripePriceId,
          quantity: 1
        }
      ],
      mode: 'subscription',
      // Note: Stripe rejects `discounts` together with allow_promotion_codes,
      // so the code box lives on our checkout page rather than Stripe's. That
      // is also what lets the customer see the discounted price before paying.
      ...(promo.discounts ? { discounts: promo.discounts } : {}),
      success_url: `${FRONTEND_BASE}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_BASE}/subscription/cancel`,
      metadata: {
        userId: req.user._id.toString(),
        planId: planDoc.planId,
        durationDays: planDoc.durationDays.toString()
      }
    });

    res.status(200).json({
      success: true,
      sessionId: session.id,
      url: session.url
    });
  } catch (error) {
    console.error('Checkout session error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Cancel subscription
// @route   POST /api/payment/cancel-subscription
// @access  Private
export const cancelSubscription = async (req, res) => {
  try {
    const { stripeSubscriptionId } = req.user.subscription;

    if (!stripeSubscriptionId) {
      return res.status(400).json({
        success: false,
        message: 'No active subscription found'
      });
    }

    // Cancel at period end
    const subscription = await stripe.subscriptions.update(stripeSubscriptionId, {
      cancel_at_period_end: true
    });

    console.log(`[cancelSubscription] Stripe confirmed cancel_at_period_end=true for sub ${stripeSubscriptionId}, user ${req.user._id}`);

    // Update user — sync endDate from Stripe so isWithinPeriod works correctly after cancel
    req.user.subscription.cancelAtPeriodEnd = true;
    if (subscription.current_period_end) {
      req.user.subscription.endDate = new Date(subscription.current_period_end * 1000);
    }
    await req.user.save();

    // Notify user of pending cancellation (non-blocking)
    const accessUntil = subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000)
      : null;
    sendSubscriptionCancelledEmail(req.user, req.user.subscription.plan || 'N/A', accessUntil)
      .catch(err => console.error('User cancellation email failed:', err));

    // Notify admin of pending cancellation (non-blocking)
    notifyAdminCancelledSubscription(req.user, req.user.subscription.plan || 'N/A')
      .catch(err => console.error('Admin cancellation notification failed:', err));

    res.status(200).json({
      success: true,
      message: 'Subscription will be cancelled at the end of the billing period',
      currentPeriodEnd: subscription.current_period_end
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Reactivate subscription
// @route   POST /api/payment/reactivate-subscription
// @access  Private
export const reactivateSubscription = async (req, res) => {
  try {
    const { stripeSubscriptionId } = req.user.subscription;

    if (!stripeSubscriptionId) {
      return res.status(400).json({
        success: false,
        message: 'No subscription found'
      });
    }

    // Reactivate subscription
    await stripe.subscriptions.update(stripeSubscriptionId, {
      cancel_at_period_end: false
    });

    // Update user
    req.user.subscription.cancelAtPeriodEnd = false;
    req.user.subscription.autoRenew = true;
    await req.user.save();

    res.status(200).json({
      success: true,
      message: 'Subscription reactivated successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get subscription details
// @route   GET /api/payment/subscription
// @access  Private
export const getSubscription = async (req, res) => {
  try {
    const { stripeSubscriptionId } = req.user.subscription;

    if (!stripeSubscriptionId) {
      return res.status(200).json({
        success: true,
        data: {
          plan: 'free',
          status: 'inactive'
        }
      });
    }

    const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);

    res.status(200).json({
      success: true,
      data: {
        plan: req.user.subscription.plan,
        status: subscription.status,
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        cancelAtPeriodEnd: subscription.cancel_at_period_end
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
