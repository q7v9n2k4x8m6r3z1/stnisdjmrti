import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import connectDB from './config/db.js';

// Load env vars
dotenv.config();

// Connect to database
connectDB();

// Route files
import authRoutes from './routes/auth.js';
import paymentRoutes from './routes/payment.js';
import sourceRoutes from './routes/source.js';
import albumRoutes from './routes/album.js';
import downloadRoutes from './routes/download.js';
import trackRoutes from './routes/track.js';
import collectionRoutes from './routes/collection.js';
import datePackRoutes from './routes/datePack.js';
import searchRoutes from './routes/search.js';
import uploadStatusRoutes from './routes/uploadStatus.js';
import userRoutes from './routes/user.js';
import analyticsRoutes from './routes/analytics.js';
import settingsRoutes from './routes/settings.js';
import adminRoutes from './routes/admin.js';
import favoriteRoutes from './routes/favorites.js';
import mashupRoutes from './routes/mashup.js';
import subscriptionRoutes from './routes/subscriptions.js';
import stripeRoutes from './routes/stripe.js';
import deviceRoutes from './routes/device.js';
import categoryRoutes from './routes/category.js';
import mashupCategoryRoutes from './routes/mashupCategory.js';
import contactRoutes from './routes/contact.js';
import emailRoutes from './routes/email.js';
import campaignRoutes from './routes/campaign.js';
import emailWebhookRoutes from './routes/webhookEmail.js';
import trackingRoutes from './routes/tracking.js';
import couponRoutes from './routes/coupon.js';
import mongoose from 'mongoose';
import { startSubscriptionReconciler } from './services/subscriptionReconciler.js';
import { startAccessDriftMonitor } from './services/accessDriftMonitor.js';
import { startWelcomeCampaign } from './services/welcomeCampaign.js';
import { startCampaignAutomation } from './services/campaignScheduler.js';
import { startTempSweeper } from './utils/tempCleanup.js';
import { recoverOrphanedJobs } from './services/processingQueue.js';

const app = express();

// Trust proxy - required when behind Nginx reverse proxy
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());

// Rate limiting
const limiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 1000 // limit each IP to 1000 requests per windowMs
});
app.use('/api/', limiter);

// CORS - Allow frontend and browser preview proxies
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      'http://localhost:5173',
      'https://tododjs.com',
      'https://www.tododjs.com',
      'https://api.tododjs.com',
      /^http:\/\/127\.0\.0\.1:\d+$/,  // Allow any port on 127.0.0.1 for browser preview
      /^http:\/\/192\.168\.\d{1,3}\.\d{1,3}:\d+$/,  // Allow LAN dev (common Vite "Network" URL)
      /^http:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+$/,  // Allow LAN dev (10/8)
      /^http:\/\/172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}:\d+$/,  // Allow LAN dev (172.16/12)
      /^https?:\/\/(.*\.)?tododjs\.com$/  // Allow all tododjs.com subdomains
    ];
    
    const isAllowed = allowedOrigins.some(allowed => {
      if (typeof allowed === 'string') {
        return allowed === origin;
      } else if (allowed instanceof RegExp) {
        return allowed.test(origin);
      }
      return false;
    });
    
    if (isAllowed) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// Body parser.
// Skip by CONTENT-TYPE, not by URL: the Stripe webhook needs its raw body for
// signature verification, and multipart/form-data uploads are parsed by multer
// per-route. Everything else (including JSON bodies on /api/albums,
// /api/collections, etc. — bulk-category, bulk-assign, bulk delete) must be
// JSON-parsed here, otherwise req.body is undefined and those routes throw.
// (The previous URL-based skip disabled JSON parsing for every /api/albums
// route, which is why bulk category assignment failed.)
app.use((req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  if (req.originalUrl === '/api/stripe/webhook' ||
      req.originalUrl === '/api/webhooks/resend' ||
      contentType.includes('multipart/form-data')) {
    return next();
  }
  express.json({ limit: '50mb' })(req, res, next);
});

// Cookie parser
app.use(cookieParser());

// Disable socket timeout for upload routes
app.use((req, res, next) => {
  if (req.originalUrl.includes('/api/collections') || 
      req.originalUrl.includes('/api/albums/upload') ||
      req.originalUrl.startsWith('/api/tracks/upload')) {
    req.setTimeout(0);
    res.setTimeout(0);
    if (req.socket) req.socket.setTimeout(0);
  }
  next();
});

// Request logging middleware (dev only)
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    console.log(`\n📨 ${req.method} ${req.originalUrl}`);
    console.log('Headers:', {
      'content-type': req.headers['content-type'],
      'authorization': req.headers['authorization'] ? 'Bearer ***' : 'none'
    });
    next();
  });
}

// Mount routers
app.use('/api/auth', authRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/sources', sourceRoutes);
app.use('/api/albums', albumRoutes);
app.use('/api/downloads', downloadRoutes);
app.use('/api/tracks', trackRoutes);
app.use('/api/collections', collectionRoutes);
app.use('/api/date-packs', datePackRoutes);
app.use('/api/upload-status', uploadStatusRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/users', userRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/favorites', favoriteRoutes);
app.use('/api/mashups', mashupRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/stripe', stripeRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/mashup-categories', mashupCategoryRoutes);
app.use('/api/contact', contactRoutes);
// Public and unauthenticated — the unsubscribe link is signed, and the person
// clicking it is reading an email, not signed in.
app.use('/api/email', emailRoutes);
// Admin-only throughout. Nothing here can bulk-send yet — create, preview and
// test only, until suppression and bounce handling are in place.
app.use('/api/campaigns', campaignRoutes);
// Public, authenticated by Svix signature. Bounces and complaints land here
// and populate the suppression list.
app.use('/api/webhooks', emailWebhookRoutes);
// Open pixel and click redirects. Public — requested by mail clients with no
// session — and authenticated by the signed token in the path.
app.use('/api/track', trackingRoutes);
app.use('/api/coupons', couponRoutes);

// Health check.
// Reports real state rather than just "the process answered": it previously
// returned 200 even with the database down, so an uptime monitor would have
// seen nothing wrong during the outages that disabled the Stripe webhook.
// Returns 503 when unhealthy so a monitor actually alerts.
let lastLoopCheck = Date.now();
let eventLoopLagMs = 0;
setInterval(() => {
  const now = Date.now();
  eventLoopLagMs = Math.max(0, now - lastLoopCheck - 1000);
  lastLoopCheck = now;
}, 1000).unref?.();

app.get('/api/health', (req, res) => {
  // 1 = connected (mongoose readyState)
  const dbConnected = mongoose.connection?.readyState === 1;
  // Sustained lag means CPU work is starving the event loop — the condition
  // that timed out Stripe webhooks and stalled uploads.
  const loopBlocked = eventLoopLagMs > 5000;
  const healthy = dbConnected && !loopBlocked;

  res.status(healthy ? 200 : 503).json({
    success: healthy,
    message: healthy ? 'TodoDJS API is running' : 'TodoDJS API is degraded',
    checks: {
      database: dbConnected ? 'connected' : 'disconnected',
      eventLoopLagMs,
      eventLoop: loopBlocked ? 'blocked' : 'ok',
    },
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || 'Server Error'
  });
});

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
  // Webhook-independent safety net: repairs any account whose Stripe
  // subscription is active but whose local record disagrees (missed webhooks,
  // disabled endpoint, downtime). See services/subscriptionReconciler.js.
  startSubscriptionReconciler();
  // The reverse question the reconciler structurally cannot ask: which accounts
  // does OUR record grant that Stripe was never paid for? Reports only — never
  // revokes. See services/accessDriftMonitor.js.
  startAccessDriftMonitor();
  // BIENVENIDA10 win-back email. Off unless WELCOME_CAMPAIGN_ENABLED is
  // explicitly 'true', so a deploy cannot start mailing customers by itself.
  startWelcomeCampaign();
  // Admin-created automated campaigns. Off unless CAMPAIGN_AUTOMATION_ENABLED
  // is explicitly 'true', and each campaign must additionally be marked ready.
  startCampaignAutomation();
  // Remove upload temp files orphaned by a crash or restart (23 GB had
  // accumulated in production). Runs now and every 6h.
  startTempSweeper();
  // Fail uploads left "Server queue — waiting" forever by a previous restart.
  recoverOrphanedJobs();
});

// Per-route req.setTimeout(0) already handles upload timeouts.
// Setting keepAliveTimeout=0 globally was killing HTTP connection reuse for ALL
// requests (Nginx had to open a new TCP connection to Node on every API call).
server.timeout = 0;
server.keepAliveTimeout = 65000; // match Nginx keepalive_timeout (65 s) — enables connection reuse
server.headersTimeout = 66000;   // must be slightly above keepAliveTimeout
server.requestTimeout = 0;

// Handle unhandled promise rejections — log but do NOT crash in production
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err?.stack || err?.message || err);
  if (process.env.NODE_ENV !== 'production') {
    server.close(() => process.exit(1));
  }
});

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err?.stack || err?.message || err);
  server.close(() => process.exit(1));
});

export default app;
