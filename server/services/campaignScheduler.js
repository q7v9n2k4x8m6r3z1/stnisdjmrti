/**
 * Runs automated campaigns on a timer.
 *
 * An automated campaign is the same object as a manual one, run periodically
 * instead of when an admin clicks Send. Its audience rules are the trigger:
 * "registered at least 24 hours ago, still free, never reached checkout" is
 * the welcome trigger, expressed once, in the same vocabulary the preview and
 * the sender already use.
 *
 * SAFETY
 *
 * Off globally unless CAMPAIGN_AUTOMATION_ENABLED is 'true'. A deploy cannot
 * start mailing people on its own, and one environment variable stops
 * everything without editing a campaign or restarting in a hurry.
 *
 * Off individually unless the campaign is BOTH automation.enabled AND status
 * 'ready'. A draft is never reachable, so an admin editing a half-written
 * automated campaign cannot have it go out mid-sentence.
 *
 * Only the designated cluster instance runs, like the reconciler — two PM2
 * workers would otherwise both mail the same audience.
 *
 * Each campaign is capped per run, independently of the batch size, so an
 * audience rule that matches far more people than intended costs a bounded
 * number of emails rather than the whole database.
 */
import Campaign from '../models/Campaign.js';
import { runCampaignPass } from './campaignSender.js';

const isEnabled = () =>
  String(process.env.CAMPAIGN_AUTOMATION_ENABLED || '').toLowerCase() === 'true';

/**
 * Campaigns due a run right now.
 *
 * Due-ness is computed from lastRunAt rather than tracked in a timer, so a
 * restart cannot lose the schedule or double-fire it: the database says when
 * each campaign last ran and that survives everything.
 */
async function findDue() {
  const campaigns = await Campaign.find({
    'automation.enabled': true,
    status: 'ready',
  })
    .select('name automation lastRunAt')
    .lean();

  const now = Date.now();
  return campaigns.filter((c) => {
    const every = Math.max(1, Number(c.automation?.intervalHours) || 1) * 3600 * 1000;
    if (!c.lastRunAt) return true;
    return now - new Date(c.lastRunAt).getTime() >= every;
  });
}

/**
 * One scheduler tick: run every campaign that is due.
 *
 * A campaign that throws does not stop the others — one broken audience rule
 * should not silently halt every other automation.
 */
export async function runAutomationTick({ dryRun = false } = {}) {
  const report = { checked: 0, ran: [], skipped: 0, errors: [] };

  if (!isEnabled() && !dryRun) {
    console.log('[campaign-automation] disabled (CAMPAIGN_AUTOMATION_ENABLED is not "true")');
    return report;
  }

  const due = await findDue();
  report.checked = due.length;

  if (!due.length) return report;

  for (const c of due) {
    try {
      const result = await runCampaignPass(c._id, { dryRun });
      report.ran.push({
        campaign: c.name,
        sent: result.sent,
        failed: result.failed,
        remaining: result.remaining,
        finished: result.finished,
      });

      // An automated campaign that has reached everyone should not flip to
      // 'sent' — its whole purpose is to keep catching people who qualify
      // later. runCampaignPass marks it sent when the audience empties, so
      // put it back to ready and let the schedule pick it up again.
      if (!dryRun && result.finished) {
        await Campaign.updateOne(
          { _id: c._id, status: 'sent' },
          { $set: { status: 'ready' } }
        );
      }
    } catch (err) {
      console.error(`[campaign-automation] "${c.name}" failed: ${err.message}`);
      report.errors.push({ campaign: c.name, error: err.message });
    }
  }

  const totalSent = report.ran.reduce((n, r) => n + r.sent, 0);
  console.log(
    `[campaign-automation] tick complete — ${report.checked} due, ${totalSent} sent` +
    `${report.errors.length ? `, ${report.errors.length} failed` : ''}${dryRun ? ' (DRY RUN)' : ''}`
  );
  return report;
}

/**
 * Schedule the tick. Mirrors the reconciler and the welcome campaign.
 */
export function startCampaignAutomation({ intervalMs = 15 * 60 * 1000, startupDelayMs = 4 * 60 * 1000 } = {}) {
  const instance = process.env.NODE_APP_INSTANCE;
  if (instance !== undefined && instance !== '0') {
    console.log(`[campaign-automation] instance ${instance} — not the designated runner, skipping`);
    return;
  }

  if (!isEnabled()) {
    console.log('[campaign-automation] not scheduled — CAMPAIGN_AUTOMATION_ENABLED is not "true"');
    return;
  }

  const run = () =>
    runAutomationTick().catch(e => console.error('[campaign-automation] tick failed:', e.message));

  // The tick runs every 15 minutes; each campaign's own intervalHours decides
  // whether it is actually due. A frequent tick with per-campaign due-ness is
  // what lets one campaign run hourly and another daily without two timers.
  setTimeout(run, startupDelayMs).unref?.();
  setInterval(run, intervalMs).unref?.();
  console.log(
    `[campaign-automation] scheduled — checking every ${Math.round(intervalMs / 60000)}m ` +
    `(first check in ${Math.round(startupDelayMs / 60000)}m)`
  );
}
