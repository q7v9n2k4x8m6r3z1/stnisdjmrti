/**
 * BIENVENIDA10 — win-back email for registrations that never subscribed.
 *
 * Someone creates a free account. Twenty-four hours later, if they still have
 * no paid plan, they get one Spanish email offering 10% off their first
 * payment with the code BIENVENIDA10. They enter it by hand on the pricing
 * page. The code only works for them, and only for 24 hours after their email
 * was sent — see isCampaignCodeValidFor below, which is what makes the subject
 * line ("caduca en 24 horas") true rather than decorative.
 *
 * SAFETY, because this sends real email to real customers
 *
 * Off by default. WELCOME_CAMPAIGN_ENABLED must be explicitly 'true', so a
 * deploy cannot start mailing people on its own.
 *
 * Bounded by age. Only accounts registered within MAX_AGE_DAYS qualify.
 * Without it, the first enabled pass would mail every free account ever
 * created — hundreds of people who signed up months ago, all at once, which is
 * how a sending domain gets burned.
 *
 * Bounded per pass. At most MAX_PER_PASS emails per run, so a mistake in the
 * query costs a handful of emails rather than the whole database.
 *
 * Allowlist for testing. WELCOME_CAMPAIGN_TEST_EMAILS restricts sending to
 * named addresses. APP_ENV=staging switches Stripe to test mode but does
 * nothing to email — Resend still delivers to real inboxes — so this is the
 * only thing that makes a staging rehearsal safe.
 *
 * The send row is written BEFORE the email goes out. A unique index on
 * (campaign, userId) means a duplicate key error answers "has anyone already
 * claimed this person", which makes double-sending impossible rather than
 * merely unlikely.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import User from '../models/User.js';
import CampaignSend from '../models/CampaignSend.js';
import { sendEmail } from './emailService.js';
import { buildUnsubscribeUrl } from '../utils/unsubscribeToken.js';

export const CAMPAIGN = 'bienvenida10';
export const CAMPAIGN_CODE = 'BIENVENIDA10';

/** How long after the email the code stays usable. The email promises 24h. */
export const CODE_TTL_MS = 24 * 60 * 60 * 1000;

/** How long after registering we wait before offering the discount. */
const WAIT_MS = 24 * 60 * 60 * 1000;

/** Never mail an account older than this. The blast-radius guard. */
const MAX_AGE_DAYS = 7;

const MAX_PER_PASS = 50;

const SUBJECT = '🎁 Tu 10 % de descuento caduca en 24 horas';

/** Neither field naming a paid plan. null also matches a missing field. */
const NOT_PAID = { $in: [null, '', 'free'] };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.join(__dirname, '..', 'templates');

let cached = null;
function loadTemplates() {
  if (!cached) {
    cached = {
      html: fs.readFileSync(path.join(TEMPLATE_DIR, 'bienvenida10.html'), 'utf8'),
      text: fs.readFileSync(path.join(TEMPLATE_DIR, 'bienvenida10.txt'), 'utf8'),
    };
  }
  return cached;
}

const isEnabled = () =>
  String(process.env.WELCOME_CAMPAIGN_ENABLED || '').toLowerCase() === 'true';

const testAllowlist = () =>
  String(process.env.WELCOME_CAMPAIGN_TEST_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);

/**
 * Is BIENVENIDA10 currently usable by this user?
 *
 * The whole campaign rule in one place, called by resolvePromotionCode so the
 * checkout preview and the actual charge can never disagree. A shared Stripe
 * code carries a single expiry for everyone, so a per-person 24-hour window
 * cannot come from Stripe — it comes from this row.
 *
 * Side effect worth keeping: someone who never received the email cannot use
 * the code, so posting it publicly achieves nothing.
 */
export async function isCampaignCodeValidFor(userId) {
  if (!userId) return { ok: false, message: 'Este código no está disponible para tu cuenta' };

  const row = await CampaignSend.findOne({ campaign: CAMPAIGN, userId }).lean();
  if (!row || row.failedAt) {
    return { ok: false, message: 'Este código no está disponible para tu cuenta' };
  }

  if (Date.now() - new Date(row.sentAt).getTime() > CODE_TTL_MS) {
    return { ok: false, message: 'Este código ha caducado' };
  }

  return { ok: true };
}

/** Accounts that qualify right now, excluding anyone already emailed. */
async function findCandidates() {
  const now = Date.now();

  const candidates = await User.find({
    role: { $ne: 'admin' },
    isActive: { $ne: false },
    isBlocked: { $ne: true },
    marketingOptOut: { $ne: true },
    createdAt: {
      $lte: new Date(now - WAIT_MS),
      $gte: new Date(now - MAX_AGE_DAYS * 24 * 60 * 60 * 1000),
    },
    // Still free. Both fields are checked: 'free' is a truthy string, and
    // trusting one field alone is exactly how a free-plan account once passed
    // for paid (f4f79ce).
    'subscription.planId': NOT_PAID,
    'subscription.plan': NOT_PAID,
  })
    .select('_id email name createdAt')
    .sort({ createdAt: 1 })
    .limit(MAX_PER_PASS * 4)
    .lean();

  if (!candidates.length) return [];

  // Drop anyone already emailed. The unique index is the real guarantee; this
  // just avoids generating work that would be rejected.
  const already = await CampaignSend.find({
    campaign: CAMPAIGN,
    userId: { $in: candidates.map(u => u._id) },
  })
    .select('userId')
    .lean();

  const seen = new Set(already.map(r => String(r.userId)));
  return candidates.filter(u => !seen.has(String(u._id))).slice(0, MAX_PER_PASS);
}

/** Build this recipient's copy of the email. */
function render(user) {
  const { html, text } = loadTemplates();
  const url = buildUnsubscribeUrl(user._id);
  return {
    html: html.split('{{unsubscribe_url}}').join(url),
    text: text.split('{{unsubscribe_url}}').join(url),
    unsubscribeUrl: url,
  };
}

/**
 * One pass. Returns a report; writes nothing when dryRun is set.
 */
export async function runWelcomeCampaignPass({ dryRun = false } = {}) {
  const report = { eligible: 0, sent: 0, failed: 0, skipped: 0, dryRun, recipients: [] };

  if (!isEnabled() && !dryRun) {
    console.log('[welcome-campaign] disabled (WELCOME_CAMPAIGN_ENABLED is not "true") — nothing sent');
    return report;
  }

  const allowlist = testAllowlist();
  const candidates = await findCandidates();
  report.eligible = candidates.length;

  if (!candidates.length) {
    console.log('[welcome-campaign] no eligible accounts this pass');
    return report;
  }

  for (const user of candidates) {
    if (allowlist.length && !allowlist.includes(String(user.email).toLowerCase())) {
      report.skipped++;
      continue;
    }

    if (dryRun) {
      report.recipients.push(user.email);
      continue;
    }

    // Claim the slot first. A duplicate key here means another pass, or
    // another worker, already has this person — not an error worth logging as
    // a failure.
    let claim;
    try {
      claim = await CampaignSend.create({ campaign: CAMPAIGN, userId: user._id, email: user.email });
    } catch (err) {
      if (err?.code === 11000) { report.skipped++; continue; }
      console.error(`[welcome-campaign] could not claim ${user.email}: ${err.message}`);
      report.failed++;
      continue;
    }

    const { html, text, unsubscribeUrl } = render(user);
    const result = await sendEmail({
      to: user.email,
      subject: SUBJECT,
      html,
      text,
      headers: {
        // A real one-click opt-out, not a mailto a human has to action.
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });

    if (result?.success === false) {
      // Keep the row and mark it failed rather than deleting it, so a broken
      // address is not retried on every pass forever.
      await CampaignSend.updateOne(
        { _id: claim._id },
        { $set: { failedAt: new Date(), failureReason: String(result.error?.message || 'send failed').slice(0, 300) } }
      );
      report.failed++;
      console.error(`[welcome-campaign] send failed for ${user.email}`);
      continue;
    }

    report.sent++;
    report.recipients.push(user.email);
    console.log(`[welcome-campaign] sent to ${user.email}`);
  }

  console.log(
    `[welcome-campaign] pass complete — eligible ${report.eligible}, sent ${report.sent}, ` +
    `failed ${report.failed}, skipped ${report.skipped}${dryRun ? ' (DRY RUN)' : ''}`
  );
  return report;
}

/**
 * Schedule it. Mirrors the reconciler: only the designated cluster instance
 * runs, so two PM2 workers cannot both mail the same people.
 */
export function startWelcomeCampaign({ intervalMs = 60 * 60 * 1000, startupDelayMs = 3 * 60 * 1000 } = {}) {
  const instance = process.env.NODE_APP_INSTANCE;
  if (instance !== undefined && instance !== '0') {
    console.log(`[welcome-campaign] instance ${instance} — not the designated runner, skipping`);
    return;
  }

  if (!isEnabled()) {
    console.log('[welcome-campaign] not scheduled — WELCOME_CAMPAIGN_ENABLED is not "true"');
    return;
  }

  const run = () =>
    runWelcomeCampaignPass().catch(e => console.error('[welcome-campaign] pass failed:', e.message));

  setTimeout(run, startupDelayMs).unref?.();
  setInterval(run, intervalMs).unref?.();
  console.log(
    `[welcome-campaign] scheduled hourly (first run in ${Math.round(startupDelayMs / 60000)}m)` +
    `${testAllowlist().length ? ` — ALLOWLIST ACTIVE (${testAllowlist().length} address(es))` : ''}`
  );
}
