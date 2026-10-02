// Email templates in multiple languages

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Translation object for email content
const translations = {
  en: {
    welcome: {
      subject: 'Welcome to TodoDJs!',
      title: 'Welcome to TodoDJs!',
      subtitle: 'Your music journey starts here',
      greeting: 'Hey',
      message: 'Thanks for joining TodoDJs! You now have access to our curated record pool of high-quality tracks.',
      button: 'Start Browsing',
      footer: 'If you have any questions, feel free to reach out to our support team.',
      copyright: 'All rights reserved.'
    },
    passwordReset: {
      subject: 'Reset Your Password — TodoDJs',
      title: 'Password Reset',
      greeting: 'Hey',
      message: 'We received a request to reset your password. Click the button below to set a new password:',
      button: 'Reset Password',
      footer: 'This link will expire in 1 hour. If you didn\'t request this, you can safely ignore this email.',
      linkText: 'Or copy this link:',
      copyright: 'All rights reserved.'
    },
    subscription: {
      subject: 'Your {plan} Plan is Active — TodoDJs',
      title: 'Subscription Confirmed!',
      greeting: 'Hey',
      message: 'Your <strong style="color: #10b981;">{plan}</strong> subscription is now active! You can now download tracks and access premium features.',
      button: 'Start Downloading',
      footer: 'Thank you for supporting TodoDJs!',
      copyright: 'All rights reserved.'
    },
    downloadReceipt: {
      subject: 'Your Download Receipt — TodoDJs',
      title: 'Download Receipt',
      greeting: 'Hey',
      message: 'Here\'s a summary of your recent downloads:',
      downloadedOn: 'Downloaded on',
      copyright: 'All rights reserved.'
    },
    paymentReceipt: {
      subject: 'Payment Confirmed — TodoDJs',
      title: 'Payment Received!',
      greeting: 'Hey',
      message: 'Your payment has been successfully processed. Here are the details:',
      plan: 'Plan',
      amount: 'Amount',
      date: 'Date',
      status: 'Status',
      statusPaid: 'Paid',
      validUntil: 'Valid Until',
      footer: 'Thank you for your support! Enjoy your premium access.',
      button: 'Start Browsing',
      copyright: 'All rights reserved.'
    },
    subscriptionCancelled: {
      subject: 'Subscription Cancelled — TodoDJs',
      title: 'Subscription Cancelled',
      greeting: 'Hey',
      message: 'Your subscription has been cancelled. Here are the details:',
      plan: 'Plan',
      cancelledOn: 'Cancelled On',
      accessUntil: 'Access Until',
      accessNote: 'You will continue to have access until the end of your current billing period.',
      reactivate: 'Changed your mind? You can reactivate anytime.',
      button: 'Reactivate Subscription',
      footer: 'We\'re sorry to see you go. You can always come back!',
      copyright: 'All rights reserved.'
    },
    paymentFailed: {
      subject: 'Payment Failed — TodoDJs',
      title: 'Payment Failed',
      greeting: 'Hey',
      message: 'We were unable to process your payment. Please update your payment method to continue your subscription.',
      reason: 'This could be due to insufficient funds, an expired card, or a declined transaction.',
      button: 'Update Payment Method',
      payMessage: 'You can settle the outstanding invoice right now, securely through Stripe. Access is restored automatically as soon as the payment goes through.',
      payButton: 'Pay Outstanding Invoice',
      footer: 'If you need help, please contact our support team.',
      copyright: 'All rights reserved.'
    },
    newUserSetup: {
      subject: 'Welcome to TodoDJs — Set Your Password',
      title: 'Welcome to TodoDJs!',
      greeting: 'Hey',
      message: 'Your subscription is now active and your account has been created.',
      step: 'To get started, please set your password by clicking the button below:',
      button: 'Set Your Password',
      footer: 'This link will expire in 24 hours. After setting your password you can log in and start downloading tracks!',
      linkText: 'Or copy this link:',
      copyright: 'All rights reserved.'
    },
    deviceBlocked: {
      subject: '⚠️ New Device Blocked — Device Limit Reached',
      title: 'Unrecognized Device Blocked',
      greeting: 'Hey',
      message: 'Someone tried to log into your <strong>TodoDJS</strong> account from a new device, but your plan only allows <strong>{maxDevices} device{plural}</strong>.',
      details: 'Blocked Device Details',
      labelDevice: 'Device',
      labelBrowser: 'Browser',
      labelOs: 'OS',
      labelIp: 'IP Address',
      labelTime: 'Time',
      footer: 'If this was you, sign in to your account and remove one of your existing devices to free up a slot.',
      notYou: 'If this was <strong>not you</strong>, your account is secure — the login was blocked. Consider changing your password immediately.',
      manageLink: 'Manage Your Devices →'
    },
    newDevice: {
      subject: 'New Device Added to Your Account',
      title: 'New Device Registered',
      greeting: 'Hey',
      message: 'A new device was added to your TodoDJS account:',
      labelDevice: 'Device',
      labelType: 'Type',
      labelIp: 'IP Address',
      labelTime: 'Time',
      footer: 'If this wasn\'t you, please sign out all devices immediately from your account settings.',
      manage: 'You can manage your devices at any time from your dashboard.'
    },
    deviceRemoved: {
      subject: 'Device Removed from Your Account',
      title: 'Device Removed',
      greeting: 'Hey',
      message: 'A device was removed from your TodoDJS account:',
      labelDevice: 'Device',
      labelRemoved: 'Removed',
      footer: 'If you didn\'t make this change, please contact support immediately.'
    },
    signOutAll: {
      subject: 'All Devices Signed Out',
      title: 'Security Alert: All Devices Signed Out',
      greeting: 'Hey',
      message: 'All devices ({count}) have been signed out from your TodoDJS account.',
      labelTime: 'Time',
      footer: 'You will need to sign in again on each device you want to use.',
      notYou: 'If you didn\'t make this change, please reset your password immediately and contact support.'
    }
  },
  es: {
    welcome: {
      subject: '¡Bienvenido a TodoDJs!',
      title: '¡Bienvenido a TodoDJs!',
      subtitle: 'Tu viaje musical comienza aquí',
      greeting: 'Hola',
      message: '¡Ya estás dentro de TodoDJS! Accede a toda nuestra biblioteca creada para DJs que quieren ir al siguiente nivel. Si tienes alguna pregunta, no dudes en contactar a nuestro equipo de soporte.',
      button: 'Comenzar a Explorar',
      footer: 'Si tienes alguna pregunta, no dudes en contactar a nuestro equipo de soporte.',
      copyright: 'Todos los derechos reservados.'
    },
    passwordReset: {
      subject: 'Restablecer tu Contraseña — TodoDJs',
      title: 'Restablecer Contraseña',
      greeting: 'Hola',
      message: 'Recibimos una solicitud para restablecer tu contraseña. Haz clic en el botón a continuación para establecer una nueva contraseña:',
      button: 'Restablecer Contraseña',
      footer: 'Este enlace expirará en 1 hora. Si no solicitaste esto, puedes ignorar este correo de forma segura.',
      linkText: 'O copia este enlace:',
      copyright: 'Todos los derechos reservados.'
    },
    subscription: {
      subject: 'Tu Plan {plan} está Activo — TodoDJs',
      title: '¡Suscripción Confirmada!',
      greeting: 'Hola',
      message: '¡Tu suscripción <strong style="color: #10b981;">{plan}</strong> está activa! Ahora puedes descargar pistas y acceder a funciones premium.',
      button: 'Comenzar a Descargar',
      footer: '¡Gracias por apoyar a TodoDJs!',
      copyright: 'Todos los derechos reservados.'
    },
    downloadReceipt: {
      subject: 'Tu Recibo de Descarga — TodoDJs',
      title: 'Recibo de Descarga',
      greeting: 'Hola',
      message: 'Aquí está el resumen de tus descargas recientes:',
      downloadedOn: 'Descargado el',
      copyright: 'Todos los derechos reservados.'
    },
    paymentReceipt: {
      subject: 'Pago Confirmado — TodoDJs',
      title: '¡Pago Recibido!',
      greeting: 'Hola',
      message: 'Tu pago ha sido procesado exitosamente. Aquí están los detalles:',
      plan: 'Plan',
      amount: 'Monto',
      date: 'Fecha',
      status: 'Estado',
      statusPaid: 'Pagado',
      validUntil: 'Válido Hasta',
      footer: '¡Gracias por tu apoyo! Disfruta de tu acceso premium.',
      button: 'Comenzar a Explorar',
      copyright: 'Todos los derechos reservados.'
    },
    subscriptionCancelled: {
      subject: 'Suscripción Cancelada — TodoDJs',
      title: 'Suscripción Cancelada',
      greeting: 'Hola',
      message: 'Tu suscripción ha sido cancelada. Aquí están los detalles:',
      plan: 'Plan',
      cancelledOn: 'Cancelado El',
      accessUntil: 'Acceso Hasta',
      accessNote: 'Continuarás teniendo acceso hasta el final de tu período de facturación actual.',
      reactivate: '¿Cambiaste de opinión? Puedes reactivar en cualquier momento.',
      button: 'Reactivar Suscripción',
      footer: 'Lamentamos verte ir. ¡Siempre puedes volver!',
      copyright: 'Todos los derechos reservados.'
    },
    paymentFailed: {
      subject: 'Pago Fallido — TodoDJs',
      title: 'Pago Fallido',
      greeting: 'Hola',
      message: 'No pudimos procesar tu pago. Por favor actualiza tu método de pago para continuar con tu suscripción.',
      reason: 'Esto podría deberse a fondos insuficientes, una tarjeta vencida o una transacción rechazada.',
      button: 'Actualizar Método de Pago',
      payMessage: 'Puedes pagar la factura pendiente ahora mismo, de forma segura a través de Stripe. Tu acceso se restablece automáticamente en cuanto se procese el pago.',
      payButton: 'Pagar Factura Pendiente',
      footer: 'Si necesitas ayuda, por favor contacta a nuestro equipo de soporte.',
      copyright: 'Todos los derechos reservados.'
    },
    newUserSetup: {
      subject: 'Bienvenido a TodoDJs — Configura tu Contraseña',
      title: '¡Bienvenido a TodoDJs!',
      greeting: 'Hola',
      message: 'Tu suscripción está activa y tu cuenta ha sido creada.',
      step: 'Para comenzar, configura tu contraseña haciendo clic en el botón de abajo:',
      button: 'Configurar Contraseña',
      footer: 'Este enlace expirará en 24 horas. Después de configurar tu contraseña podrás iniciar sesión y comenzar a descargar pistas.',
      linkText: 'O copia este enlace:',
      copyright: 'Todos los derechos reservados.'
    },
    deviceBlocked: {
      subject: '⚠️ Acceso Bloqueado — Límite de Dispositivos Alcanzado',
      title: 'Dispositivo No Reconocido Bloqueado',
      greeting: 'Hola',
      message: 'Alguien intentó iniciar sesión en tu cuenta de <strong>TodoDJS</strong> desde un nuevo dispositivo, pero tu plan solo permite <strong>{maxDevices} dispositivo{plural}</strong>.',
      details: 'Detalles del Dispositivo Bloqueado',
      labelDevice: 'Dispositivo',
      labelBrowser: 'Navegador',
      labelOs: 'Sistema Operativo',
      labelIp: 'Dirección IP',
      labelTime: 'Hora',
      footer: 'Si fuiste tú, inicia sesión en tu cuenta y elimina uno de tus dispositivos existentes para liberar un espacio.',
      notYou: 'Si <strong>no fuiste tú</strong>, tu cuenta está segura — el acceso fue bloqueado. Considera cambiar tu contraseña inmediatamente.',
      manageLink: 'Gestionar Tus Dispositivos →'
    },
    newDevice: {
      subject: 'Nuevo Dispositivo Añadido a Tu Cuenta',
      title: 'Nuevo Dispositivo Registrado',
      greeting: 'Hola',
      message: 'Se añadió un nuevo dispositivo a tu cuenta de TodoDJS:',
      labelDevice: 'Dispositivo',
      labelType: 'Tipo',
      labelIp: 'Dirección IP',
      labelTime: 'Hora',
      footer: 'Si no fuiste tú, cierra sesión en todos los dispositivos inmediatamente desde la configuración de tu cuenta.',
      manage: 'Puedes gestionar tus dispositivos en cualquier momento desde tu panel.'
    },
    deviceRemoved: {
      subject: 'Dispositivo Eliminado de Tu Cuenta',
      title: 'Dispositivo Eliminado',
      greeting: 'Hola',
      message: 'Se eliminó un dispositivo de tu cuenta de TodoDJS:',
      labelDevice: 'Dispositivo',
      labelRemoved: 'Eliminado el',
      footer: 'Si no realizaste este cambio, por favor contacta al soporte inmediatamente.'
    },
    signOutAll: {
      subject: 'Todos los Dispositivos Han Cerrado Sesión',
      title: 'Alerta de Seguridad: Sesión Cerrada en Todos los Dispositivos',
      greeting: 'Hola',
      message: 'Se cerró sesión en todos los dispositivos ({count}) de tu cuenta de TodoDJS.',
      labelTime: 'Hora',
      footer: 'Necesitarás iniciar sesión nuevamente en cada dispositivo que desees usar.',
      notYou: 'Si no realizaste este cambio, restablece tu contraseña inmediatamente y contacta al soporte.'
    }
  }
};

// Helper function to get translation
function t(lang, key, replacements = {}) {
  const keys = key.split('.');
  let value = translations[lang] || translations.en;
  
  for (const k of keys) {
    value = value[k];
    if (!value) return key;
  }
  
  // Replace placeholders
  if (typeof value === 'string') {
    Object.keys(replacements).forEach(placeholder => {
      value = value.replace(`{${placeholder}}`, replacements[placeholder]);
    });
  }
  
  return value;
}

// Base email template
function getEmailTemplate(lang, title, content, { preheader = '', gradient = 'linear-gradient(135deg, #6366f1, #8b5cf6)' } = {}) {
  const year = new Date().getFullYear();
  const copyright = t(lang, 'welcome.copyright');
  const preheaderHtml = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${preheader}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="${lang}" dir="ltr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#0f0f0f;">
  ${preheaderHtml}
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#0f0f0f;">
    <tr>
      <td align="center" style="padding:20px 10px;">
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;width:100%;background:#0a0a0a;color:#ffffff;border-radius:12px;overflow:hidden;">
          <div style="background:${gradient};padding:40px 30px;text-align:center;">
            <h1 style="margin:0;font-size:28px;font-weight:700;color:#ffffff;">${title}</h1>
          </div>
          ${content}
          <div style="padding:20px 30px;border-top:1px solid #1a1a1a;text-align:center;">
            <p style="margin:0 0 4px;font-size:12px;color:#555;">© ${year} TodoDJs. ${copyright}</p>
            <p style="margin:0;font-size:11px;color:#444;">TodoDJs &middot; <a href="mailto:support@tododjs.com" style="color:#6366f1;text-decoration:none;">support@tododjs.com</a> &middot; tododjs.com</p>
          </div>
        </div>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Welcome email template
export function getWelcomeEmailTemplate(user, lang = 'es') {
  const content = `
    <div style="padding: 30px;">
      <p style="font-size: 16px; color: #e0e0e0; line-height: 1.6;">${t(lang, 'welcome.greeting')} <strong>${user.name}</strong>,</p>
      <p style="font-size: 15px; color: #a0a0a0; line-height: 1.6;">${t(lang, 'welcome.message')}</p>
      <div style="margin: 25px 0;">
        <a href="${FRONTEND_URL}" style="display: inline-block; background: #6366f1; color: #ffffff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px;">${t(lang, 'welcome.button')}</a>
      </div>
      <p style="font-size: 14px; color: #666; line-height: 1.6;">${t(lang, 'welcome.footer')}</p>
    </div>
  `;
  
  return {
    subject: t(lang, 'welcome.subject'),
    html: getEmailTemplate(lang, t(lang, 'welcome.title'), content),
    text: `${t(lang, 'welcome.greeting')} ${user.name}, ${t(lang, 'welcome.message')} ${FRONTEND_URL}`
  };
}

// Password reset email template
export function getPasswordResetEmailTemplate(user, resetToken, lang = 'es', isNewUser = false) {
  const resetUrl = `${FRONTEND_URL}/reset-password?token=${resetToken}`;
  
  if (isNewUser) {
    const content = `
      <div style="padding: 30px;">
        <p style="font-size: 16px; color: #e0e0e0; line-height: 1.6;">${t(lang, 'newUserSetup.greeting')} <strong>${user.name}</strong>,</p>
        <p style="font-size: 15px; color: #a0a0a0; line-height: 1.6;">${t(lang, 'newUserSetup.message')}</p>
        <p style="font-size: 15px; color: #a0a0a0; line-height: 1.6;">${t(lang, 'newUserSetup.step')}</p>
        <div style="margin: 25px 0;">
          <a href="${resetUrl}" style="display: inline-block; background: #10b981; color: #ffffff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px;">${t(lang, 'newUserSetup.button')}</a>
        </div>
        <p style="font-size: 14px; color: #666; line-height: 1.6;">${t(lang, 'newUserSetup.footer')}</p>
        <p style="font-size: 12px; color: #555; margin-top: 20px; word-break: break-all;">${t(lang, 'newUserSetup.linkText')} ${resetUrl}</p>
      </div>
    `;

    return {
      subject: t(lang, 'newUserSetup.subject'),
      html: getEmailTemplate(lang, t(lang, 'newUserSetup.title'), content, { gradient: 'linear-gradient(135deg, #10b981, #059669)' }),
      text: `${t(lang, 'newUserSetup.greeting')} ${user.name}, ${t(lang, 'newUserSetup.message')} ${resetUrl}`
    };
  }
  
  // Regular password reset email
  const content = `
    <div style="padding: 30px;">
      <p style="font-size: 16px; color: #e0e0e0; line-height: 1.6;">${t(lang, 'passwordReset.greeting')} <strong>${user.name}</strong>,</p>
      <p style="font-size: 15px; color: #a0a0a0; line-height: 1.6;">${t(lang, 'passwordReset.message')}</p>
      <div style="margin: 25px 0;">
        <a href="${resetUrl}" style="display: inline-block; background: #6366f1; color: #ffffff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px;">${t(lang, 'passwordReset.button')}</a>
      </div>
      <p style="font-size: 14px; color: #666; line-height: 1.6;">${t(lang, 'passwordReset.footer')}</p>
      <p style="font-size: 12px; color: #555; margin-top: 20px; word-break: break-all;">${t(lang, 'passwordReset.linkText')} ${resetUrl}</p>
    </div>
  `;
  
  return {
    subject: t(lang, 'passwordReset.subject'),
    html: getEmailTemplate(lang, t(lang, 'passwordReset.title'), content),
    text: `${t(lang, 'passwordReset.greeting')} ${user.name}, ${t(lang, 'passwordReset.message')} ${resetUrl}`
  };
}

// Subscription confirmation email template
export function getSubscriptionEmailTemplate(user, planName, lang = 'es') {
  const content = `
    <div style="padding: 30px;">
      <p style="font-size: 16px; color: #e0e0e0; line-height: 1.6;">${t(lang, 'subscription.greeting')} <strong>${user.name}</strong>,</p>
      <p style="font-size: 15px; color: #a0a0a0; line-height: 1.6;">${t(lang, 'subscription.message', { plan: planName })}</p>
      <div style="margin: 25px 0;">
        <a href="${FRONTEND_URL}" style="display: inline-block; background: #10b981; color: #ffffff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px;">${t(lang, 'subscription.button')}</a>
      </div>
      <p style="font-size: 14px; color: #666; line-height: 1.6;">${t(lang, 'subscription.footer')}</p>
    </div>
  `;
  
  return {
    subject: t(lang, 'subscription.subject', { plan: planName }),
    html: getEmailTemplate(lang, t(lang, 'subscription.title'), content, { gradient: 'linear-gradient(135deg, #10b981, #059669)', preheader: t(lang, 'subscription.footer') }),
    text: `${t(lang, 'subscription.greeting')} ${user.name}, ${t(lang, 'subscription.message', { plan: planName })} ${FRONTEND_URL}`
  };
}

// Download receipt email template
export function getDownloadReceiptEmailTemplate(user, tracks, lang = 'es') {
  const trackList = tracks.map(t => `<li style="padding: 6px 0; color: #a0a0a0; font-size: 14px;">${t.artist} — ${t.title}</li>`).join('');
  
  const dateOptions = lang === 'es' 
    ? { year: 'numeric', month: 'long', day: 'numeric' }
    : { year: 'numeric', month: 'long', day: 'numeric' };
  const locale = lang === 'es' ? 'es-ES' : 'en-US';
  
  const content = `
    <div style="padding: 30px;">
      <p style="font-size: 16px; color: #e0e0e0; line-height: 1.6;">${t(lang, 'downloadReceipt.greeting')} <strong>${user.name}</strong>,</p>
      <p style="font-size: 15px; color: #a0a0a0; line-height: 1.6;">${t(lang, 'downloadReceipt.message')}</p>
      <ul style="list-style: none; padding: 0; margin: 15px 0; border: 1px solid #1a1a1a; border-radius: 8px; padding: 15px;">
        ${trackList}
      </ul>
      <p style="font-size: 13px; color: #555;">${t(lang, 'downloadReceipt.downloadedOn')} ${new Date().toLocaleDateString(locale, dateOptions)}</p>
    </div>
  `;
  
  return {
    subject: t(lang, 'downloadReceipt.subject'),
    html: getEmailTemplate(lang, t(lang, 'downloadReceipt.title'), content),
    text: `${t(lang, 'downloadReceipt.greeting')} ${user.name}, ${t(lang, 'downloadReceipt.message')} ${tracks.map(t => `${t.artist} - ${t.title}`).join(', ')}`
  };
}

// ─── User Payment & Subscription Templates ───

export function getPaymentReceiptEmailTemplate(user, planName, amount, currency, endDate, lang = 'es') {
  const locale = lang === 'es' ? 'es-ES' : 'en-US';
  const dateOptions = { year: 'numeric', month: 'long', day: 'numeric' };
  const formattedDate = new Date().toLocaleDateString(locale, dateOptions);
  const formattedEndDate = endDate ? new Date(endDate).toLocaleDateString(locale, dateOptions) : '';
  const currencySymbol = currency === 'EUR' || currency === '€' ? '€' : currency === 'USD' || currency === '$' ? '$' : currency || '€';

  const content = `
    <div style="padding: 30px;">
      <p style="font-size: 16px; color: #e0e0e0; line-height: 1.6;">${t(lang, 'paymentReceipt.greeting')} <strong>${user.name}</strong>,</p>
      <p style="font-size: 15px; color: #a0a0a0; line-height: 1.6;">${t(lang, 'paymentReceipt.message')}</p>
      <div style="margin: 20px 0; background: #111; border: 1px solid #1a1a1a; border-radius: 10px; padding: 20px;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 10px 0; font-size: 13px; color: #888; border-bottom: 1px solid #1a1a1a;">${t(lang, 'paymentReceipt.plan')}</td>
            <td style="padding: 10px 0; font-size: 14px; color: #10b981; font-weight: 700; text-align: right; border-bottom: 1px solid #1a1a1a;">${planName}</td>
          </tr>
          <tr>
            <td style="padding: 10px 0; font-size: 13px; color: #888; border-bottom: 1px solid #1a1a1a;">${t(lang, 'paymentReceipt.amount')}</td>
            <td style="padding: 10px 0; font-size: 14px; color: #ffffff; font-weight: 700; text-align: right; border-bottom: 1px solid #1a1a1a;">${currencySymbol}${amount}</td>
          </tr>
          <tr>
            <td style="padding: 10px 0; font-size: 13px; color: #888; border-bottom: 1px solid #1a1a1a;">${t(lang, 'paymentReceipt.date')}</td>
            <td style="padding: 10px 0; font-size: 14px; color: #e0e0e0; text-align: right; border-bottom: 1px solid #1a1a1a;">${formattedDate}</td>
          </tr>
          <tr>
            <td style="padding: 10px 0; font-size: 13px; color: #888; border-bottom: 1px solid #1a1a1a;">${t(lang, 'paymentReceipt.status')}</td>
            <td style="padding: 10px 0; font-size: 14px; color: #10b981; font-weight: 600; text-align: right; border-bottom: 1px solid #1a1a1a;">✓ ${t(lang, 'paymentReceipt.statusPaid')}</td>
          </tr>
          ${formattedEndDate ? `<tr>
            <td style="padding: 10px 0; font-size: 13px; color: #888;">${t(lang, 'paymentReceipt.validUntil')}</td>
            <td style="padding: 10px 0; font-size: 14px; color: #e0e0e0; text-align: right;">${formattedEndDate}</td>
          </tr>` : ''}
        </table>
      </div>
      <div style="margin: 25px 0;">
        <a href="${FRONTEND_URL}" style="display: inline-block; background: #10b981; color: #ffffff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px;">${t(lang, 'paymentReceipt.button')}</a>
      </div>
      <p style="font-size: 14px; color: #666; line-height: 1.6;">${t(lang, 'paymentReceipt.footer')}</p>
    </div>
  `;

  return {
    subject: t(lang, 'paymentReceipt.subject'),
    html: getEmailTemplate(lang, t(lang, 'paymentReceipt.title'), content, { gradient: 'linear-gradient(135deg, #10b981, #059669)', preheader: t(lang, 'paymentReceipt.message') }),
    text: `${t(lang, 'paymentReceipt.greeting')} ${user.name}, ${t(lang, 'paymentReceipt.message')} ${planName} - ${currencySymbol}${amount}`
  };
}

export function getSubscriptionCancelledEmailTemplate(user, planName, accessUntilDate, lang = 'es') {
  const locale = lang === 'es' ? 'es-ES' : 'en-US';
  const dateOptions = { year: 'numeric', month: 'long', day: 'numeric' };
  const formattedCancelDate = new Date().toLocaleDateString(locale, dateOptions);
  const formattedAccessDate = accessUntilDate ? new Date(accessUntilDate).toLocaleDateString(locale, dateOptions) : '';

  const content = `
    <div style="padding: 30px;">
      <p style="font-size: 16px; color: #e0e0e0; line-height: 1.6;">${t(lang, 'subscriptionCancelled.greeting')} <strong>${user.name}</strong>,</p>
      <p style="font-size: 15px; color: #a0a0a0; line-height: 1.6;">${t(lang, 'subscriptionCancelled.message')}</p>
      <div style="margin: 20px 0; background: #111; border: 1px solid #1a1a1a; border-radius: 10px; padding: 20px;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 10px 0; font-size: 13px; color: #888; border-bottom: 1px solid #1a1a1a;">${t(lang, 'subscriptionCancelled.plan')}</td>
            <td style="padding: 10px 0; font-size: 14px; color: #ef4444; font-weight: 700; text-align: right; border-bottom: 1px solid #1a1a1a;">${planName || 'N/A'}</td>
          </tr>
          <tr>
            <td style="padding: 10px 0; font-size: 13px; color: #888; border-bottom: 1px solid #1a1a1a;">${t(lang, 'subscriptionCancelled.cancelledOn')}</td>
            <td style="padding: 10px 0; font-size: 14px; color: #e0e0e0; text-align: right; border-bottom: 1px solid #1a1a1a;">${formattedCancelDate}</td>
          </tr>
          ${formattedAccessDate ? `<tr>
            <td style="padding: 10px 0; font-size: 13px; color: #888;">${t(lang, 'subscriptionCancelled.accessUntil')}</td>
            <td style="padding: 10px 0; font-size: 14px; color: #f59e0b; text-align: right;">${formattedAccessDate}</td>
          </tr>` : ''}
        </table>
      </div>
      ${formattedAccessDate ? `<div style="margin: 15px 0; padding: 12px 16px; background: rgba(245,158,11,0.1); border: 1px solid rgba(245,158,11,0.2); border-radius: 8px;">
        <p style="margin: 0; font-size: 14px; color: #f59e0b;">${t(lang, 'subscriptionCancelled.accessNote')}</p>
      </div>` : ''}
      <p style="font-size: 15px; color: #a0a0a0; line-height: 1.6;">${t(lang, 'subscriptionCancelled.reactivate')}</p>
      <div style="margin: 25px 0;">
        <a href="${FRONTEND_URL}" style="display: inline-block; background: #6366f1; color: #ffffff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px;">${t(lang, 'subscriptionCancelled.button')}</a>
      </div>
      <p style="font-size: 14px; color: #666; line-height: 1.6;">${t(lang, 'subscriptionCancelled.footer')}</p>
    </div>
  `;

  return {
    subject: t(lang, 'subscriptionCancelled.subject'),
    html: getEmailTemplate(lang, t(lang, 'subscriptionCancelled.title'), content, { gradient: 'linear-gradient(135deg, #ef4444, #dc2626)', preheader: t(lang, 'subscriptionCancelled.accessNote') }),
    text: `${t(lang, 'subscriptionCancelled.greeting')} ${user.name}, ${t(lang, 'subscriptionCancelled.message')}`
  };
}

// `payUrl` is Stripe's hosted invoice page for the invoice that failed
// (invoice.hosted_invoice_url). Passing it turns this from a notice into
// something the customer can act on: without it the button pointed at the
// site's home page, which offers no way to settle an outstanding invoice, so
// every recovery had to be chased by hand with a link sent over WhatsApp.
//
// Paying there fires invoice.paid, which restores access automatically
// (handleInvoicePaid) — the link is the whole self-service path.
//
// Null for standalone card failures that are not tied to an invoice; the
// original "update your payment method" wording is kept for those, since
// there is no invoice to pay.
export function getPaymentFailedEmailTemplate(user, lang = 'es', payUrl = null) {
  const ctaUrl = payUrl || FRONTEND_URL;
  const ctaLabel = payUrl ? t(lang, 'paymentFailed.payButton') : t(lang, 'paymentFailed.button');

  const content = `
    <div style="padding: 30px;">
      <p style="font-size: 16px; color: #e0e0e0; line-height: 1.6;">${t(lang, 'paymentFailed.greeting')} <strong>${user.name}</strong>,</p>
      <p style="font-size: 15px; color: #a0a0a0; line-height: 1.6;">${t(lang, 'paymentFailed.message')}</p>
      <div style="margin: 15px 0; padding: 12px 16px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.2); border-radius: 8px;">
        <p style="margin: 0; font-size: 14px; color: #ef4444;">${t(lang, 'paymentFailed.reason')}</p>
      </div>
      ${payUrl ? `<p style="font-size: 15px; color: #a0a0a0; line-height: 1.6;">${t(lang, 'paymentFailed.payMessage')}</p>` : ''}
      <div style="margin: 25px 0;">
        <a href="${ctaUrl}" style="display: inline-block; background: #6366f1; color: #ffffff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px;">${ctaLabel}</a>
      </div>
      <p style="font-size: 14px; color: #666; line-height: 1.6;">${t(lang, 'paymentFailed.footer')}</p>
    </div>
  `;

  return {
    subject: t(lang, 'paymentFailed.subject'),
    html: getEmailTemplate(lang, t(lang, 'paymentFailed.title'), content, { gradient: 'linear-gradient(135deg, #ef4444, #b91c1c)', preheader: t(lang, 'paymentFailed.reason') }),
    text: `${t(lang, 'paymentFailed.greeting')} ${user.name}, ${t(lang, 'paymentFailed.message')}`
  };
}

// ─── Device Email Templates ───

// `manageUrl` is a tokenised link to the standalone device-management page.
// It replaces the old /subscription link, which only worked if the email was
// opened on a device that already had a session — never true for the device
// that was just blocked, which is exactly who needs to act. Falls back to
// /subscription when no token was issued.
export function getDeviceBlockedEmailTemplate(user, maxDevices, deviceInfo, ipAddress, lang = 'es', manageUrl = null) {
  const plural = maxDevices > 1 ? 's' : '';
  const locale = lang === 'es' ? 'es-ES' : 'en-US';
  const content = `
    <div style="padding: 30px;">
      <p style="font-size: 16px; color: #e0e0e0; line-height: 1.6;">${t(lang, 'deviceBlocked.greeting')} <strong>${user.name}</strong>,</p>
      <p style="font-size: 15px; color: #a0a0a0; line-height: 1.6;">${t(lang, 'deviceBlocked.message', { maxDevices, plural })}</p>
      <div style="margin: 20px 0; background: #111; border: 1px solid #1a1a1a; border-radius: 10px; padding: 20px;">
        <p style="margin: 0 0 12px; font-size: 13px; font-weight: 700; color: #f59e0b;">${t(lang, 'deviceBlocked.details')}</p>
        <table style="width: 100%; border-collapse: collapse;">
          <tr><td style="padding: 6px 0; font-size: 13px; color: #888; width: 140px;">${t(lang, 'deviceBlocked.labelDevice')}</td><td style="padding: 6px 0; font-size: 13px; color: #e0e0e0;">${deviceInfo.deviceName || 'Unknown'}</td></tr>
          <tr><td style="padding: 6px 0; font-size: 13px; color: #888;">${t(lang, 'deviceBlocked.labelBrowser')}</td><td style="padding: 6px 0; font-size: 13px; color: #e0e0e0;">${deviceInfo.browser || 'Unknown'}</td></tr>
          <tr><td style="padding: 6px 0; font-size: 13px; color: #888;">${t(lang, 'deviceBlocked.labelOs')}</td><td style="padding: 6px 0; font-size: 13px; color: #e0e0e0;">${deviceInfo.os || 'Unknown'}</td></tr>
          <tr><td style="padding: 6px 0; font-size: 13px; color: #888;">${t(lang, 'deviceBlocked.labelIp')}</td><td style="padding: 6px 0; font-size: 13px; color: #e0e0e0;">${ipAddress}</td></tr>
          <tr><td style="padding: 6px 0; font-size: 13px; color: #888;">${t(lang, 'deviceBlocked.labelTime')}</td><td style="padding: 6px 0; font-size: 13px; color: #e0e0e0;">${new Date().toLocaleString(locale)}</td></tr>
        </table>
      </div>
      <p style="font-size: 14px; color: #a0a0a0; line-height: 1.6;">${t(lang, 'deviceBlocked.footer')}</p>
      <p style="font-size: 14px; color: #a0a0a0; line-height: 1.6;">${t(lang, 'deviceBlocked.notYou')}</p>
      <div style="margin: 25px 0;">
        <a href="${manageUrl || `${FRONTEND_URL}/subscription`}" style="display: inline-block; background: #7c3aed; color: #ffffff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px;">${t(lang, 'deviceBlocked.manageLink')}</a>
        ${manageUrl ? `<p style="margin: 12px 0 0; font-size: 12px; color: #666;">${lang === 'es' ? 'Este enlace caduca en 30 minutos y solo permite gestionar tus dispositivos.' : 'This link expires in 30 minutes and only allows managing your devices.'}</p>` : ''}
      </div>
    </div>
  `;
  return {
    subject: t(lang, 'deviceBlocked.subject'),
    html: getEmailTemplate(lang, t(lang, 'deviceBlocked.title'), content, { gradient: 'linear-gradient(135deg, #f59e0b, #d97706)' }),
    text: `${t(lang, 'deviceBlocked.greeting')} ${user.name}, ${t(lang, 'deviceBlocked.message', { maxDevices, plural })}`
  };
}

export function getNewDeviceEmailTemplate(user, deviceInfo, ipAddress, lang = 'es') {
  const locale = lang === 'es' ? 'es-ES' : 'en-US';
  const content = `
    <div style="padding: 30px;">
      <p style="font-size: 16px; color: #e0e0e0; line-height: 1.6;">${t(lang, 'newDevice.greeting')} <strong>${user.name}</strong>,</p>
      <p style="font-size: 15px; color: #a0a0a0; line-height: 1.6;">${t(lang, 'newDevice.message')}</p>
      <div style="margin: 20px 0; background: #111; border: 1px solid #1a1a1a; border-radius: 10px; padding: 20px;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr><td style="padding: 6px 0; font-size: 13px; color: #888; width: 140px;">${t(lang, 'newDevice.labelDevice')}</td><td style="padding: 6px 0; font-size: 13px; color: #e0e0e0;">${deviceInfo.deviceName || 'Unknown'}</td></tr>
          <tr><td style="padding: 6px 0; font-size: 13px; color: #888;">${t(lang, 'newDevice.labelType')}</td><td style="padding: 6px 0; font-size: 13px; color: #e0e0e0;">${deviceInfo.deviceType || 'Unknown'}</td></tr>
          <tr><td style="padding: 6px 0; font-size: 13px; color: #888;">${t(lang, 'newDevice.labelIp')}</td><td style="padding: 6px 0; font-size: 13px; color: #e0e0e0;">${ipAddress}</td></tr>
          <tr><td style="padding: 6px 0; font-size: 13px; color: #888;">${t(lang, 'newDevice.labelTime')}</td><td style="padding: 6px 0; font-size: 13px; color: #e0e0e0;">${new Date().toLocaleString(locale)}</td></tr>
        </table>
      </div>
      <p style="font-size: 14px; color: #a0a0a0; line-height: 1.6;">${t(lang, 'newDevice.footer')}</p>
      <p style="font-size: 14px; color: #666; line-height: 1.6;">${t(lang, 'newDevice.manage')}</p>
    </div>
  `;
  return {
    subject: t(lang, 'newDevice.subject'),
    html: getEmailTemplate(lang, t(lang, 'newDevice.title'), content, { gradient: 'linear-gradient(135deg, #10b981, #059669)' }),
    text: `${t(lang, 'newDevice.greeting')} ${user.name}, ${t(lang, 'newDevice.message')}`
  };
}

export function getDeviceRemovedEmailTemplate(user, removedDevice, lang = 'es') {
  const locale = lang === 'es' ? 'es-ES' : 'en-US';
  const deviceLabel = removedDevice.deviceName || ((removedDevice.browser || '') + ' on ' + (removedDevice.os || ''));
  const content = `
    <div style="padding: 30px;">
      <p style="font-size: 16px; color: #e0e0e0; line-height: 1.6;">${t(lang, 'deviceRemoved.greeting')} <strong>${user.name}</strong>,</p>
      <p style="font-size: 15px; color: #a0a0a0; line-height: 1.6;">${t(lang, 'deviceRemoved.message')}</p>
      <div style="margin: 20px 0; background: #111; border: 1px solid #1a1a1a; border-radius: 10px; padding: 20px;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr><td style="padding: 6px 0; font-size: 13px; color: #888; width: 140px;">${t(lang, 'deviceRemoved.labelDevice')}</td><td style="padding: 6px 0; font-size: 13px; color: #e0e0e0;">${deviceLabel}</td></tr>
          <tr><td style="padding: 6px 0; font-size: 13px; color: #888;">${t(lang, 'deviceRemoved.labelRemoved')}</td><td style="padding: 6px 0; font-size: 13px; color: #e0e0e0;">${new Date().toLocaleString(locale)}</td></tr>
        </table>
      </div>
      <p style="font-size: 14px; color: #a0a0a0; line-height: 1.6;">${t(lang, 'deviceRemoved.footer')}</p>
    </div>
  `;
  return {
    subject: t(lang, 'deviceRemoved.subject'),
    html: getEmailTemplate(lang, t(lang, 'deviceRemoved.title'), content, { gradient: 'linear-gradient(135deg, #ef4444, #dc2626)' }),
    text: `${t(lang, 'deviceRemoved.greeting')} ${user.name}, ${t(lang, 'deviceRemoved.message')}`
  };
}

export function getSignOutAllEmailTemplate(user, deviceCount, lang = 'es') {
  const locale = lang === 'es' ? 'es-ES' : 'en-US';
  const content = `
    <div style="padding: 30px;">
      <p style="font-size: 16px; color: #e0e0e0; line-height: 1.6;">${t(lang, 'signOutAll.greeting')} <strong>${user.name}</strong>,</p>
      <p style="font-size: 15px; color: #a0a0a0; line-height: 1.6;">${t(lang, 'signOutAll.message', { count: deviceCount })}</p>
      <div style="margin: 15px 0; padding: 12px 16px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.2); border-radius: 8px;">
        <p style="margin: 0; font-size: 13px; color: #e0e0e0;"><strong>${t(lang, 'signOutAll.labelTime')}</strong> ${new Date().toLocaleString(locale)}</p>
      </div>
      <p style="font-size: 14px; color: #a0a0a0; line-height: 1.6;">${t(lang, 'signOutAll.footer')}</p>
      <p style="font-size: 14px; color: #a0a0a0; line-height: 1.6;">${t(lang, 'signOutAll.notYou')}</p>
    </div>
  `;
  return {
    subject: t(lang, 'signOutAll.subject'),
    html: getEmailTemplate(lang, t(lang, 'signOutAll.title'), content, { gradient: 'linear-gradient(135deg, #ef4444, #b91c1c)' }),
    text: `${t(lang, 'signOutAll.greeting')} ${user.name}, ${t(lang, 'signOutAll.message', { count: deviceCount })}`
  };
}

// ─── Admin Notification Templates ───

function getAdminEmailTemplate(title, content) {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#0f0f0f;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#0f0f0f;">
    <tr>
      <td align="center" style="padding:20px 10px;">
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;width:100%;background:#0a0a0a;color:#ffffff;border-radius:12px;overflow:hidden;">
          <div style="background:linear-gradient(135deg,#f59e0b,#d97706);padding:30px;text-align:center;">
            <h1 style="margin:0;font-size:22px;font-weight:700;color:#ffffff;">Admin Notification</h1>
            <p style="margin:8px 0 0;font-size:14px;color:rgba(255,255,255,0.85);">${title}</p>
          </div>
          ${content}
          <div style="padding:16px 30px;border-top:1px solid #1a1a1a;text-align:center;">
            <p style="margin:0;font-size:11px;color:#555;">© ${year} TodoDJs Admin &middot; Automated notification</p>
          </div>
        </div>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function formatDate(date) {
  return new Date(date).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
  });
}

function adminInfoRow(label, value) {
  return `
    <tr>
      <td style="padding: 8px 0; font-size: 13px; color: #888; width: 140px; vertical-align: top;">${label}</td>
      <td style="padding: 8px 0; font-size: 14px; color: #e0e0e0; font-weight: 500;">${value}</td>
    </tr>
  `;
}

export function getAdminNewSignupTemplate(user) {
  const content = `
    <div style="padding: 30px;">
      <p style="font-size: 15px; color: #a0a0a0; margin: 0 0 20px;">A new user has registered on TodoDJs.</p>
      <table style="width: 100%; border-collapse: collapse; background: #111; border-radius: 8px; padding: 16px;">
        <tbody style="display: block; padding: 16px;">
          ${adminInfoRow('Name', user.name)}
          ${adminInfoRow('Email', `<a href="mailto:${user.email}" style="color: #6366f1; text-decoration: none;">${user.email}</a>`)}
          ${adminInfoRow('Phone', user.phoneNumber || 'Not provided')}
          ${adminInfoRow('Language', (user.preferredLanguage || 'en').toUpperCase())}
          ${adminInfoRow('Registered', formatDate(new Date()))}
        </tbody>
      </table>
    </div>
  `;

  return {
    subject: `🆕 New Signup: ${user.name} (${user.email})`,
    html: getAdminEmailTemplate('New User Registration', content),
    text: `New user registered: ${user.name} (${user.email})`
  };
}

export function getAdminNewPaymentTemplate(user, plan, amount, currency) {
  const content = `
    <div style="padding: 30px;">
      <p style="font-size: 15px; color: #a0a0a0; margin: 0 0 20px;">A payment has been received!</p>
      <table style="width: 100%; border-collapse: collapse; background: #111; border-radius: 8px; padding: 16px;">
        <tbody style="display: block; padding: 16px;">
          ${adminInfoRow('User', user.name)}
          ${adminInfoRow('Email', `<a href="mailto:${user.email}" style="color: #6366f1; text-decoration: none;">${user.email}</a>`)}
          ${adminInfoRow('Plan', `<span style="color: #10b981; font-weight: 700;">${plan}</span>`)}
          ${adminInfoRow('Amount', `<span style="color: #10b981; font-weight: 700;">${currency || '€'}${amount}</span>`)}
          ${adminInfoRow('Date', formatDate(new Date()))}
        </tbody>
      </table>
      <div style="margin-top: 20px; padding: 12px 16px; background: #10b981/10; border: 1px solid #10b98133; border-radius: 8px;">
        <p style="margin: 0; font-size: 14px; color: #10b981;">💰 Revenue received! Subscription activated.</p>
      </div>
    </div>
  `;

  return {
    subject: `💰 New Payment: ${user.name} — ${currency || '€'}${amount} (${plan})`,
    html: getAdminEmailTemplate('New Payment Received', content),
    text: `Payment received from ${user.name} (${user.email}): ${currency || '€'}${amount} for ${plan}`
  };
}

export function getAdminCancelledSubscriptionTemplate(user, planName) {
  const content = `
    <div style="padding: 30px;">
      <p style="font-size: 15px; color: #a0a0a0; margin: 0 0 20px;">A user has cancelled their subscription.</p>
      <table style="width: 100%; border-collapse: collapse; background: #111; border-radius: 8px; padding: 16px;">
        <tbody style="display: block; padding: 16px;">
          ${adminInfoRow('User', user.name)}
          ${adminInfoRow('Email', `<a href="mailto:${user.email}" style="color: #6366f1; text-decoration: none;">${user.email}</a>`)}
          ${adminInfoRow('Plan', `<span style="color: #ef4444;">${planName || 'N/A'}</span>`)}
          ${adminInfoRow('Cancelled At', formatDate(new Date()))}
        </tbody>
      </table>
      <div style="margin-top: 20px; padding: 12px 16px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.2); border-radius: 8px;">
        <p style="margin: 0; font-size: 14px; color: #ef4444;">⚠️ Subscription cancelled. Consider reaching out to the user.</p>
      </div>
    </div>
  `;

  return {
    subject: `❌ Subscription Cancelled: ${user.name} (${user.email})`,
    html: getAdminEmailTemplate('Subscription Cancelled', content),
    text: `Subscription cancelled by ${user.name} (${user.email}), plan: ${planName || 'N/A'}`
  };
}

export function getAdminExpiredSubscriptionTemplate(user, planName) {
  const content = `
    <div style="padding: 30px;">
      <p style="font-size: 15px; color: #a0a0a0; margin: 0 0 20px;">A user's subscription has expired.</p>
      <table style="width: 100%; border-collapse: collapse; background: #111; border-radius: 8px; padding: 16px;">
        <tbody style="display: block; padding: 16px;">
          ${adminInfoRow('User', user.name)}
          ${adminInfoRow('Email', `<a href="mailto:${user.email}" style="color: #6366f1; text-decoration: none;">${user.email}</a>`)}
          ${adminInfoRow('Plan', planName || 'N/A')}
          ${adminInfoRow('Expired At', formatDate(new Date()))}
        </tbody>
      </table>
    </div>
  `;

  return {
    subject: `⏰ Subscription Expired: ${user.name} (${user.email})`,
    html: getAdminEmailTemplate('Subscription Expired', content),
    text: `Subscription expired for ${user.name} (${user.email}), plan: ${planName || 'N/A'}`
  };
}

export default {
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
};
