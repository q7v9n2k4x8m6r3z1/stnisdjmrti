import express from 'express';
import { handleResendWebhook } from '../controllers/webhookEmailController.js';

const router = express.Router();

// express.raw, like the Stripe webhook: the signature covers the exact bytes
// received, so parsing and re-serialising would break verification.
router.post('/resend', express.raw({ type: 'application/json' }), handleResendWebhook);

export default router;
