/**
 * Sequence management for the admin panel.
 *
 * Steps reference Campaigns, so everything a step needs — content, tracking,
 * discount code, preview, test send — is edited in the campaign editor that
 * already exists. This surface is only about order, timing and who enters.
 */
import Sequence from '../models/Sequence.js';
import SequenceEnrollment from '../models/SequenceEnrollment.js';
import Campaign from '../models/Campaign.js';
import User from '../models/User.js';
import { buildAudienceQuery } from '../services/campaignSender.js';
import { runSequenceTick } from '../services/sequenceEngine.js';

const EDITABLE = ['name', 'audience', 'steps', 'status', 'maxPerRun'];
const STATUSES = ['draft', 'active', 'paused'];

function validate(body) {
  if (body.name !== undefined && !String(body.name).trim()) return 'Give the sequence a name';
  if (body.status !== undefined && !STATUSES.includes(body.status)) return 'Unknown status';
  if (body.steps !== undefined) {
    if (!Array.isArray(body.steps)) return 'Steps must be a list';
    for (const [i, s] of body.steps.entries()) {
      if (!s?.campaignId) return `Step ${i + 1} has no email selected`;
      const h = Number(s.delayHours);
      if (!Number.isFinite(h) || h < 0) return `Step ${i + 1} has an invalid delay`;
    }
  }
  return null;
}

// @desc    List sequences with their enrolment counts
// @route   GET /api/sequences
// @access  Private/Admin
export const listSequences = async (req, res) => {
  try {
    const rows = await Sequence.find().sort({ createdAt: -1 }).limit(100).lean();

    // One grouped query rather than three per sequence.
    const counts = await SequenceEnrollment.aggregate([
      { $match: { sequence: { $in: rows.map(r => r._id) } } },
      { $group: { _id: { sequence: '$sequence', status: '$status' }, n: { $sum: 1 } } },
    ]);

    const byId = new Map();
    for (const c of counts) {
      const key = String(c._id.sequence);
      const entry = byId.get(key) || { active: 0, completed: 0, exited: 0 };
      entry[c._id.status] = c.n;
      byId.set(key, entry);
    }

    res.status(200).json({
      success: true,
      data: rows.map(r => ({
        ...r,
        enrollments: byId.get(String(r._id)) || { active: 0, completed: 0, exited: 0 },
      })),
    });
  } catch (error) {
    console.error('[sequences] list failed:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    One sequence, with its steps resolved to campaign names
// @route   GET /api/sequences/:id
// @access  Private/Admin
export const getSequence = async (req, res) => {
  try {
    const row = await Sequence.findById(req.params.id).lean();
    if (!row) return res.status(404).json({ success: false, message: 'Sequence not found' });

    const campaigns = await Campaign.find({ _id: { $in: (row.steps || []).map(s => s.campaignId) } })
      .select('name subject')
      .lean();
    const byId = new Map(campaigns.map(c => [String(c._id), c]));

    res.status(200).json({
      success: true,
      data: {
        ...row,
        steps: (row.steps || []).map(s => ({
          ...s,
          campaignName: byId.get(String(s.campaignId))?.name || null,
          campaignSubject: byId.get(String(s.campaignId))?.subject || null,
          // Surfaced rather than silently skipped: a step pointing at a
          // deleted campaign stops everyone who reaches it.
          missing: !byId.has(String(s.campaignId)),
        })),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Create a sequence
// @route   POST /api/sequences
// @access  Private/Admin
export const createSequence = async (req, res) => {
  try {
    const invalid = validate(req.body);
    if (invalid) return res.status(400).json({ success: false, message: invalid });

    const doc = {};
    for (const f of EDITABLE) if (req.body[f] !== undefined) doc[f] = req.body[f];
    doc.createdBy = req.user._id;
    // Always a draft, whatever was posted — creating something already active
    // would skip the only approval step there is.
    doc.status = 'draft';

    const created = await Sequence.create(doc);
    console.log(`[sequences] created "${created.name}" by admin ${req.user._id}`);
    res.status(201).json({ success: true, data: created });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Update a sequence
// @route   PUT /api/sequences/:id
// @access  Private/Admin
export const updateSequence = async (req, res) => {
  try {
    const invalid = validate(req.body);
    if (invalid) return res.status(400).json({ success: false, message: invalid });

    const sequence = await Sequence.findById(req.params.id);
    if (!sequence) return res.status(404).json({ success: false, message: 'Sequence not found' });

    // Reordering or removing steps while people are part way through would
    // move them to a different email than the one their position refers to —
    // someone on step 2 would receive whatever now occupies that slot.
    if (req.body.steps !== undefined && sequence.status === 'active') {
      const live = await SequenceEnrollment.countDocuments({ sequence: sequence._id, status: 'active' });
      if (live > 0) {
        return res.status(409).json({
          success: false,
          message: `${live} people are part way through this sequence. Pause it before changing the steps.`,
        });
      }
    }

    const set = {};
    for (const f of EDITABLE) if (req.body[f] !== undefined) set[f] = req.body[f];

    const updated = await Sequence.findByIdAndUpdate(req.params.id, { $set: set }, { new: true });
    res.status(200).json({ success: true, data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Delete a sequence
// @route   DELETE /api/sequences/:id
// @access  Private/Admin
export const deleteSequence = async (req, res) => {
  try {
    const sequence = await Sequence.findById(req.params.id);
    if (!sequence) return res.status(404).json({ success: false, message: 'Sequence not found' });

    if (sequence.status === 'active') {
      return res.status(409).json({ success: false, message: 'Pause the sequence before deleting it.' });
    }

    // Enrollments go too — they only mean anything in the context of this
    // sequence. CampaignSend rows are left alone: they are the record of what
    // was actually emailed, and they are what keeps issued discount codes
    // valid for their recipients.
    await SequenceEnrollment.deleteMany({ sequence: sequence._id });
    await Sequence.findByIdAndDelete(req.params.id);

    console.log(`[sequences] deleted "${sequence.name}" by admin ${req.user._id}`);
    res.status(200).json({ success: true, message: 'Sequence deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    How many people would enter this sequence
// @route   GET /api/sequences/:id/audience
// @access  Private/Admin
export const sequenceAudience = async (req, res) => {
  try {
    const sequence = await Sequence.findById(req.params.id).lean();
    if (!sequence) return res.status(404).json({ success: false, message: 'Sequence not found' });

    const query = buildAudienceQuery(sequence.audience);
    const [count, alreadyEnrolled] = await Promise.all([
      User.countDocuments(query),
      SequenceEnrollment.countDocuments({ sequence: sequence._id }),
    ]);

    res.status(200).json({ success: true, data: { count, alreadyEnrolled } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Run one tick immediately, for testing
// @route   POST /api/sequences/run
// @access  Private/Admin
export const runSequencesNow = async (req, res) => {
  try {
    const report = await runSequenceTick({ dryRun: req.query.dryRun === '1' });
    res.status(200).json({ success: true, data: report });
  } catch (error) {
    console.error('[sequences] manual run failed:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};
