/**
 * Signed tokens for open and click tracking.
 *
 * Two things make this worth signing rather than putting ids in a query string.
 *
 * The click endpoint redirects the browser to a destination. If that
 * destination arrived unsigned, anyone could craft
 * api.tododjs.com/api/track/c/?to=<phishing site> and send it out — a link
 * that genuinely originates from your domain, passes casual inspection, and
 * lands wherever they choose. Signing the destination into the token means
 * only URLs this server produced can be redirected to.
 *
 * And the ids identify a person and a campaign. Unsigned, they would be
 * trivially enumerable: increment a user id and record opens against accounts
 * that never received anything, or read someone else's engagement.
 *
 * Stateless, like the unsubscribe token: an email may be opened months later
 * and there is nothing to store or expire.
 */
import crypto from 'crypto';

const SECRET = () => process.env.JWT_SECRET || '';

const b64url = (s) => Buffer.from(s, 'utf8').toString('base64url');
const unb64url = (s) => Buffer.from(String(s), 'base64url').toString('utf8');

const sign = (payload) =>
  crypto.createHmac('sha256', SECRET()).update(`track:${payload}`).digest('base64url');

/**
 * Build a token carrying the campaign, the recipient, and for a click, the
 * destination it is allowed to redirect to.
 */
export function makeTrackingToken({ campaignId, userId, destination = null }) {
  const payload = b64url(JSON.stringify({
    c: String(campaignId),
    u: String(userId),
    ...(destination ? { d: String(destination) } : {}),
  }));
  return `${payload}.${sign(payload)}`;
}

/**
 * @returns {{ ok: true, campaignId: string, userId: string, destination: string|null }
 *          | { ok: false }}
 */
export function readTrackingToken(token) {
  if (!token || !SECRET()) return { ok: false };

  const raw = String(token);
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return { ok: false };

  const payload = raw.slice(0, dot);
  const provided = raw.slice(dot + 1);
  const expected = sign(payload);

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // Length check first — timingSafeEqual throws on a mismatch.
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false };

  try {
    const data = JSON.parse(unb64url(payload));
    if (!data.c || !data.u) return { ok: false };
    return { ok: true, campaignId: data.c, userId: data.u, destination: data.d || null };
  } catch {
    return { ok: false };
  }
}

/**
 * Only ever redirect to http(s).
 *
 * Belt and braces: the destination is already signed, so it can only be a URL
 * this server produced. But a campaign's HTML is admin-supplied, so a
 * javascript: or data: href could be signed in perfectly legitimately and
 * would then execute in whatever context follows the redirect.
 */
export function isSafeRedirect(url) {
  try {
    const parsed = new URL(String(url));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
