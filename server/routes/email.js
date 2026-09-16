import express from 'express';
import { unsubscribe } from '../controllers/emailController.js';

const router = express.Router();

// Public and unauthenticated on purpose — the signed token in the query is the
// authorisation. GET is the human clicking the link in the email; POST is the
// one-click opt-out mail clients issue when they see List-Unsubscribe-Post.
router.get('/unsubscribe', unsubscribe);
router.post('/unsubscribe', unsubscribe);

export default router;
