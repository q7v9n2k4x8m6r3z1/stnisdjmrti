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
import { checkEmailAddress } from '../utils/emailAddress.js';

export const CAMPAIGN = 'bienvenida10';
export const CAMPAIGN_CODE = 'BIENVENIDA10';

/** How long after the email the code stays usable. The email promises 24h. */
export const CODE_TTL_MS = 24 * 60 * 60 * 1000;

/** How long after registering we wait before offering the discount. */
const WAIT_MS = 24 * 60 * 60 * 1000;

/** Never mail an account older than this. The blast-radius guard. */
const MAX_AGE_DAYS = 7;

const MAX_PER_PASS = 50;

/**
 * Gap between sends. Resend rate-limits around 2 requests/second on standard
 * plans, and a burst of thirty back-to-back sends is exactly the shape that
 * trips it. Pacing is cheaper than handling the 429.
 */
const SEND_INTERVAL_MS = 600;

/**
 * How many times a transient failure is retried on later passes before the
 * recipient is given up on. Without a cap a permanently unreachable mailbox
 * would be attempted every hour forever.
 */
const MAX_ATTEMPTS = 3;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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

  // sentAt, not the row's existence: a claimed-but-unsent row means the email
  // never reached them, so the code they have not seen must not work.
  const row = await CampaignSend.findOne({ campaign: CAMPAIGN, userId }).lean();
  if (!row || !row.sentAt) {
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

    // Never had any dealings with Stripe.
    //
    // The email opens "Has dado el primer paso al registrarte" — you have
    // taken the first step by registering. To someone who already subscribed
    // and cancelled, or who reached checkout and did not finish, that reads as
    // if we have no idea who they are. A lapsed customer deserves a different
    // message, not this one.
    //
    // Three independent traces, because any one of them can be absent: a
    // customer id from ever reaching checkout, a subscription id from ever
    // having a plan, and a history row from ever having paid. null also
    // matches a missing field; 'subscriptionHistory.0' matches an array that
    // is empty or absent.
    'subscription.stripeCustomerId': { $in: [null, ''] },
    'subscription.stripeSubscriptionId': { $in: [null, ''] },
    'subscriptionHistory.0': { $exists: false },
  })
    .select('_id email name createdAt')
    .sort({ createdAt: 1 })
    .limit(MAX_PER_PASS * 4)
    .lean();

  if (!candidates.length) return [];

  // Drop anyone already dealt with. The unique index is the real guarantee;
  // this avoids generating work that would be rejected.
  const already = await CampaignSend.find({
    campaign: CAMPAIGN,
    userId: { $in: candidates.map(u => u._id) },
  })
    .select('userId sentAt attempts permanentFailure')
    .lean();

  // Sent, given up on, or unreachable. A transient failure with attempts left
  // stays eligible, so the next pass retries it — otherwise a single rate
  // limit would drop that person from the campaign silently and for good.
  const done = new Set(
    already
      .filter(r => r.sentAt || r.permanentFailure || (r.attempts || 0) >= MAX_ATTEMPTS)
      .map(r => String(r.userId))
  );
  return candidates.filter(u => !done.has(String(u._id))).slice(0, MAX_PER_PASS);
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
  const report = { eligible: 0, sent: 0, failed: 0, skipped: 0, dryRun, recipients: [], invalid: [] };

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

  let sendIndex = 0;
  for (const user of candidates) {
    if (allowlist.length && !allowlist.includes(String(user.email).toLowerCase())) {
      report.skipped++;
      continue;
    }

    // Addresses that will certainly bounce never reach Resend. A hard bounce
    // costs sender reputation, and a domain that has only ever sent receipts
    // has none to spare. The address is reported, never corrected: mailing a
    // guessed address could send someone's discount code to a stranger.
    const address = checkEmailAddress(user.email);
    if (!address.ok) {
      report.invalid.push({
        email: user.email,
        reason: address.reason,
        suggestion: address.suggestion || null,
      });
      if (!dryRun) {
        // Recorded as permanently failed so later passes stop reconsidering
        // it, and so the report can show the admin what to correct.
        await CampaignSend.updateOne(
          { campaign: CAMPAIGN, userId: user._id },
          {
            $setOnInsert: { email: user.email, claimedAt: new Date() },
            $set: {
              failedAt: new Date(),
              failureReason: address.reason,
              permanentFailure: true,
              lastAttemptAt: new Date(),
            },
          },
          { upsert: true }
        ).catch(err => console.error(`[welcome-campaign] could not record invalid ${user.email}: ${err.message}`));
      }
      continue;
    }

    if (dryRun) {
      report.recipients.push(user.email);
      continue;
    }

    // Claim the slot before sending. A duplicate key means a row already
    // exists — either someone already received it, or a previous attempt
    // failed and may be retried.
    const now = new Date();
    try {
      await CampaignSend.create({
        campaign: CAMPAIGN,
        userId: user._id,
        email: user.email,
        attempts: 1,
        lastAttemptAt: now,
      });
    } catch (err) {
      if (err?.code !== 11000) {
        console.error(`[welcome-campaign] could not claim ${user.email}: ${err.message}`);
        report.failed++;
        continue;
      }
      // Take over a failed attempt, but only one that is still retriable. The
      // filter does the deciding atomically: if it matches nothing, another
      // worker got there first or this person is already done.
      const retry = await CampaignSend.findOneAndUpdate(
        {
          campaign: CAMPAIGN,
          userId: user._id,
          sentAt: null,
          permanentFailure: { $ne: true },
          attempts: { $lt: MAX_ATTEMPTS },
        },
        { $inc: { attempts: 1 }, $set: { lastAttemptAt: now } },
        { new: true }
      );
      if (!retry) { report.skipped++; continue; }
    }

    // Pace the sends. Not before the first one.
    if (sendIndex++ > 0) await sleep(SEND_INTERVAL_MS);

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
      // Left retriable on purpose. The row keeps its attempt count, so the
      // next pass tries again until MAX_ATTEMPTS — a rate limit or a momentary
      // network fault must not remove someone from the campaign permanently.
      await CampaignSend.updateOne(
        { campaign: CAMPAIGN, userId: user._id },
        {
          $set: {
            failedAt: new Date(),
            failureReason: String(result.error?.message || 'send failed').slice(0, 300),
          },
        }
      );
      report.failed++;
      console.error(`[welcome-campaign] send failed for ${user.email} (attempt recorded, will retry)`);
      continue;
    }

    // Stamp sentAt only now. The customer's 24-hour discount window starts
    // when the email actually goes out, not when the row was claimed — a
    // retried send would otherwise arrive with part of its window gone.
    await CampaignSend.updateOne(
      { campaign: CAMPAIGN, userId: user._id },
      { $set: { sentAt: new Date(), failedAt: null, failureReason: null } }
    );

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
