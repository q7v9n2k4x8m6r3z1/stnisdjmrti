/**
 * Public email endpoints. No authentication by design: the person clicking
 * unsubscribe is reading an email, not signed in, and very often on a
 * different device from the one they registered on. The signed token in the
 * link is the authorisation, and it grants exactly one thing.
 */
import User from '../models/User.js';
import Suppression from '../models/Suppression.js';
import { verifyUnsubscribeToken } from '../utils/unsubscribeToken.js';

/** Minimal self-contained page — no SPA route, no assets, works offline. */
function page(title, message, tone = 'ok') {
  const accent = tone === 'ok' ? '#E4002B' : '#6A6A74';
  return `<!DOCTYPE html>
<html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · TodoDJs</title>
</head>
<body style="margin:0;background:#0A0A0C;color:#fff;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:64px 24px;text-align:center;">
    <div style="font-size:22px;font-weight:700;letter-spacing:2px;color:${accent};margin-bottom:28px;">TODODJS</div>
    <h1 style="font-size:24px;font-weight:700;margin:0 0 14px;">${title}</h1>
    <p style="font-size:16px;line-height:26px;color:#A4A4AE;margin:0 0 32px;">${message}</p>
    <a href="https://tododjs.com" style="display:inline-block;padding:14px 28px;background:${accent};color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;">Volver a TodoDJs</a>
  </div>
</body></html>`;
}

/**
 * @desc    Unsubscribe from promotional email
 * @route   GET|POST /api/email/unsubscribe?u=<id>&t=<token>
 * @access  Public (signed token)
 *
 * POST is supported because List-Unsubscribe-Post asks mail clients to send
 * one, and Gmail hides the one-click control if the endpoint rejects it.
 */
export const unsubscribe = async (req, res) => {
  try {
    const userId = req.query.u;
    const token = req.query.t;

    if (!verifyUnsubscribeToken(userId, token)) {
      return res
        .status(400)
        .type('html')
        .send(page('Enlace no válido', 'Este enlace de baja no es válido o está incompleto. Si sigues recibiendo correos, escríbenos a soporte@tododjs.com.', 'muted'));
    }

    // Idempotent: clicking twice, or a mail client prefetching the link, must
    // not error. Only stamp the date on the first opt-out so the record
    // reflects when they actually asked.
    const user = await User.findById(userId).select('marketingOptOut email').lean();
    if (!user) {
      return res
        .status(404)
        .type('html')
        .send(page('Cuenta no encontrada', 'No hemos encontrado esta cuenta. Es posible que se haya eliminado.', 'muted'));
    }

    if (!user.marketingOptOut) {
      await User.updateOne(
        { _id: userId },
        { $set: { marketingOptOut: true, marketingOptOutAt: new Date() } }
      );
      console.log(`[email] ${user.email} unsubscribed from promotional email`);
    }

    // Also record the ADDRESS, not just the account.
    //
    // The flag on the user is what campaign audience queries read, but it is
    // lost if the account is deleted and recreated — and the person would
    // start receiving mail again having explicitly asked not to. The
    // suppression list is keyed on the address and outlives the account.
    // Idempotent, so a second click or a mail client prefetching the link
    // changes nothing.
    await Suppression.add(user.email, 'unsubscribe', 'via unsubscribe link', userId);

    // 200 with a body for a human click; mail clients doing the one-click POST
    // only care about the status.
    return res
      .status(200)
      .type('html')
      .send(page(
        'Baja confirmada',
        'No volverás a recibir correos promocionales de TodoDJs. Seguirás recibiendo los correos necesarios de tu cuenta, como recibos y avisos de pago.'
      ));
  } catch (error) {
    console.error('[email] unsubscribe failed:', error.message);
    return res
      .status(500)
      .type('html')
      .send(page('Algo ha fallado', 'No hemos podido procesar tu baja. Escríbenos a soporte@tododjs.com y lo hacemos por ti.', 'muted'));
  }
};
