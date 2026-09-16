import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide a name'],
    trim: true,
    maxlength: [50, 'Name cannot be more than 50 characters']
  },
  email: {
    type: String,
    required: [true, 'Please provide an email'],
    unique: true,
    lowercase: true,
    match: [
      /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
      'Please provide a valid email'
    ]
  },
  // NOT schema-required, deliberately. Registration enforces it (see
  // authController), but 8 pre-existing accounts have no phone, and a
  // schema-level requirement would make every save() on them throw —
  // including the save() during login, locking those users out of accounts
  // they pay for. New signups are validated at the entry point instead.
  phoneNumber: {
    type: String,
    trim: true,
    match: [
      /^\+?[1-9]\d{6,14}$/,
      'Please provide a valid phone number (e.g. +1234567890)'
    ]
  },
  // Instagram handle, collected at registration to help support identify and
  // contact users. Stored normalised (no @, no URL) so it can be searched.
  // Same reasoning as phoneNumber: enforced at registration, not in schema,
  // so existing accounts keep working.
  instagram: {
    type: String,
    trim: true
  },
  password: {
    type: String,
    required: [true, 'Please provide a password'],
    minlength: [6, 'Password must be at least 6 characters'],
    select: false
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  subscription: {
    planId: {
      type: String,
      default: null
    },
    plan: {
      type: String,
      default: null
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'expired', 'cancelled', 'past_due'],
      default: 'inactive'
    },
    startDate: {
      type: Date,
      default: null
    },
    endDate: {
      type: Date,
      default: null
    },
    autoRenew: {
      type: Boolean,
      default: false
    },
    cancelAtPeriodEnd: {
      type: Boolean,
      default: false
    },
    currentPeriodEnd: {
      type: Date,
      default: null
    },
    grantedByAdmin: {
      type: Boolean,
      default: false
    },
    stripeCustomerId: String,
    stripeSubscriptionId: String,
    stripePaymentIntentId: String,
    paymentMethod: String,
    sharedWith: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }],
    sharedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    devices: [{
      deviceId: { type: String, required: true },
      deviceName: { type: String, default: null },
      deviceType: { type: String, enum: ['mobile', 'desktop', 'tablet', 'unknown'], default: 'unknown' },
      browser: { type: String, default: 'Unknown' },
      os: { type: String, default: 'Unknown' },
      deviceInfo: { type: mongoose.Schema.Types.Mixed, default: 'Unknown Device' },
      ipAddress: { type: String },
      location: { type: String, default: null },
      lastActive: { type: Date, default: Date.now },
      addedAt: { type: Date, default: Date.now },
      isCurrentDevice: { type: Boolean, default: false }
    }]
  },
  blockedLoginAttempts: [{
    deviceName: { type: String, default: 'Unknown Device' },
    browser:    { type: String, default: 'Unknown' },
    os:         { type: String, default: 'Unknown' },
    ipAddress:  { type: String, default: null },
    userAgent:  { type: String, default: null },
    attemptedAt:{ type: Date,   default: Date.now }
  }],
  subscriptionHistory: [{
    planId: String,
    startDate: Date,
    endDate: Date,
    amount: Number,
    currency: String,
    status: String,
    stripePaymentIntentId: String,
    createdAt: { type: Date, default: Date.now }
  }],
  downloads: {
    today: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    lastDownloadDate: Date
  },
  favorites: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Track'
  }],
  playlists: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Playlist'
  }],
  avatar: {
    type: String,
    default: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop'
  },
  avatarKey: {
    type: String
  },
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  emailVerificationToken: String,
  resetPasswordToken: String,
  resetPasswordExpire: Date,
  // Short-lived, single-purpose token emailed when a login is blocked by the
  // device limit. It authenticates ONLY the device-management page, so the
  // blocked device (which has no session yet) can free a slot without being
  // able to reach anything else in the account.
  deviceManageToken: String,
  deviceManageExpire: Date,
  // Devices removed via that page. Needed because `protect` re-registers any
  // device it sees, which would otherwise silently re-add the removed device
  // on its very next request and undo the removal. Entries are pruned after
  // REVOCATION_TTL and cleared for a device when the user logs in on it again
  // with their password.
  revokedDevices: [{
    deviceId: { type: String, required: true },
    revokedAt: { type: Date, default: Date.now }
  }],
  lastLogin: Date,
  isActive: {
    type: Boolean,
    default: true
  },
  isBlocked: {
    type: Boolean,
    default: false
  },
  blockReason: {
    type: String,
    enum: ['account_sharing', 'content_sharing', 'abusive_use', 'piracy', 'other', null],
    default: null
  },
  blockedAt: {
    type: Date,
    default: null
  },
  downloadSuspended: {
    type: Boolean,
    default: false
  },
  downloadSuspendedAt: {
    type: Date,
    default: null
  },
  downloadWarningLevel: {
    type: Number,
    enum: [0, 1, 2, 3],
    default: 0
  },
  downloadPausedUntil: {
    type: Date,
    default: null
  },
  downloadFlaggedForReview: {
    type: Boolean,
    default: false
  },
  downloadLiftedAt: {
    type: Date,
    default: null
  },
  preferredLanguage: {
    type: String,
    enum: ['en', 'es'],
    default: 'en'
  },
  // Opt-out from promotional email. Transactional mail — receipts, payment
  // failures, device alerts, password resets — ignores this and must continue
  // to send: those are part of the service the customer pays for, not
  // marketing. Only campaigns check it.
  marketingOptOut: {
    type: Boolean,
    default: false
  },
  marketingOptOutAt: {
    type: Date,
    default: null
  },
  maxDevices: {
    type: Number,
    default: 2
  },
  passkeyCredentials: [{
    credentialId: { type: String, required: true },
    publicKey: { type: String, required: true },
    counter: { type: Number, default: 0 },
    deviceType: { type: String },
    createdAt: { type: Date, default: Date.now }
  }]
}, {
  timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) {
    next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Compare password method
userSchema.methods.comparePassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Reset daily download count
userSchema.methods.resetDailyDownloads = function() {
  const today = new Date().setHours(0, 0, 0, 0);
  const lastDownload = this.downloads.lastDownloadDate 
    ? new Date(this.downloads.lastDownloadDate).setHours(0, 0, 0, 0)
    : null;
  
  if (!lastDownload || today > lastDownload) {
    this.downloads.today = 0;
  }
};

// Check download limit based on subscription
// How long access survives after the paid period lapses while Stripe retries a
// failed renewal.
//
// Policy: ZERO. Access ends the moment the paid period ends — an unpaid
// renewal grants nothing. This is the default in code rather than only an env
// var so a new or rebuilt environment cannot silently fall back to granting
// free days. Set SUBSCRIPTION_GRACE_DAYS=<n> to reintroduce a retry window.
export const PAST_DUE_GRACE_MS = (() => {
  const raw = parseInt(process.env.SUBSCRIPTION_GRACE_DAYS, 10);
  const days = Number.isFinite(raw) && raw >= 0 ? raw : 0;
  return days * 24 * 60 * 60 * 1000;
})();

/**
 * Does this subscription's STATUS and DATES grant access right now?
 *
 * The status/date half of the entitlement question, in one place. It had been
 * reimplemented independently in the middleware, both auth controllers and the
 * status endpoint — each with its own copy of the grace constant — so the
 * zero-grace policy change reached some copies and not others, and the same
 * account could be "active" to the UI and 403 to the download endpoints.
 *
 * Deliberately does NOT consider the plan. 'free' must be excluded on BOTH
 * `planId` and `plan` (the string 'free' is truthy, which is how a free-plan
 * account with an active status once downloaded), and admin-granted plans carry
 * a plan name with no planId — so callers apply that check with the rules that
 * fit their context.
 *
 * @param {object} subscription - a User's `subscription` subdocument
 */
export function hasActiveWindow(subscription = {}) {
  const end = subscription?.endDate ? new Date(subscription.endDate).getTime() : null;
  const now = Date.now();
  const isWithinPeriod = end !== null && now <= end;
  const msSinceExpiry = end !== null ? now - end : null;

  // Bounded at BOTH ends. `now - end < GRACE` alone is also satisfied by a
  // FUTURE endDate (a negative difference), which handed unlimited access to
  // any past_due account whose endDate had been pushed forward — and endDate
  // was pushed forward on every failed renewal attempt.
  const isPastDueInGrace =
    subscription?.status === 'past_due' &&
    msSinceExpiry !== null &&
    msSinceExpiry >= 0 &&
    msSinceExpiry < PAST_DUE_GRACE_MS;

  // An 'active' status whose paid period has already passed is stale data, not
  // entitlement — requireSubscription treats it as expired and this must agree.
  if (subscription?.status === 'active' && end !== null && !isWithinPeriod) return false;

  return (
    subscription?.status === 'active' ||
    // past_due INSIDE the period they already paid for keeps access; the failed
    // renewal concerns the NEXT period.
    (subscription?.status === 'past_due' && isWithinPeriod) ||
    (subscription?.status === 'cancelled' && isWithinPeriod) ||
    isPastDueInGrace
  );
}

userSchema.methods.canDownload = function() {
  this.resetDailyDownloads();

  // Access is granted for a period the user actually PAID for, plus a short
  // retry window after it lapses.
  //
  // The previous grace test was `(now - endDate) < GRACE`, which is also true
  // whenever endDate is in the FUTURE (a negative difference). Any past_due
  // user whose endDate had been pushed forward therefore kept full access for
  // the entire unpaid period — and endDate was being pushed forward on every
  // failed renewal, so it never expired. That is why users with failed
  // payments continued downloading. The window must be bounded at both ends.
  const isWithinPeriod = !!this.subscription.endDate && new Date() <= new Date(this.subscription.endDate);
  const msSinceExpiry = this.subscription.endDate
    ? Date.now() - new Date(this.subscription.endDate).getTime()
    : null;
  const isPastDueInGrace = this.subscription.status === 'past_due' &&
    msSinceExpiry !== null &&
    msSinceExpiry >= 0 &&
    msSinceExpiry < PAST_DUE_GRACE_MS;
  // An 'active' status whose paid period has already passed is stale data, not
  // entitlement — requireSubscription treats it as expired, and this method
  // must agree or the two gates disagree about the same account.
  const staleActive = this.subscription.status === 'active' &&
    !!this.subscription.endDate &&
    !isWithinPeriod;

  const hasActiveSubscription = !staleActive &&
    ((this.subscription.status === 'active' ||
     // past_due still inside the period they paid for keeps access; the
     // failed renewal is for the NEXT period.
     (this.subscription.status === 'past_due' && isWithinPeriod) ||
     (this.subscription.status === 'cancelled' && isWithinPeriod) ||
     isPastDueInGrace) &&
    // 'free' must be excluded on BOTH fields. Testing only `planId` truthiness
    // let planId:'free' through, because the string is truthy — a free-plan
    // account with an active status could download.
    ((this.subscription.planId && this.subscription.planId !== 'free') ||
     (this.subscription.plan && this.subscription.plan !== 'free')));
  
  // NO PER-DAY CAP IS ENFORCED. There was a `limits` table here
  // ({ free: 5, premium: 50, pro: Infinity }) that nothing ever read — the
  // function returns on hasActiveSubscription alone. It was removed rather
  // than wired up, because switching it on would newly restrict paying
  // customers and no plan advertises a daily limit. Reintroducing caps is a
  // product decision, not a cleanup.
  //
  // downloads.today is therefore decorative as far as access goes. It is also
  // wrong: resetDailyDownloads below mutates the in-memory document and no
  // caller saves it, while the real counter is bumped by an atomic $inc in
  // downloadController — so the stored value never resets and converges on the
  // lifetime total. Anything that needs a real per-day figure must count the
  // Download collection, which is what the admin users list now does.
  if (hasActiveSubscription) {
    return true;
  }
  
  // Free / non-subscribed users cannot download at all
  return false;
};

// Increment download count
userSchema.methods.incrementDownload = function() {
  this.resetDailyDownloads();
  this.downloads.today += 1;
  this.downloads.total += 1;
  this.downloads.lastDownloadDate = new Date();
};

export default mongoose.model('User', userSchema);
