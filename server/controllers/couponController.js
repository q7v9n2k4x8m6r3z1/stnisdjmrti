/**
 * Discount codes.
 *
 * Stripe is the source of truth. There is deliberately no local Coupon model:
 * a mirrored copy of discount rules is exactly the duplicated state that has
 * caused every access bug in this codebase, and Stripe already implements the
 * hard parts correctly — percent vs fixed, how many invoices a discount
 * applies to, expiry, redemption caps, proration and refunds.
 *
 * Two Stripe objects are involved and the distinction matters:
 *   - a COUPON defines the discount itself (20% off, for 3 months)
 *   - a PROMOTION CODE is the string a customer types (SUMMER20), pointing at
 *     a coupon
 *
 * The admin panel creates them as a pair so an admin never has to think about
 * it. Codes are validated here before checkout so the customer sees the real
 * price on our page rather than discovering it on Stripe's.
 */
import stripe from '../config/stripe.js';
import SubscriptionPlan from '../models/SubscriptionPlan.js';
import { CAMPAIGN_CODE, isCampaignCodeValidFor } from '../services/welcomeCampaign.js';

/** Shape a Stripe promotion code + its coupon into one flat row for the admin table. */
function toAdminRow(promo) {
  const c = promo.coupon || {};
  return {
    id: promo.id,
    code: promo.code,
    active: promo.active,
    couponId: c.id,
    // Exactly one of these is set by Stripe.
    percentOff: c.percent_off ?? null,
    amountOff: c.amount_off != null ? c.amount_off / 100 : null,
    currency: (c.currency || 'eur').toUpperCase(),
    // 'once' | 'repeating' | 'forever'
    duration: c.duration,
    durationInMonths: c.duration_in_months ?? null,
    timesRedeemed: promo.times_redeemed || 0,
    maxRedemptions: promo.max_redemptions ?? null,
    expiresAt: promo.expires_at ? new Date(promo.expires_at * 1000) : null,
    firstTimeOnly: promo.restrictions?.first_time_transaction || false,
    minimumAmount: promo.restrictions?.minimum_amount != null
      ? promo.restrictions.minimum_amount / 100
      : null,
    createdAt: new Date(promo.created * 1000),
  };
}

/** Human-readable summary of a discount, used in the admin list and at checkout. */
function describeDiscount(coupon) {
  const c = coupon || {};

  // A coupon deleted directly in the Stripe dashboard expands to a stub with
  // neither field set. Without this guard the row rendered "NaN EUR off".
  if (c.percent_off == null && c.amount_off == null) {
    return 'Discount unavailable — the coupon was deleted in Stripe';
  }

  const amount = c.percent_off != null
    ? `${c.percent_off}%`
    : `${(c.amount_off / 100).toFixed(2)} ${(c.currency || 'eur').toUpperCase()}`;

  if (c.duration === 'forever') return `${amount} off, every renewal`;
  if (c.duration === 'repeating') return `${amount} off for ${c.duration_in_months} month(s)`;
  return `${amount} off the first payment`;
}

// @desc    List discount codes
// @route   GET /api/coupons
// @access  Private/Admin
export const listCoupons = async (req, res) => {
  try {
    // Paged, not capped. A flat limit of 100 silently hid every code beyond
    // the first page once enough had been created.
    const promos = await stripe.promotionCodes
      .list({ limit: 100, expand: ['data.coupon'] })
      .autoPagingToArray({ limit: 1000 });

    const rows = promos
      // Stripe cannot delete a promotion code — only coupons have a delete
      // endpoint — so a deleted code is tombstoned in its metadata and hidden
      // here. From the admin's point of view it is gone; from Stripe's it is a
      // permanently disabled code with no coupon behind it.
      .filter(p => !p.metadata?.deletedAt)
      .map(p => ({
        ...toAdminRow(p),
        description: describeDiscount(p.coupon),
      }));

    res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error('[coupons] list failed:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Create a discount code (coupon + promotion code as one unit)
// @route   POST /api/coupons
// @access  Private/Admin
export const createCoupon = async (req, res) => {
  try {
    const {
      code,
      percentOff,
      amountOff,
      currency = 'EUR',
      duration = 'once',
      durationInMonths,
      maxRedemptions,
      expiresAt,
      firstTimeOnly = false,
      minimumAmount,
    } = req.body;

    if (!code || !String(code).trim()) {
      return res.status(400).json({ success: false, message: 'A code is required' });
    }

    // Exactly one discount kind. Sending both to Stripe is an error, and
    // sending neither silently creates a coupon that discounts nothing.
    const hasPercent = percentOff !== undefined && percentOff !== null && percentOff !== '';
    const hasAmount = amountOff !== undefined && amountOff !== null && amountOff !== '';
    if (hasPercent === hasAmount) {
      return res.status(400).json({
        success: false,
        message: 'Set either a percentage or a fixed amount, not both',
      });
    }

    if (hasPercent) {
      const pct = Number(percentOff);
      if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
        return res.status(400).json({ success: false, message: 'Percentage must be between 1 and 100' });
      }
    } else {
      const amt = Number(amountOff);
      if (!Number.isFinite(amt) || amt <= 0) {
        return res.status(400).json({ success: false, message: 'Amount must be greater than zero' });
      }
    }

    if (duration === 'repeating' && !Number(durationInMonths)) {
      return res.status(400).json({
        success: false,
        message: 'Choose how many months the discount repeats for',
      });
    }

    // An expiry in the past creates a code that can never be used. Stripe
    // accepts it without complaint, so catch it here.
    let expiresUnix;
    if (expiresAt) {
      const when = new Date(expiresAt);
      if (Number.isNaN(when.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid expiry date' });
      }
      if (when.getTime() <= Date.now()) {
        return res.status(400).json({ success: false, message: 'Expiry date must be in the future' });
      }
      expiresUnix = Math.floor(when.getTime() / 1000);
    }

    const normalisedCode = String(code).trim().toUpperCase();

    // The form says letters and numbers only; enforce it rather than letting a
    // stray space reach Stripe and return a raw API error to the admin.
    if (!/^[A-Z0-9]{3,40}$/.test(normalisedCode)) {
      return res.status(400).json({
        success: false,
        message: 'Use letters and numbers only, between 3 and 40 characters',
      });
    }

    // Reject a duplicate before creating the coupon, otherwise the coupon is
    // created, the promotion code fails, and an orphan coupon is left behind.
    const existing = await stripe.promotionCodes.list({ code: normalisedCode, limit: 1 });
    const clash = existing.data[0];
    if (clash) {
      // A deleted code still occupies its name — Stripe keeps promotion codes
      // permanently. Saying "already exists" about something the admin cannot
      // see in the list is not a usable error, so say what actually happened.
      const wasDeleted = !!clash.metadata?.deletedAt;
      return res.status(409).json({
        success: false,
        message: wasDeleted
          ? `${normalisedCode} was used by a code that has been deleted. Stripe keeps codes permanently, so this name cannot be reused — pick a different one.`
          : `The code ${normalisedCode} already exists`,
      });
    }

    const couponParams = {
      duration,
      name: normalisedCode,
      ...(hasPercent
        ? { percent_off: Number(percentOff) }
        : { amount_off: Math.round(Number(amountOff) * 100), currency: String(currency).toLowerCase() }),
      ...(duration === 'repeating' ? { duration_in_months: Number(durationInMonths) } : {}),
    };

    const coupon = await stripe.coupons.create(couponParams);

    let promo;
    try {
      promo = await stripe.promotionCodes.create({
        coupon: coupon.id,
        code: normalisedCode,
        ...(maxRedemptions ? { max_redemptions: Number(maxRedemptions) } : {}),
        ...(expiresUnix ? { expires_at: expiresUnix } : {}),
        restrictions: {
          ...(firstTimeOnly ? { first_time_transaction: true } : {}),
          ...(minimumAmount
            ? { minimum_amount: Math.round(Number(minimumAmount) * 100), minimum_amount_currency: String(currency).toLowerCase() }
            : {}),
        },
      });
    } catch (promoErr) {
      // Don't leave a coupon nobody can reach.
      try { await stripe.coupons.del(coupon.id); } catch { /* best effort */ }
      throw promoErr;
    }

    console.log(`[coupons] created ${normalisedCode} (${describeDiscount(coupon)}) by admin ${req.user?._id}`);

    res.status(201).json({
      success: true,
      data: { ...toAdminRow({ ...promo, coupon }), description: describeDiscount(coupon) },
    });
  } catch (error) {
    console.error('[coupons] create failed:', error.message);
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    Enable or disable a code without deleting it
// @route   PATCH /api/coupons/:id
// @access  Private/Admin
export const setCouponActive = async (req, res) => {
  try {
    const { active } = req.body;
    if (typeof active !== 'boolean') {
      return res.status(400).json({ success: false, message: 'active must be true or false' });
    }

    const promo = await stripe.promotionCodes.update(req.params.id, { active });
    console.log(`[coupons] ${promo.code} ${active ? 'enabled' : 'disabled'} by admin ${req.user?._id}`);

    res.status(200).json({ success: true, data: toAdminRow(promo) });
  } catch (error) {
    console.error('[coupons] update failed:', error.message);
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    Delete a code
// @route   DELETE /api/coupons/:id
// @access  Private/Admin
export const deleteCoupon = async (req, res) => {
  try {
    // Stripe has no delete endpoint for promotion codes — only coupons can be
    // deleted — so "delete" is three steps that together make the code gone
    // and unusable:
    //   1. deactivate the promotion code, so it stops working immediately
    //   2. delete the underlying coupon, so nothing can reach the discount
    //   3. tombstone it in metadata, so listCoupons hides it from the panel
    //
    // What deliberately does NOT happen: customers already receiving this
    // discount keep it. Deleting a code must never retroactively raise the
    // price of someone who is mid-subscription.
    const promo = await stripe.promotionCodes.retrieve(req.params.id, { expand: ['coupon'] });

    await stripe.promotionCodes.update(promo.id, {
      active: false,
      metadata: { ...(promo.metadata || {}), deletedAt: new Date().toISOString() },
    });

    if (promo.coupon?.id) {
      try {
        await stripe.coupons.del(promo.coupon.id);
      } catch (delErr) {
        // Already gone, or Stripe refused — the deactivation above is what
        // actually stops the code, so don't fail the request over it.
        console.warn(`[coupons] coupon ${promo.coupon.id} not deleted: ${delErr.message}`);
      }
    }

    console.log(`[coupons] ${promo.code} deleted by admin ${req.user?._id}`);
    res.status(200).json({
      success: true,
      message: 'Code deleted. Customers already receiving this discount keep it.',
    });
  } catch (error) {
    console.error('[coupons] delete failed:', error.message);
    res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * Resolve a typed code to a usable Stripe promotion code.
 *
 * Shared by the validate endpoint and the two payment paths, so what the
 * customer is shown on the checkout page and what Stripe actually applies can
 * never disagree — the whole point of validating before redirect.
 *
 * @returns {Promise<{ok: true, promo: object} | {ok: false, message: string}>}
 */
export async function resolvePromotionCode(rawCode, { userId = null } = {}) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) return { ok: false, message: 'Enter a code' };

  // Campaign codes carry a per-recipient window that Stripe cannot express: a
  // shared promotion code has one expiry for everyone, but BIENVENIDA10 must
  // die 24 hours after each person's email. The rule lives in one place and is
  // applied here so the checkout preview and the actual charge cannot differ.
  if (code === CAMPAIGN_CODE) {
    const eligible = await isCampaignCodeValidFor(userId);
    if (!eligible.ok) return { ok: false, message: eligible.message };
  }

  // Deliberately NOT filtered by customer.
  //
  // `customer` on this endpoint means "only return codes RESTRICTED to this
  // customer" — it is not an applicability check. Passing it excluded every
  // ordinary unrestricted code, so any returning customer (anyone with a
  // stripeCustomerId, i.e. anyone who had reached checkout before) was told a
  // perfectly good code was invalid, while brand-new users saw it work.
  //
  // Customer-specific restrictions like first_time_transaction are enforced by
  // Stripe when the discount is applied, and surface as a clear error there.
  const found = await stripe.promotionCodes.list({
    code,
    active: true,
    limit: 1,
    expand: ['data.coupon'],
  });

  const promo = found.data[0];
  // Stripe's `active` filter already excludes disabled codes, but expiry and
  // redemption limits are separate fields and are not filtered by it.
  if (!promo) return { ok: false, message: 'That code is not valid' };

  if (promo.expires_at && promo.expires_at * 1000 <= Date.now()) {
    return { ok: false, message: 'That code has expired' };
  }
  if (promo.max_redemptions != null && promo.times_redeemed >= promo.max_redemptions) {
    return { ok: false, message: 'That code has been fully redeemed' };
  }
  if (promo.coupon && promo.coupon.valid === false) {
    return { ok: false, message: 'That code is no longer available' };
  }

  return { ok: true, promo };
}

// @desc    Check a code and preview the price, before any payment is started
// @route   POST /api/coupons/validate
// @access  Private
export const validateCoupon = async (req, res) => {
  try {
    const { code, planId } = req.body;

    const plan = await SubscriptionPlan.findOne({ planId, isActive: true });
    if (!plan) {
      return res.status(400).json({ success: false, message: 'Invalid plan' });
    }

    const result = await resolvePromotionCode(code, { userId: req.user?.id || req.user?._id || null });
    if (!result.ok) {
      return res.status(200).json({ success: false, message: result.message });
    }

    const coupon = result.promo.coupon;

    // Preview only. Stripe recomputes the real charge at payment time; this
    // exists so the customer is not asked to trust an undiscounted number.
    let discountAmount;
    if (coupon.percent_off != null) {
      discountAmount = (plan.price * coupon.percent_off) / 100;
    } else {
      discountAmount = coupon.amount_off / 100;
    }
    const newPrice = Math.max(0, plan.price - discountAmount);

    res.status(200).json({
      success: true,
      data: {
        code: result.promo.code,
        description: describeDiscount(coupon),
        originalPrice: Number(plan.price.toFixed(2)),
        discountAmount: Number(discountAmount.toFixed(2)),
        newPrice: Number(newPrice.toFixed(2)),
        currency: plan.currency || 'EUR',
        // 'once' means the discount applies to the first payment only — the
        // customer should be told that before they buy, not after.
        duration: coupon.duration,
        durationInMonths: coupon.duration_in_months ?? null,
      },
    });
  } catch (error) {
    console.error('[coupons] validate failed:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

export default {
  listCoupons,
  createCoupon,
  setCouponActive,
  deleteCoupon,
  validateCoupon,
  resolvePromotionCode,
};
