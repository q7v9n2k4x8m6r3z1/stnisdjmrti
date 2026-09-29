import express from 'express';
import { trackOpen, trackClick } from '../controllers/trackingController.js';

const router = express.Router();

// Public and unauthenticated by necessity: these are requested by a mail
// client or a browser with no session. The signed token is the authorisation.
router.get('/o/:token', trackOpen);
router.get('/c/:token', trackClick);

export default router;
