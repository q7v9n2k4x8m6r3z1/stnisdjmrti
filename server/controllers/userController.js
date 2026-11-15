import User from '../models/User.js';
import SubscriptionPlan from '../models/SubscriptionPlan.js';
import Download from '../models/Download.js';
import { uploadToWasabi, deleteFromWasabi, getSignedDownloadUrl } from '../config/wasabi.js';
import stripe from '../config/stripe.js';
import { isStaging } from '../config/stripeTest.js';
import { sendBlockedAccountEmail } from '../services/emailService.js';

// Shared plan-id variant matcher (covers Stripe planIds, legacy hyphenated
// values, and the admin-set `subscription.plan` field).
const planMatch = (ids) => ({
  'subscription.status': 'active',
  $or: [
    { 'subscription.plan': { $in: ids } },
    { 'subscription.planId': { $in: ids } }
  ]
});
const INDIVIDUAL_PLAN_IDS = ['premium', 'individual-monthly', 'individual_monthly', 'individual-quarterly', 'individual_quarterly'];
const SHARED_PLAN_IDS = ['pro', 'shared-monthly', 'shared_monthly', 'shared-quarterly', 'shared_quarterly'];

// Stripe statuses that constitute EVIDENCE OF PAYMENT for the current period.
//
// Stripe advances current_period_end when it ATTEMPTS a renewal, not when one
// succeeds, so copying it unconditionally extends paid-through on a renewal
// that FAILED. handleSubscriptionUpdated (stripeController.js) and
// requireSubscription (middleware/subscription.js) were both fixed to gate on
// this in 0b7591f; the two admin sync paths below were missed by that commit
// and kept writing endDate for past_due/cancelled/unpaid subscriptions — so
// pressing "Sync All from Stripe" re-granted access the gates had correctly
// withdrawn. endDate must only ever move forward on evidence of payment.
const STRIPE_PAID_STATUSES = ['active', 'trialing'];

// Maps a stat-card "segment" to its Mongo filter. Kept in one place so the
// displayed count (from getAllUsers' stats block) and the filtered table
// (query built from this same function) can never disagree.
function buildSegmentQuery(segment) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  switch (segment) {
    case 'free':
      return { 'subscription.status': { $ne: 'active' } };
    case 'individual':
      return planMatch(INDIVIDUAL_PLAN_IDS);
    case 'shared':
      return planMatch(SHARED_PLAN_IDS);
    case 'flagged':
      return { $or: [{ downloadSuspended: true }, { downloadFlaggedForReview: true }, { isBlocked: true }] };
    case 'new':
      return { createdAt: { $gte: startOfMonth } };
    default:
      return {};
  }
}

// @desc    Get all users with search, pagination, stats
// @route   GET /api/users
// @access  Private/Admin
export const getAllUsers = async (req, res) => {
  try {
    const {
      search = '',
      role,
      plan,
      status,
      segment,
      sort = '-createdAt',
      page = 1,
      limit = 25
    } = req.query;

    const query = { role: { $ne: 'admin' } };
    const andConditions = [];

    if (search) {
      andConditions.push({ $or: [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ]});
    }

    if (role) query.role = role;
    if (plan) {
      const planVariants = [plan, plan.replace(/-/g, '_'), plan.replace(/_/g, '-')];
      andConditions.push({ $or: [
        { 'subscription.planId': { $in: planVariants } },
        { 'subscription.plan': { $in: planVariants } }
      ]});
    }
    if (status) query['subscription.status'] = status;

    // segment=all (or omitted) shows everyone — the Total Members card.
    if (segment && segment !== 'all') {
      Object.assign(query, buildSegmentQuery(segment));
    }

    if (andConditions.length) query.$and = andConditions;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await User.countDocuments(query);

    const users = await User.find(query)
      .select('-password')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Today's downloads come from the Download collection, not from the
    // denormalised user.downloads.today counter.
    //
    // That counter is bumped by an atomic $inc on every download but is never
    // reset in the database: resetDailyDownloads() only mutates an in-memory
    // document and no caller saves it. So it only ever grows and converges on
    // the lifetime total — one account showed "87 downloads, +87 today" having
    // last downloaded anything four weeks earlier. The Downloads panel reads
    // the Download collection and was right; this panel read the counter and
    // was wrong.
    //
    // One indexed aggregation per page ({ userId: 1, createdAt: -1 } covers
    // it), scoped to the users actually being displayed.
    if (users.length) {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const todayCounts = await Download.aggregate([
        { $match: { userId: { $in: users.map(u => u._id) }, createdAt: { $gte: startOfToday } } },
        { $group: { _id: '$userId', count: { $sum: 1 } } },
      ]);
      const todayByUser = new Map(todayCounts.map(r => [String(r._id), r.count]));
      for (const u of users) {
        u.downloads = { ...(u.downloads || {}), today: todayByUser.get(String(u._id)) || 0 };
      }
    }

    // Compute stats by subscription.plan (covers both Stripe and admin-granted plans).
    // Each count uses buildSegmentQuery so the number on a stat card always
    // matches exactly what clicking that card filters the table to.
    const [
      totalUsers,
      activeCount,
      individualMonthlyCount,
      individualQuarterlyCount,
      sharedMonthlyCount,
      sharedQuarterlyCount,
      freeCount,
      flaggedCount,
      newThisMonth,
      activePlans
    ] = await Promise.all([
      User.countDocuments({ role: { $ne: 'admin' } }),
      User.countDocuments({ 'subscription.status': 'active', role: { $ne: 'admin' } }),
      User.countDocuments(planMatch(['premium', 'individual-monthly', 'individual_monthly'])),
      User.countDocuments(planMatch(['individual-quarterly', 'individual_quarterly'])),
      User.countDocuments(planMatch(['pro', 'shared-monthly', 'shared_monthly'])),
      User.countDocuments(planMatch(['shared-quarterly', 'shared_quarterly'])),
      User.countDocuments({ role: { $ne: 'admin' }, ...buildSegmentQuery('free') }),
      User.countDocuments({ role: { $ne: 'admin' }, ...buildSegmentQuery('flagged') }),
      User.countDocuments({ role: { $ne: 'admin' }, ...buildSegmentQuery('new') }),
      SubscriptionPlan.find({ isActive: true }).select('planId price duration').lean()
    ]);

    const priceOf = (id) => (activePlans.find(p => p.planId === id)?.price || 0);
    const estimatedRevenue = (
      individualMonthlyCount  * priceOf('individual_monthly') +
      individualQuarterlyCount * (priceOf('individual_quarterly') / 3) +
      sharedMonthlyCount      * priceOf('shared_monthly') +
      sharedQuarterlyCount    * (priceOf('shared_quarterly') / 3)
    ).toFixed(2);

    res.status(200).json({
      success: true,
      data: users,
      stats: {
        totalUsers,
        activeCount,
        individualMonthlyCount,
        individualQuarterlyCount,
        sharedMonthlyCount,
        sharedQuarterlyCount,
        freeCount,
        flaggedCount,
        newThisMonth,
        estimatedRevenue: parseFloat(estimatedRevenue)
      },
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Export users (matching the current search/segment filter) as CSV
// @route   GET /api/users/export
// @access  Private/Admin
const EXPORT_ROW_CAP = 10000;
export const exportUsers = async (req, res) => {
  try {
    const { search = '', segment } = req.query;

    const query = { role: { $ne: 'admin' } };
    if (search) {
      query.$and = [{ $or: [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ]}];
    }
    if (segment && segment !== 'all') {
      Object.assign(query, buildSegmentQuery(segment));
    }

    const users = await User.find(query)
      .select('-password')
      .sort('-createdAt')
      .limit(EXPORT_ROW_CAP)
      .lean();

    // Today's downloads from the Download collection, same as getAllUsers.
    // user.downloads.today is never reset in the database, so exporting it
    // shipped the lifetime total under a "Downloads Today" heading.
    //
    // Matched on date alone rather than on the exported user ids: an export
    // can carry up to EXPORT_ROW_CAP rows, and today's downloads across the
    // whole platform are far fewer than a 10,000-element $in.
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayCounts = await Download.aggregate([
      { $match: { createdAt: { $gte: startOfToday } } },
      { $group: { _id: '$userId', count: { $sum: 1 } } },
    ]);
    const todayByUser = new Map(todayCounts.map(r => [String(r._id), r.count]));

    const escapeCsv = (val) => {
      const s = val === null || val === undefined ? '' : String(val);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const planOf = (u) => u.subscription?.planId || u.subscription?.plan || 'free';
    const statusOf = (u) => {
      if (u.isBlocked) return `Blocked (${u.blockReason || 'unspecified'})`;
      if (u.downloadSuspended) return 'Download suspended';
      if (u.isActive === false) return 'Inactive';
      return 'Active';
    };

    const header = ['Name', 'Email', 'Phone', 'Instagram', 'Plan', 'Subscription Status', 'Joined', 'Last Login', 'Downloads Total', 'Downloads Today', 'Account Status'];
    const rows = users.map(u => [
      u.name || '',
      u.email || '',
      u.phoneNumber || '',
      u.instagram || '',
      planOf(u),
      u.subscription?.status || '',
      u.createdAt ? new Date(u.createdAt).toISOString().slice(0, 10) : '',
      u.lastLogin ? new Date(u.lastLogin).toISOString() : '',
      u.downloads?.total || 0,
      todayByUser.get(String(u._id)) || 0,
      statusOf(u)
    ].map(escapeCsv).join(','));

    const csv = [header.join(','), ...rows].join('\r\n');
    const filename = `users-export-${segment || 'all'}-${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csv);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Update user role/subscription
// @route   PUT /api/users/:id
// @access  Private/Admin
export const updateUser = async (req, res) => {
  try {
    const { role, plan, isActive, endDate } = req.body;

    // Optional expiry for an admin-granted plan.
    //
    // Admin grants were permanent by construction: updateUser wrote
    // status:'active' with endDate:null, and hasActiveWindow's stale-active
    // guard only fires when endDate EXISTS — so a null endDate never expires
    // and nothing in the system could ever revoke it. The audit found several
    // such accounts with hundreds of downloads and no way to time-box them.
    // Passing endDate now gives a grant a real end; omitting it keeps the
    // previous permanent behaviour, which is still the right default for
    // internal/company accounts.
    let grantEndDate;
    if (endDate !== undefined) {
      if (endDate === null || endDate === '') {
        grantEndDate = null;                       // explicit "never expires"
      } else {
        const parsed = new Date(endDate);
        if (Number.isNaN(parsed.getTime())) {
          return res.status(400).json({ success: false, message: 'Invalid expiry date' });
        }
        grantEndDate = parsed;
      }
    }
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (role) user.role = role;

    let stripeBillingStopped = null;
    let stripeStopError = null;

    // The edit form always sends `plan`, even when the admin only changed the
    // role or the enabled toggle. Treating every save as a grant stamped
    // grantedByAdmin:true onto paying Stripe customers — which hid their card
    // and Cancel button, leaving them unable to stop their own payments. Only
    // act when the plan really changes.
    const currentPlan = user.subscription.planId || user.subscription.plan || 'free';
    const requestedPlan = plan === undefined ? undefined : (plan || 'free');
    // Re-selecting the same paid plan on a lapsed account is a reactivation and
    // must still go through the grant path. past_due is deliberately excluded:
    // that customer's card failed, and an unrelated Save must not hand them
    // access the payment did not buy.
    const reactivating = requestedPlan !== undefined && requestedPlan !== 'free' &&
      ['cancelled', 'expired', 'inactive'].includes(user.subscription.status);
    const planChanged = requestedPlan !== undefined && (requestedPlan !== currentPlan || reactivating);

    // Same plan, new expiry: still honour the date on a true admin grant.
    if (!planChanged && grantEndDate !== undefined && !user.subscription.stripeSubscriptionId &&
        currentPlan !== 'free') {
      user.subscription.endDate = grantEndDate;
    }

    if (planChanged) {
      if (plan && plan !== 'free') {
        user.subscription.plan   = plan;
        user.subscription.planId = plan; // keep plan and planId in sync for admin grants
        user.subscription.status = 'active';
        if (!user.subscription.startDate) user.subscription.startDate = new Date();
        // Never override a Stripe-managed endDate from here — Stripe owns the
        // paid period, and writing it by hand is how records start lying to
        // the access gate. For a true admin grant (no Stripe sub), use the
        // expiry the admin chose, or null for a permanent grant.
        if (!user.subscription.stripeSubscriptionId) {
          user.subscription.endDate = grantEndDate !== undefined ? grantEndDate : null;
        } else if (grantEndDate !== undefined) {
          console.warn(
            `[Admin] updateUser ${user._id}: ignoring endDate — subscription is ` +
            `Stripe-managed (${user.subscription.stripeSubscriptionId}); Stripe owns the period`
          );
        }
        user.subscription.grantedByAdmin = true;
        user.subscription.adminRevokedAt = null;
      } else {
        user.subscription.plan   = 'free';
        user.subscription.planId = null; // clear Stripe planId when reverting to free
        user.subscription.status = 'cancelled';
        user.subscription.startDate      = null;
        user.subscription.endDate        = null;
        user.subscription.grantedByAdmin = false;
        user.subscription.stripeSubscriptionId = user.subscription.stripeSubscriptionId || null;
        // Marks the downgrade as deliberate so the hourly reconciler and the
        // bulk sync leave it alone. Without it they saw "active at Stripe, not
        // active here" and restored the plan within the hour.
        user.subscription.adminRevokedAt = new Date();

        // Stop future charges. Removing access while Stripe keeps billing would
        // charge the customer every month for nothing. cancel_at_period_end is
        // the gentlest stop (no refund, no immediate cancellation, reversible
        // from the Stripe dashboard); any refund stays a deliberate admin act.
        const subId = user.subscription.stripeSubscriptionId;
        if (subId) {
          try {
            const live = await stripe.subscriptions.retrieve(subId);
            if (['active', 'past_due', 'trialing', 'unpaid'].includes(live.status) && !live.cancel_at_period_end) {
              await stripe.subscriptions.update(subId, { cancel_at_period_end: true });
              stripeBillingStopped = subId;
              console.log(`[Admin] updateUser ${user._id}: set to Free — Stripe sub ${subId} set to cancel at period end`);
            }
          } catch (err) {
            stripeStopError = err.message;
            console.error(`[Admin] updateUser ${user._id}: set to Free but could not stop Stripe sub ${subId}:`, err.message);
          }
        }
      }
    }

    if (isActive !== undefined) user.isActive = isActive;

    await user.save();

    res.status(200).json({
      success: true,
      // Surfaced so the admin knows whether the customer will still be charged.
      ...(stripeBillingStopped && { message: `Set to Free. Stripe billing stopped (subscription ${stripeBillingStopped} will not renew).` }),
      ...(stripeStopError && { warning: `Set to Free, but Stripe billing could NOT be stopped (${stripeStopError}). Cancel the subscription in the Stripe dashboard or the customer will keep being charged.` }),
      data: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        downloads: { total: user.downloads?.total || 0, today: user.downloads?.today || 0 },
        subscription: {
          status: user.subscription?.status,
          plan: user.subscription?.plan,
          planId: user.subscription?.planId,
          endDate: user.subscription?.endDate || null,
          grantedByAdmin: user.subscription?.grantedByAdmin || false
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Delete user
// @route   DELETE /api/users/:id
// @access  Private/Admin
export const deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.role === 'admin') {
      return res.status(400).json({ success: false, message: 'Cannot delete admin users' });
    }

    await User.findByIdAndDelete(req.params.id);

    res.status(200).json({ success: true, message: 'User deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get all users with device/session details for admin
// @route   GET /api/users/devices
// @access  Private/Admin
export const getDeviceOverview = async (req, res) => {
  try {
    const { search = '', page = 1, limit = 20 } = req.query;
    const query = {};
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await User.countDocuments(query);

    const users = await User.find(query)
      .select('name email role subscription.status subscription.plan subscription.planId subscription.devices subscription.sharedWith subscription.sharedBy subscription.stripeCustomerId subscription.stripeSubscriptionId blockedLoginAttempts lastLogin isActive createdAt downloads')
      .sort('-lastLogin')
      .skip(skip)
      .limit(parseInt(limit))
      .populate('subscription.sharedWith', 'name email')
      .populate('subscription.sharedBy', 'name email')
      .lean();

    const now = new Date();
    const activeThreshold = new Date(now - 15 * 60 * 1000); // 15 min

    const enriched = users.map(u => {
      const devices = u.subscription?.devices || [];
      const activeSessions = devices.filter(d => d.lastActive && new Date(d.lastActive) > activeThreshold).length;
      const uniqueIPs = [...new Set(devices.map(d => d.ipAddress).filter(Boolean))];
      const uniqueCountries = [...new Set(devices.map(d => d.location).filter(Boolean))];
      const blockedAttempts = u.blockedLoginAttempts || [];
      const suspiciousSharing = (
        uniqueIPs.length > 2 ||
        (u.subscription?.sharedWith?.length > 0) ||
        blockedAttempts.length > 0
      );
      return {
        _id: u._id,
        name: u.name,
        email: u.email,
        role: u.role,
        isActive: u.isActive,
        lastLogin: u.lastLogin,
        createdAt: u.createdAt,
        downloads: { total: u.downloads?.total || 0, today: u.downloads?.today || 0 },
        subscription: {
          status: u.subscription?.status,
          plan: u.subscription?.plan,
          planId: u.subscription?.planId,
          sharedWith: u.subscription?.sharedWith || [],
          sharedBy: u.subscription?.sharedBy || null,
          stripeCustomerId: u.subscription?.stripeCustomerId || null,
          stripeSubscriptionId: u.subscription?.stripeSubscriptionId || null
        },
        devices,
        blockedLoginAttempts: blockedAttempts,
        activeSessions,
        uniqueIPs,
        uniqueCountries,
        suspiciousSharing
      };
    });

    res.status(200).json({
      success: true,
      data: enriched,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Revoke a specific device for a user
// @route   DELETE /api/users/:id/devices/:deviceId
// @access  Private/Admin
export const revokeDevice = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // Atomic $pull so an admin revoke can't clobber a concurrent device
    // registration by writing back a stale devices array.
    const result = await User.updateOne(
      { _id: req.params.id },
      { $pull: { 'subscription.devices': { deviceId: req.params.deviceId } } }
    );

    if (result.modifiedCount === 0) {
      return res.status(404).json({ success: false, message: 'Device not found' });
    }

    res.status(200).json({ success: true, message: 'Device revoked successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get users suspected of subscription sharing
// @route   GET /api/users/sharing-suspects
// @access  Private/Admin
export const getSharingSuspects = async (req, res) => {
  try {
    const users = await User.find({
      'subscription.status': 'active',
      $or: [
        { 'subscription.devices.1': { $exists: true } },
        { 'subscription.sharedWith.0': { $exists: true } }
      ]
    })
      .select('name email subscription.plan subscription.devices subscription.sharedWith subscription.sharedBy lastLogin')
      .populate('subscription.sharedWith', 'name email')
      .populate('subscription.sharedBy', 'name email')
      .lean();

    const suspects = users
      .map(u => {
        const devices = u.subscription?.devices || [];
        const uniqueIPs = [...new Set(devices.map(d => d.ipAddress).filter(Boolean))];
        const uniqueLocations = [...new Set(devices.map(d => d.location).filter(Boolean))];
        const riskScore =
          (uniqueIPs.length > 1 ? uniqueIPs.length * 20 : 0) +
          (uniqueLocations.length > 1 ? uniqueLocations.length * 15 : 0) +
          ((u.subscription?.sharedWith?.length || 0) * 30);
        return {
          _id: u._id,
          name: u.name,
          email: u.email,
          plan: u.subscription?.plan,
          devices,
          uniqueIPs,
          uniqueLocations,
          sharedWith: u.subscription?.sharedWith || [],
          sharedBy: u.subscription?.sharedBy || null,
          deviceCount: devices.length,
          riskScore
        };
      })
      .filter(u => u.riskScore > 0)
      .sort((a, b) => b.riskScore - a.riskScore);

    res.status(200).json({ success: true, data: suspects });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Sync a user's subscription endDate from Stripe
// @route   POST /api/users/:id/sync-stripe
// @access  Private/Admin
export const syncUserStripeSubscription = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // Use stored ID or the one manually provided by the admin
    const stripeSubscriptionId = user.subscription?.stripeSubscriptionId || req.body?.stripeSubscriptionId;
    if (!stripeSubscriptionId) {
      return res.status(400).json({ success: false, message: 'No Stripe Subscription ID found. Paste it from the Stripe Dashboard.' });
    }

    const stripeSub = await stripe.subscriptions.retrieve(stripeSubscriptionId);

    // Persist the subscription ID if it wasn't stored yet (e.g. webhook missed on first purchase)
    if (!user.subscription.stripeSubscriptionId) {
      user.subscription.stripeSubscriptionId = stripeSubscriptionId;
    }
    if (stripeSub.customer && !user.subscription.stripeCustomerId) {
      user.subscription.stripeCustomerId = stripeSub.customer;
    }

    const newEndDate = stripeSub.current_period_end
      ? new Date(stripeSub.current_period_end * 1000)
      : null;

    const statusMap = { active: 'active', canceled: 'cancelled', past_due: 'past_due', unpaid: 'past_due', paused: 'inactive', trialing: 'active' };
    const newStatus = statusMap[stripeSub.status] || user.subscription.status;

    // Only extend paid-through when Stripe reports the subscription as PAID.
    // See STRIPE_PAID_STATUSES above — an unpaid renewal must not buy access.
    if (newEndDate && STRIPE_PAID_STATUSES.includes(stripeSub.status)) {
      user.subscription.endDate = newEndDate;
    } else if (newEndDate) {
      console.log(
        `[Admin] sync user ${user._id}: NOT extending endDate — Stripe status is ` +
        `'${stripeSub.status}' (unpaid). Keeping paid-through ${user.subscription.endDate}`
      );
    }
    user.subscription.status = newStatus;
    user.subscription.cancelAtPeriodEnd = stripeSub.cancel_at_period_end || false;

    // Restore planId when the record has none.
    //
    // This is the button an admin reaches for when a customer reports "I paid
    // but I'm still on Free", so it has to be able to actually fix that. It
    // only wrote status/endDate before, and every access gate additionally
    // requires planId to be set and not 'free' — so on precisely the accounts
    // it was meant to repair it reported "Subscription synced from Stripe."
    // and changed nothing the customer could see.
    //
    // Resolved from the price Stripe is billing, same as the reconciler.
    // Only fills a gap; never overwrites a plan the customer already holds.
    let restoredPlanId = null;
    if (!user.subscription.planId || user.subscription.planId === 'free') {
      const priceId = stripeSub.items?.data?.[0]?.price?.id;
      const plan = priceId ? await SubscriptionPlan.findOne({ stripePriceId: priceId }) : null;
      if (plan) {
        user.subscription.planId = plan.planId;
        user.subscription.plan = plan.planId;
        if (plan.features?.maxDevices) user.maxDevices = plan.features.maxDevices;
        restoredPlanId = plan.planId;
      } else {
        console.warn(
          `[Admin] sync user ${user._id}: no planId on record and Stripe price ` +
          `${priceId} is not mapped to any SubscriptionPlan.stripePriceId — ` +
          `status synced but the account will still show Free`
        );
      }
    }

    // An admin explicitly choosing to follow Stripe for this one account lifts
    // any earlier "set to Free" override.
    user.subscription.adminRevokedAt = null;

    await user.save();

    console.log(`[Admin] Synced Stripe sub for user ${user._id}: status=${newStatus}, endDate=${newEndDate}, planRestored=${restoredPlanId || 'n/a'}`);

    res.status(200).json({
      success: true,
      message: restoredPlanId
        ? `Subscription synced from Stripe. Plan restored to ${restoredPlanId}.`
        : 'Subscription synced from Stripe.',
      data: {
        endDate: user.subscription.endDate,
        status: user.subscription.status,
        cancelAtPeriodEnd: user.subscription.cancelAtPeriodEnd,
        planId: user.subscription.planId,
        planRestored: restoredPlanId
      }
    });
  } catch (error) {
    console.error('[syncUserStripeSubscription] Error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Bulk sync ALL paid users' subscription data from Stripe
// @route   POST /api/users/bulk-sync-stripe
// @access  Private/Admin
export const bulkSyncStripeSubscriptions = async (req, res) => {
  // Staging = Stripe TEST mode + the PRODUCTION database. Every real customer's
  // Stripe id is a live-mode id that test mode reports as "No such
  // subscription", so applying this would clear the Stripe link of every
  // paying customer. Even the preview is useless there and takes ~17 minutes
  // (one failing Stripe lookup per customer), long past the proxy's 60s
  // timeout — the HTML 504 page is what the admin saw as "Unexpected token '<'".
  if (isStaging) {
    return res.status(409).json({
      success: false,
      message: 'Stripe bulk sync is disabled on staging: staging uses Stripe test mode but shares the production database, ' +
        'so it cannot see real customers\' subscriptions and applying it would erase their Stripe links. Run it on the live admin panel.',
    });
  }
  try {
    // Preview before writing. One click used to mutate every matching account
    // with no way to see what it would do first — which is how a month of
    // unpaid access was written to a customer's record and went unnoticed
    // until someone ran an audit by hand. The admin panel now previews, shows
    // the proposed changes, and only writes on a second, explicit click.
    const dryRun = req.query.dryRun === '1' || req.body?.dryRun === true;
    // Target users who have a paid plan OR any Stripe ID stored
    const users = await User.find({
      $or: [
        { 'subscription.stripeSubscriptionId': { $exists: true, $ne: null } },
        { 'subscription.stripeCustomerId': { $exists: true, $ne: null } },
        { 'subscription.planId': { $nin: [null, 'free', ''] } }
      ]
    });

    let synced = 0, skipped = 0, failed = 0;
    const results = [];

    const statusMap = {
      active: 'active', canceled: 'cancelled', cancelled: 'cancelled',
      past_due: 'past_due', unpaid: 'past_due', paused: 'inactive', trialing: 'active'
    };

    for (const user of users) {
      try {
        // Captured before any mutation so the preview can show before -> after.
        // Ids are part of this too, not just status/endDate: repairing a dead
        // stripeCustomerId is itself a change worth applying, and if it were
        // left out of the diff below such an account would report changed:false,
        // never offer an Apply button, and stay broken on every future run.
        const before = {
          status: user.subscription?.status ?? null,
          endDate: user.subscription?.endDate ?? null,
          customerId: user.subscription?.stripeCustomerId ?? null,
          subscriptionId: user.subscription?.stripeSubscriptionId ?? null,
        };
        let subId = user.subscription?.stripeSubscriptionId;
        let customerId = user.subscription?.stripeCustomerId;

        // Admin decisions win over Stripe data in a BULK pass:
        //  - a plan an admin removed must not be restored by Stripe still
        //    listing the old subscription;
        //  - a pure admin grant (no Stripe subscription) must not be replaced
        //    by whatever old, cancelled subscription an email lookup turns up,
        //    which flipped working grants to 'cancelled'.
        // The per-user "Sync from Stripe" button is the deliberate override.
        const adminOverride = user.subscription?.adminRevokedAt
          ? 'removed_by_admin'
          : (user.subscription?.grantedByAdmin && !subId ? 'admin_grant' : null);
        if (adminOverride) {
          skipped++;
          results.push({ email: user.email, result: adminOverride, changed: false });
          continue;
        }

        // Step 1: if no IDs at all, search Stripe by email
        if (!subId && !customerId) {
          const customers = await stripe.customers.list({ email: user.email, limit: 1 });
          if (customers.data.length) {
            customerId = customers.data[0].id;
            user.subscription.stripeCustomerId = customerId;
          }
        }

        // Step 2: resolve the active subscription
        let stripeSub = null;
        if (subId) {
          try {
            stripeSub = await stripe.subscriptions.retrieve(subId);
          } catch (retrieveErr) {
            // Invalid/deleted/mode-mismatched sub ID — clear it and fall back to email lookup
            console.warn(`[BulkSync] sub ID invalid for ${user.email} (${retrieveErr.message}) — clearing and trying email lookup`);
            user.subscription.stripeSubscriptionId = null;
            subId = null;
          }
        }
        if (!stripeSub && !customerId) {
          const customers = await stripe.customers.list({ email: user.email, limit: 1 });
          if (customers.data.length) {
            customerId = customers.data[0].id;
            user.subscription.stripeCustomerId = customerId;
          }
        }
        if (!stripeSub && customerId) {
          // A dead customer id must recover the same way a dead subscription id
          // does above. Without this the list call throws 'No such customer',
          // the account is reported as failed, and the email lookup that would
          // have found the customer is never reached — so the SAME accounts
          // failed on every single run, permanently, while a working customer
          // record sat in Stripe under their email. (Stale ids arise from a
          // deleted customer or a test/live mode mismatch.)
          try {
            const subs = await stripe.subscriptions.list({ customer: customerId, limit: 5, status: 'all' });
            stripeSub = subs.data.find(s => s.status === 'active') ||
                        subs.data.find(s => s.status === 'trialing') ||
                        subs.data[0] || null;
          } catch (customerErr) {
            console.warn(
              `[BulkSync] customer ID invalid for ${user.email} (${customerErr.message}) — ` +
              `clearing and trying email lookup`
            );
            user.subscription.stripeCustomerId = null;
            customerId = null;

            const customers = await stripe.customers.list({ email: user.email, limit: 1 });
            if (customers.data.length) {
              customerId = customers.data[0].id;
              user.subscription.stripeCustomerId = customerId;
              const subs = await stripe.subscriptions.list({ customer: customerId, limit: 5, status: 'all' });
              stripeSub = subs.data.find(s => s.status === 'active') ||
                          subs.data.find(s => s.status === 'trialing') ||
                          subs.data[0] || null;
            }
          }

          if (stripeSub) {
            user.subscription.stripeSubscriptionId = stripeSub.id;
          }
        }

        if (!stripeSub) {
          // No subscription found — but the lookup may still have REPAIRED
          // something on the way here. A dead customer or subscription id
          // cleared above is worth persisting even when nothing is found,
          // otherwise this branch returns before the diff below and the same
          // dead id is rediscovered, and re-cleared in memory, on every run
          // forever — two wasted Stripe calls each time and a record that
          // keeps reporting 'No such customer' to the audit.
          const repairedIds =
            (user.subscription.stripeCustomerId ?? null) !== before.customerId ||
            (user.subscription.stripeSubscriptionId ?? null) !== before.subscriptionId;
          if (repairedIds && !dryRun) {
            // Targeted $set, not user.save(). Saving the whole document here
            // would rewrite every subscription field from a copy loaded at the
            // top of this loop — and a webhook may have activated the account
            // in the meantime, which this would silently revert. Same reason
            // downloadController uses $inc and handleInvoicePaid uses a single
            // atomic $set. Only the two ids changed, so only they are written.
            await User.updateOne(
              { _id: user._id },
              {
                $set: {
                  'subscription.stripeCustomerId': user.subscription.stripeCustomerId ?? null,
                  'subscription.stripeSubscriptionId': user.subscription.stripeSubscriptionId ?? null,
                },
              }
            );
          }

          skipped++;
          results.push({
            email: user.email,
            result: 'no_stripe_subscription_found',
            changed: repairedIds,
            idsRepaired: repairedIds,
          });
          continue;
        }

        const newEndDate = stripeSub.current_period_end
          ? new Date(stripeSub.current_period_end * 1000)
          : null;
        const newStatus = statusMap[stripeSub.status] || user.subscription.status;

        // Only extend paid-through when Stripe reports the subscription as
        // PAID. Without this, a bulk sync re-poisoned endDate for every
        // past_due/cancelled/unpaid account it touched — the remediation
        // button was itself re-granting the access it was run to correct.
        if (newEndDate && STRIPE_PAID_STATUSES.includes(stripeSub.status)) {
          user.subscription.endDate = newEndDate;
        } else if (newEndDate) {
          console.log(
            `[BulkSync] ${user.email}: NOT extending endDate — Stripe status is ` +
            `'${stripeSub.status}' (unpaid). Keeping paid-through ${user.subscription.endDate}`
          );
        }
        user.subscription.status = newStatus;
        user.subscription.cancelAtPeriodEnd = stripeSub.cancel_at_period_end || false;
        if (stripeSub.customer && !user.subscription.stripeCustomerId) {
          user.subscription.stripeCustomerId = stripeSub.customer;
        }
        // The mutations above are in-memory only until this save. On a dry run
        // we simply never save, so the document is discarded untouched.
        const after = {
          status: user.subscription.status ?? null,
          endDate: user.subscription.endDate ?? null,
          customerId: user.subscription.stripeCustomerId ?? null,
          subscriptionId: user.subscription.stripeSubscriptionId ?? null,
        };
        const idsRepaired =
          before.customerId !== after.customerId ||
          before.subscriptionId !== after.subscriptionId;
        const changed =
          before.status !== after.status ||
          String(before.endDate ?? '') !== String(after.endDate ?? '') ||
          idsRepaired;

        if (!dryRun) await user.save();

        synced++;
        results.push({
          email: user.email,
          result: 'synced',
          status: after.status,
          endDate: after.endDate,
          before,
          changed,
          idsRepaired,
        });
        console.log(
          `[BulkSync]${dryRun ? ' (preview)' : ''} ${user.email}: ` +
          `status=${before.status}->${after.status}, endDate=${before.endDate}->${after.endDate}`
        );
      } catch (err) {
        failed++;
        results.push({ email: user.email, result: 'error', error: err.message });
        console.error(`[BulkSync] Failed for ${user.email}:`, err.message);
      }
    }

    const changedCount = results.filter(r => r.changed).length;

    res.status(200).json({
      success: true,
      dryRun,
      // changedCount spans BOTH buckets: an account can be "skipped" (no
      // subscription found) and still have a dead id to clear, so counting
      // changes "of synced" would under-report what Apply is about to do.
      message: dryRun
        ? `Preview: ${changedCount} change(s) to apply — ${synced} matched, ${skipped} skipped, ${failed} failed`
        : `Bulk sync complete: ${synced} synced, ${skipped} skipped, ${failed} failed`,
      data: { synced, skipped, failed, changed: changedCount, total: users.length, results }
    });
  } catch (error) {
    console.error('[bulkSyncStripeSubscriptions] Error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Upload profile photo (avatar)
// @route   PUT /api/users/avatar
// @access  Private (authenticated user)
export const uploadAvatar = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please upload an image file' });
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(req.file.mimetype)) {
      return res.status(400).json({ success: false, message: 'Only JPEG, PNG, WebP, and GIF images are allowed' });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Delete old avatar from S3 if it's a Wasabi key (not a default URL)
    if (user.avatarKey) {
      try {
        await deleteFromWasabi(user.avatarKey);
      } catch (e) {
        console.warn('Failed to delete old avatar:', e.message);
      }
    }

    // Upload new avatar to Wasabi
    const ext = req.file.originalname.split('.').pop() || 'jpg';
    const key = `avatars/${user._id}-${Date.now()}.${ext}`;
    const upload = await uploadToWasabi(req.file.buffer, key, req.file.mimetype);

    user.avatar = upload.location || upload.Location;
    user.avatarKey = key;
    await user.save();

    // Generate signed URL for immediate use
    const signedUrl = await getSignedDownloadUrl(key, 7200);

    res.status(200).json({
      success: true,
      message: 'Profile photo updated',
      data: {
        avatar: signedUrl,
        avatarKey: key
      }
    });
  } catch (error) {
    console.error('Avatar upload error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Block a user
// @route   PUT /api/users/:id/block
// @access  Private/Admin
export const blockUser = async (req, res) => {
  try {
    const { reason } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user.role === 'admin') return res.status(400).json({ success: false, message: 'Cannot block admin users' });

    user.isBlocked = true;
    user.blockReason = reason || 'other';
    user.blockedAt = new Date();
    await user.save();

    try { await sendBlockedAccountEmail(user); } catch (e) { console.warn('Block email failed:', e.message); }

    res.status(200).json({ success: true, message: 'User blocked successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Unblock a user
// @route   PUT /api/users/:id/unblock
// @access  Private/Admin
export const unblockUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    user.isBlocked = false;
    user.blockReason = null;
    user.blockedAt = null;
    await user.save();

    res.status(200).json({ success: true, message: 'User unblocked successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Lift download suspension for a user
// @route   PUT /api/users/:id/lift-download-suspension
// @access  Private/Admin
export const liftDownloadSuspension = async (req, res) => {
  try {
    // Atomic $set so the lift can't be clobbered by a concurrent download
    // request, and downloadLiftedAt reliably becomes the fresh-count baseline.
    const result = await User.updateOne(
      { _id: req.params.id },
      {
        $set: {
          downloadSuspended: false,
          downloadSuspendedAt: null,
          downloadWarningLevel: 0,
          downloadPausedUntil: null,
          downloadFlaggedForReview: false,
          downloadLiftedAt: new Date(), // Start counting fresh from this moment
        },
      }
    );
    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.status(200).json({ success: true, message: 'Download suspension lifted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
