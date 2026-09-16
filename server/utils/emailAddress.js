/**
 * Address sanity checks for bulk sending.
 *
 * Not an attempt at RFC 5322 — the only reliable test of an address is
 * delivery. The goal is narrower: keep addresses that will certainly bounce
 * out of a bulk send, because hard bounces damage sender reputation and a
 * domain that normally sends only receipts has no reputation to spare.
 *
 * A real registration in the database was `tonift24@gmail.con`. A generic
 * format check passes it — `.con` is a well-formed TLD — so format alone is
 * not enough, hence the typo table below.
 *
 * Nothing here rewrites an address. A typo is reported so a human can correct
 * it; silently mailing a guessed address risks sending someone's discount code
 * to a stranger.
 */

// Deliberately conservative: one @, no spaces, a dot in the domain, no
// consecutive dots, does not start or end with a dot.
const SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/**
 * Near-misses for the providers that dominate this user base. Each key is a
 * domain that is almost certainly a mistyped version of the value.
 */
const TYPOS = {
  'gmail.con': 'gmail.com',
  'gmail.co': 'gmail.com',
  'gmail.cm': 'gmail.com',
  'gmail.om': 'gmail.com',
  'gmai.com': 'gmail.com',
  'gmial.com': 'gmail.com',
  'gmail.comm': 'gmail.com',
  'hotmail.con': 'hotmail.com',
  'hotmial.com': 'hotmail.com',
  'hotmai.com': 'hotmail.com',
  'outlook.con': 'outlook.com',
  'outlok.com': 'outlook.com',
  'yahoo.con': 'yahoo.com',
  'icloud.con': 'icloud.com',
  'iclod.com': 'icloud.com',
};

/**
 * @returns {{ ok: true } | { ok: false, reason: string, suggestion?: string }}
 */
export function checkEmailAddress(raw) {
  const email = String(raw || '').trim().toLowerCase();

  if (!email) return { ok: false, reason: 'empty address' };
  if (email.length > 254) return { ok: false, reason: 'address too long' };
  if (!SHAPE.test(email)) return { ok: false, reason: 'malformed address' };
  if (email.includes('..')) return { ok: false, reason: 'malformed address' };

  const domain = email.slice(email.lastIndexOf('@') + 1);
  if (TYPOS[domain]) {
    return {
      ok: false,
      reason: `probable typo in domain "${domain}"`,
      // Plain slice, not a regex: the domain contains dots, which would be
      // metacharacters and could match the wrong thing.
      suggestion: email.slice(0, email.length - domain.length) + TYPOS[domain],
    };
  }

  return { ok: true };
}
