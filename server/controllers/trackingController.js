/**
 * Open and click tracking endpoints.
 *
 * Both are public and unauthenticated by necessity — they are requested by a
 * mail client or a browser that has no session. The signed token is the
 * authorisation, and it is the only thing standing between these URLs and
 * either an open redirect or fabricated engagement data.
 *
 * Neither endpoint ever fails visibly. A tracking pixel that returns an error
 * shows a broken image in the middle of the email, and a click that errors
 * strands someone who was trying to reach the site. Both swallow problems and
 * do the useful thing anyway: serve the pixel, follow the link.
 */
import CampaignSend from '../models/CampaignSend.js';
import { readTrackingToken, isSafeRedirect } from '../utils/trackingToken.js';

// Smallest valid transparent GIF, 43 bytes.
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

function servePixel(res) {
  res.set({
    'Content-Type': 'image/gif',
    'Content-Length': String(PIXEL.length),
    // Without this a client caches the pixel and the second open never
    // reaches us — and proxies would serve one person's pixel to another.
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
    Expires: '0',
  });
  return res.status(200).end(PIXEL);
}

/**
 * @desc    Record an open
 * @route   GET /api/track/o/:token
 * @access  Public, authenticated by signed token
 */
export const trackOpen = async (req, res) => {
  // Serve the image whatever happens. A visibly broken pixel in a customer's
  // email is a worse outcome than a lost statistic.
  try {
    const parsed = readTrackingToken(req.params.token);
    if (parsed.ok) {
      // Pipeline update so the count and the first-seen timestamp are one
      // atomic write. $min would NOT work here: null sorts below a date in
      // MongoDB's ordering, so $min against an unset openedAt keeps the null
      // and the timestamp would never be recorded at all.
      await CampaignSend.updateOne(
        { campaign: parsed.campaignId, userId: parsed.userId },
        [{
          $set: {
            openCount: { $add: [{ $ifNull: ['$openCount', 0] }, 1] },
            // First open only. Later opens raise the count; the timestamp
            // stays the moment it was first seen, which is the useful one.
            openedAt: { $ifNull: ['$openedAt', '$$NOW'] },
          },
        }]
      ).catch(() => {});
    }
  } catch { /* never surface */ }

  return servePixel(res);
};

/**
 * @desc    Record a click and forward to the destination
 * @route   GET /api/track/c/:token
 * @access  Public, authenticated by signed token
 */
export const trackClick = async (req, res) => {
  const fallback = process.env.FRONTEND_URL || 'https://tododjs.com';

  try {
    const parsed = readTrackingToken(req.params.token);

    // An unsigned or tampered token means the destination cannot be trusted.
    // Send them to the site rather than anywhere the URL claims — this is the
    // open-redirect guard, and it has to come before anything else.
    if (!parsed.ok || !parsed.destination || !isSafeRedirect(parsed.destination)) {
      console.warn('[track] click rejected — bad token or unsafe destination');
      return res.redirect(302, fallback);
    }

    // Same pipeline form and the same reason as the open above.
    //
    // A click is a far stronger signal than an open: it proves a person acted,
    // not that a proxy fetched an image. Someone who clicked without a
    // recorded open simply had images blocked, which is common — so clicks
    // exceeding opens is normal rather than a fault.
    await CampaignSend.updateOne(
      { campaign: parsed.campaignId, userId: parsed.userId },
      [{
        $set: {
          clickCount: { $add: [{ $ifNull: ['$clickCount', 0] }, 1] },
          clickedAt: { $ifNull: ['$clickedAt', '$$NOW'] },
        },
      }]
    ).catch(() => {});

    return res.redirect(302, parsed.destination);
  } catch (err) {
    console.error('[track] click failed:', err.message);
    return res.redirect(302, fallback);
  }
};
