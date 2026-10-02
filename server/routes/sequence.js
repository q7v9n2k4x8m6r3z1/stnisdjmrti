import express from 'express';
import {
  listSequences,
  getSequence,
  createSequence,
  updateSequence,
  deleteSequence,
  sequenceAudience,
  runSequencesNow,
} from '../controllers/sequenceController.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

router.use(protect, authorize('admin'));

// Before /:id, or "run" would be read as a sequence id.
router.post('/run', runSequencesNow);

router.route('/')
  .get(listSequences)
  .post(createSequence);

router.route('/:id')
  .get(getSequence)
  .put(updateSequence)
  .delete(deleteSequence);

router.get('/:id/audience', sequenceAudience);

export default router;
