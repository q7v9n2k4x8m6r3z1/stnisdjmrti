import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function TermsPage() {
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const isEs = i18n.language?.startsWith('es');

  return (
    <div className="min-h-screen bg-dark-bg">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-sm text-brand-text-tertiary hover:text-white mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {isEs ? 'Volver' : 'Back'}
        </button>

        <h1 className="text-3xl font-bold text-white mb-2">{isEs ? 'Términos y Condiciones' : 'Terms and Conditions'}</h1>
        <p className="text-sm text-brand-text-tertiary mb-10">{isEs ? 'Última actualización: junio de 2026' : 'Last updated: June 2026'}</p>

        <div className="space-y-8 text-sm text-brand-text-secondary leading-relaxed">

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">{isEs ? '1. Partes del Contrato' : '1. Parties to the Contract'}</h2>
            <p>
              {isEs
                ? 'TodoDJS regula la relación contractual con cualquier persona física o jurídica que utilice la plataforma (en adelante, «el usuario»).'
                : 'TodoDJS regulates the contractual relationship with any natural or legal person who uses the platform (hereinafter, "the user").'}
            </p>
            <p className="mt-2">
              {isEs
                ? 'El acceso a la plataforma implica la aceptación íntegra de estos Términos. Si no está de acuerdo, debe abstenerse de utilizar el servicio.'
                : 'Access to the platform implies full acceptance of these Terms. If you do not agree, you must refrain from using the service.'}
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">{isEs ? '2. Descripción del Servicio' : '2. Description of the Service'}</h2>
            <p>
              {isEs
                ? 'TodoDJS es una plataforma de música digital que proporciona a los usuarios registrados acceso a pistas de audio, mashups y recursos para uso profesional en actuaciones de DJ. El acceso completo está condicionado a la suscripción a uno de los planes disponibles.'
                : 'TodoDJS is a digital music platform that provides registered users with access to audio tracks, mashups, and resources for professional use in DJ performances. Full access is conditional on subscribing to one of the available plans.'}
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">{isEs ? '3. Registro y Cuenta de Usuario' : '3. Registration and User Account'}</h2>
            <p>{isEs ? 'Para utilizar los servicios de pago, el usuario debe crear una cuenta proporcionando:' : 'To use the paid services, the user must create an account by providing:'}</p>
            <ul className="mt-2 space-y-1 pl-4 list-disc list-inside">
              {isEs ? (
                <><li>Nombre completo o nombre artístico</li><li>Dirección de correo electrónico válida</li><li>Contraseña segura</li></>
              ) : (
                <><li>Full name or artistic name</li><li>Valid email address</li><li>Secure password</li></>
              )}
            </ul>
            <p className="mt-3">
              {isEs
                ? 'El usuario es responsable de mantener la confidencialidad de sus credenciales. En caso de uso no autorizado, debe notificarlo inmediatamente a '
                : 'The user is responsible for maintaining the confidentiality of their credentials. In the event of unauthorized use, they must notify '}
              <a href="mailto:contacto.tododjs@gmail.com" className="text-accent hover:underline">contacto.tododjs@gmail.com</a>
              {isEs ? ' de inmediato.' : ' immediately.'}
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">{isEs ? '4. Planes de Suscripción' : '4. Subscription Plans'}</h2>
            <p>{isEs ? 'TodoDJS ofrece los siguientes tipos de plan:' : 'TodoDJS offers the following plan types:'}</p>
            <div className="mt-3 space-y-4">
              <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                <p className="font-semibold text-white mb-1">{isEs ? 'Individual Mensual' : 'Individual Monthly'}</p>
                <p className="text-xs text-brand-text-tertiary">
                  {isEs
                    ? 'Acceso completo para 1 dispositivo registrado. Renovación automática mensual. Cancelable en cualquier momento con acceso hasta fin del período pagado.'
                    : 'Full access for 1 registered device. Automatic monthly renewal. Cancelable at any time with access until the end of the paid period.'}
                </p>
              </div>
              <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                <p className="font-semibold text-white mb-1">{isEs ? 'Compartido (Mensual y Trimestral)' : 'Shared (Monthly and Quarterly)'}</p>
                <p className="text-xs text-brand-text-tertiary">
                  {isEs
                    ? 'Acceso para hasta 2 dispositivos registrados. Permite compartir con un segundo usuario. Renovación automática según el ciclo contratado.'
                    : 'Access for up to 2 registered devices. Allows sharing with a second user. Automatic renewal according to the contracted cycle.'}
                </p>
              </div>
            </div>
            <p className="mt-3">
              {isEs
                ? 'Los precios están disponibles en la página de precios y pueden modificarse con 30 días de preaviso.'
                : 'Prices are available on the pricing page and may be modified with 30 days\' notice.'}
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">{isEs ? '5. Pagos y Facturación' : '5. Payments and Billing'}</h2>
            <p>
              {isEs
                ? 'Stripe Inc. procesa los pagos. TodoDJS no almacena datos completos de tarjetas bancarias.'
                : 'Stripe Inc. processes payments. TodoDJS does not store full bank card data.'}
            </p>
            <ul className="mt-3 space-y-2 pl-4 list-disc list-inside">
              {isEs ? (
                <>
                  <li>Las suscripciones se renuevan automáticamente al final de cada período salvo cancelación previa.</li>
                  <li>El cargo se realiza en la tarjeta asociada a la cuenta en la fecha de renovación.</li>
                  <li>Si el pago falla, Stripe puede reintentar automáticamente el cobro en los días siguientes.</li>
                  <li>Durante el período de reintento, el acceso puede quedar suspendido temporalmente.</li>
                  <li>Al recuperar el pago, el acceso se restaura automáticamente sin intervención manual.</li>
                  <li>Se enviará un recibo o confirmación por correo electrónico tras cada cargo exitoso.</li>
                </>
              ) : (
                <>
                  <li>Subscriptions are automatically renewed at the end of each period unless canceled in advance.</li>
                  <li>The charge is made to the card associated with the account on the renewal date.</li>
                  <li>If the payment fails, Stripe may automatically retry charging in the following days.</li>
                  <li>During the retry period, access may be temporarily suspended.</li>
                  <li>Upon successful payment recovery, access is automatically restored without manual intervention.</li>
                  <li>A receipt or confirmation will be sent via email after each successful charge.</li>
                </>
              )}
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">{isEs ? '6. Cancelación y Reembolsos' : '6. Cancellation and Refunds'}</h2>
            <p>
              {isEs
                ? 'El usuario puede cancelar su suscripción en cualquier momento desde el panel de gestión de suscripción. La cancelación surte efecto al final del período de facturación en curso, conservando el acceso hasta esa fecha.'
                : 'The user can cancel their subscription at any time from the subscription management panel. The cancellation takes effect at the end of the current billing period, with access retained until that date.'}
            </p>
            <p className="mt-2">
              {isEs
                ? 'Debido a la naturaleza digital e inmediata del servicio ofrecido por TodoDJS, los pagos realizados no son reembolsables una vez activada la suscripción y concedido el acceso a la plataforma.'
                : 'Due to the digital and immediate nature of the service offered by TodoDJS, payments made are non-refundable once the subscription is activated and access to the platform is granted.'}
            </p>
            <p className="mt-2">{isEs ? 'No se considerarán reembolsos por:' : 'Refunds will not be considered for:'}</p>
            <ul className="mt-2 space-y-1 pl-4 list-disc list-inside">
              {isEs ? (
                <>
                  <li>Tiempo de suscripción no utilizado</li>
                  <li>Cancelaciones voluntarias del usuario</li>
                  <li>Falta de uso del servicio</li>
                  <li>Desconocimiento de las funcionalidades o condiciones de la suscripción</li>
                </>
              ) : (
                <>
                  <li>Unused subscription time remaining</li>
                  <li>Voluntary user cancellations</li>
                  <li>Lack of use of the service</li>
                  <li>Ignorance of the subscription's functionalities or conditions</li>
                </>
              )}
            </ul>
            <p className="mt-2">{isEs ? 'Posibles reembolsos solo podrán revisarse en casos excepcionales, como:' : 'Possible refunds may only be reviewed in exceptional cases, such as:'}</p>
            <ul className="mt-2 space-y-1 pl-4 list-disc list-inside">
              {isEs ? (
                <>
                  <li>Cargos duplicados demostrables</li>
                  <li>Errores técnicos graves directamente imputables a la plataforma</li>
                </>
              ) : (
                <>
                  <li>Demonstrable duplicate charges</li>
                  <li>Serious technical errors directly attributable to the platform</li>
                </>
              )}
            </ul>
            <p className="mt-3">
              {isEs ? 'Para cualquier problema relacionado con pagos o facturación: ' : 'For any issues related to payments or billing: '}
              <a href="mailto:contacto.tododjs@gmail.com" className="text-accent hover:underline">contacto.tododjs@gmail.com</a>
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">{isEs ? '7. Uso del Servicio y del Contenido' : '7. Use of the Service and Content'}</h2>
            <p>
              {isEs
                ? 'El acceso a la plataforma y a sus contenidos está limitado exclusivamente a los usuarios registrados dentro de los términos de la suscripción contratada. El contenido disponible en TodoDJS está destinado únicamente al uso personal y profesional relacionado con actividades de DJ y reproducción musical privada.'
                : 'Access to the platform and its content is limited exclusively to registered users within the terms of the contracted subscription. The content available on TodoDJS is intended solely for personal and professional use related to DJ activities and private music playback.'}
            </p>
            <p className="mt-3">{isEs ? 'Está expresamente prohibido:' : 'It is expressly prohibited to:'}</p>
            <ul className="mt-2 space-y-1 pl-4 list-disc list-inside">
              {isEs ? (
                <>
                  <li>Redistribuir, revender o compartir archivos descargados con terceros</li>
                  <li>Publicar contenido obtenido de la plataforma en servicios de streaming o plataformas públicas</li>
                  <li>Usar sistemas automatizados, bots o herramientas de descarga masiva</li>
                  <li>Compartir cuentas o accesos fuera de los límites permitidos por el plan contratado</li>
                  <li>Usar la plataforma para fines ilícitos o fraudulentos</li>
                </>
              ) : (
                <>
                  <li>Redistribute, resell, or share downloaded files with third parties</li>
                  <li>Publish content obtained from the platform on streaming services or public platforms</li>
                  <li>Use automated systems, bots, or bulk download tools</li>
                  <li>Share accounts or access outside the limits permitted by the contracted plan</li>
                  <li>Use the platform for illicit or fraudulent purposes</li>
                </>
              )}
            </ul>
            <p className="mt-3">
              {isEs
                ? 'TodoDJS podrá suspender o cancelar cuentas en las que se detecte actividad abusiva, uso indebido del servicio o incumplimiento de estos términos. Los usuarios son responsables del uso que hagan de los contenidos y recursos accesibles a través de la plataforma.'
                : 'TodoDJS may suspend or cancel accounts that detect abusive activity, misuse of the service, or non-compliance with these terms. Users are responsible for the use they make of the content and resources accessible through the platform.'}
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">{isEs ? '8. Límite de Dispositivos' : '8. Device Limit'}</h2>
            <p>
              {isEs
                ? 'Cada plan permite el acceso desde un número máximo de dispositivos registrados. El intento de conexión desde un dispositivo adicional será bloqueado, y el titular de la cuenta recibirá una notificación por correo electrónico. El titular puede gestionar y eliminar dispositivos desde su panel de suscripción.'
                : 'Each plan allows access from a maximum number of registered devices. The attempt to connect from an additional device will be blocked, and the account holder will receive a notification by email. The holder can manage and delete devices from their subscription panel.'}
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">{isEs ? '9. Uso Aceptable' : '9. Acceptable Use'}</h2>
            <p>{isEs ? 'El usuario se compromete a no:' : 'The user undertakes not to:'}</p>
            <ul className="mt-2 space-y-1 pl-4 list-disc list-inside">
              {isEs ? (
                <>
                  <li>Usar scrapers, bots o sistemas automatizados para descargar contenido masivamente</li>
                  <li>Intentar acceder a partes restringidas de la plataforma sin autorización</li>
                  <li>Compartir su contraseña o credenciales con terceros</li>
                  <li>Realizar actividades que perjudiquen la disponibilidad o integridad del servicio</li>
                  <li>Infringir derechos de propiedad intelectual de terceros</li>
                </>
              ) : (
                <>
                  <li>Use scrapers, bots, or automated systems to download content on a large scale</li>
                  <li>Attempt to access restricted parts of the platform without authorization</li>
                  <li>Share their password or credentials with third parties</li>
                  <li>Carry out any activity that harms the availability or integrity of the service</li>
                  <li>Infringe the intellectual property rights of third parties</li>
                </>
              )}
            </ul>
            <p className="mt-3">
              {isEs
                ? 'El incumplimiento de estas condiciones podrá resultar en la suspensión o cancelación inmediata de la cuenta sin derecho a reembolso.'
                : 'Non-compliance with these conditions may result in the immediate suspension or cancellation of the account without the right to a refund.'}
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">{isEs ? '10. Suspensión y Cancelación de Cuenta' : '10. Suspension and Cancellation of Account'}</h2>
            <p>
              {isEs
                ? 'TodoDJS se reserva el derecho de suspender o cancelar cuentas de usuario en los siguientes casos:'
                : 'TodoDJS reserves the right to suspend or cancel user accounts in the following cases:'}
            </p>
            <ul className="mt-2 space-y-1 pl-4 list-disc list-inside">
              {isEs ? (
                <>
                  <li>Incumplimiento de los presentes Términos</li>
                  <li>Impago de la suscripción tras los reintentos automáticos</li>
                  <li>Uso fraudulento o actividad ilícita</li>
                  <li>Solicitud expresa del usuario</li>
                </>
              ) : (
                <>
                  <li>Non-compliance with these Terms</li>
                  <li>Non-payment of the subscription after automatic retries</li>
                  <li>Fraudulent use or illicit activity</li>
                  <li>Express request of the user</li>
                </>
              )}
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">{isEs ? '11. Responsabilidad' : '11. Liability'}</h2>
            <p>
              {isEs
                ? 'TodoDJS no garantiza la disponibilidad ininterrumpida del servicio, pero se compromete a minimizar las interrupciones y a notificar los mantenimientos programados con antelación.'
                : 'TodoDJS does not guarantee the uninterrupted availability of the service, but it undertakes to minimize interruptions and to notify scheduled maintenance in advance.'}
            </p>
            <p className="mt-2">
              {isEs
                ? 'La responsabilidad total de TodoDJS frente al usuario, por cualquier causa, no excederá el importe abonado por el usuario en los últimos 3 meses de suscripción.'
                : 'TodoDJS\'s total liability to the user, for any reason, shall not exceed the amount paid by the user in the last 3 months of subscription.'}
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">{isEs ? '12. Modificación de los Términos' : '12. Modification of Terms'}</h2>
            <p>
              {isEs
                ? 'TodoDJS podrá modificar estos Términos notificando al usuario con al menos 15 días de antelación por correo electrónico. Si el usuario continúa utilizando el servicio tras la entrada en vigor de las modificaciones, se entenderá que las acepta.'
                : 'TodoDJS may modify these Terms by notifying the user at least 15 days in advance by email. If the user continues to use the service after the entry into force of the modifications, it will be understood that they accept them.'}
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">{isEs ? '13. Legislación Aplicable y Jurisdicción' : '13. Applicable Legislation and Jurisdiction'}</h2>
            <p>
              {isEs
                ? 'Estos Términos se regirán e interpretarán de conformidad con la legislación aplicable en el estado de Florida, Estados Unidos.'
                : 'These Terms shall be governed and interpreted in accordance with the applicable legislation in the state of Florida, United States.'}
            </p>
            <p className="mt-2">
              {isEs
                ? 'Cualquier controversia, reclamación o disputa relacionada con el acceso, uso o funcionamiento de la plataforma se someterá a la jurisdicción competente correspondiente al domicilio legal de TodoDJS, salvo que sean de aplicación disposiciones legales obligatorias.'
                : 'Any controversy, claim, or dispute related to the access, use, or operation of the platform will be submitted to the competent jurisdiction corresponding to the legal address of TodoDJS, unless applicable mandatory legal provisions apply.'}
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">{isEs ? '14. Límites de Descarga y Protección Anti-Piratería' : '14. Download Limits and Anti-Piracy Protection'}</h2>
            <p>
              {isEs
                ? 'Las descargas disponibles en TodoDJS están destinadas exclusivamente al uso personal y profesional relacionado con actuaciones de DJ. El sistema de la plataforma monitoriza los patrones de velocidad y frecuencia de descarga para detectar actividades incompatibles con un uso legítimo.'
                : 'Downloads available on TodoDJS are intended exclusively for personal and professional use related to DJ performances. The platform system monitors download speed and frequency patterns to detect activities incompatible with legitimate use.'}
            </p>
            <p className="mt-3">{isEs ? 'El sistema de protección opera en dos niveles:' : 'The protection system operates at two levels:'}</p>
            <div className="mt-3 space-y-3">
              <div className="p-4 rounded-xl bg-yellow-500/5 border border-yellow-500/20">
                <p className="font-semibold text-yellow-300 mb-1">{isEs ? 'Nivel 1 — Aviso' : 'Level 1 — Warning'}</p>
                <p className="text-xs text-brand-text-tertiary">
                  {isEs
                    ? 'Se activa al superar 10 descargas de álbumes (ZIP) en 30 minutos, o 100 pistas individuales (MP3) en 60 minutos. El usuario recibe un aviso informativo y puede continuar descargando con normalidad.'
                    : 'Triggered upon exceeding 10 album (ZIP) downloads within 30 minutes, or 100 individual track (MP3) downloads within 60 minutes. The user receives an informational notice and may continue downloading normally.'}
                </p>
              </div>
              <div className="p-4 rounded-xl bg-orange-500/5 border border-orange-500/20">
                <p className="font-semibold text-orange-300 mb-1">{isEs ? 'Nivel 2 — Pausa Temporal (24 horas)' : 'Level 2 — Temporary Pause (24 hours)'}</p>
                <p className="text-xs text-brand-text-tertiary">
                  {isEs
                    ? 'Se activa al superar 15 descargas de álbumes ZIP en 30 minutos, o 150 pistas MP3 en 60 minutos. Las descargas quedan suspendidas automáticamente durante 24 horas. La navegación y la escucha de contenido no se ven afectadas. Repetir este comportamiento puede resultar en la suspensión permanente de la cuenta sin derecho a reembolso.'
                    : 'Triggered upon exceeding 15 ZIP album downloads within 30 minutes, or 150 MP3 tracks within 60 minutes. Downloads are automatically suspended for 24 hours. Browsing and listening to content are not affected. Repeating this behavior may result in permanent account suspension without the right to a refund.'}
                </p>
              </div>
            </div>
            <p className="mt-2">
              {isEs
                ? 'Las cuentas con reincidencia o actividad incompatible con el uso legítimo de la plataforma podrán ser suspendidas o canceladas de forma permanente por TodoDJS, sin derecho a reembolso.'
                : 'Accounts with repeated violations or activity incompatible with legitimate platform use may be permanently suspended or cancelled by TodoDJS, without the right to a refund.'}
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">{isEs ? '15. Contacto' : '15. Contact'}</h2>
            <p>
              {isEs ? 'Para cualquier consulta sobre estos Términos:' : 'For any inquiries about these Terms:'}{' '}
              <a href="mailto:contacto.tododjs@gmail.com" className="text-accent hover:underline">
                contacto.tododjs@gmail.com
              </a>
            </p>
          </section>

        </div>
      </div>
    </div>
  );
}
