import mongoose from 'mongoose';

/**
 * One person's position in one sequence.
 *
 * The whole reason sequences need their own state: a campaign either has been
 * sent to someone or has not, which a CampaignSend row answers. A sequence
 * asks "where are they up to, and when is the next one due" — a question no
 * existing record can answer.
 *
 * nextDueAt is a stored timestamp rather than a timer. A restart, a deploy or
 * a crash cannot lose someone's place or fire their step twice, because the
 * schedule lives in the database and survives everything. This is the same
 * reason the automation scheduler computes due-ness from lastRunAt.
 */
const enrollmentSchema = new mongoose.Schema(
  {
    sequence: { type: mongoose.Schema.Types.ObjectId, ref: 'Sequence', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Kept alongside userId so a report reads sensibly if the account is
    // deleted, matching CampaignSend.
    email: { type: String, required: true },

    // Index of the NEXT step to send. 0 means nothing has gone out yet.
    currentStep: { type: Number, default: 0 },

    // When that step becomes due. The engine looks for enrollments whose time
    // has come rather than holding timers for each person.
    nextDueAt: { type: Date, default: Date.now, index: true },

    // active    — moving through the steps
    // completed — every step sent
    // exited    — stopped early because they no longer match the audience,
    //             which for a win-back almost always means they subscribed.
    //             The good outcome, and recorded as distinct from finishing.
    status: {
      type: String,
      enum: ['active', 'completed', 'exited'],
      default: 'active',
      index: true,
    },
    exitedAt: { type: Date, default: null },
    exitReason: { type: String, default: null },
  },
  { timestamps: true }
);

// One enrollment per person per sequence. As with CampaignSend, the index is
// the actual guarantee against enrolling someone twice — not the query that
// precedes it, which two overlapping ticks could both pass.
enrollmentSchema.index({ sequence: 1, userId: 1 }, { unique: true });

// The engine's hot query: who is due right now.
enrollmentSchema.index({ status: 1, nextDueAt: 1 });

export default mongoose.model('SequenceEnrollment', enrollmentSchema);
