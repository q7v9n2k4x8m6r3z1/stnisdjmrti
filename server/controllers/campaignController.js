/**
 * Campaign management for the admin panel.
 *
 * Create, edit, preview and test-send promotional emails without a developer.
 *
 * There is deliberately no bulk-send endpoint in this file yet. An admin can
 * build a campaign and see exactly what it will look like, but nothing here
 * can mail a customer. Sending arrives with the suppression list and bounce
 * handling that must exist before any of it is safe to point at a real
 * audience — building the button first and the safety after is how a sending
 * domain gets burned.
 */
import Campaign from '../models/Campaign.js';
import CampaignSend from '../models/CampaignSend.js';
import SubscriptionPlan from '../models/SubscriptionPlan.js';
import User from '../models/User.js';
import { sendEmail } from '../services/emailService.js';
import { buildUnsubscribeUrl } from '../utils/unsubscribeToken.js';
import { checkEmailAddress } from '../utils/emailAddress.js';
import { runCampaignPass, buildAudienceQuery } from '../services/campaignSender.js';
import stripe from '../config/stripe.js';

/** Fields an admin may set. Anything else in the body is ignored. */
const EDITABLE = [
  'name', 'subject', 'preheader', 'html', 'text',
  'audience', 'discountCode', 'discountValidHours', 'status', 'automation',
];

const SEGMENTS = ['all', 'free', 'paid', 'cancelled'];
const STATUSES = ['draft', 'ready', 'sending', 'sent', 'paused'];

/**
 * Substitute the placeholders a template may use.
 *
 * A deliberately tiny, fixed set. Anything resembling a template language here
 * would be evaluating admin-supplied strings against user records, and the
 * blast radius of a mistake is "the wrong person's data in someone's inbox".
 */
function render(campaign, { userId, name = '', email = '' }) {
  const unsubscribeUrl = buildUnsubscribeUrl(userId);
  const apply = (s) =>
    String(s || '')
      .split('{{unsubscribe_url}}').join(unsubscribeUrl)
      .split('{{preheader}}').join(campaign.preheader || '')
      // Falls back to the address rather than leaving "Hola ," — an empty
      // greeting reads worse than a slightly impersonal one.
      .split('{{name}}').join(name || email || '');

  return {
    subject: apply(campaign.subject),
    html: apply(campaign.html),
    text: apply(campaign.text),
    unsubscribeUrl,
  };
}

/** Reject anything that cannot safely be sent, with a reason an admin can act on. */
function validate(body) {
  if (body.name !== undefined && !String(body.name).trim()) {
    return 'Give the campaign a name';
  }
  if (body.subject !== undefined && !String(body.subject).trim()) {
    return 'A subject line is required';
  }
  if (body.status !== undefined && !STATUSES.includes(body.status)) {
    return 'Unknown status';
  }
  if (body.audience?.segment !== undefined && !SEGMENTS.includes(body.audience.segment)) {
    return 'Unknown audience segment';
  }
  const hours = body.discountValidHours;
  if (hours !== undefined && (!Number.isFinite(Number(hours)) || Number(hours) < 0)) {
    return 'Discount validity must be zero or more hours';
  }
  return null;
}

// @desc    List campaigns
// @route   GET /api/campaigns
// @access  Private/Admin
export const listCampaigns = async (req, res) => {
  try {
    // html and text are excluded: a list of twenty campaigns would otherwise
    // ship several hundred KB of email markup nobody is looking at.
    const rows = await Campaign.find()
      .select('-html -text')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error('[campaigns] list failed:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    One campaign, including its markup
// @route   GET /api/campaigns/:id
// @access  Private/Admin
export const getCampaign = async (req, res) => {
  try {
    const row = await Campaign.findById(req.params.id).lean();
    if (!row) return res.status(404).json({ success: false, message: 'Campaign not found' });
    res.status(200).json({ success: true, data: row });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Create a campaign
// @route   POST /api/campaigns
// @access  Private/Admin
export const createCampaign = async (req, res) => {
  try {
    const invalid = validate(req.body);
    if (invalid) return res.status(400).json({ success: false, message: invalid });

    const doc = {};
    for (const f of EDITABLE) if (req.body[f] !== undefined) doc[f] = req.body[f];
    doc.createdBy = req.user._id;
    // New campaigns always start as drafts, whatever was posted. Creating
    // something already marked ready would skip the one human check there is.
    doc.status = 'draft';

    const created = await Campaign.create(doc);
    console.log(`[campaigns] created "${created.name}" by admin ${req.user._id}`);
    res.status(201).json({ success: true, data: created });
  } catch (error) {
    console.error('[campaigns] create failed:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Update a campaign
// @route   PUT /api/campaigns/:id
// @access  Private/Admin
export const updateCampaign = async (req, res) => {
  try {
    const invalid = validate(req.body);
    if (invalid) return res.status(400).json({ success: false, message: invalid });

    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });

    // A campaign that has already gone out is a record of what was sent.
    // Editing it would rewrite history and make the report describe an email
    // nobody received.
    if (campaign.status === 'sent') {
      return res.status(409).json({
        success: false,
        message: 'This campaign has already been sent and cannot be edited. Duplicate it instead.',
      });
    }

    const set = {};
    for (const f of EDITABLE) if (req.body[f] !== undefined) set[f] = req.body[f];

    const updated = await Campaign.findByIdAndUpdate(req.params.id, { $set: set }, { new: true });
    res.status(200).json({ success: true, data: updated });
  } catch (error) {
    console.error('[campaigns] update failed:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Duplicate a campaign
// @route   POST /api/campaigns/:id/duplicate
// @access  Private/Admin
export const duplicateCampaign = async (req, res) => {
  try {
    const source = await Campaign.findById(req.params.id).lean();
    if (!source) return res.status(404).json({ success: false, message: 'Campaign not found' });

    // The route back to editing something already sent, and the usual way a
    // recurring promotion gets reused.
    const { _id, createdAt, updatedAt, stats, lastRunAt, ...rest } = source;
    const copy = await Campaign.create({
      ...rest,
      name: `${source.name} (copia)`,
      status: 'draft',
      createdBy: req.user._id,
    });

    res.status(201).json({ success: true, data: copy });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Delete a campaign
// @route   DELETE /api/campaigns/:id
// @access  Private/Admin
export const deleteCampaign = async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });

    // Its CampaignSend rows are the record of who was emailed and are left
    // alone deliberately — they are also what makes a discount code valid for
    // its recipients, so deleting them would revoke live offers.
    if (campaign.status === 'sending') {
      return res.status(409).json({
        success: false,
        message: 'This campaign is sending. Pause it before deleting.',
      });
    }

    // Deleting the campaign would un-gate its discount code.
    //
    // checkCampaignDiscount enforces the per-recipient window by finding a
    // Campaign that claims the code. No campaign, no governance: the code
    // falls through to Stripe's own rules, and these codes are issued with no
    // redemption cap and no expiry because OUR window was the limit. So
    // deleting a finished campaign would quietly turn a 24-hour offer for a
    // handful of recipients into an unlimited public discount — with nothing
    // in the UI saying so.
    //
    // Refuse while the code is still live at Stripe. Deactivating it there is
    // one click and makes the intent explicit, rather than this endpoint
    // silently mutating billing configuration as a side effect of a delete.
    if (campaign.discountCode && campaign.discountValidHours) {
      let liveCode = null;
      try {
        const found = await stripe.promotionCodes.list({
          code: String(campaign.discountCode).trim().toUpperCase(),
          active: true,
          limit: 1,
        });
        liveCode = found.data[0] || null;
      } catch (e) {
        // Cannot verify — refuse rather than risk un-gating a live code.
        console.error(`[campaigns] delete blocked: could not check Stripe for ${campaign.discountCode}: ${e.message}`);
        return res.status(502).json({
          success: false,
          message: `Could not check whether ${campaign.discountCode} is still active at Stripe. Try again, or deactivate the code there first.`,
        });
      }

      if (liveCode) {
        return res.status(409).json({
          success: false,
          message:
            `${campaign.discountCode} is still active in Stripe, and this campaign is what limits it ` +
            `to ${campaign.discountValidHours}h per recipient. Deleting now would make it an unlimited ` +
            `public discount. Deactivate the code in Stripe first, then delete.`,
        });
      }
    }

    await Campaign.findByIdAndDelete(req.params.id);
    console.log(`[campaigns] deleted "${campaign.name}" by admin ${req.user._id}`);
    res.status(200).json({ success: true, message: 'Campaign deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Render the campaign as it will be received
// @route   GET /api/campaigns/:id/preview
// @access  Private/Admin
export const previewCampaign = async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id).lean();
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });

    if (!campaign.html) {
      return res
        .status(200)
        .type('html')
        .send('<div style="font-family:sans-serif;padding:40px;color:#666">This campaign has no HTML yet.</div>');
    }

    // Rendered through the same function a real send uses, so a preview cannot
    // drift from what recipients get. The admin's own id backs the unsubscribe
    // link, which is inert for them — admins are never campaign recipients.
    const { html } = render(campaign, {
      userId: req.user._id,
      name: req.user.name,
      email: req.user.email,
    });
    res.status(200).type('html').send(html);
  } catch (error) {
    console.error('[campaigns] preview failed:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Send this campaign to one named address
// @route   POST /api/campaigns/:id/test
// @access  Private/Admin
export const testCampaign = async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id).lean();
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });
    if (!campaign.html && !campaign.text) {
      return res.status(400).json({ success: false, message: 'Add some content before sending a test' });
    }

    const to = String(req.body?.email || '').trim();
    const address = checkEmailAddress(to);
    if (!address.ok) {
      return res.status(400).json({
        success: false,
        message: `${address.reason}${address.suggestion ? ` — did you mean ${address.suggestion}?` : ''}`,
      });
    }

    const { subject, html, text, unsubscribeUrl } = render(campaign, {
      userId: req.user._id,
      name: req.user.name,
      email: req.user.email,
    });

    const result = await sendEmail({
      to,
      subject,
      html,
      text,
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });

    if (result?.success === false) {
      return res.status(502).json({
        success: false,
        message: String(result.error?.message || 'The email provider rejected the send'),
      });
    }

    console.log(`[campaigns] test of "${campaign.name}" sent to ${to} by admin ${req.user._id}`);
    res.status(200).json({
      success: true,
      message: `Test sent to ${to}. No recipient was consumed and no send record was written.`,
    });
  } catch (error) {
    console.error('[campaigns] test send failed:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Send one bounded batch of this campaign
// @route   POST /api/campaigns/:id/send
// @access  Private/Admin
//
// One batch per call, not "send everything". A pass that tried to mail an
// entire audience in one request would hold an HTTP connection open for
// minutes, lose its place on any restart, and give an admin no way to stop it
// part way. Calling this repeatedly walks the audience, and each call reports
// how many remain.
export const sendCampaign = async (req, res) => {
  try {
    const report = await runCampaignPass(req.params.id, { dryRun: req.query.dryRun === '1' });
    res.status(200).json({ success: true, data: report });
  } catch (error) {
    // A refusal here is usually the status guard — a draft that has not been
    // marked ready. That is a message for the admin, not a server fault.
    const isGuard = /ready|no content|not found/i.test(error.message);
    console.error('[campaigns] send failed:', error.message);
    res.status(isGuard ? 400 : 500).json({ success: false, message: error.message });
  }
};

// @desc    Stop a send part way, or let it continue
// @route   POST /api/campaigns/:id/pause  |  /resume
// @access  Private/Admin
export const setCampaignPaused = (paused) => async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });

    if (paused && !['sending', 'ready'].includes(campaign.status)) {
      return res.status(409).json({ success: false, message: `Nothing to pause — campaign is "${campaign.status}"` });
    }
    if (!paused && campaign.status !== 'paused') {
      return res.status(409).json({ success: false, message: `Campaign is "${campaign.status}", not paused` });
    }

    // The sender re-reads status before every recipient, so a pause takes
    // effect within one send rather than at the end of the batch.
    campaign.status = paused ? 'paused' : 'sending';
    await campaign.save();

    console.log(`[campaigns] "${campaign.name}" ${paused ? 'paused' : 'resumed'} by admin ${req.user._id}`);
    res.status(200).json({ success: true, data: { status: campaign.status } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Per-recipient rows for a campaign, joined to the account.
 *
 * Conversion is read from the user's CURRENT subscription rather than written
 * at subscribe time. That needs no hook in the Stripe webhook path — the most
 * fragile code in this system and not worth touching for a report — and it
 * stays correct if someone subscribes through a route nobody thought to
 * instrument.
 */
async function buildReportRows(campaignId) {
  const sends = await CampaignSend.find({ campaign: String(campaignId) })
    .sort({ sentAt: -1 })
    .lean();

  if (!sends.length) return [];

  const users = await User.find({ _id: { $in: sends.map(s => s.userId) } })
    .select('email name subscription marketingOptOut')
    .lean();
  const byId = new Map(users.map(u => [String(u._id), u]));

  const plans = await SubscriptionPlan.find().select('planId price').lean();
  const priceOf = new Map(plans.map(p => [p.planId, p.price || 0]));

  return sends.map((s) => {
    const u = byId.get(String(s.userId));
    const sub = u?.subscription || {};
    const paid = (v) => v && v !== 'free';
    const subscribed = !!u && (paid(sub.planId) || paid(sub.plan));

    return {
      email: s.email,
      sentAt: s.sentAt,
      failed: !!s.failedAt,
      failureReason: s.failureReason || null,
      opened: !!s.openedAt,
      openedAt: s.openedAt,
      openCount: s.openCount || 0,
      clicked: !!s.clickedAt,
      clickedAt: s.clickedAt,
      clickCount: s.clickCount || 0,
      subscribed,
      // Only counted when they actually converted, and only at the plan's
      // list price — this is attribution, not billing, and it deliberately
      // ignores discounts, proration and refunds rather than pretending to
      // be a revenue figure it cannot be.
      planId: subscribed ? (sub.planId || sub.plan || null) : null,
      planPrice: subscribed ? (priceOf.get(sub.planId) ?? priceOf.get(sub.plan) ?? 0) : 0,
      optedOut: !!u?.marketingOptOut,
      accountDeleted: !u,
    };
  });
}

// @desc    Who received this campaign and what happened
// @route   GET /api/campaigns/:id/report
// @access  Private/Admin
export const campaignReport = async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id).select('name tracking stats').lean();
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });

    const rows = await buildReportRows(req.params.id);
    const delivered = rows.filter(r => !r.failed);
    const converted = delivered.filter(r => r.subscribed);
    const pct = (n, of) => (of ? Math.round((n / of) * 1000) / 10 : 0);

    res.status(200).json({
      success: true,
      data: {
        campaign: campaign.name,
        tracking: campaign.tracking || { opens: false, clicks: false },
        totals: {
          sent: delivered.length,
          failed: rows.length - delivered.length,
          opened: delivered.filter(r => r.opened).length,
          clicked: delivered.filter(r => r.clicked).length,
          subscribed: converted.length,
          optedOut: rows.filter(r => r.optedOut).length,
          openRate: pct(delivered.filter(r => r.opened).length, delivered.length),
          clickRate: pct(delivered.filter(r => r.clicked).length, delivered.length),
          conversionRate: pct(converted.length, delivered.length),
          attributedRevenue:
            Math.round(converted.reduce((sum, r) => sum + (r.planPrice || 0), 0) * 100) / 100,
        },
        rows,
      },
    });
  } catch (error) {
    console.error('[campaigns] report failed:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    The same report as CSV
// @route   GET /api/campaigns/:id/report.csv
// @access  Private/Admin
export const campaignReportCsv = async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id).select('name').lean();
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });

    const rows = await buildReportRows(req.params.id);

    const esc = (v) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const iso = (d) => (d ? new Date(d).toISOString() : '');

    const header = ['Email', 'Sent', 'Failed', 'Failure reason', 'Opened', 'Opens', 'Clicked', 'Clicks', 'Subscribed', 'Plan', 'Plan price', 'Opted out'];
    const lines = rows.map(r => [
      r.email, iso(r.sentAt), r.failed ? 'yes' : 'no', r.failureReason,
      r.opened ? iso(r.openedAt) : '', r.openCount,
      r.clicked ? iso(r.clickedAt) : '', r.clickCount,
      r.subscribed ? 'yes' : 'no', r.planId, r.planPrice || '',
      r.optedOut ? 'yes' : 'no',
    ].map(esc).join(','));

    const safeName = String(campaign.name).replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="campaign-${safeName}-${new Date().toISOString().slice(0, 10)}.csv"`);
    // CRLF and a BOM: Excel misreads UTF-8 without one, and Spanish accents
    // in a name arrive mangled.
    res.status(200).send('﻿' + [header.join(','), ...lines].join('\r\n'));
  } catch (error) {
    console.error('[campaigns] csv export failed:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    How many people this campaign would reach, and a sample
// @route   GET /api/campaigns/:id/audience
// @access  Private/Admin
export const previewAudience = async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id).lean();
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });

    // The same function the sender uses, not a second copy of the rules. Two
    // implementations of "who is in this audience" would drift, and the number
    // an admin approves has to be the number that actually gets mailed — this
    // codebase has already paid for that lesson with the access window.
    const query = buildAudienceQuery(campaign.audience);

    const [count, sample] = await Promise.all([
      User.countDocuments(query),
      User.find(query).select('email createdAt').sort({ createdAt: -1 }).limit(10).lean(),
    ]);

    res.status(200).json({
      success: true,
      data: { count, sample: sample.map(u => u.email) },
    });
  } catch (error) {
    console.error('[campaigns] audience preview failed:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};
