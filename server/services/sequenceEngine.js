/**
 * Runs email sequences: enrol people who qualify, then walk them through the
 * steps over days.
 *
 * TWO JOBS, ONE TICK
 *
 * Enrolment finds people who match the audience and are not already enrolled.
 * Advancement finds enrollments whose next step is due and sends it.
 *
 * THE AUDIENCE IS THE EXIT CONDITION
 *
 * Before every step, the person is re-checked against the sequence's audience.
 * Someone who subscribed after step one no longer matches "still free" and
 * exits. There is no second condition language to keep in agreement with the
 * first — which is what stops a customer receiving "you haven't subscribed
 * yet" the day after they paid.
 *
 * Suppression is checked immediately before each send too, not at enrolment.
 * A sequence runs over days; somebody can unsubscribe on day two of a
 * fourteen-day sequence and must not receive day three.
 *
 * SAFETY
 *
 * Off unless CAMPAIGN_AUTOMATION_ENABLED is 'true' — the same switch as the
 * campaign scheduler, so one variable stops all automated mail. A sequence
 * must additionally be 'active'; a draft never sends. Capped per tick. One
 * designated cluster instance, like every other scheduled job here.
 */
import Sequence from '../models/Sequence.js';
import SequenceEnrollment from '../models/SequenceEnrollment.js';
import Campaign from '../models/Campaign.js';
import Suppression from '../models/Suppression.js';
import User from '../models/User.js';
import { buildAudienceQuery, deliverToUser } from './campaignSender.js';

const SEND_INTERVAL_MS = 600;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const isEnabled = () =>
  String(process.env.CAMPAIGN_AUTOMATION_ENABLED || '').toLowerCase() === 'true';

/**
 * Enrol people who match the audience and are not already in this sequence.
 *
 * The unique index is the real guarantee — two overlapping ticks could both
 * pass a "not already enrolled" check — so duplicates are caught on write and
 * treated as "someone else got there first" rather than an error.
 */
async function enrol(sequence, limit) {
  const candidates = await User.find(buildAudienceQuery(sequence.audience))
    .select('_id email')
    .sort({ createdAt: 1 })
    .limit(limit * 4)
    .lean();

  if (!candidates.length) return 0;

  const existing = await SequenceEnrollment.find({
    sequence: sequence._id,
    userId: { $in: candidates.map(u => u._id) },
  }).select('userId').lean();

  const enrolled = new Set(existing.map(e => String(e.userId)));
  const fresh = candidates.filter(u => !enrolled.has(String(u._id))).slice(0, limit);

  let added = 0;
  for (const u of fresh) {
    try {
      // Due immediately: the audience's minAccountAgeHours is already the
      // entry delay, and applying the first step's delay on top would silently
      // double the wait an admin configured.
      await SequenceEnrollment.create({
        sequence: sequence._id, userId: u._id, email: u.email,
        currentStep: 0, nextDueAt: new Date(),
      });
      added++;
    } catch (err) {
      if (err?.code !== 11000) {
        console.error(`[sequence] could not enrol ${u.email}: ${err.message}`);
      }
    }
  }
  return added;
}

/** Send the due step for one enrollment and move it along. */
async function advanceOne(sequence, enrollment, campaignsById) {
  const step = sequence.steps[enrollment.currentStep];
  if (!step) {
    await SequenceEnrollment.updateOne(
      { _id: enrollment._id },
      { $set: { status: 'completed' } }
    );
    return 'completed';
  }

  // Still in the audience? This is the exit condition, evaluated fresh rather
  // than remembered from enrolment — days may have passed.
  const stillMatches = await User.findOne({
    _id: enrollment.userId,
    ...buildAudienceQuery(sequence.audience),
  }).select('_id email name').lean();

  if (!stillMatches) {
    await SequenceEnrollment.updateOne(
      { _id: enrollment._id },
      {
        $set: {
          status: 'exited', exitedAt: new Date(),
          exitReason: 'no longer matches the audience',
        },
      }
    );
    return 'exited';
  }

  // Suppression last, and separately: someone may have unsubscribed mid-way
  // through a sequence that runs over days.
  const suppressed = await Suppression.filterSuppressed([stillMatches.email]);
  if (suppressed.has(String(stillMatches.email).toLowerCase())) {
    await SequenceEnrollment.updateOne(
      { _id: enrollment._id },
      { $set: { status: 'exited', exitedAt: new Date(), exitReason: 'unsubscribed or bounced' } }
    );
    return 'exited';
  }

  const campaign = campaignsById.get(String(step.campaignId));
  if (!campaign) {
    // A step pointing at a deleted campaign stops that person rather than the
    // whole sequence, and says so in the record.
    await SequenceEnrollment.updateOne(
      { _id: enrollment._id },
      { $set: { status: 'exited', exitedAt: new Date(), exitReason: 'step campaign is missing' } }
    );
    return 'exited';
  }

  const outcome = await deliverToUser(campaign, stillMatches);

  // Advance whatever the outcome. A permanently undeliverable address should
  // not hold its position and be retried on every tick forever; deliverToUser
  // has already recorded why it failed.
  const nextIndex = enrollment.currentStep + 1;
  const nextStep = sequence.steps[nextIndex];

  await SequenceEnrollment.updateOne(
    { _id: enrollment._id },
    nextStep
      ? {
          $set: {
            currentStep: nextIndex,
            nextDueAt: new Date(Date.now() + (Number(nextStep.delayHours) || 0) * 3600 * 1000),
          },
        }
      : { $set: { currentStep: nextIndex, status: 'completed' } }
  );

  return outcome;
}

/**
 * One tick across every active sequence.
 */
export async function runSequenceTick({ dryRun = false } = {}) {
  const report = { sequences: 0, enrolled: 0, sent: 0, exited: 0, completed: 0, failed: 0, dryRun };

  if (!isEnabled() && !dryRun) {
    console.log('[sequence] disabled (CAMPAIGN_AUTOMATION_ENABLED is not "true")');
    return report;
  }

  const sequences = await Sequence.find({ status: 'active' }).lean();
  report.sequences = sequences.length;

  for (const sequence of sequences) {
    if (!sequence.steps?.length) continue;

    const limit = Math.max(1, Number(sequence.maxPerRun) || 50);

    try {
      if (!dryRun) report.enrolled += await enrol(sequence, limit);

      const due = await SequenceEnrollment.find({
        sequence: sequence._id,
        status: 'active',
        nextDueAt: { $lte: new Date() },
      })
        .sort({ nextDueAt: 1 })
        .limit(limit)
        .lean();

      if (dryRun) {
        report.sent += due.length;
        continue;
      }

      // Loaded once for the whole batch rather than per enrollment.
      const campaigns = await Campaign.find({
        _id: { $in: sequence.steps.map(s => s.campaignId) },
      }).lean();
      const campaignsById = new Map(campaigns.map(c => [String(c._id), c]));

      let sendIndex = 0;
      for (const enrollment of due) {
        // Re-read so pausing a sequence takes effect within one recipient.
        const live = await Sequence.findById(sequence._id).select('status').lean();
        if (live?.status !== 'active') {
          console.log(`[sequence] "${sequence.name}" no longer active — stopping`);
          break;
        }

        if (sendIndex > 0) await sleep(SEND_INTERVAL_MS);
        sendIndex++;

        const outcome = await advanceOne(sequence, enrollment, campaignsById);
        if (outcome === 'sent') report.sent++;
        else if (outcome === 'exited') report.exited++;
        else if (outcome === 'completed') report.completed++;
        else if (outcome === 'failed' || outcome === 'invalid') report.failed++;
      }

      await Sequence.updateOne({ _id: sequence._id }, { $set: { lastRunAt: new Date() } });
    } catch (err) {
      // One broken sequence must not stop the others.
      console.error(`[sequence] "${sequence.name}" failed: ${err.message}`);
    }
  }

  console.log(
    `[sequence] tick — ${report.sequences} active, enrolled ${report.enrolled}, ` +
    `sent ${report.sent}, exited ${report.exited}, completed ${report.completed}` +
    `${dryRun ? ' (DRY RUN)' : ''}`
  );
  return report;
}

export function startSequenceEngine({ intervalMs = 15 * 60 * 1000, startupDelayMs = 5 * 60 * 1000 } = {}) {
  const instance = process.env.NODE_APP_INSTANCE;
  if (instance !== undefined && instance !== '0') {
    console.log(`[sequence] instance ${instance} — not the designated runner, skipping`);
    return;
  }
  if (!isEnabled()) {
    console.log('[sequence] not scheduled — CAMPAIGN_AUTOMATION_ENABLED is not "true"');
    return;
  }

  const run = () => runSequenceTick().catch(e => console.error('[sequence] tick failed:', e.message));
  setTimeout(run, startupDelayMs).unref?.();
  setInterval(run, intervalMs).unref?.();
  console.log(`[sequence] scheduled — checking every ${Math.round(intervalMs / 60000)}m`);
}
