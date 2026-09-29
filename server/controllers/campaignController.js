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
import User from '../models/User.js';
import { sendEmail } from '../services/emailService.js';
import { buildUnsubscribeUrl } from '../utils/unsubscribeToken.js';
import { checkEmailAddress } from '../utils/emailAddress.js';

/** Fields an admin may set. Anything else in the body is ignored. */
const EDITABLE = [
  'name', 'subject', 'preheader', 'html', 'text',
  'audience', 'discountCode', 'discountValidHours', 'status',
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

// @desc    How many people this campaign would reach, and a sample
// @route   GET /api/campaigns/:id/audience
// @access  Private/Admin
export const previewAudience = async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id).lean();
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });

    const a = campaign.audience || {};
    const now = Date.now();
    const NOT_PAID = { $in: [null, '', 'free'] };

    const query = {
      role: { $ne: 'admin' },
      isActive: { $ne: false },
      isBlocked: { $ne: true },
      // Never offer an audience that includes people who have opted out. The
      // count an admin sees has to be the count that could actually be mailed.
      marketingOptOut: { $ne: true },
    };

    if (a.minAccountAgeHours) {
      query.createdAt = { $lte: new Date(now - a.minAccountAgeHours * 3600 * 1000) };
    }
    if (a.registeredWithinDays) {
      query.createdAt = {
        ...(query.createdAt || {}),
        $gte: new Date(now - a.registeredWithinDays * 86400 * 1000),
      };
    }

    if (a.segment === 'free') {
      query['subscription.planId'] = NOT_PAID;
      query['subscription.plan'] = NOT_PAID;
    } else if (a.segment === 'paid') {
      query['subscription.status'] = 'active';
      query['subscription.planId'] = { $nin: [null, '', 'free'] };
    } else if (a.segment === 'cancelled') {
      query['subscription.status'] = 'cancelled';
    }

    if (a.excludeStripeHistory) {
      query['subscription.stripeCustomerId'] = { $in: [null, ''] };
      query['subscription.stripeSubscriptionId'] = { $in: [null, ''] };
      query['subscriptionHistory.0'] = { $exists: false };
    }

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
