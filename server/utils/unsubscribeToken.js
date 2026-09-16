/**
 * Unsubscribe links for promotional email.
 *
 * Deliberately stateless, unlike deviceManageToken: an unsubscribe link must
 * still work when someone finds the email eighteen months later, so it cannot
 * expire and there is nothing to store or clean up. The token is the user id
 * plus an HMAC of it, so it can be verified without a lookup and cannot be
 * forged or enumerated — guessing another user's link means forging a SHA-256
 * HMAC without the secret.
 *
 * It grants exactly one thing: setting marketingOptOut on that account. It
 * cannot log in, read the profile, or change anything else.
 */
import crypto from 'crypto';

const SECRET = () => process.env.JWT_SECRET || '';

const sign = (id) =>
  crypto.createHmac('sha256', SECRET()).update(`unsubscribe:${id}`).digest('base64url');

/**
 * Absolute unsubscribe URL for a user, safe to put in an email body and in the
 * List-Unsubscribe header.
 */
export function buildUnsubscribeUrl(userId) {
  const id = String(userId);
  // The API host, not FRONTEND_URL. tododjs.com is served by Nginx as static
  // files with an SPA fallback and has no /api proxy, so an unsubscribe link
  // pointing there would quietly return index.html and the click would appear
  // to do nothing.
  const base = (process.env.API_PUBLIC_URL || 'https://api.tododjs.com').replace(/\/+$/, '');
  return `${base}/api/email/unsubscribe?u=${id}&t=${sign(id)}`;
}

/**
 * Verify a token against a user id.
 *
 * timingSafeEqual rather than === so a wrong signature cannot be narrowed one
 * character at a time by measuring how long the comparison takes.
 */
export function verifyUnsubscribeToken(userId, token) {
  if (!userId || !token || !SECRET()) return false;
  const expected = sign(String(userId));
  const a = Buffer.from(String(token));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
