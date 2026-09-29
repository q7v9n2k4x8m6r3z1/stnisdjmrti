/**
 * Verify a Svix-signed webhook, which is what Resend uses.
 *
 * This matters more than it looks. The endpoint behind it writes to the
 * suppression list, so an unauthenticated version would let anyone POST a
 * stream of fabricated "bounce" events and quietly stop every customer from
 * receiving email — including receipts and password resets, since a poisoned
 * suppression list is indistinguishable from a real one. Signature
 * verification is the only thing standing between a public URL and that.
 *
 * The scheme: sign "<id>.<timestamp>.<raw body>" with HMAC-SHA256 under the
 * secret, base64 the result, and compare against one of the space-separated
 * signatures in the svix-signature header. Several may be present during a
 * secret rotation, so any match is a pass.
 */
import crypto from 'crypto';

/** Replays are rejected outside this window, in seconds. */
const TOLERANCE_S = 5 * 60;

/**
 * @param {Buffer|string} rawBody  the body EXACTLY as received — parsing and
 *                                 re-serialising changes the bytes and the
 *                                 signature will not match
 * @param {object} headers         request headers
 * @param {string} secret          the whsec_... signing secret
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function verifySvixSignature(rawBody, headers, secret) {
  if (!secret) return { ok: false, reason: 'no signing secret configured' };

  const id = headers['svix-id'] || headers['webhook-id'];
  const timestamp = headers['svix-timestamp'] || headers['webhook-timestamp'];
  const signature = headers['svix-signature'] || headers['webhook-signature'];

  if (!id || !timestamp || !signature) {
    return { ok: false, reason: 'missing signature headers' };
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'bad timestamp' };
  if (Math.abs(Date.now() / 1000 - ts) > TOLERANCE_S) {
    return { ok: false, reason: 'timestamp outside tolerance' };
  }

  // The secret is base64 after the prefix; the raw bytes are the HMAC key.
  const key = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64');
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
  const expected = crypto
    .createHmac('sha256', key)
    .update(`${id}.${ts}.${body}`)
    .digest('base64');

  // Header is "v1,<sig> v1,<sig>" — more than one during a rotation.
  const provided = String(signature)
    .split(' ')
    .map(part => part.split(',')[1])
    .filter(Boolean);

  const expectedBuf = Buffer.from(expected);
  const match = provided.some((sig) => {
    const buf = Buffer.from(sig);
    // Length check first: timingSafeEqual throws on a mismatch rather than
    // returning false.
    return buf.length === expectedBuf.length && crypto.timingSafeEqual(buf, expectedBuf);
  });

  return match ? { ok: true } : { ok: false, reason: 'signature mismatch' };
}
