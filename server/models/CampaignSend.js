import mongoose from 'mongoose';

/**
 * One row per promotional email attempt to one person.
 *
 * A separate collection rather than an array on the user document. Campaign
 * history grows without bound, and this codebase already carries one unbounded
 * array on User (blockedLoginAttempts) that nothing prunes — repeating that
 * shape for something that grows with every campaign would eventually push
 * documents toward the 16MB ceiling.
 *
 * The compound unique index is what actually guarantees "never email the same
 * person twice", not the query that precedes the send. Checking first and
 * sending after is a race: two overlapping passes, or a restart mid-pass, can
 * both pass the check. Claiming the row BEFORE sending, and treating a
 * duplicate key as "someone else already has this one", makes double-sending
 * impossible rather than unlikely.
 *
 * This row is also the campaign's eligibility record: BIENVENIDA10 only works
 * for someone whose email actually went out, and only within 24 hours of
 * `sentAt`.
 */
const campaignSendSchema = new mongoose.Schema(
  {
    campaign: {
      type: String,
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // Kept alongside userId so a report still reads sensibly if the account is
    // later deleted, and so a bounce can be traced without a join.
    email: {
      type: String,
      required: true,
    },
    // When the row was claimed — NOT when the email went out.
    claimedAt: {
      type: Date,
      default: Date.now,
    },
    // Set only on a successful send, and reset on every successful retry.
    //
    // Deliberately null until delivery is accepted: the customer's 24-hour
    // discount window is measured from here, and measuring it from a failed
    // first attempt would hand someone a code that had already partly expired
    // before they ever saw the email.
    sentAt: {
      type: Date,
      default: null,
    },
    // How many times sending has been attempted. A transient failure — a rate
    // limit, a momentary network fault — must be retried, or the recipient is
    // silently dropped. A permanent one must not be retried forever.
    attempts: {
      type: Number,
      default: 0,
    },
    lastAttemptAt: {
      type: Date,
      default: null,
    },
    failedAt: {
      type: Date,
      default: null,
    },
    failureReason: {
      type: String,
      default: null,
    },
    // ── Engagement ───────────────────────────────────────────────────────
    //
    // Recorded here rather than in a separate events collection: this row is
    // already the per-recipient record, and one row per person beats one row
    // per open for both storage and the queries a report actually runs.
    //
    // Opens are the weakest number in the system and are labelled as such
    // wherever they are shown. Apple Mail Privacy Protection pre-fetches
    // remote images for every message whether or not anyone looks at it, so a
    // large share of "opens" are a proxy server, not a person. Clicks and
    // conversions are the figures worth acting on.
    openedAt: { type: Date, default: null },
    openCount: { type: Number, default: 0 },
    clickedAt: { type: Date, default: null },
    clickCount: { type: Number, default: 0 },

    // True when the address itself is the problem and retrying cannot help —
    // a malformed address, or a well-known provider typo such as gmail.con.
    // Kept distinct from a transient failure so the report can show the admin
    // what to correct rather than burying it among network errors.
    permanentFailure: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// The guarantee behind "the same user cannot receive the email twice".
campaignSendSchema.index({ campaign: 1, userId: 1 }, { unique: true });

export default mongoose.model('CampaignSend', campaignSendSchema);
