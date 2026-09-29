/**
 * Sending engine for admin-created campaigns.
 *
 * Deliberately built on the patterns BIENVENIDA10 already proved in
 * production rather than a fresh design: claim the recipient before sending,
 * pace the sends, count attempts so a transient failure retries and a dead
 * address does not, and cap the blast radius of a mistake.
 *
 * The one thing this adds over that path — and the reason sending could not
 * ship in Phase 1 — is the suppression list. Every batch is filtered against
 * it immediately before sending, not when the audience was chosen: someone can
 * unsubscribe, bounce or complain between an admin pressing Send and their
 * turn coming up, and the list is the only thing that catches that.
 *
 * A pass is resumable by construction. It sends a bounded batch and returns;
 * anything left is picked up next time, because "who has already been sent to"
 * is a database fact rather than a position in a loop that a restart loses.
 */
import Campaign from '../models/Campaign.js';
import CampaignSend from '../models/CampaignSend.js';
import Suppression from '../models/Suppression.js';
import User from '../models/User.js';
import { sendEmail } from './emailService.js';
import { buildUnsubscribeUrl } from '../utils/unsubscribeToken.js';
import { checkEmailAddress } from '../utils/emailAddress.js';
import { makeTrackingToken } from '../utils/trackingToken.js';

/** Most recipients touched by a single pass. */
const MAX_PER_PASS = 50;

/** Gap between sends — Resend rate-limits around 2/second on standard plans. */
const SEND_INTERVAL_MS = 600;

/** Transient failures retried across passes before giving up on an address. */
const MAX_ATTEMPTS = 3;

const NOT_PAID = { $in: [null, '', 'free'] };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Translate stored audience rules into a query.
 *
 * Shared with the audience preview so the number an admin was shown is the
 * number that actually gets mailed. Only the named shapes below are reachable
 * — no admin-supplied query ever reaches the database.
 */
export function buildAudienceQuery(audience = {}) {
  const now = Date.now();
  const query = {
    role: { $ne: 'admin' },
    isActive: { $ne: false },
    isBlocked: { $ne: true },
    marketingOptOut: { $ne: true },
  };

  if (audience.minAccountAgeHours) {
    query.createdAt = { $lte: new Date(now - audience.minAccountAgeHours * 3600 * 1000) };
  }
  if (audience.registeredWithinDays) {
    query.createdAt = {
      ...(query.createdAt || {}),
      $gte: new Date(now - audience.registeredWithinDays * 86400 * 1000),
    };
  }

  if (audience.segment === 'free') {
    query['subscription.planId'] = NOT_PAID;
    query['subscription.plan'] = NOT_PAID;
  } else if (audience.segment === 'paid') {
    query['subscription.status'] = 'active';
    query['subscription.planId'] = { $nin: [null, '', 'free'] };
  } else if (audience.segment === 'cancelled') {
    query['subscription.status'] = 'cancelled';
  }

  if (audience.excludeStripeHistory) {
    query['subscription.stripeCustomerId'] = { $in: [null, ''] };
    query['subscription.stripeSubscriptionId'] = { $in: [null, ''] };
    query['subscriptionHistory.0'] = { $exists: false };
  }

  // Win-back campaigns need a recency bound, or "cancelled" reaches everyone
  // who ever left — including people who left two years ago and would read a
  // come-back offer as the platform having lost track of them entirely.
  if (audience.endedWithinDays) {
    query['subscription.endDate'] = {
      $gte: new Date(now - audience.endedWithinDays * 86400 * 1000),
      $lte: new Date(now),
    };
  }

  return query;
}

/**
 * Is this promotion code usable by this user, given the campaigns that
 * advertise it?
 *
 * The general form of the rule BIENVENIDA10 proved. A shared Stripe promotion
 * code carries ONE expiry for everyone, so a per-recipient window cannot come
 * from Stripe — it comes from the send record. A code advertised by a campaign
 * therefore works only for someone that campaign actually emailed, and only
 * within the campaign's own window.
 *
 * Two consequences worth keeping: the "expires in 24 hours" in an email is
 * true rather than decorative, and posting the code publicly achieves nothing
 * because a stranger has no send record.
 *
 * @returns {{ governed: false } | { governed: true, ok: boolean, message?: string }}
 *          governed:false means no campaign claims this code — an ordinary
 *          Stripe code, which must pass through untouched.
 */
export async function checkCampaignDiscount(rawCode, userId) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) return { governed: false };

  const campaigns = await Campaign.find({ discountCode: code })
    .select('_id name discountValidHours')
    .lean();

  if (!campaigns.length) return { governed: false };

  // A campaign with the window disabled hands the code back to Stripe's own
  // rules — an admin choosing 0 hours is saying "no per-person limit".
  if (campaigns.every(c => !c.discountValidHours)) return { governed: false };

  if (!userId) {
    return { governed: true, ok: false, message: 'Este código no está disponible para tu cuenta' };
  }

  const rows = await CampaignSend.find({
    campaign: { $in: campaigns.map(c => String(c._id)) },
    userId,
    sentAt: { $ne: null },
  })
    .select('campaign sentAt')
    .lean();

  if (!rows.length) {
    return { governed: true, ok: false, message: 'Este código no está disponible para tu cuenta' };
  }

  // Any campaign that still has an open window is enough. If the same code
  // went out twice, the later send is the one that should count.
  const byId = new Map(campaigns.map(c => [String(c._id), c]));
  const open = rows.some((r) => {
    const hours = byId.get(String(r.campaign))?.discountValidHours;
    if (!hours) return true;
    return Date.now() - new Date(r.sentAt).getTime() <= hours * 3600 * 1000;
  });

  return open
    ? { governed: true, ok: true }
    : { governed: true, ok: false, message: 'Este código ha caducado' };
}

const trackingBase = () =>
  (process.env.API_PUBLIC_URL || 'https://api.tododjs.com').replace(/\/+$/, '');

/**
 * Point every http(s) link through the click tracker.
 *
 * The unsubscribe URL is deliberately left alone. It is a legal requirement,
 * it has to work even if tracking is misconfigured or the endpoint is down,
 * and routing an opt-out through an engagement tracker is the wrong thing to
 * do to someone who has just asked to be left alone.
 *
 * mailto:, tel: and anchors are skipped — there is nothing to redirect to.
 */
export function rewriteLinks(html, campaignId, userId, unsubscribeUrl) {
  return String(html || '').replace(
    /href\s*=\s*(["'])(.*?)\1/gi,
    (match, quote, url) => {
      const target = String(url).trim();
      if (!/^https?:\/\//i.test(target)) return match;
      if (target === unsubscribeUrl) return match;

      const token = makeTrackingToken({ campaignId, userId, destination: target });
      return `href=${quote}${trackingBase()}/api/track/c/${token}${quote}`;
    }
  );
}

/**
 * Append the open pixel.
 *
 * Before </body> when there is one so it lands inside the document rather than
 * after it, which some clients strip.
 */
function addOpenPixel(html, campaignId, userId) {
  const token = makeTrackingToken({ campaignId, userId });
  const img = `<img src="${trackingBase()}/api/track/o/${token}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px" />`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${img}</body>`) : html + img;
}

/** Substitute the fixed placeholder set. Mirrors campaignController.render. */
function render(campaign, user) {
  const unsubscribeUrl = buildUnsubscribeUrl(user._id);
  const apply = (s) =>
    String(s || '')
      .split('{{unsubscribe_url}}').join(unsubscribeUrl)
      .split('{{preheader}}').join(campaign.preheader || '')
      .split('{{name}}').join(user.name || user.email || '');

  let html = apply(campaign.html);

  // Applied after substitution so the unsubscribe URL is a real URL by the
  // time rewriteLinks is deciding what to leave alone.
  if (campaign.tracking?.clicks) {
    html = rewriteLinks(html, String(campaign._id), String(user._id), unsubscribeUrl);
  }
  if (campaign.tracking?.opens) {
    html = addOpenPixel(html, String(campaign._id), String(user._id));
  }

  return {
    subject: apply(campaign.subject),
    html,
    // The plain-text part is never rewritten. A tracking URL in text is
    // unreadable, unmistakably a tracker, and the usual reason a message gets
    // marked as spam by a person reading it.
    text: apply(campaign.text),
    unsubscribeUrl,
  };
}

/** Recipients still owed this campaign, already filtered for suppression. */
async function nextBatch(campaign) {
  const candidates = await User.find(buildAudienceQuery(campaign.audience))
    .select('_id email name')
    .sort({ createdAt: 1 })
    .limit(MAX_PER_PASS * 4)
    .lean();

  if (!candidates.length) return [];

  const campaignKey = String(campaign._id);

  // Already handled: sent, exhausted, or a dead address.
  const already = await CampaignSend.find({
    campaign: campaignKey,
    userId: { $in: candidates.map(u => u._id) },
  })
    .select('userId sentAt attempts permanentFailure')
    .lean();

  const done = new Set(
    already
      .filter(r => r.sentAt || r.permanentFailure || (r.attempts || 0) >= MAX_ATTEMPTS)
      .map(r => String(r.userId))
  );

  const remaining = candidates.filter(u => !done.has(String(u._id)));
  if (!remaining.length) return [];

  // Checked here, immediately before sending, rather than when the audience
  // was chosen. Someone can unsubscribe or bounce between Send being pressed
  // and their turn arriving, and mailing them anyway is what the list exists
  // to prevent.
  const suppressed = await Suppression.filterSuppressed(remaining.map(u => u.email));

  return remaining
    .filter(u => !suppressed.has(String(u.email).toLowerCase()))
    .slice(0, MAX_PER_PASS);
}

/**
 * Send one bounded batch of a campaign.
 *
 * @param {string} campaignId
 * @param {{ dryRun?: boolean }} opts
 */
export async function runCampaignPass(campaignId, { dryRun = false } = {}) {
  const report = {
    campaign: null, sent: 0, failed: 0, skipped: 0, invalid: [],
    remaining: 0, finished: false, dryRun, recipients: [],
  };

  const campaign = await Campaign.findById(campaignId);
  if (!campaign) throw new Error('Campaign not found');
  report.campaign = campaign.name;

  // 'ready' is the human checkpoint. A draft has not been approved by anyone
  // and must not be able to reach a customer, whatever calls this.
  if (!dryRun && !['ready', 'sending'].includes(campaign.status)) {
    throw new Error(`Campaign is "${campaign.status}" — mark it ready before sending`);
  }
  if (!campaign.html && !campaign.text) {
    throw new Error('Campaign has no content');
  }

  const batch = await nextBatch(campaign);
  if (!batch.length) {
    if (!dryRun && campaign.status === 'sending') {
      campaign.status = 'sent';
      campaign.lastRunAt = new Date();
      await campaign.save();
    }
    report.finished = true;
    return report;
  }

  if (dryRun) {
    report.recipients = batch.map(u => u.email);
    report.remaining = batch.length;
    return report;
  }

  if (campaign.status !== 'sending') {
    campaign.status = 'sending';
    await campaign.save();
  }

  const campaignKey = String(campaign._id);
  let sendIndex = 0;

  for (const user of batch) {
    // Re-read each time: an admin pausing a long send should take effect
    // within one recipient, not at the end of the batch.
    const current = await Campaign.findById(campaignKey).select('status').lean();
    if (current?.status === 'paused') {
      console.log(`[campaign-send] "${campaign.name}" paused by admin — stopping`);
      break;
    }

    const address = checkEmailAddress(user.email);
    if (!address.ok) {
      report.invalid.push({ email: user.email, reason: address.reason, suggestion: address.suggestion || null });
      await CampaignSend.updateOne(
        { campaign: campaignKey, userId: user._id },
        {
          $setOnInsert: { email: user.email, claimedAt: new Date() },
          $set: {
            failedAt: new Date(), failureReason: address.reason,
            permanentFailure: true, lastAttemptAt: new Date(),
          },
        },
        { upsert: true }
      ).catch(e => console.error(`[campaign-send] could not record invalid ${user.email}: ${e.message}`));
      continue;
    }

    // Claim before sending. A duplicate key means someone else has this
    // recipient, which is what makes double-sending impossible rather than
    // merely unlikely.
    const now = new Date();
    try {
      await CampaignSend.create({
        campaign: campaignKey, userId: user._id, email: user.email,
        attempts: 1, lastAttemptAt: now,
      });
    } catch (err) {
      if (err?.code !== 11000) {
        console.error(`[campaign-send] could not claim ${user.email}: ${err.message}`);
        report.failed++;
        continue;
      }
      const retry = await CampaignSend.findOneAndUpdate(
        {
          campaign: campaignKey, userId: user._id, sentAt: null,
          permanentFailure: { $ne: true }, attempts: { $lt: MAX_ATTEMPTS },
        },
        { $inc: { attempts: 1 }, $set: { lastAttemptAt: now } },
        { new: true }
      );
      if (!retry) { report.skipped++; continue; }
    }

    if (sendIndex++ > 0) await sleep(SEND_INTERVAL_MS);

    const { subject, html, text, unsubscribeUrl } = render(campaign, user);
    const result = await sendEmail({
      to: user.email,
      subject, html, text,
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });

    if (result?.success === false) {
      // Left retriable: a rate limit or a momentary fault must not remove
      // someone from the campaign for good.
      await CampaignSend.updateOne(
        { campaign: campaignKey, userId: user._id },
        { $set: { failedAt: new Date(), failureReason: String(result.error?.message || 'send failed').slice(0, 300) } }
      );
      report.failed++;
      continue;
    }

    // sentAt stamped on success, never at claim time — any per-recipient
    // discount window is measured from here, and a retried send would
    // otherwise arrive with part of its window already gone.
    await CampaignSend.updateOne(
      { campaign: campaignKey, userId: user._id },
      { $set: { sentAt: new Date(), failedAt: null, failureReason: null } }
    );
    report.sent++;
    report.recipients.push(user.email);
  }

  await Campaign.updateOne(
    { _id: campaignKey },
    {
      $inc: {
        'stats.sent': report.sent,
        'stats.failed': report.failed,
        'stats.skipped': report.skipped,
      },
      $set: { lastRunAt: new Date() },
    }
  );

  report.remaining = (await nextBatch(campaign)).length;
  report.finished = report.remaining === 0;

  if (report.finished) {
    const fresh = await Campaign.findById(campaignKey).select('status').lean();
    if (fresh?.status === 'sending') {
      await Campaign.updateOne({ _id: campaignKey }, { $set: { status: 'sent' } });
    }
  }

  console.log(
    `[campaign-send] "${campaign.name}" — sent ${report.sent}, failed ${report.failed}, ` +
    `skipped ${report.skipped}, remaining ${report.remaining}`
  );
  return report;
}
