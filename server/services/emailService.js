import { Resend } from 'resend';
import {
  getWelcomeEmailTemplate,
  getPasswordResetEmailTemplate,
  getSubscriptionEmailTemplate,
  getDownloadReceiptEmailTemplate,
  getPaymentReceiptEmailTemplate,
  getSubscriptionCancelledEmailTemplate,
  getPaymentFailedEmailTemplate,
  getDeviceBlockedEmailTemplate,
  getNewDeviceEmailTemplate,
  getDeviceRemovedEmailTemplate,
  getSignOutAllEmailTemplate,
  getAdminNewSignupTemplate,
  getAdminNewPaymentTemplate,
  getAdminCancelledSubscriptionTemplate,
  getAdminExpiredSubscriptionTemplate
} from './emailTemplates.js';

// Built on first use, not at import.
//
// `new Resend(undefined)` THROWS. Constructing it at module scope made a
// missing or mistyped RESEND_API_KEY a total outage rather than a loss of
// email: server.js imports the routes, which import the controllers, which
// import this file — so the throw happens before the HTTP listener exists and
// the whole API fails to boot. A one-character slip in .env during a deploy
// took the site down instead of just the mail.
//
// Deferring it keeps that failure proportionate: the site serves, downloads
// work, and the emails that cannot be sent say so in the logs.
let resendClient = null;
function getResend() {
  if (resendClient) return resendClient;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  resendClient = new Resend(key);
  return resendClient;
}
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'TodoDJs <hello@tododjs.com>';
const REPLY_TO_EMAIL = process.env.RESEND_REPLY_TO || 'support@tododjs.com';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const UNSUBSCRIBE_EMAIL = process.env.RESEND_UNSUBSCRIBE_EMAIL || 'support@tododjs.com';

/**
 * Send an email via Resend
 */
export async function sendEmail({ to, subject, html, text, replyTo, headers }) {
  try {
    const resend = getResend();
    if (!resend) {
      console.error(`[email] RESEND_API_KEY is not set — not sending "${subject}" to ${to}`);
      return { success: false, error: 'RESEND_API_KEY is not configured' };
    }

    const payload = {
      from: FROM_EMAIL,
      // Resend SDK v3+ expects camelCase `replyTo` — the legacy `reply_to`
      // field is silently IGNORED, which left every outgoing email with no
      // Reply-To header. Gmail replies then went to the From address
      // (info@tododjs.com, no mailbox) and bounced with 550 5.1.1.
      replyTo: replyTo || REPLY_TO_EMAIL,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text,
    };
    if (headers && Object.keys(headers).length > 0) payload.headers = headers;
    const { data, error } = await resend.emails.send(payload);

    if (error) {
      console.error('Resend API error:', JSON.stringify(error, null, 2));
      console.error('  → name:', error.name, '| statusCode:', error.statusCode);
      console.error('  → message:', error.message);
      return { success: false, error };
    }

    console.log(`✓ Email sent to ${to}: ${data?.id}`);
    return { success: true, id: data?.id };
  } catch (err) {
    console.error('Email send exception:', err.message);
    console.error(err);
    return { success: false, error: err.message };
  }
}

/**
 * Welcome email sent after registration
 */
export async function sendWelcomeEmail(user) {
  const lang = user.preferredLanguage || 'es';
  const { subject, html, text } = getWelcomeEmailTemplate(user, lang);

  return sendEmail({
    to: user.email,
    subject,
    html,
    text,
    headers: {
      'List-Unsubscribe': `<mailto:${UNSUBSCRIBE_EMAIL}?subject=unsubscribe>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });
}

/**
 * Password reset email with token link
 * @param {Object} user - User object
 * @param {string} resetToken - Reset token
 * @param {boolean} isNewUser - If true, sends welcome email with password setup instead of reset
 */
export async function sendPasswordResetEmail(user, resetToken, isNewUser = false) {
  const lang = user.preferredLanguage || 'es';
  const { subject, html, text } = getPasswordResetEmailTemplate(user, resetToken, lang, isNewUser);
  
  return sendEmail({
    to: user.email,
    subject,
    html,
    text
  });
}

/**
 * Subscription confirmation email
 */
export async function sendSubscriptionEmail(user, plan) {
  const lang = user.preferredLanguage || 'es';
  const { subject, html, text } = getSubscriptionEmailTemplate(user, plan, lang);

  return sendEmail({
    to: user.email,
    subject,
    html,
    text,
    headers: {
      'List-Unsubscribe': `<mailto:${UNSUBSCRIBE_EMAIL}?subject=unsubscribe>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });
}

/**
 * Download receipt email
 */
export async function sendDownloadReceiptEmail(user, tracks) {
  const lang = user.preferredLanguage || 'es';
  const { subject, html, text } = getDownloadReceiptEmailTemplate(user, tracks, lang);
  
  return sendEmail({
    to: user.email,
    subject,
    html,
    text
  });
}

/**
 * Generic notification email
 */
export async function sendNotificationEmail(to, subject, message) {
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: #0a0a0a; color: #ffffff; border-radius: 12px; overflow: hidden;">
      <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 30px; text-align: center;">
        <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #ffffff;">TodoDJs</h1>
      </div>
      <div style="padding: 30px;">
        <p style="font-size: 15px; color: #a0a0a0; line-height: 1.6;">${message}</p>
      </div>
      <div style="padding: 20px 30px; border-top: 1px solid #1a1a1a; text-align: center;">
        <p style="margin: 0; font-size: 12px; color: #555;">© ${new Date().getFullYear()} TodoDJs. Todos los derechos reservados.</p>
      </div>
    </div>
  `;

  return sendEmail({ to, subject, html, text: message });
}

// ─── User Payment & Subscription Emails ───

/**
 * Payment receipt email sent to user after successful payment
 */
export async function sendPaymentReceiptEmail(user, planName, amount, currency, endDate) {
  const lang = user.preferredLanguage || 'es';
  const { subject, html, text } = getPaymentReceiptEmailTemplate(user, planName, amount, currency, endDate, lang);
  
  return sendEmail({
    to: user.email,
    subject,
    html,
    text
  });
}

/**
 * Subscription cancelled email sent to user
 */
export async function sendSubscriptionCancelledEmail(user, planName, accessUntilDate) {
  const lang = user.preferredLanguage || 'es';
  const { subject, html, text } = getSubscriptionCancelledEmailTemplate(user, planName, accessUntilDate, lang);
  
  return sendEmail({
    to: user.email,
    subject,
    html,
    text
  });
}

/**
 * Account blocked notification email
 */
export async function sendBlockedAccountEmail(user) {
  const lang = user.preferredLanguage || 'es';
  const isEs = lang.startsWith('es');

  const reasonLabels = {
    account_sharing: isEs ? 'Compartición de cuenta' : 'Account sharing',
    content_sharing: isEs ? 'Compartición de contenido' : 'Content sharing',
    abusive_use:     isEs ? 'Uso abusivo de la plataforma' : 'Abusive platform use',
    piracy:          isEs ? 'Piratería' : 'Piracy',
    other:           isEs ? 'Otro (contacta con soporte)' : 'Other (contact support)'
  };
  const reasonLabel = reasonLabels[user.blockReason] || reasonLabels.other;

  const subject = isEs ? 'Acceso suspendido — TodoDJs' : 'Access suspended — TodoDJs';

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0a;color:#fff;border-radius:12px;overflow:hidden;">
  <div style="background:linear-gradient(135deg,#e50914,#b00710);padding:32px;text-align:center;">
    <div style="width:64px;height:64px;background:rgba(255,255,255,0.15);border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
    </div>
    <h1 style="margin:0;font-size:24px;font-weight:700;">${isEs ? 'Cuenta suspendida' : 'Account suspended'}</h1>
    <p style="margin:8px 0 0;opacity:.85;font-size:14px;">TodoDJs</p>
  </div>
  <div style="padding:32px;">
    <p style="font-size:16px;margin-top:0;">${isEs ? `Hola ${user.name},` : `Hi ${user.name},`}</p>
    <p style="color:#ccc;line-height:1.6;">${isEs
      ? 'Tu cuenta ha sido suspendida por incumplimiento de nuestros Términos de Servicio.'
      : 'Your account has been suspended due to a violation of our Terms of Service.'}</p>
    <div style="background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:16px;margin:20px 0;">
      <p style="margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#888;">${isEs ? 'Motivo de la suspensión' : 'Reason for suspension'}</p>
      <p style="margin:0;font-size:15px;font-weight:600;color:#e50914;">${reasonLabel}</p>
    </div>
    <p style="color:#ccc;line-height:1.6;">${isEs
      ? 'Si crees que esto es un error o quieres apelar esta decisión, contacta con nuestro equipo de soporte.'
      : 'If you believe this is an error or would like to appeal this decision, please contact our support team.'}</p>
    <div style="text-align:center;margin:28px 0;">
      <a href="mailto:support@tododjs.com" style="display:inline-block;background:#e50914;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;">
        ${isEs ? 'Contactar soporte' : 'Contact support'}
      </a>
    </div>
    <p style="color:#555;font-size:12px;text-align:center;margin-bottom:0;">© ${new Date().getFullYear()} TodoDJs. ${isEs ? 'Todos los derechos reservados.' : 'All rights reserved.'}</p>
  </div>
</div>`;

  return sendEmail({ to: user.email, subject, html });
}

/**
 * Payment failed email sent to user
 */
// `payUrl` — Stripe's hosted invoice page for the failed invoice. When given,
// the email's button pays that invoice directly and access is restored
// automatically; without it the customer is only told that something failed.
export async function sendPaymentFailedEmail(user, payUrl = null) {
  const lang = user.preferredLanguage || 'es';
  const { subject, html, text } = getPaymentFailedEmailTemplate(user, lang, payUrl);
  
  return sendEmail({
    to: user.email,
    subject,
    html,
    text
  });
}

// ─── Admin Notification Emails ───

// Comma-separated list supported, so notifications can land in several inboxes
// so notifications can land in multiple inboxes. Previously this was passed to
// sendEmail as a single raw string; Resend rejects a comma-joined string as one
// malformed address, so EVERY admin notification (suspicious downloads, new
// signups, cancellations, expired subscriptions) silently stopped sending the
// moment ADMIN_EMAIL was set to more than one address.
const ADMIN_EMAILS = (process.env.ADMIN_EMAIL || '')
  .split(',')
  .map(e => e.trim())
  .filter(Boolean);

/**
 * Send admin notification (skips silently if ADMIN_EMAIL is not set)
 */
async function sendAdminNotification({ subject, html, text }) {
  if (!ADMIN_EMAILS.length) {
    console.log('ADMIN_EMAIL not set — skipping admin notification:', subject);
    return { success: false, error: 'ADMIN_EMAIL not configured' };
  }
  return sendEmail({ to: ADMIN_EMAILS, subject, html, text });
}

/**
 * Notify admin of a new user signup
 */
export async function notifyAdminNewSignup(user) {
  const { subject, html, text } = getAdminNewSignupTemplate(user);
  return sendAdminNotification({ subject, html, text });
}

/**
 * Notify admin of a new payment
 */
export async function notifyAdminNewPayment(user, planName, amount, currency) {
  const { subject, html, text } = getAdminNewPaymentTemplate(user, planName, amount, currency);
  return sendAdminNotification({ subject, html, text });
}

/**
 * Notify admin of a cancelled subscription
 */
export async function notifyAdminCancelledSubscription(user, planName) {
  const { subject, html, text } = getAdminCancelledSubscriptionTemplate(user, planName);
  return sendAdminNotification({ subject, html, text });
}

/**
 * Notify admin of an expired subscription
 */
export async function notifyAdminExpiredSubscription(user, planName) {
  const { subject, html, text } = getAdminExpiredSubscriptionTemplate(user, planName);
  return sendAdminNotification({ subject, html, text });
}

/**
 * Notify admin of suspicious (mass) download activity — user auto-suspended
 */
export async function notifyAdminSuspiciousDownloads(user, downloadCount, windowMinutes) {
  const subject = `⚠️ Suspicious downloads — ${user.name} (${user.email}) auto-suspended`;
  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0a;color:#fff;border-radius:12px;overflow:hidden;">
  <div style="background:linear-gradient(135deg,#f59e0b,#d97706);padding:32px;text-align:center;">
    <h1 style="margin:0;font-size:22px;font-weight:700;">⚠️ Suspicious Download Activity</h1>
    <p style="margin:8px 0 0;opacity:.85;font-size:14px;">TodoDJs — Admin Alert</p>
  </div>
  <div style="padding:32px;">
    <p style="font-size:15px;margin-top:0;">A user has been automatically suspended for excessive downloads.</p>
    <div style="background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:16px;margin:20px 0;">
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="color:#888;padding:4px 0;width:140px;">Name</td><td style="color:#fff;font-weight:600;">${user.name}</td></tr>
        <tr><td style="color:#888;padding:4px 0;">Email</td><td style="color:#fff;">${user.email}</td></tr>
        <tr><td style="color:#888;padding:4px 0;">Downloads</td><td style="color:#f59e0b;font-weight:700;">${downloadCount} in the last ${windowMinutes} minutes</td></tr>
        <tr><td style="color:#888;padding:4px 0;">Plan</td><td style="color:#fff;">${user.subscription?.planId || user.subscription?.plan || 'free'}</td></tr>
        <tr><td style="color:#888;padding:4px 0;">Suspended at</td><td style="color:#fff;">${new Date().toUTCString()}</td></tr>
      </table>
    </div>
    <p style="color:#ccc;line-height:1.6;font-size:14px;">Downloads have been automatically suspended for this account. You can lift the suspension from the Admin → Users panel.</p>
    <p style="color:#555;font-size:12px;text-align:center;margin-bottom:0;">© ${new Date().getFullYear()} TodoDJs</p>
  </div>
</div>`;
  return sendAdminNotification({ subject, html });
}

export {
  getDeviceBlockedEmailTemplate,
  getNewDeviceEmailTemplate,
  getDeviceRemovedEmailTemplate,
  getSignOutAllEmailTemplate
} from './emailTemplates.js';

export default {
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendSubscriptionEmail,
  sendDownloadReceiptEmail,
  sendNotificationEmail,
  sendPaymentReceiptEmail,
  sendSubscriptionCancelledEmail,
  sendPaymentFailedEmail,
  notifyAdminNewSignup,
  notifyAdminNewPayment,
  notifyAdminCancelledSubscription,
  notifyAdminExpiredSubscription
};
