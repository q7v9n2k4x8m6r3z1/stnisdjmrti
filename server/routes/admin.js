import express from 'express';
import { getOverview } from '../controllers/adminController.js';
import { protect, authorize } from '../middleware/auth.js';
import { reconcileSubscriptions } from '../services/subscriptionReconciler.js';
import { detectAccessDrift } from '../services/accessDriftMonitor.js';
import {
  runWelcomeCampaignPass,
  renderCampaignEmail,
  sendCampaignTest,
  CAMPAIGN,
} from '../services/welcomeCampaign.js';
import CampaignSend from '../models/CampaignSend.js';
import User from '../models/User.js';

const router = express.Router();

router.get('/overview', protect, authorize('admin'), getOverview);

// Manually trigger a Stripe->DB subscription reconciliation. The job also runs
// on a timer, but this lets an admin resolve a "I paid and I'm still on Free"
// complaint immediately instead of waiting for the next scheduled pass.
// ?dryRun=1 reports what would change without writing.
router.post('/reconcile-subscriptions', protect, authorize('admin'), async (req, res) => {
  try {
    const report = await reconcileSubscriptions({ dryRun: req.query.dryRun === '1' });
    res.status(200).json({ success: true, data: report });
  } catch (error) {
    console.error('[reconcile-subscriptions]', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// The reverse of reconcile: which accounts does our record grant that Stripe
// was never paid for? Read-only — it reports and never revokes. The scheduled
// job runs this daily; this endpoint is for looking on demand.
router.get('/access-drift', protect, authorize('admin'), async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
    const report = await detectAccessDrift({ limit });
    res.status(200).json({ success: true, data: report });
  } catch (error) {
    console.error('[access-drift]', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Who received the BIENVENIDA10 email and whether they subscribed afterwards.
//
// Conversion is read from the user's current plan rather than written at
// subscribe time: it needs no hook in the webhook path, which is the most
// fragile code in this system and not worth touching for a report.
router.get('/campaign/bienvenida10', protect, authorize('admin'), async (req, res) => {
  try {
    const sends = await CampaignSend.find({ campaign: CAMPAIGN }).sort({ sentAt: -1 }).lean();
    const users = await User.find({ _id: { $in: sends.map(s => s.userId) } })
      .select('email subscription marketingOptOut')
      .lean();
    const byId = new Map(users.map(u => [String(u._id), u]));

    const isPaid = (u) => {
      const s = u?.subscription || {};
      const paid = (v) => v && v !== 'free';
      return paid(s.planId) || paid(s.plan);
    };

    const rows = sends.map(s => {
      const u = byId.get(String(s.userId));
      return {
        email: s.email,
        sentAt: s.sentAt,
        failed: !!s.failedAt,
        failureReason: s.failureReason || null,
        subscribed: !!u && isPaid(u),
        optedOut: !!u?.marketingOptOut,
        accountDeleted: !u,
      };
    });

    const delivered = rows.filter(r => !r.failed);
    const converted = delivered.filter(r => r.subscribed);

    res.status(200).json({
      success: true,
      data: {
        totals: {
          sent: delivered.length,
          failed: rows.length - delivered.length,
          subscribed: converted.length,
          optedOut: rows.filter(r => r.optedOut).length,
          conversionRate: delivered.length
            ? Math.round((converted.length / delivered.length) * 1000) / 10
            : 0,
        },
        rows,
      },
    });
  } catch (error) {
    console.error('[campaign] report failed:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Preview the next pass without sending anything. The only safe way to see
// who would be emailed before enabling the campaign.
router.post('/campaign/bienvenida10/preview', protect, authorize('admin'), async (req, res) => {
  try {
    const report = await runWelcomeCampaignPass({ dryRun: true });
    res.status(200).json({ success: true, data: report });
  } catch (error) {
    console.error('[campaign] preview failed:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// See the email exactly as a recipient would, in a browser tab.
//
// Rendered through the same function the real send uses, so it cannot drift
// from what customers actually receive. Writes nothing.
//
// Caveat worth knowing: a browser is not a mail client. Outlook ignores the
// background textures and falls back to flat colour — intentional, per the
// designer — and only a real send shows that. Use the test endpoint for it.
router.get('/campaign/bienvenida10/preview-html', protect, authorize('admin'), async (req, res) => {
  try {
    // The admin's own id, so the unsubscribe link in the preview is real and
    // clickable. Harmless: admins are excluded from the campaign by role, so
    // opting out changes nothing for them.
    const { html } = renderCampaignEmail(req.user._id);
    res.status(200).type('html').send(html);
  } catch (error) {
    console.error('[campaign] preview-html failed:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Send the campaign email to one named address to check it in a real inbox.
//
// Bypasses the candidate query entirely and records no CampaignSend row: a
// test must not consume a recipient, and must not make the discount code live
// for anyone. The address is validated first, so a typo here fails loudly
// rather than bouncing.
router.post('/campaign/bienvenida10/test', protect, authorize('admin'), async (req, res) => {
  try {
    const to = String(req.body?.email || '').trim();
    if (!to) {
      return res.status(400).json({ success: false, message: 'Provide an email address to send the test to' });
    }

    const result = await sendCampaignTest({ to, userId: req.user._id });
    if (!result.ok) {
      return res.status(400).json({ success: false, message: result.message });
    }

    res.status(200).json({
      success: true,
      message: `Test email sent to ${to}. No campaign record was written and no recipient was consumed.`,
    });
  } catch (error) {
    console.error('[campaign] test send failed:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
