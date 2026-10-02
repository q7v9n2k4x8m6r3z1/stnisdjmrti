import mongoose from 'mongoose';

/**
 * An ordered series of emails sent to one person over time.
 *
 * "Send the welcome offer. Three days later, if they still have not
 * subscribed, send a reminder. Four days after that, a last call."
 *
 * Steps reference Campaigns rather than carrying their own content. A step
 * needs a subject, HTML, a plain-text part, tracking settings and possibly a
 * discount code — all of which a Campaign already has, along with an editor, a
 * preview and a test send. Duplicating that inline would have meant a second
 * editor and two places for the same bug.
 *
 * THE EXIT CONDITION IS THE AUDIENCE
 *
 * There is deliberately no separate "stop if…" language. The audience rules
 * already say who should be receiving this — "still free, never reached
 * checkout" — so the engine simply re-checks them before every step. Someone
 * who subscribed after step one no longer matches, and stops. Expressing the
 * same condition twice, once to enter and once to leave, is how the two drift
 * and someone gets a "you haven't subscribed yet" email the day after paying.
 */
const sequenceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },

    // Who enters, and — re-evaluated before every step — who stays.
    audience: {
      segment: { type: String, default: 'free' },
      registeredWithinDays: { type: Number, default: 7 },
      minAccountAgeHours: { type: Number, default: 24 },
      excludeStripeHistory: { type: Boolean, default: true },
      endedWithinDays: { type: Number, default: null },
    },

    steps: [{
      campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
      // Hours to wait after the PREVIOUS step. Zero on the first step means
      // "as soon as they qualify" — the audience's minAccountAgeHours is
      // already the entry delay, so restating it here would double it.
      delayHours: { type: Number, default: 0 },
    }],

    status: {
      type: String,
      enum: ['draft', 'active', 'paused'],
      default: 'draft',
      index: true,
    },

    // Ceiling per tick across the whole sequence, so a mistake in the audience
    // costs a bounded number of emails rather than the whole database.
    maxPerRun: { type: Number, default: 50 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    lastRunAt: { type: Date, default: null },
  },
  { timestamps: true }
);

sequenceSchema.index({ createdAt: -1 });

export default mongoose.model('Sequence', sequenceSchema);
