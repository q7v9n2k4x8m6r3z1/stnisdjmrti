import mongoose from 'mongoose';

/**
 * One row per promotional email actually sent to one person.
 *
 * A separate collection rather than an array on the user document. Campaign
 * history grows without bound, and this codebase already carries one unbounded
 * array on User (blockedLoginAttempts) that nothing prunes — repeating that
 * shape for something that grows with every campaign would eventually push
 * documents toward the 16MB ceiling.
 *
 * The compound unique index is what actually guarantees "never email the same
 * person twice", not the query that precedes the send. Checking first and
 * sending after is a race: two passes overlapping, or a restart mid-pass, can
 * both pass the check. Writing the row BEFORE sending, and letting a duplicate
 * key error mean "someone else already has this one", makes double-sending
 * impossible rather than unlikely.
 *
 * This row is also the campaign's eligibility record: BIENVENIDA10 only works
 * for someone who received it, and only within 24 hours of `sentAt`.
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
    sentAt: {
      type: Date,
      default: Date.now,
    },
    // Set only when the send fails. The row is written first so the slot is
    // claimed; a failure is recorded rather than deleted, so a broken address
    // is not retried forever on every pass.
    failedAt: {
      type: Date,
      default: null,
    },
    failureReason: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

// The guarantee behind requirement "the same user cannot receive the email twice".
campaignSendSchema.index({ campaign: 1, userId: 1 }, { unique: true });

export default mongoose.model('CampaignSend', campaignSendSchema);
