import stripe from '../config/stripe.js';
import { isStaging, testConfig } from '../config/stripeTest.js';
import SubscriptionPlan from '../models/SubscriptionPlan.js';
import User from '../models/User.js';
import { notifyAdminNewPayment, notifyAdminCancelledSubscription, sendPaymentReceiptEmail, sendSubscriptionCancelledEmail, sendPaymentFailedEmail } from '../services/emailService.js';
import { customerLocaleFields } from '../utils/stripeLocale.js';
import { sendPurchaseEvent } from '../services/metaConversions.js';
import { currentPeriodIsPaid } from '../utils/stripeTruth.js';

// Trailing slashes stripped — FRONTEND_URL=https://site.com/ would otherwise
// produce double-slash paths that break SPA route matching.
const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');

// ── Invoice field compatibility ──────────────────────────────────────────────
//
// Webhook payloads are serialized with the API version configured ON THE
// WEBHOOK ENDPOINT in the Stripe dashboard — NOT the version this SDK pins
// (config/stripe.js pins 2023-10-16, which only governs calls we make).
// Production's endpoints are on 2026-01-28.clover, where two fields these
// handlers depend on were removed:
//
//   invoice.subscription          -> invoice.parent.subscription_details.subscription
//   invoice.lines[].price.id      -> invoice.lines[].pricing.price_details.price
//
// Reading the old names returned undefined on every live event. For the
// subscription id that is actively dangerous: the user lookup does
//   $or: [{ stripeSubscriptionId: <undefined> }, { stripeCustomerId }]
// and Mongoose keeps the key with an undefined value, which the driver
// serializes to null (ignoreUndefined is not enabled in config/db.js). The
// clause becomes "stripeSubscriptionId: null" — matching any account that has
// no Stripe subscription id — so findOne could return an arbitrary user and
// apply another customer's payment to them.
//
// These readers accept BOTH shapes so the handlers are correct regardless of
// which API version an endpoint is pinned to, including after a future
// dashboard upgrade.
function invoiceSubscriptionId(invoice) {
  const raw = invoice?.subscription ?? invoice?.parent?.subscription_details?.subscription ?? null;
  // May arrive expanded as an object rather than a bare id.
  return (raw && typeof raw === 'object' ? raw.id : raw) || null;
}

function invoiceLinePriceId(invoice) {
  const line = invoice?.lines?.data?.[0];
  const raw = line?.price?.id ?? line?.pricing?.price_details?.price ?? null;
  return (raw && typeof raw === 'object' ? raw.id : raw) || null;
}

// Build the user lookup for an invoice without ever putting undefined into the
// query — see the note above on why an undefined clause is unsafe.
function invoiceUserQuery(subscriptionId, customerId) {
  const or = [];
  if (subscriptionId) or.push({ 'subscription.stripeSubscriptionId': subscriptionId });
  if (customerId) or.push({ 'subscription.stripeCustomerId': customerId });
  return or.length ? { $or: or } : null;
}

// @desc    Verify payment and activate subscription
// @route   POST /api/stripe/verify-payment
// @access  Public — the Stripe checkout session ID (unguessable, and only
//          known to whoever just completed that checkout) is itself the proof
//          of payment. This route MUST NOT require a JWT: after Stripe's
//          hosted checkout the customer often returns without a usable token
//          (logged out, different browser/device, or an account that was
//          created by the checkout itself and has never logged in). Requiring
//          auth here produced "Not authorized to access this route" on the
//          success page for paying customers — one paid twice believing the
//          first attempt had failed.
export const verifyPayment = async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'Session ID is required' });
    }

    // Retrieve the session from Stripe — Stripe is the source of truth
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    // If the caller IS authenticated, still enforce that the session belongs
    // to them (prevents a logged-in user probing someone else's session).
    // Unauthenticated callers are allowed: possession of the session ID is
    // the credential, and the response exposes no personal data.
    const sessionUserId = session.metadata?.userId;
    if (req.user && sessionUserId && sessionUserId !== req.user.id.toString()) {
      console.warn(`[SECURITY] verifyPayment session mismatch: sessionUser=${sessionUserId}, reqUser=${req.user.id}`);
      return res.status(403).json({
        success: false,
        message: 'Session does not belong to this user'
      });
    }

    // Accept 'paid' and 'no_payment_required' (free trials / 100% coupons)
    const validStatuses = ['paid', 'no_payment_required'];
    if (!validStatuses.includes(session.payment_status)) {
      return res.status(400).json({
        success: false,
        message: 'Payment not completed'
      });
    }

    // Safety net: the webhook is the normal activation path, but if it is
    // delayed, disabled, or failing (as happened when the live endpoint was
    // auto-disabled in Stripe), the customer would pay and stay on the free
    // plan. Run the same idempotent handler here so a confirmed payment
    // always activates. handleCheckoutCompleted dedups on session.id, so a
    // later webhook delivery for this session is a no-op.
    let activated = false;
    try {
      await handleCheckoutCompleted(session);
      activated = true;
    } catch (e) {
      console.error('[verifyPayment] fallback activation failed:', e.message);
    }

    res.status(200).json({
      success: true,
      activated,
      // Amount/currency let the frontend report an accurate Purchase
      // conversion to the Meta Pixel. amount_total is in cents.
      amount: session.amount_total != null ? session.amount_total / 100 : null,
      currency: session.currency || 'usd',
      message: 'Payment confirmed. Subscription will be activated shortly.'
    });
  } catch (error) {
    console.error('Payment verification error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Handle Stripe webhooks
// @route   POST /api/stripe/webhook
// @access  Public (but verified with Stripe signature)
export const handleWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  // Test-mode webhooks (staging's own endpoint in the Stripe test dashboard)
  // sign with a different secret than the live-mode endpoint.
  const webhookSecret = isStaging ? testConfig.webhookSecret : process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Acknowledge FIRST, process after.
  //
  // This handler used to await every handler — outbound Stripe API calls and
  // several DB writes — before replying. Stripe gives roughly 20 seconds, and
  // this is a single-threaded Node process that also runs Essentia audio
  // analysis and builds ZIPs; while that CPU work holds the event loop, a
  // webhook request simply sits unanswered until Stripe gives up. Those are
  // connection-level failures rather than HTTP errors, which is precisely what
  // Stripe reported: "184 requests had other errors" over nine days, ending in
  // the endpoint being disabled — the root cause behind every "paid but still
  // Free" incident, and why re-enabling it kept not sticking.
  //
  // Replying immediately keeps delivery healthy no matter how slow or busy the
  // processing is. The trade-off is that Stripe will not retry a failure that
  // happens after this 200, so failures are logged loudly and the subscription
  // reconciler (services/subscriptionReconciler.js, every 6h) remains the
  // backstop that repairs anything a dropped event would have missed.
  res.json({ received: true });

  processWebhookEvent(event).catch(error => {
    console.error(`[webhook] processing failed for ${event.type} (${event.id}):`, error?.stack || error?.message || error);
  });
};

async function processWebhookEvent(event) {
  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutCompleted(event.data.object);
      break;

    case 'payment_intent.succeeded':
      console.log('PaymentIntent succeeded:', event.data.object.id);
      break;

    case 'payment_intent.payment_failed':
      console.warn('Payment failed:', event.data.object.id);
      await handlePaymentFailed(event.data.object);
      break;

    case 'invoice.paid':
    case 'invoice.payment_succeeded':
      await handleInvoicePaid(event.data.object);
      break;

    case 'invoice.payment_failed':
      await handleInvoicePaymentFailed(event.data.object);
      break;

    case 'charge.refunded':
      await handleChargeRefunded(event.data.object);
      break;

    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event.data.object);
      break;

    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(event.data.object);
      break;

    default:
      console.warn(`Unhandled Stripe event type: ${event.type}`);
  }
}

// Helper function to handle completed checkout
async function handleCheckoutCompleted(session) {
  const planId = session.metadata.planId;
  const durationDays = parseInt(session.metadata.durationDays);
  const customerEmail = session.customer_details?.email || session.customer_email;
  
  const plan = await SubscriptionPlan.findOne({ planId });

  if (!plan) {
    console.error('Plan not found in webhook handler');
    return;
  }

  // Check if user exists (for existing users upgrading) or create new user (for new subscriptions)
  let user = session.metadata.userId ? await User.findById(session.metadata.userId) : null;
  
  if (!user && customerEmail) {
    // New user - create account via subscription payment
    user = await User.findOne({ email: customerEmail });
    
    if (!user) {
      // Create new user account
      const crypto = await import('crypto');
      const tempPassword = crypto.randomBytes(32).toString('hex');
      
      user = await User.create({
        name: session.customer_details?.name || customerEmail.split('@')[0],
        email: customerEmail,
        password: tempPassword, // Temporary password, user will reset via email
        phoneNumber: session.customer_details?.phone || undefined,
        preferredLanguage: 'en',
        isEmailVerified: true // Email confirmed via Stripe payment flow
      });
      
      console.log(`New user account created via subscription: ${customerEmail}`);
    }
  }

  if (!user) {
    console.error('Could not find or create user in webhook handler');
    return;
  }

  const startDate = new Date();
  let endDate = null;
  let stripeSubscriptionId = null;

  // For subscription mode, get endDate from Stripe subscription's current_period_end
  if (session.subscription) {
    try {
      const stripeSubscription = await stripe.subscriptions.retrieve(session.subscription, {
        expand: ['default_payment_method', 'latest_invoice.payment_intent']
      });
      endDate = stripeSubscription.current_period_end
        ? new Date(stripeSubscription.current_period_end * 1000)
        : null;
      stripeSubscriptionId = stripeSubscription.id;

      // Auto-save the payment method used at checkout as the customer default
      // so it immediately appears in the PAGOS / payment methods section.
      // Primary: subscription's default_payment_method
      // Fallback: latest_invoice.payment_intent.payment_method
      const pmId =
        (typeof stripeSubscription.default_payment_method === 'object'
          ? stripeSubscription.default_payment_method?.id
          : stripeSubscription.default_payment_method) ||
        stripeSubscription.latest_invoice?.payment_intent?.payment_method ||
        null;
      if (pmId && session.customer) {
        stripe.customers.update(session.customer, {
          invoice_settings: { default_payment_method: pmId }
        }).catch(e => console.warn('Auto-save PM after checkout failed:', e.message));
      }
    } catch (e) {
      console.error('Failed to retrieve Stripe subscription:', e.message);
    }
  }

  // Fallback: calculate from durationDays metadata (legacy one-time mode)
  if (!endDate && !isNaN(durationDays)) {
    endDate = new Date();
    endDate.setDate(endDate.getDate() + durationDays);
  }

  // Safety: null endDate would be treated as no-expiry — default to 30 days
  if (!endDate) {
    console.error('[webhook] Could not determine endDate — defaulting to 30 days to prevent indefinite access');
    endDate = new Date();
    endDate.setDate(endDate.getDate() + 30);
  }

  // Dedup key, shared with handleInvoicePaid.
  //
  // This used session.id while invoice.paid keys on invoice.id, so the two
  // handlers could not see each other's work. That was survivable only while
  // invoice.paid unconditionally skipped every subscription_create invoice;
  // now that it activates the ones checkout never saw, the two must share a
  // key or a single payment records twice and emails two receipts.
  //
  // Prefer the invoice id (what invoice.paid uses) and fall back to session.id
  // when Stripe gives us no invoice. Both are checked below so history rows
  // written under the old key are still recognised.
  const sessionInvoiceId =
    typeof session.invoice === 'object' ? session.invoice?.id : session.invoice;
  const historyKey = sessionInvoiceId || session.id;
  const alreadyRecorded = user.subscriptionHistory?.some(
    h => h.stripePaymentIntentId === historyKey || h.stripePaymentIntentId === session.id
  );
  if (alreadyRecorded) {
    console.log(`checkout.session.completed dedup: session ${historyKey} already processed for user ${user._id} — skipping`);
    return;
  }

  user.subscription.planId = planId;
  user.subscription.plan = planId; // Add legacy plan field for compatibility
  user.subscription.status = 'active';
  user.subscription.startDate = startDate;
  user.subscription.endDate = endDate;
  user.subscription.stripeCustomerId = session.customer || user.subscription.stripeCustomerId;
  user.subscription.stripeSubscriptionId = stripeSubscriptionId || user.subscription.stripeSubscriptionId;
  user.subscription.stripePaymentIntentId = session.payment_intent || user.subscription.stripePaymentIntentId;
  user.subscription.paymentMethod = 'card';
  user.subscription.autoRenew = !!stripeSubscriptionId;

  // Set maxDevices based on plan type
  user.maxDevices = plan.features.maxDevices || (plan.type === 'shared' ? 2 : 1);

  user.subscriptionHistory.push({
    planId: planId,
    startDate: startDate,
    endDate: endDate,
    amount: plan.price,
    currency: plan.currency,
    status: 'completed',
    stripePaymentIntentId: historyKey
  });

  const isNewUser = !session.metadata.userId;
  
  await user.save();
  console.log(`Subscription activated for user ${user._id}`);

  if (isNewUser) {
    // New user - send password reset email instead of payment receipt
    const { sendPasswordResetEmail } = await import('../services/emailService.js');
    const crypto = await import('crypto');
    
    // Generate password reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    
    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpire = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
    await user.save();
    
    // Send welcome email with password reset link
    sendPasswordResetEmail(user, resetToken, true) // true = isNewUser
      .catch(err => console.error('Password reset email failed:', err));
  } else {
    // Existing user - send payment receipt
    sendPaymentReceiptEmail(user, plan.name, plan.price, plan.currency, endDate)
      .catch(err => console.error('User webhook payment receipt email failed:', err));
  }

  // Notify admin of new payment (non-blocking)
  notifyAdminNewPayment(user, plan.name, plan.price, plan.currency)
    .catch(err => console.error('Admin webhook payment notification failed:', err));

  // Meta Conversions API — report the Purchase server-side. This is the
  // first successful payment of a new subscription (renewals go through
  // handleInvoicePaid and are NOT reported as Purchase). event_id is the
  // checkout session id, matching the browser-side pixel for dedup. Non-blocking
  // so a Meta outage cannot block subscription activation.
  sendPurchaseEvent({
    eventSourceId: session.id,
    amount: session.amount_total != null ? session.amount_total / 100 : plan.price,
    currency: session.currency || plan.currency || 'EUR',
    customer: {
      email: customerEmail,
      name: session.customer_details?.name,
      phone: session.customer_details?.phone
    }
  }).catch(err => console.error('Meta CAPI Purchase failed:', err.message));
}

// Helper function to handle payment failures
async function handlePaymentFailed(paymentIntent) {
  console.warn('Payment failed for customer:', paymentIntent.customer);

  // If this payment intent is tied to an invoice (subscription payment),
  // invoice.payment_failed will fire too and handles email + status update.
  // Only send email here for standalone (non-subscription) payment failures.
  if (paymentIntent.invoice) {
    console.log(`payment_intent.payment_failed skipped: invoice-based failure handled by invoice.payment_failed (pi=${paymentIntent.id})`);
    return;
  }

  if (paymentIntent.customer) {
    try {
      const user = await User.findOne({ 'subscription.stripeCustomerId': paymentIntent.customer });
      if (user) {
        sendPaymentFailedEmail(user)
          .catch(err => console.error('User payment failed email failed:', err));
      }
    } catch (err) {
      console.error('Error finding user for payment failure notification:', err);
    }
  }
}

// Helper: handle invoice.paid — extends subscription on renewal
async function handleInvoicePaid(invoice) {
  const subscriptionId = invoiceSubscriptionId(invoice);
  const customerId = invoice.customer;

  const query = invoiceUserQuery(subscriptionId, customerId);
  if (!query) {
    console.error(`invoice.paid: invoice ${invoice.id} has neither a subscription nor a customer id — cannot identify the account`);
    return;
  }
  const user = await User.findOne(query);

  if (!user) {
    console.warn(`invoice.paid: no user found for subscription ${subscriptionId} / customer ${customerId}`);
    return;
  }

  // The initial invoice of a subscription is normally activated by
  // checkout.session.completed, so this handler used to return immediately on
  // billing_reason === 'subscription_create'.
  //
  // That assumed every subscription is born in a Checkout Session. It is not.
  // A subscription created from Stripe's dunning recovery page (the "Update
  // payment method" link in a failed-payment email), the customer portal, the
  // dashboard or the API produces a subscription_create invoice with NO
  // checkout session behind it. The invoice was skipped, nothing else
  // activated the account, and the customer paid and stayed on Free — silently,
  // with the log line reporting it as normal.
  //
  // Skip only when checkout demonstrably DID handle it, not when it merely
  // should have. The invoice-id dedup on the write below still makes webhook
  // re-delivery a no-op, so this can only add an activation that would
  // otherwise never happen.
  if (invoice.billing_reason === 'subscription_create') {
    const alreadyActivated =
      user.subscription?.stripeSubscriptionId === subscriptionId &&
      user.subscription?.status === 'active';
    if (alreadyActivated) {
      console.log(`invoice.paid skipped: subscription ${subscriptionId} already activated by checkout for user ${user._id}`);
      return;
    }
    console.warn(
      `[handleInvoicePaid] user ${user._id}: subscription_create invoice ${invoice.id} with no ` +
      `prior activation — no checkout session (recovery page / portal / API). Activating here.`
    );
  }

  // Derive new endDate from invoice line item period, then fall back to subscription object
  let newEndDate = null;
  const lineItem = invoice.lines?.data?.[0];
  if (lineItem?.period?.end) {
    newEndDate = new Date(lineItem.period.end * 1000);
  }

  if (!newEndDate && subscriptionId) {
    try {
      const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
      if (stripeSubscription.current_period_end) {
        newEndDate = new Date(stripeSubscription.current_period_end * 1000);
      }
    } catch (e) {
      console.error('Failed to retrieve subscription for invoice.paid:', e.message);
    }
  }

  // Stripe fires invoice.paid and customer.subscription.updated at essentially
  // the same moment on a renewal. Both handlers used to load the user, mutate
  // it, and user.save() the WHOLE document — so whichever saved last silently
  // reverted the other's fields. A renewal could be recorded as paid and then
  // immediately stamped back to past_due, leaving a paying customer on Free.
  // Everything below is therefore one atomic update, with the dedup folded
  // into the filter so a webhook re-delivery is a no-op rather than a
  // duplicate history entry.
  const set = {
    'subscription.status': 'active',
    'subscription.autoRenew': true,
    // They have paid, so the overdue notice no longer applies. Clearing it
    // means a future lapse notifies them again instead of being suppressed
    // by a stamp from months ago.
    'subscription.overdueNoticeSentAt': null,
  };
  if (newEndDate) set['subscription.endDate'] = newEndDate;

  // Update startDate to current period start so UI shows the renewal date
  const lineItemForStart = invoice.lines?.data?.[0];
  if (lineItemForStart?.period?.start) {
    set['subscription.startDate'] = new Date(lineItemForStart.period.start * 1000);
  }

  // Recovery: sync stripeSubscriptionId if user was found by customerId and ID is missing
  if (!user.subscription.stripeSubscriptionId && subscriptionId) {
    set['subscription.stripeSubscriptionId'] = subscriptionId;
    console.log(`[handleInvoicePaid] Recovered stripeSubscriptionId ${subscriptionId} for user ${user._id}`);
  }

  // A successful cycle renewal means the user is NOT cancelling — reset the flag.
  // handleSubscriptionUpdated normally syncs this, but reset here as a safety net
  // in case that webhook is delayed or retried out of order.
  if (invoice.billing_reason === 'subscription_cycle') {
    set['subscription.cancelAtPeriodEnd'] = false;
  }

  // Resolve the plan from what Stripe actually billed, not from what our record
  // happens to say.
  //
  // This handler used to set status:'active' and nothing else about the plan,
  // which is only sufficient while planId survives the lapse. It does not
  // always: an admin reverting an account to free clears it (userController
  // "revert to free"), and a shared member losing their primary clears it too.
  // The account then comes back from a recovered payment with status 'active'
  // but no planId — and every access gate requires planId to be set and not
  // 'free', so the customer pays and still sees Plan: Free with no access,
  // with no error anywhere. Worse, the SubscriptionPlan lookup below keyed off
  // that same empty planId, so no history row was written and no receipt was
  // sent: the failure was completely silent.
  //
  // Stripe is the authority on what is being billed, so map the invoice's
  // price to our plan exactly as the reconciler does, and fall back to the
  // stored planId only when the price is unmapped.
  const invoicePriceId = invoiceLinePriceId(invoice);
  let plan = invoicePriceId
    ? await SubscriptionPlan.findOne({ stripePriceId: invoicePriceId })
    : null;
  if (!plan && user.subscription.planId) {
    plan = await SubscriptionPlan.findOne({ planId: user.subscription.planId });
  }

  // Restore planId/plan whenever the record has none (or 'free') and we could
  // resolve one. Left alone otherwise, so a normal renewal never rewrites a
  // plan the customer already holds — including admin-granted plans, which
  // carry a plan name with no Stripe planId and must not be clobbered.
  const storedPlanId = user.subscription.planId;
  const needsPlanRestore = !storedPlanId || storedPlanId === 'free';
  if (needsPlanRestore && plan) {
    set['subscription.planId'] = plan.planId;
    set['subscription.plan'] = plan.planId;
    if (plan.features?.maxDevices) set.maxDevices = plan.features.maxDevices;
    console.warn(
      `[handleInvoicePaid] user ${user._id}: restored planId '${plan.planId}' from ` +
      `invoice price ${invoicePriceId} (record had ${JSON.stringify(storedPlanId)}) — ` +
      `account would otherwise have stayed on Free despite paying`
    );
  } else if (needsPlanRestore) {
    // Nothing to restore from. Say so loudly: the customer has paid and this
    // account cannot be activated without a price->plan mapping.
    console.error(
      `[handleInvoicePaid] user ${user._id}: PAID but no plan resolvable — ` +
      `invoice price ${invoicePriceId} is not mapped to any SubscriptionPlan.stripePriceId ` +
      `and the record has no planId. Account will remain on Free until this is fixed.`
    );
  }
  const update = { $set: set };
  if (plan) {
    update.$push = {
      subscriptionHistory: {
        // Resolved plan, not the stored one — on a restore the stored value is
        // the empty/'free' record we are correcting.
        planId: plan.planId,
        startDate: new Date(),
        endDate: newEndDate,
        amount: plan.price,
        currency: plan.currency,
        status: 'completed',
        stripePaymentIntentId: invoice.id
      }
    };
  }

  const writeResult = await User.updateOne(
    { _id: user._id, 'subscriptionHistory.stripePaymentIntentId': { $ne: invoice.id } },
    update
  );
  if (writeResult.matchedCount === 0) {
    console.log(`invoice.paid dedup: invoice ${invoice.id} already recorded for user ${user._id}`);
    return;
  }
  console.log(`Subscription renewed for user ${user._id}, new endDate: ${newEndDate}`);

  // Extend shared users' endDate so they don't lose access at the old period end
  if (newEndDate && user.subscription.sharedWith?.length > 0) {
    await User.updateMany(
      { _id: { $in: user.subscription.sharedWith } },
      { $set: { 'subscription.endDate': newEndDate, 'subscription.status': 'active' } }
    ).catch(e => console.error('Failed to extend shared users endDate on renewal:', e.message));
  }

  // Send renewal receipt email (covers both normal renewals and retry successes)
  if (plan) {
    sendPaymentReceiptEmail(user, plan.name, plan.price, plan.currency, newEndDate)
      .catch(err => console.error('Renewal receipt email failed:', err));
  }
}

// Helper: handle invoice.payment_failed — marks subscription as past_due
async function handleInvoicePaymentFailed(invoice) {
  const subscriptionId = invoiceSubscriptionId(invoice);
  const customerId = invoice.customer;

  const query = invoiceUserQuery(subscriptionId, customerId);
  if (!query) {
    console.error(`invoice.payment_failed: invoice ${invoice.id} has neither a subscription nor a customer id — cannot identify the account`);
    return;
  }
  const user = await User.findOne(query);

  if (!user) {
    console.warn(`invoice.payment_failed: no user found for subscription ${subscriptionId} / customer ${customerId}`);
    return;
  }

  // Out-of-order safety: webhook delivery is not ordered, so a retry may have
  // already succeeded by the time this failure event is processed. Downgrading
  // then would take access away from someone who has actually paid.
  if (invoice.paid) {
    console.log(`invoice.payment_failed ignored: invoice ${invoice.id} is already paid (user ${user._id})`);
    return;
  }

  // Mark past_due — do NOT cancel; Stripe will retry automatically.
  // Atomic $set so this cannot clobber a concurrent invoice.paid write.
  await User.updateOne({ _id: user._id }, { $set: { 'subscription.status': 'past_due' } });
  console.log(`Subscription marked past_due for user ${user._id} (attempt ${invoice.attempt_count})`);

  // Only email on the first failure — Stripe retries up to 4 times over 10 days.
  // Subsequent retries are silent to avoid flooding the user with failure emails.
  //
  // hosted_invoice_url is Stripe's own payment page for THIS invoice. Paying
  // there fires invoice.paid and handleInvoicePaid restores access with no
  // manual step, so sending it is what makes recovery self-service rather than
  // something an admin has to chase per customer.
  if (invoice.attempt_count === 1) {
    if (!invoice.hosted_invoice_url) {
      console.warn(
        `invoice.payment_failed: invoice ${invoice.id} has no hosted_invoice_url — ` +
        `emailing ${user.email} without a pay link (recovery will need a link sent by hand)`
      );
    }
    sendPaymentFailedEmail(user, invoice.hosted_invoice_url || null)
      .catch(err => console.error('Payment failed email error:', err));
  }
}

// Helper: handle Stripe charge refunded (one-time payment model cancellation)
async function handleChargeRefunded(charge) {
  const user = await User.findOne({
    $or: [
      { 'subscription.stripePaymentIntentId': charge.payment_intent },
      { 'subscription.stripeCustomerId': charge.customer }
    ]
  });

  if (user && user.subscription.status === 'active') {
    // A refund does NOT always mean the customer lost their subscription.
    // This handler matches on stripeCustomerId, so refunding a DUPLICATE
    // charge — which happened repeatedly while the "paid but still Free"
    // bug pushed customers to pay several times — would revoke the
    // subscription they legitimately still hold. Ask Stripe whether any
    // live subscription remains before cancelling anything.
    const customerId = charge.customer || user.subscription.stripeCustomerId;
    if (customerId) {
      try {
        const live = await stripe.subscriptions.list({ customer: customerId, status: 'active', limit: 1 });
        if (live.data.length > 0) {
          console.log(
            `charge.refunded: user ${user._id} still has active Stripe subscription ` +
            `${live.data[0].id} — refund was for a different charge, keeping access`
          );
          return;
        }
      } catch (e) {
        // Cannot verify — err toward keeping access. Wrongly revoking a paying
        // customer is worse than a stale record the reconciler will correct.
        console.error(`charge.refunded: could not verify subscriptions for ${customerId} — keeping access:`, e.message);
        return;
      }
    }

    const planId = user.subscription.planId;
    user.subscription.status = 'cancelled';
    user.subscription.autoRenew = false;
    await user.save();
    console.log(`Subscription cancelled via refund for user ${user._id}`);

    sendSubscriptionCancelledEmail(user, planId, null)
      .catch(err => console.error('Cancellation email failed:', err));
    notifyAdminCancelledSubscription(user, planId)
      .catch(err => console.error('Admin cancellation notification failed:', err));
  }
}

// Helper: handle subscription deletion (Stripe subscription mode)
async function handleSubscriptionDeleted(subscription) {
  const user = await User.findOne({
    $or: [
      { 'subscription.stripeSubscriptionId': subscription.id },
      { 'subscription.stripeCustomerId': subscription.customer }
    ]
  });

  if (user) {
    const planId = user.subscription.planId;
    // Capture before clearing — true means user explicitly cancelled (already emailed)
    const wasUserInitiatedCancel = user.subscription.cancelAtPeriodEnd === true;
    const accessEndDate = user.subscription.endDate || null;

    user.subscription.status = 'cancelled';
    user.subscription.autoRenew = false;
    user.subscription.stripeSubscriptionId = null;
    user.subscription.stripePaymentIntentId = null;
    user.subscription.cancelAtPeriodEnd = false;
    await user.save();
    console.log(`Subscription deleted for user ${user._id} (userInitiated=${wasUserInitiatedCancel})`);

    // Only send final cancellation email for Stripe-forced cancellations (failed payment retries).
    // User-initiated cancels already received an email at the time they clicked cancel.
    if (!wasUserInitiatedCancel) {
      sendSubscriptionCancelledEmail(user, planId, accessEndDate)
        .catch(err => console.error('User cancellation email failed:', err));
      // Admin was already notified at cancel-click time for user-initiated cancels.
      // Only notify here for Stripe-forced cancellations (payment retries exhausted).
      notifyAdminCancelledSubscription(user, planId)
        .catch(err => console.error('Admin cancellation notification failed:', err));
    }
  }
}

// Helper: handle subscription updated (Stripe subscription mode)
async function handleSubscriptionUpdated(subscription) {
  const user = await User.findOne({
    $or: [
      { 'subscription.stripeSubscriptionId': subscription.id },
      { 'subscription.stripeCustomerId': subscription.customer }
    ]
  });

  if (!user) return;

  // Map Stripe statuses to internal statuses
  const statusMap = {
    active: 'active',
    canceled: 'cancelled',
    past_due: 'past_due',
    unpaid: 'past_due',
    paused: 'inactive',
    trialing: 'active',
  };

  let newStatus = statusMap[subscription.status];

  // Guard: if Stripe reports 'canceled' but current_period_end is still in the future,
  // do NOT set status to 'cancelled' yet — the paid period is still active.
  // customer.subscription.deleted will fire at actual period end to finalize cancellation.
  if (newStatus === 'cancelled' && subscription.current_period_end) {
    const periodEnd = new Date(subscription.current_period_end * 1000);
    if (periodEnd > new Date()) {
      newStatus = 'active';
    }
  }

  // Atomic $set rather than mutate-then-user.save(): this event lands at the
  // same instant as invoice.paid on a renewal, and a full-document save from
  // either handler would overwrite the other's fields (see handleInvoicePaid).
  const set = {};
  if (newStatus && user.subscription.status !== newStatus) set['subscription.status'] = newStatus;

  // Only extend paid-through when the subscription is actually PAID.
  //
  // Stripe advances current_period_end when it ATTEMPTS a renewal, not when
  // that renewal succeeds. Copying it unconditionally handed users a full
  // extra month of access the moment their card failed: a renewal that failed
  // on 17 Aug still moved endDate to 17 Sep. Combined with the past_due grace
  // below, that is why users with failed payments kept downloading for weeks.
  //
  // endDate must therefore only ever move forward on evidence of payment.
  //
  // Testing `status === 'active'` is NOT that evidence, which is why the
  // original fix did not hold. This event fires AT the period rollover,
  // before Stripe has attempted the charge: current_period_end has already
  // advanced a month and the status is still legitimately 'active'. Gating on
  // status therefore recorded a month nobody had paid for, and when the
  // charge failed moments later nothing moved endDate back. Twenty-two
  // accounts ended up exactly one month past their last paid invoice, to the
  // minute, still downloading.
  //
  // currentPeriodIsPaid asks the invoice instead, and answers false on any
  // uncertainty. A missed extension is repaired by invoice.paid or the
  // reconciler; a wrong extension is unpaid access that nothing reverses.
  if (subscription.current_period_end && await currentPeriodIsPaid(subscription)) {
    set['subscription.endDate'] = new Date(subscription.current_period_end * 1000);
  } else if (subscription.current_period_end) {
    console.log(
      `[subscription.updated] user ${user._id}: NOT extending endDate — latest invoice ` +
      `is not paid (Stripe status '${subscription.status}'). Keeping paid-through ${user.subscription.endDate}`
    );
  }
  if (typeof subscription.cancel_at_period_end === 'boolean') set['subscription.cancelAtPeriodEnd'] = subscription.cancel_at_period_end;

  // Recovery: if stripeSubscriptionId is missing (e.g. DB save failed in subscribeWithSavedCard),
  // sync it now so cancel / renewal lookups work correctly going forward.
  if (!user.subscription.stripeSubscriptionId && subscription.id) {
    set['subscription.stripeSubscriptionId'] = subscription.id;
    if (!user.subscription.planId && subscription.metadata?.planId) {
      set['subscription.planId'] = subscription.metadata.planId;
      set['subscription.plan'] = subscription.metadata.planId;
    }
  }

  if (Object.keys(set).length > 0) {
    await User.updateOne({ _id: user._id }, { $set: set });
    console.log(`Subscription updated for user ${user._id}: status=${newStatus}, endDate=${set['subscription.endDate'] || user.subscription.endDate}`);
  }
}

// @desc    Get Stripe publishable key
// @route   GET /api/stripe/config
// @access  Public
export const getStripeConfig = async (req, res) => {
  res.status(200).json({
    success: true,
    // A pk_live_ publishable key paired with a sk_test_ secret key (or vice
    // versa) makes Stripe.js reject every request, so this must track the
    // same isStaging switch as the secret key in config/stripe.js.
    publishableKey: isStaging ? testConfig.publishableKey : process.env.STRIPE_PUBLISHABLE_KEY
  });
};

// @desc    Create payment intent (alternative to checkout session)
// @route   POST /api/stripe/create-payment-intent
// @access  Private
export const createPaymentIntent = async (req, res) => {
  try {
    const { planId } = req.body;
    const user = await User.findById(req.user.id);

    const plan = await SubscriptionPlan.findOne({ planId });

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Plan not found'
      });
    }

    // Create or retrieve Stripe customer
    let customerId = user.subscription.stripeCustomerId;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        // Localises the emails Stripe sends itself (failed payment, receipts).
        ...customerLocaleFields(user),
        metadata: {
          userId: user._id.toString()
        }
      });
      customerId = customer.id;
      user.subscription.stripeCustomerId = customerId;
      await user.save();
    }

    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(plan.price * 100),
      currency: plan.currency.toLowerCase(),
      customer: customerId,
      metadata: {
        userId: user._id.toString(),
        planId: plan.planId,
        planName: plan.name,
        durationDays: plan.durationDays.toString()
      },
      description: `${plan.name} - ${plan.durationDays} days`
    });

    res.status(200).json({
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id
    });
  } catch (error) {
    console.error('Payment intent error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

export default {
  verifyPayment,
  handleWebhook,
  getStripeConfig,
  createPaymentIntent
};
