/**
 * Resend delivery events → the suppression list.
 *
 * Bounces and complaints are the two signals mailbox providers score a sender
 * on. Continuing to mail an address that hard bounced, or someone who marked a
 * message as spam, is what moves a domain from "inbox" to "junk" — and it takes
 * the transactional mail down with it, so a customer stops getting receipts and
 * password resets too.
 *
 * Nothing here trusts the request until the signature checks out. The endpoint
 * is public, and writing to the suppression list is exactly the thing an
 * attacker would want to do with it.
 */
import Suppression from '../models/Suppression.js';
import User from '../models/User.js';
import { verifySvixSignature } from '../utils/svixSignature.js';

/** Resend event names → why we would stop mailing that address. */
const SUPPRESSING = {
  'email.bounced': 'bounce',
  'email.complained': 'complaint',
};

/**
 * @desc    Resend delivery events
 * @route   POST /api/webhooks/resend
 * @access  Public, authenticated by signature
 */
export const handleResendWebhook = async (req, res) => {
  try {
    const secret = process.env.RESEND_WEBHOOK_SECRET;

    // Refuse rather than fall back to trusting the caller. An endpoint that
    // processes unsigned events when the secret is absent is the same as
    // having no signature check, and it fails open at exactly the wrong time.
    if (!secret) {
      console.error('[email-webhook] RESEND_WEBHOOK_SECRET is not set — event rejected');
      return res.status(503).json({ success: false, message: 'Webhook not configured' });
    }

    const verdict = verifySvixSignature(req.body, req.headers, secret);
    if (!verdict.ok) {
      console.warn(`[email-webhook] rejected: ${verdict.reason}`);
      return res.status(400).json({ success: false, message: 'Invalid signature' });
    }

    // Parsed only after verification, and from the same bytes that were signed.
    let event;
    try {
      event = JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body));
    } catch {
      return res.status(400).json({ success: false, message: 'Malformed payload' });
    }

    const type = event?.type;
    const reason = SUPPRESSING[type];

    // Acknowledge everything. A non-2xx makes Resend retry, and retrying a
    // delivered/opened event we simply do not act on achieves nothing.
    if (!reason) {
      return res.status(200).json({ success: true, ignored: type || 'unknown' });
    }

    // `to` may be a single address or a list.
    const recipients = []
      .concat(event?.data?.to || [])
      .map(e => String(e || '').toLowerCase().trim())
      .filter(Boolean);

    if (!recipients.length) {
      console.warn(`[email-webhook] ${type} carried no recipient — nothing to suppress`);
      return res.status(200).json({ success: true, ignored: 'no recipient' });
    }

    const detail = String(
      event?.data?.bounce?.message || event?.data?.reason || event?.data?.subject || ''
    ).slice(0, 300);

    for (const address of recipients) {
      // Address first — it is the key, and it holds even with no account.
      const user = await User.findOne({ email: address }).select('_id').lean();
      await Suppression.add(address, reason, detail, user?._id || null);

      // Mirror onto the account when there is one, so the campaign audience
      // query excludes them without a join.
      if (user) {
        await User.updateOne(
          { _id: user._id },
          { $set: { marketingOptOut: true, marketingOptOutAt: new Date() } }
        );
      }

      console.log(`[email-webhook] suppressed ${address} (${reason})`);
    }

    res.status(200).json({ success: true, suppressed: recipients.length, reason });
  } catch (error) {
    console.error('[email-webhook] failed:', error.message);
    // 500 so Resend retries — a database blip should not lose a bounce.
    res.status(500).json({ success: false, message: error.message });
  }
};
