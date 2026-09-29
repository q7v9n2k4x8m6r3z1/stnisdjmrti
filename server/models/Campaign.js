import mongoose from 'mongoose';

/**
 * A promotional email campaign, as data rather than code.
 *
 * BIENVENIDA10 is currently a hardcoded module — its wording, audience, timing
 * and discount all live in welcomeCampaign.js, so changing any of them needs a
 * developer and a deploy. This model is what lets an admin create and edit a
 * campaign themselves.
 *
 * That campaign is deliberately NOT migrated here yet. It is verified and
 * working, and replacing a proven send path with an unproven one before this
 * has ever sent anything would be trading a known-good thing for a risk. The
 * two run side by side until this one has earned it.
 *
 * Nothing here decides who is safe to email. Suppression — unsubscribes, hard
 * bounces, complaints — is enforced at send time against the user record and
 * the suppression list, never from a stale copy stored on the campaign.
 */
const campaignSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    // ── What goes out ────────────────────────────────────────────────────
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    // Shown next to the subject in most inbox lists. Absent means the client
    // shows the first line of the body instead, which is usually worse.
    preheader: {
      type: String,
      default: '',
      trim: true,
    },
    // The full HTML document, as produced by a designer. Stored whole rather
    // than assembled from parts: email HTML is deliberately archaic — tables,
    // inline styles, VML for Outlook — and any builder that "helps" tends to
    // break it. {{unsubscribe_url}} is substituted at send time.
    html: {
      type: String,
      default: '',
    },
    // Plain-text alternative. Not decoration: a multipart message with a text
    // part measurably improves deliverability, and some clients show nothing
    // useful without it.
    text: {
      type: String,
      default: '',
    },

    // ── Who receives it ──────────────────────────────────────────────────
    //
    // Stored as named rules rather than a raw Mongo query. A saved query would
    // be a stored database expression an admin could edit through a web form,
    // which is an obvious way to read the whole collection. The rules are
    // translated into a query server-side, so only the shapes below are
    // reachable.
    audience: {
      // 'all' | 'free' | 'paid' | 'cancelled'
      segment: { type: String, default: 'free' },
      // Only accounts registered within this many days. Null means no bound,
      // which on a first send means everyone who ever signed up.
      registeredWithinDays: { type: Number, default: 7 },
      // Wait this long after registration before they qualify.
      minAccountAgeHours: { type: Number, default: 24 },
      // Exclude anyone who has ever reached Stripe.
      excludeStripeHistory: { type: Boolean, default: true },
    },

    // ── Offer ────────────────────────────────────────────────────────────
    // The promotion code this campaign advertises, if any. Eligibility and any
    // per-recipient expiry are enforced by the send record, not by Stripe — a
    // shared Stripe code carries one expiry for everyone.
    discountCode: {
      type: String,
      default: '',
      trim: true,
      uppercase: true,
    },
    // Hours the code stays usable after each recipient's own send. 0 disables
    // the window and the code behaves as Stripe configured it.
    discountValidHours: {
      type: Number,
      default: 24,
    },

    // ── State ────────────────────────────────────────────────────────────
    // draft    — being written, cannot send
    // ready    — approved to send, still requires an explicit start
    // sending  — a pass is in progress
    // sent     — finished
    // paused   — stopped part way, can resume
    status: {
      type: String,
      enum: ['draft', 'ready', 'sending', 'sent', 'paused'],
      default: 'draft',
      index: true,
    },

    // Counters, maintained as sends happen. Reporting reads CampaignSend,
    // which is the source of truth; these exist so the list can show progress
    // without an aggregation per row.
    stats: {
      sent: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      skipped: { type: Number, default: 0 },
    },

    lastRunAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// The list view is always most-recent-first.
campaignSchema.index({ createdAt: -1 });

export default mongoose.model('Campaign', campaignSchema);
