import crypto from 'crypto';
import { sendEmail } from '../services/emailService.js';
import { uploadToWasabi, getSignedDownloadUrl } from '../config/wasabi.js';

// Comma-separated list supported, so one notification can land in several
// inboxes (e.g. a Gmail account and a domain mailbox).
//
// No hardcoded fallback: the address used to be inlined here, which published
// it with the source. ADMIN_EMAIL must be set in server/.env — if it is not,
// submitContact logs loudly and still returns success to the sender, because
// a misconfigured notification is our problem, not theirs.
const ADMIN_EMAILS = (process.env.ADMIN_EMAIL || '')
  .split(',')
  .map(e => e.trim())
  .filter(Boolean);

const ATTACHMENT_PREFIX = 'contact-attachments/';

// Escape user-supplied text before interpolating into the email HTML — the
// form is public/unauthenticated, so name/subject/message must never be
// trusted as raw HTML.
const escapeHtml = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const sanitizeFilename = (name = 'file') =>
  name.replace(/[^\w.\- ]/g, '_').slice(-100);

// @desc    Submit contact form
// @route   POST /api/contact
// @access  Public
export const submitContact = async (req, res) => {
  try {
    const { name, email, phone, subject, message } = req.body;

    if (!name?.trim() || !email?.trim() || !message?.trim()) {
      return res.status(400).json({ success: false, message: 'Nombre, correo y mensaje son obligatorios.' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, message: 'Dirección de correo inválida.' });
    }

    // Upload each attachment to Wasabi and build its HTML block — images get
    // an inline <img> preview, everything else (PDF, doc, etc.) gets a
    // clickable link. The link points at our own redirect endpoint rather
    // than a raw signed URL, so it keeps working no matter how long the
    // email sits unread (a signed URL embedded directly would go dead).
    const files = req.files || [];
    const attachmentBlocks = [];
    for (const file of files) {
      try {
        const key = `${ATTACHMENT_PREFIX}${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${sanitizeFilename(file.originalname)}`;
        await uploadToWasabi(file.buffer, key, file.mimetype);
        const viewUrl = `${req.protocol}://${req.get('host')}/api/contact/attachment?key=${encodeURIComponent(key)}`;
        const safeName = escapeHtml(file.originalname);
        if (file.mimetype.startsWith('image/')) {
          attachmentBlocks.push(
            `<div style="margin-top:12px;"><img src="${viewUrl}" alt="${safeName}" style="max-width:100%;border-radius:8px;border:1px solid #333;display:block;"></div>`
          );
        } else {
          attachmentBlocks.push(
            `<p style="margin-top:8px;">📎 <a href="${viewUrl}" style="color:#e53e3e;">${safeName}</a></p>`
          );
        }
      } catch (uploadErr) {
        console.error(`Contact attachment upload failed (${file.originalname}):`, uploadErr.message);
        attachmentBlocks.push(`<p style="margin-top:8px;color:#f59e0b;">⚠ ${escapeHtml(file.originalname)} (upload failed)</p>`);
      }
    }
    const attachmentsHtml = attachmentBlocks.length
      ? `<div><strong style="color:#aaa;">Archivos adjuntos:</strong>${attachmentBlocks.join('')}</div>`
      : '';

    const safeName = escapeHtml(name);
    const safeSubject = escapeHtml(subject?.trim() || 'Sin asunto');
    const safePhone = escapeHtml(phone?.trim() || '—');
    const safeMessage = escapeHtml(message);

    // Without a destination there is nothing to notify. Log it rather than
    // calling sendEmail with an empty recipient list, which Resend rejects —
    // that would throw into the catch below and show the visitor a failure
    // for a problem entirely on our side. The acknowledgement to the sender
    // below still goes out, and the submission is not lost silently: this
    // line names the misconfiguration.
    if (ADMIN_EMAILS.length === 0) {
      console.error(
        '[contact] ADMIN_EMAIL is not set — no admin notification sent for a ' +
        `submission from ${email}. Set ADMIN_EMAIL in server/.env.`
      );
    } else await sendEmail({
      to: ADMIN_EMAILS,
      subject: `[Contacto] ${safeSubject} — ${safeName}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#111;color:#eee;padding:24px;border-radius:12px;">
          <h2 style="color:#e53e3e;margin-top:0;">📬 Nuevo mensaje de contacto</h2>
          <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
            <tr><td style="padding:6px 12px;color:#aaa;white-space:nowrap;">Nombre</td><td style="padding:6px 12px;">${safeName}</td></tr>
            <tr><td style="padding:6px 12px;color:#aaa;white-space:nowrap;">Correo</td><td style="padding:6px 12px;"><a href="mailto:${escapeHtml(email)}" style="color:#e53e3e;">${escapeHtml(email)}</a></td></tr>
            <tr><td style="padding:6px 12px;color:#aaa;white-space:nowrap;">Teléfono</td><td style="padding:6px 12px;">${safePhone}</td></tr>
            <tr><td style="padding:6px 12px;color:#aaa;white-space:nowrap;">Asunto</td><td style="padding:6px 12px;">${safeSubject}</td></tr>
          </table>
          <div style="background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:16px;white-space:pre-wrap;line-height:1.6;">${safeMessage}</div>
          ${attachmentsHtml}
        </div>`,
      replyTo: email,
    });

    await sendEmail({
      to: email,
      subject: '✅ Recibimos tu mensaje — TodoDJs',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#111;color:#eee;padding:24px;border-radius:12px;">
          <h2 style="color:#e53e3e;margin-top:0;">Hola, ${safeName} 👋</h2>
          <p>Hemos recibido tu mensaje y nos pondremos en contacto contigo a la brevedad.</p>
          <div style="background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:16px;white-space:pre-wrap;line-height:1.6;margin-top:16px;">${safeMessage}</div>
          <p style="color:#888;font-size:13px;margin-top:24px;">— El equipo de TodoDJs</p>
        </div>`,
    });

    res.json({ success: true, message: 'Mensaje enviado correctamente.' });
  } catch (err) {
    console.error('Contact form error:', err);
    res.status(500).json({ success: false, message: 'Error al enviar el mensaje. Inténtalo de nuevo.' });
  }
};

// @desc    Redirect to a fresh signed URL for a contact-form attachment.
//          Generating the signed URL at click-time (rather than embedding
//          one directly in the email) means the link keeps working no
//          matter how long after receipt the admin opens the email.
// @route   GET /api/contact/attachment?key=...
// @access  Public (unguessable key; strictly scoped to the attachments
//          prefix below so it can never sign arbitrary bucket objects)
export const getContactAttachment = async (req, res) => {
  try {
    const { key } = req.query;
    if (!key || typeof key !== 'string' || !key.startsWith(ATTACHMENT_PREFIX)) {
      return res.status(400).json({ success: false, message: 'Invalid attachment key.' });
    }
    const signedUrl = await getSignedDownloadUrl(key, 3600);
    res.redirect(signedUrl);
  } catch (err) {
    console.error('Contact attachment fetch error:', err.message);
    res.status(404).json({ success: false, message: 'Attachment not found.' });
  }
};
