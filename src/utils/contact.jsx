/**
 * The public contact address, supplied at BUILD time rather than hardcoded.
 *
 * WHY
 * ---
 * The legal pages — privacy policy, cookie policy, terms — have to show a real
 * contact point; EU customers have a right to one, and a privacy policy without
 * it is a compliance gap. But the repository is public, so the address itself
 * must not live in tracked source.
 *
 * Set VITE_CONTACT_EMAIL in an UNTRACKED env file on the machine that runs the
 * build: `.env.production.local` for a production build, `.env.local` for
 * development. Vite inlines it at build time.
 *
 * `.env` and `.env.production` ARE tracked in git, so the value must NOT go in
 * either of those — that would put it straight back into the public repo.
 *
 * When it is unset the pages render nothing rather than a dead `mailto:` link,
 * and a development build warns, so a misconfigured build is obvious instead of
 * silently shipping a broken contact link.
 */
export const CONTACT_EMAIL = (import.meta.env.VITE_CONTACT_EMAIL || '').trim();

if (!CONTACT_EMAIL && import.meta.env.DEV) {
  console.warn(
    '[contact] VITE_CONTACT_EMAIL is not set — the legal pages will display no ' +
    'contact address. Set it in .env.local (dev) or .env.production.local (build).'
  );
}

/**
 * The address as a mailto link, for the several places in the legal pages that
 * render it that way. Renders nothing when unconfigured.
 */
export function ContactEmail({ className = 'text-accent hover:underline' }) {
  if (!CONTACT_EMAIL) return null;
  return (
    <a href={`mailto:${CONTACT_EMAIL}`} className={className}>
      {CONTACT_EMAIL}
    </a>
  );
}
