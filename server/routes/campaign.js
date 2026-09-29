import express from 'express';
import {
  listCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  duplicateCampaign,
  deleteCampaign,
  previewCampaign,
  testCampaign,
  previewAudience,
} from '../controllers/campaignController.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

// Admin only, every route. These read the user base and can send email.
router.use(protect, authorize('admin'));

router.route('/')
  .get(listCampaigns)
  .post(createCampaign);

router.route('/:id')
  .get(getCampaign)
  .put(updateCampaign)
  .delete(deleteCampaign);

router.post('/:id/duplicate', duplicateCampaign);

// Read-only: renders the email and reports who would receive it. Neither
// writes anything or contacts a recipient.
router.get('/:id/preview', previewCampaign);
router.get('/:id/audience', previewAudience);

// Sends to one named address only. No send record, no recipient consumed.
router.post('/:id/test', testCampaign);

export default router;
