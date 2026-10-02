import SubscriptionPlan from '../models/SubscriptionPlan.js';
import User, { PAST_DUE_GRACE_MS, hasActiveWindow } from '../models/User.js';
import stripe from '../config/stripe.js';
import { sendSubscriptionCancelledEmail, notifyAdminCancelledSubscription } from '../services/emailService.js';
import { parseDeviceInfo } from '../utils/deviceParser.js';
import { registerDevice as registerDeviceAtomic } from '../utils/deviceRegistry.js';
import { customerLocaleFields } from '../utils/stripeLocale.js';

// @desc    Get all subscription plans
// @route   GET /api/subscriptions/plans
// @access  Public
export const getPlans = async (req, res) => {
  try {
    const plans = await SubscriptionPlan.find({ isActive: true }).sort({ order: 1 });
    
    res.status(200).json({
      success: true,
      count: plans.length,
      data: plans
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get single subscription plan
// @route   GET /api/subscriptions/plans/:planId
// @access  Public
export const getPlan = async (req, res) => {
  try {
    const plan = await SubscriptionPlan.findOne({ planId: req.params.planId });
    
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Plan not found'
      });
    }
    
    res.status(200).json({
      success: true,
      data: plan
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get user's subscription status
// @route   GET /api/subscriptions/status
// @access  Private
export const getSubscriptionStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .populate('subscription.sharedWith', 'name email')
      .populate('subscription.sharedBy', 'name email');
    
    // Recognize both Stripe-paid (planId set) and admin-granted (plan name set, no planId)
    const hasPlan = user.subscription.planId ||
      (user.subscription.plan && user.subscription.plan !== 'free');

    if (!hasPlan || user.subscription.status === 'inactive') {
      return res.status(200).json({
        success: true,
        data: {
          hasSubscription: false,
          status: user.subscription.status || 'inactive'
        }
      });
    }

    // Look up Stripe plan document (null for admin-granted plans)
    const plan = user.subscription.planId
      ? await SubscriptionPlan.findOne({ planId: user.subscription.planId })
      : null;

    // past_due grace: compute BEFORE the expired check so it can bypass it.
    //
    // Uses the shared PAST_DUE_GRACE_MS from the User model — the single place
    // the policy lives (currently ZERO; SUBSCRIPTION_GRACE_DAYS reopens it).
    // This used to hardcode its own 10 days, left behind when the zero-grace
    // policy landed and only updated the model. The endpoint therefore reported
    // isActive:true for a past_due account up to 10 days past endDate while
    // requireSubscription and canDownload — which DID follow the policy —
    // returned 403 for the same account. The UI showed an active subscription
    // and every download failed. It also suppressed the flip to 'expired'
    // below, so the record stayed past_due indefinitely.
    //
    // The window is bounded at BOTH ends. `now - endDate < GRACE` alone is also
    // satisfied by a FUTURE endDate (a negative difference), which granted the
    // grace to anyone whose endDate had been pushed forward — the exact bug
    // fixed in User.js and middleware/subscription.js.
    const msSinceExpiry = user.subscription.endDate
      ? Date.now() - new Date(user.subscription.endDate).getTime()
      : null;
    const isPastDueInGrace = user.subscription.status === 'past_due' &&
      msSinceExpiry !== null &&
      msSinceExpiry >= 0 &&
      msSinceExpiry < PAST_DUE_GRACE_MS;

    // Check if subscription expired (past endDate).
    // Skip for past_due users still within the retry grace window — do NOT overwrite their status.
    if (!isPastDueInGrace && user.subscription.endDate && new Date() > user.subscription.endDate) {
      const hoursSinceExpiry = (Date.now() - new Date(user.subscription.endDate).getTime()) / (1000 * 60 * 60);
      // For Stripe-managed subscriptions give a 48h grace window for webhook delivery
      // before marking expired locally — avoids locking out users due to webhook delays
      const hasStripeSubscription = !!user.subscription.stripeSubscriptionId;
      const shouldExpireLocally = !hasStripeSubscription || hoursSinceExpiry > 48;

      if (shouldExpireLocally) {
        // Guarded and atomic — the endDate condition is re-checked by the
        // database at write time rather than against the copy loaded above.
        // A payment landing while this request was in flight moves endDate
        // forward with an atomic $set from handleInvoicePaid; a full-document
        // save from this stale copy would stamp 'expired' over it and leave a
        // customer who had just paid locked out with a future endDate.
        await User.updateOne(
          {
            _id: user._id,
            'subscription.status': { $ne: 'expired' },
            'subscription.endDate': { $lt: new Date() }
          },
          { $set: { 'subscription.status': 'expired' } }
        );
        // Mirror it in the copy we report from, so the status this endpoint
        // returns matches what was just persisted without a second read.
        user.subscription.status = 'expired';
      }
    }

    // Admin-granted plans with no endDate = unlimited (-1 signals "no expiry")
    const daysRemaining = user.subscription.endDate
      ? Math.max(0, Math.ceil((user.subscription.endDate - new Date()) / (1000 * 60 * 60 * 24)))
      : -1;

    // isActive is what the UI labels the account with, so it must agree with
    // requireSubscription and User.canDownload exactly — any divergence shows
    // the customer one thing while the download endpoints do another.
    //
    // Delegated to the shared predicate rather than restated here, which is
    // the rule for this question (see CLAUDE.md). The copy that used to live
    // in this function was missing hasActiveWindow's stale-active guard: an
    // 'active' status whose endDate has already passed is stale data, not
    // entitlement. Inside the 48h webhook-delivery window above the record
    // deliberately stays 'active' past endDate, so this endpoint reported
    // isActive:true for accounts every download endpoint was already 403ing.
    const isActive = hasActiveWindow(user.subscription);

    res.status(200).json({
      success: true,
      data: {
        hasSubscription: true,
        isActive,
        subscription: user.subscription,
        plan: plan,
        daysRemaining
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Activate subscription (after payment)
// @route   POST /api/subscriptions/activate
// @access  Private
export const activateSubscription = async (req, res) => {
  try {
    // Block non-admin users — real activation is handled exclusively by the Stripe webhook
    if (req.user.role !== 'admin') {
      console.warn(
        `[SECURITY] Unauthorized activation attempt — userId=${req.user.id}, ip=${req.ip}, body=${JSON.stringify(req.body)}`
      );
      return res.status(403).json({
        success: false,
        message: 'Forbidden. Subscription activation is handled automatically after payment.'
      });
    }

    const { planId, paymentIntentId, paymentMethod } = req.body;
    
    const plan = await SubscriptionPlan.findOne({ planId });
    
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Plan not found'
      });
    }
    
    const user = await User.findById(req.user.id);
    
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + plan.durationDays);
    
    // Update subscription
    user.subscription.planId = planId;
    user.subscription.status = 'active';
    user.subscription.startDate = startDate;
    user.subscription.endDate = endDate;
    user.subscription.stripePaymentIntentId = paymentIntentId;
    user.subscription.paymentMethod = paymentMethod;
    user.subscription.autoRenew = plan.duration === 'monthly';
    
    // Add to history
    user.subscriptionHistory.push({
      planId: planId,
      startDate: startDate,
      endDate: endDate,
      amount: plan.price,
      currency: plan.currency,
      status: 'completed',
      stripePaymentIntentId: paymentIntentId
    });
    
    await user.save();
    
    res.status(200).json({
      success: true,
      message: 'Subscription activated successfully',
      data: {
        subscription: user.subscription,
        plan: plan
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Cancel subscription
// @route   PUT /api/subscriptions/cancel
// @access  Private
export const cancelSubscription = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    const cancelableStatuses = ['active', 'past_due'];
    if (!user.subscription.planId || !cancelableStatuses.includes(user.subscription.status)) {
      return res.status(400).json({
        success: false,
        message: 'No active subscription to cancel'
      });
    }
    
    // Cancel on Stripe if this is a recurring subscription.
    // Recovery: if stripeSubscriptionId is missing in DB but we have a customerId,
    // fetch the live active subscription from Stripe and sync it back to DB.
    let stripeSubscriptionId = user.subscription.stripeSubscriptionId;
    if (!stripeSubscriptionId && user.subscription.stripeCustomerId) {
      try {
        const subs = await stripe.subscriptions.list({
          customer: user.subscription.stripeCustomerId,
          limit: 10
        });
        const liveSub = subs.data.find(s => ['active', 'past_due', 'trialing'].includes(s.status));
        if (liveSub) {
          stripeSubscriptionId = liveSub.id;
          user.subscription.stripeSubscriptionId = stripeSubscriptionId;
          console.log(`[cancelSubscription] Recovered stripeSubscriptionId ${stripeSubscriptionId} from Stripe for user ${user._id}`);
        }
      } catch (e) {
        console.warn('[cancelSubscription] Could not recover stripeSubscriptionId from Stripe:', e.message);
      }
    }

    if (stripeSubscriptionId) {
      let stripeSubscription;
      try {
        stripeSubscription = await stripe.subscriptions.update(stripeSubscriptionId, {
          cancel_at_period_end: true
        });
      } catch (err) {
        console.error('[cancelSubscription] Stripe cancel failed:', err.message);
        // Hard fail — do NOT silently proceed. If Stripe wasn't updated, the subscription
        // would keep auto-renewing and the user would be charged against their intent.
        return res.status(502).json({
          success: false,
          message: 'Could not reach Stripe to cancel your subscription. Please try again or contact support.',
          stripeError: err.message
        });
      }

      user.subscription.cancelAtPeriodEnd = true;
      // Sync endDate so isWithinPeriod check works correctly after cancellation
      if (stripeSubscription.current_period_end) {
        user.subscription.endDate = new Date(stripeSubscription.current_period_end * 1000);
      }
      console.log(`[cancelSubscription] Stripe confirmed cancel_at_period_end for sub ${stripeSubscriptionId}, user ${user._id}`);

      // Send cancellation confirmation email now (before period ends)
      const accessUntil = stripeSubscription?.current_period_end
        ? new Date(stripeSubscription.current_period_end * 1000)
        : user.subscription.endDate;
      sendSubscriptionCancelledEmail(user, user.subscription.planId || 'N/A', accessUntil)
        .catch(err => console.error('[cancelSubscription] Cancellation email failed:', err));
      // Admin will be notified by handleSubscriptionDeleted webhook at actual period end.
      // Avoid double-notifying for Stripe-managed subscriptions.
    }

    // For Stripe subscriptions: keep status 'active' — access continues until period end.
    // The customer.subscription.deleted webhook will set status='cancelled' at the right time.
    // For non-Stripe (admin-granted) subscriptions: cancel immediately in DB.
    if (!stripeSubscriptionId) {
      user.subscription.status = 'cancelled';
      console.log(`[cancelSubscription] Skipping Stripe cancel for user ${user._id}: no stripeSubscriptionId found.`);
      // Non-Stripe (admin-granted) cancel: notify admin immediately since no webhook will fire
      notifyAdminCancelledSubscription(user, user.subscription.planId || 'N/A')
        .catch(err => console.error('[cancelSubscription] Admin cancel notification failed:', err));
    }
    user.subscription.autoRenew = false;

    await user.save();

    res.status(200).json({
      success: true,
      message: 'Subscription cancelled. Access will continue until end date.',
      stripeConfirmed: !!stripeSubscriptionId,
      data: {
        subscription: user.subscription
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get user's devices
// @route   GET /api/subscriptions/devices
// @access  Private
export const getDevices = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    res.status(200).json({
      success: true,
      data: user.subscription.devices || []
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Register/update device
// @route   POST /api/subscriptions/devices
// @access  Private
export const registerDevice = async (req, res) => {
  try {
    const { deviceId, deviceInfo } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress;
    
    const user = await User.findById(req.user.id);
    const plan = await SubscriptionPlan.findOne({ planId: user.subscription.planId });

    if (!plan) {
      return res.status(400).json({
        success: false,
        message: 'No active subscription plan'
      });
    }

    // Atomic registration — no load-modify-save race (see utils/deviceRegistry.js)
    const parsed = parseDeviceInfo(req.headers['user-agent'] || '');
    const meta = { ...parsed, deviceInfo: deviceInfo || parsed.deviceInfo, ipAddress };
    const result = await registerDeviceAtomic(user._id, deviceId, meta, { maxDevices: plan.features.maxDevices });

    const refreshed = await User.findById(user._id).select('subscription.devices');
    const devices = refreshed?.subscription?.devices || [];

    if (result === 'limit') {
      return res.status(403).json({
        success: false,
        message: `Device limit reached (${plan.features.maxDevices} devices max). Remove a device to continue.`,
        devices
      });
    }

    res.status(200).json({
      success: true,
      message: 'Device registered successfully',
      data: devices
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Remove device
// @route   DELETE /api/subscriptions/devices/:deviceId
// @access  Private
export const removeDevice = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    user.subscription.devices = user.subscription.devices.filter(
      d => d.deviceId !== req.params.deviceId
    );
    
    await user.save();
    
    res.status(200).json({
      success: true,
      message: 'Device removed successfully',
      data: user.subscription.devices
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Share subscription with another user
// @route   POST /api/subscriptions/share
// @access  Private
export const shareSubscription = async (req, res) => {
  try {
    const { email } = req.body;
    
    const user = await User.findById(req.user.id);
    const plan = await SubscriptionPlan.findOne({ planId: user.subscription.planId });
    
    if (!plan || plan.type !== 'shared') {
      return res.status(400).json({
        success: false,
        message: 'Only shared plans can be shared with other users'
      });
    }
    
    if (user.subscription.sharedWith.length >= plan.features.maxUsers - 1) {
      return res.status(400).json({
        success: false,
        message: `Maximum users reached (${plan.features.maxUsers} users max)`
      });
    }
    
    const sharedUser = await User.findOne({ email: email.toLowerCase() });
    
    if (!sharedUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found with that email'
      });
    }
    
    if (sharedUser._id.toString() === user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Cannot share subscription with yourself'
      });
    }
    
    if (user.subscription.sharedWith.includes(sharedUser._id)) {
      return res.status(400).json({
        success: false,
        message: 'Subscription already shared with this user'
      });
    }
    
    // Add to sharedWith array
    user.subscription.sharedWith.push(sharedUser._id);
    await user.save();
    
    // Update shared user's subscription
    sharedUser.subscription.planId = user.subscription.planId;
    sharedUser.subscription.status = 'active';
    sharedUser.subscription.startDate = user.subscription.startDate;
    sharedUser.subscription.endDate = user.subscription.endDate;
    sharedUser.subscription.sharedBy = user._id;
    await sharedUser.save();
    
    res.status(200).json({
      success: true,
      message: 'Subscription shared successfully',
      data: {
        sharedWith: user.subscription.sharedWith
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Remove shared user
// @route   DELETE /api/subscriptions/share/:userId
// @access  Private
export const removeSharedUser = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const sharedUserId = req.params.userId;
    
    user.subscription.sharedWith = user.subscription.sharedWith.filter(
      id => id.toString() !== sharedUserId
    );
    await user.save();
    
    // Remove subscription from shared user
    const sharedUser = await User.findById(sharedUserId);
    if (sharedUser) {
      sharedUser.subscription.planId = null;
      sharedUser.subscription.status = 'inactive';
      sharedUser.subscription.sharedBy = null;
      await sharedUser.save();
    }
    
    res.status(200).json({
      success: true,
      message: 'Shared user removed successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Check WhatsApp support eligibility
// @route   GET /api/subscriptions/whatsapp-eligibility
// @access  Private
export const checkWhatsAppEligibility = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user.subscription.planId || user.subscription.status !== 'active') {
      return res.status(200).json({
        success: true,
        data: { eligible: false, reason: 'no_active_subscription' }
      });
    }

    // Check if subscription expired
    if (user.subscription.endDate && new Date() > user.subscription.endDate) {
      return res.status(200).json({
        success: true,
        data: { eligible: false, reason: 'subscription_expired' }
      });
    }

    const plan = await SubscriptionPlan.findOne({ planId: user.subscription.planId });

    if (!plan || !plan.features.whatsappSupport) {
      return res.status(200).json({
        success: true,
        data: { eligible: false, reason: 'plan_no_whatsapp' }
      });
    }

    const whatsappNumber = process.env.WHATSAPP_NUMBER || '';

    res.status(200).json({
      success: true,
      data: {
        eligible: true,
        whatsappNumber,
        planName: plan.name
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Update a subscription plan (price, features, etc.)
// @route   PUT /api/subscriptions/plans/:planId
// @access  Private/Admin
export const updatePlan = async (req, res) => {
  try {
    const plan = await SubscriptionPlan.findOne({ planId: req.params.planId });
    if (!plan) {
      return res.status(404).json({ success: false, message: 'Plan not found' });
    }

    const { price, durationDays, type, duration, name, nameEs, badge, badgeEs, isActive, isBestOption, features } = req.body;

    if (price !== undefined)         plan.price        = parseFloat(price);
    if (durationDays !== undefined)  plan.durationDays = parseInt(durationDays);
    if (type !== undefined)          plan.type         = type;
    if (duration !== undefined)      plan.duration     = duration;
    if (name !== undefined)          plan.name         = name;
    if (nameEs !== undefined)        plan.nameEs       = nameEs;
    if (badge !== undefined)         plan.badge        = badge;
    if (badgeEs !== undefined)       plan.badgeEs      = badgeEs;
    if (isActive !== undefined)      plan.isActive     = isActive;
    if (isBestOption !== undefined)  plan.isBestOption = isBestOption;

    if (features && typeof features === 'object') {
      Object.assign(plan.features, features);
    }

    await plan.save();
    res.status(200).json({ success: true, data: plan });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    List all saved payment methods for the Stripe customer
// @route   GET /api/subscriptions/payment-methods
// @access  Private
export const listPaymentMethods = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    let customerId = user.subscription?.stripeCustomerId;

    if (!customerId) {
      return res.status(200).json({ success: true, data: { cards: [], defaultId: null } });
    }

    // Get all saved cards
    const pms = await stripe.paymentMethods.list({ customer: customerId, type: 'card' });

    // Determine the default payment method
    let defaultId = null;
    const subscriptionId = user.subscription?.stripeSubscriptionId;
    if (subscriptionId) {
      try {
        const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['default_payment_method'] });
        defaultId = typeof sub.default_payment_method === 'object'
          ? sub.default_payment_method?.id
          : sub.default_payment_method;
      } catch (_) {}
    }
    if (!defaultId) {
      const customer = await stripe.customers.retrieve(customerId, { expand: ['invoice_settings.default_payment_method'] });
      const def = customer.invoice_settings?.default_payment_method;
      defaultId = typeof def === 'object' ? def?.id : def;
    }

    const cards = pms.data.map(pm => ({
      id: pm.id,
      brand: pm.card?.brand || 'card',
      last4: pm.card?.last4 || '????',
      expMonth: pm.card?.exp_month,
      expYear: pm.card?.exp_year,
      isDefault: pm.id === defaultId
    }));

    res.status(200).json({ success: true, data: { cards, defaultId } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Remove (detach) a saved payment method
// @route   DELETE /api/subscriptions/payment-method/:pmId
// @access  Private
export const detachPaymentMethod = async (req, res) => {
  try {
    const { pmId } = req.params;
    const user = await User.findById(req.user.id);
    const customerId = user.subscription?.stripeCustomerId;

    // Safety: verify this card belongs to this customer before detaching
    const pm = await stripe.paymentMethods.retrieve(pmId);
    if (pm.customer !== customerId) {
      return res.status(403).json({ success: false, message: 'Not your payment method' });
    }

    // What would be left on file, and will this customer be billed again?
    // Ask Stripe rather than our own record — Stripe is the authority on both,
    // and a stale local status is exactly what caused earlier access bugs.
    const [allCards, subs, customer] = await Promise.all([
      stripe.paymentMethods.list({ customer: customerId, type: 'card' }),
      stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 10 }),
      stripe.customers.retrieve(customerId),
    ]);
    const remaining = allCards.data.filter(p => p.id !== pmId);
    // A subscription set to cancel at period end will not be charged again, so
    // removing the card is harmless in that case.
    const willBillAgain = subs.data.find(
      s => ['active', 'past_due', 'trialing', 'unpaid'].includes(s.status) && !s.cancel_at_period_end
    );

    // Removing the ONLY card while billing continues guarantees the next
    // renewal fails. Since access now ends the moment the paid period does,
    // that silently costs the customer their subscription — so refuse, and
    // tell them the two ways forward.
    if (remaining.length === 0 && willBillAgain) {
      return res.status(409).json({
        success: false,
        requiresCardOnFile: true,
        message: 'Please add another card before removing this one. Your subscription renews automatically and the payment would fail without a card on file. If you want to stop renewing, cancel your subscription first.',
      });
    }

    // Capture the default BEFORE detaching — Stripe clears it on detach, so
    // afterwards there is no way to tell whether this card was the default.
    const wasDefault = customer.invoice_settings?.default_payment_method === pmId;

    await stripe.paymentMethods.detach(pmId);

    // Removing the default card while others remain leaves the customer with
    // cards on file but NO default, so the next renewal fails anyway. Promote
    // a replacement on both the customer and the subscription.
    let promoted = null;
    if (wasDefault && remaining.length > 0) {
      promoted = remaining[0].id;
      await stripe.customers.update(customerId, {
        invoice_settings: { default_payment_method: promoted },
      });
      if (willBillAgain) {
        await stripe.subscriptions.update(willBillAgain.id, { default_payment_method: promoted }).catch(
          e => console.error('[detach] could not set subscription default:', e.message)
        );
      }
      console.log(`[detach] user ${user._id}: removed default card, promoted ${promoted}`);
    }

    res.status(200).json({
      success: true,
      message: promoted ? 'Card removed. Your other card is now the default.' : 'Card removed',
      data: { remainingCards: remaining.length, newDefaultPaymentMethod: promoted },
    });
  } catch (error) {
    console.error('[detach] failed:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get current payment method from Stripe
// @route   GET /api/subscriptions/payment-method
// @access  Private
export const getPaymentMethod = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const customerId = user.subscription?.stripeCustomerId;
    const subscriptionId = user.subscription?.stripeSubscriptionId;

    if (!customerId) {
      return res.status(200).json({ success: true, data: null });
    }

    let pm = null;

    // Try subscription's default_payment_method first
    if (subscriptionId) {
      try {
        const sub = await stripe.subscriptions.retrieve(subscriptionId, {
          expand: ['default_payment_method']
        });
        pm = sub.default_payment_method || null;
      } catch (_) {}
    }

    // Fall back to customer's invoice default
    if (!pm) {
      const customer = await stripe.customers.retrieve(customerId, {
        expand: ['invoice_settings.default_payment_method']
      });
      pm = customer.invoice_settings?.default_payment_method || null;
    }

    if (!pm || typeof pm === 'string') {
      return res.status(200).json({ success: true, data: null });
    }

    res.status(200).json({
      success: true,
      data: {
        brand: pm.card?.brand || 'card',
        last4: pm.card?.last4 || '????',
        expMonth: pm.card?.exp_month,
        expYear: pm.card?.exp_year,
        id: pm.id
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Create Stripe SetupIntent to update payment method
// @route   POST /api/subscriptions/setup-intent
// @access  Private
export const createSetupIntent = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    let customerId = user.subscription?.stripeCustomerId;

    const createCustomer = async () => {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        // Localises the emails Stripe sends itself (failed payment, receipts).
        ...customerLocaleFields(user),
        metadata: { userId: user._id.toString() }
      });
      user.subscription.stripeCustomerId = customer.id;
      await user.save();
      return customer.id;
    };

    if (!customerId) {
      customerId = await createCustomer();
    }

    let setupIntent;
    try {
      setupIntent = await stripe.setupIntents.create({
        customer: customerId,
        usage: 'off_session',
        payment_method_types: ['card']
      });
    } catch (stripeErr) {
      // Stale customer ID (e.g. live→test mode switch) — create a fresh one
      if (stripeErr.code === 'resource_missing') {
        customerId = await createCustomer();
        setupIntent = await stripe.setupIntents.create({
          customer: customerId,
          usage: 'off_session',
          payment_method_types: ['card']
        });
      } else {
        throw stripeErr;
      }
    }

    res.status(200).json({ success: true, clientSecret: setupIntent.client_secret });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Set new default payment method after SetupIntent confirmed
// @route   POST /api/subscriptions/payment-method
// @access  Private
export const updatePaymentMethod = async (req, res) => {
  try {
    const { paymentMethodId } = req.body;
    if (!paymentMethodId) {
      return res.status(400).json({ success: false, message: 'paymentMethodId required' });
    }

    const user = await User.findById(req.user.id);
    const customerId = user.subscription?.stripeCustomerId;
    const subscriptionId = user.subscription?.stripeSubscriptionId;

    if (!customerId) {
      return res.status(400).json({ success: false, message: 'No Stripe customer found' });
    }

    // Attach to customer if not already attached
    await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId }).catch(() => {});

    // Set as customer default
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId }
    });

    // Set as subscription default so next invoice uses this card
    if (subscriptionId) {
      await stripe.subscriptions.update(subscriptionId, {
        default_payment_method: paymentMethodId
      });

      // If subscription is past_due, attempt to pay the outstanding invoice now
      if (user.subscription.status === 'past_due') {
        try {
          const invoices = await stripe.invoices.list({
            customer: customerId,
            status: 'open',
            limit: 1
          });
          if (invoices.data.length > 0) {
            await stripe.invoices.pay(invoices.data[0].id, {
              payment_method: paymentMethodId
            });
          }
        } catch (retryErr) {
          console.warn('Immediate retry after card update failed:', retryErr.message);
        }
      }
    }

    res.status(200).json({ success: true, message: 'Payment method updated' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get subscription history
// @route   GET /api/subscriptions/history
// @access  Private
export const getSubscriptionHistory = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    res.status(200).json({
      success: true,
      data: user.subscriptionHistory || []
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
