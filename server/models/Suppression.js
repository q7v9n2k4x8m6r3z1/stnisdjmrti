import mongoose from 'mongoose';

/**
 * Addresses that must never receive promotional email again.
 *
 * Keyed on the ADDRESS, not the user id, and deliberately so. A bounce or a
 * spam complaint is a fact about a mailbox: the same address may belong to a
 * deleted account, to an account created later, or to no account at all. Tying
 * suppression to a user record would lose the entry the moment the account
 * changed, and the mailbox would start receiving mail again.
 *
 * This is the list that protects the sending domain. Mailbox providers score a
 * sender on bounces and complaints; continuing to mail an address that hard
 * bounced, or someone who reported a message as spam, is the fastest way to
 * have everything else land in junk — including the receipts and password
 * resets that customers actually need.
 *
 * Transactional mail deliberately does NOT consult this list. A receipt or a
 * failed-payment notice is part of the service someone is paying for, and a
 * bounce on it is a delivery problem to investigate rather than a reason to
 * stop telling a customer their card failed.
 */
const suppressionSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      unique: true,
      index: true,
    },

    // unsubscribe — the person asked, via the link or the one-click header
    // bounce     — the mailbox rejected it permanently (no such address)
    // complaint  — reported as spam; the most damaging signal of the three
    // manual     — an admin added it
    reason: {
      type: String,
      enum: ['unsubscribe', 'bounce', 'complaint', 'manual'],
      required: true,
    },

    // Whatever the provider told us, kept verbatim for diagnosis. A "bounce"
    // that turns out to be a full mailbox rather than a dead address is worth
    // being able to tell apart afterwards.
    detail: {
      type: String,
      default: '',
    },

    // Set when the entry came from a user account, purely so a report can join
    // back. Never used to decide suppression — the address is the key.
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

/**
 * Add an address to the list, or leave an existing entry alone.
 *
 * Idempotent, and deliberately does not overwrite: the first reason is the
 * truthful one. Someone who unsubscribed and later hard-bounced unsubscribed
 * first, and a later bounce should not rewrite that history.
 */
suppressionSchema.statics.add = async function add(email, reason, detail = '', userId = null) {
  const address = String(email || '').toLowerCase().trim();
  if (!address) return null;

  return this.findOneAndUpdate(
    { email: address },
    { $setOnInsert: { email: address, reason, detail, userId } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

/**
 * Which of these addresses are suppressed?
 *
 * Returns a Set of lowercased addresses, so a send pass can filter a batch
 * with one query rather than one per recipient.
 */
suppressionSchema.statics.filterSuppressed = async function filterSuppressed(emails) {
  const list = (emails || []).map(e => String(e || '').toLowerCase().trim()).filter(Boolean);
  if (!list.length) return new Set();
  const rows = await this.find({ email: { $in: list } }).select('email').lean();
  return new Set(rows.map(r => r.email));
};

export default mongoose.model('Suppression', suppressionSchema);
