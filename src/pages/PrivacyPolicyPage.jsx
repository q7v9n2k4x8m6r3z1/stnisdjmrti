import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CONTACT_EMAIL, CONTACT_ADDRESS, ContactEmail } from '../utils/contact.jsx';

export default function PrivacyPolicyPage() {
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

        <h1 className="text-3xl font-bold text-white mb-2">{isEs ? 'Política de Privacidad' : 'Privacy Policy'}</h1>
        <p className="text-sm text-brand-text-tertiary mb-10">{isEs ? 'Última actualización: junio de 2026' : 'Last updated: June 2026'}</p>

        <div className="space-y-8 text-sm text-brand-text-secondary leading-relaxed">

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">{isEs ? '1. Responsable del Tratamiento' : '1. Data Controller'}</h2>
            <ul className="space-y-1 pl-4 list-disc list-inside">
              <li><strong className="text-white">{isEs ? 'Responsable:' : 'Data Controller:'}</strong> TodoDJS</li>
              {/* Omitted entirely when unconfigured — a label with nothing
                  after it reads worse than no row, and makes a misconfigured
                  build harder to spot. */}
              {CONTACT_ADDRESS && (
                <li><strong className="text-white">{isEs ? 'Dirección:' : 'Address:'}</strong> {CONTACT_ADDRESS}</li>
              )}
              {CONTACT_EMAIL && (
                <li><strong className="text-white">{isEs ? 'Correo electrónico:' : 'Email:'}</strong> {CONTACT_EMAIL}</li>
              )}
              <li><strong className="text-white">{isEs ? 'Sitio web:' : 'Website:'}</strong> www.tododjs.com</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">{isEs ? '2. Datos que Recabamos' : '2. Data We Collect'}</h2>
            <p>{isEs ? 'Podemos recopilar las siguientes categorías de datos:' : 'We may collect the following categories of data:'}</p>
            <ul className="mt-3 space-y-2 pl-4 list-disc list-inside">
              {isEs ? (
                <>
                  <li><strong className="text-white">Datos de registro:</strong> nombre, correo electrónico y credenciales de acceso.</li>
                  <li><strong className="text-white">Datos de contacto:</strong> número de teléfono facilitado voluntariamente por el usuario.</li>
                  <li><strong className="text-white">Datos de suscripción:</strong> plan contratado, estado de la suscripción, renovaciones y pagos asociados.</li>
                  <li><strong className="text-white">Datos de uso:</strong> actividad en la plataforma, descargas realizadas, direcciones IP, dispositivos y accesos.</li>
                  <li><strong className="text-white">Datos técnicos:</strong> navegador, sistema operativo y registros básicos de seguridad y acceso.</li>
                  <li><strong className="text-white">Datos de comportamiento de descarga:</strong> marcas de tiempo, tipo de archivo (MP3/ZIP), intervalos entre descargas y patrones consecutivos, utilizados exclusivamente para la protección anti-piratería y la integridad de la plataforma.</li>
                </>
              ) : (
                <>
                  <li><strong className="text-white">Registration data:</strong> name, email, and access credentials.</li>
                  <li><strong className="text-white">Contact data:</strong> phone number voluntarily provided by the user.</li>
                  <li><strong className="text-white">Subscription data:</strong> plan contracted, subscription status, renewals, and associated payments.</li>
                  <li><strong className="text-white">Usage data:</strong> activity within the platform, downloads made, IP addresses, devices, and accesses.</li>
                  <li><strong className="text-white">Technical data:</strong> browser, operating system, and basic security and access logs.</li>
                  <li><strong className="text-white">Download behaviour data:</strong> timestamps, file type (MP3/ZIP), intervals between downloads, and consecutive download patterns, used exclusively for anti-piracy protection and platform integrity.</li>
                </>
              )}
            </ul>
            <p className="mt-3">
              {isEs
                ? 'Los pagos son procesados por proveedores externos especializados. TodoDJS no almacena directamente datos completos de tarjetas bancarias.'
                : 'Payments are processed by specialized external providers. TodoDJS does not directly store full bank card data.'}
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">{isEs ? '3. Finalidad del Tratamiento' : '3. Purpose of Processing'}</h2>
            <p>{isEs ? 'Los datos podrán utilizarse para:' : 'The data may be used for:'}</p>
            <ul className="mt-3 space-y-1 pl-4 list-disc list-inside">
              {isEs ? (
                <>
                  <li>Gestionar el acceso y el funcionamiento de la plataforma</li>
                  <li>Gestionar suscripciones y pagos</li>
                  <li>Enviar comunicaciones relacionadas con la cuenta o el servicio</li>
                  <li>Mejorar el funcionamiento, la estabilidad y la seguridad de la plataforma</li>
                  <li>Prevenir abusos, accesos no autorizados o usos fraudulentos</li>
                  <li>Cumplir con las obligaciones legales aplicables</li>
                </>
              ) : (
                <>
                  <li>Managing access and operation of the platform</li>
                  <li>Managing subscriptions and payments</li>
                  <li>Sending communications related to the account or the service</li>
                  <li>Improving the operation, stability, and security of the platform</li>
                  <li>Preventing abuses, unauthorized access, or fraudulent use</li>
                  <li>Complying with applicable legal obligations</li>
                </>
              )}
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">{isEs ? '4. Conservación de Datos' : '4. Data Retention'}</h2>
            <p>
              {isEs
                ? 'Los datos se conservarán mientras exista una relación activa con el usuario y durante el tiempo necesario para cumplir con obligaciones legales, resolver incidencias o proteger los intereses legítimos de la plataforma.'
                : 'The data will be retained as long as there is an active relationship with the user and for the time necessary to comply with legal obligations, resolve incidents, or protect the legitimate interests of the platform.'}
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">{isEs ? '5. Cesión de Datos' : '5. Data Sharing'}</h2>
            <p>
              {isEs
                ? 'Los datos podrán ser tratados por proveedores tecnológicos y servicios externos necesarios para el funcionamiento de la plataforma, incluyendo procesamiento de pagos, alojamiento, seguridad y comunicaciones. Asimismo, los datos podrán ser facilitados cuando exista obligación legal o solicitud válida de una autoridad competente.'
                : 'The data may be processed by technological providers and external services necessary for the operation of the platform, including payment processing, hosting, security, and communications. Likewise, the data may be provided when there is a legal obligation or valid request from a competent authority.'}
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">{isEs ? '6. Transferencias Internacionales' : '6. International Transfers'}</h2>
            <p>
              {isEs
                ? 'Algunos proveedores tecnológicos utilizados por TodoDJS pueden estar ubicados fuera del país de residencia del usuario. El uso de la plataforma implica la aceptación de dichas transferencias cuando sean necesarias para la prestación del servicio.'
                : 'Some technological providers used by TodoDJS may be located outside the user\'s country of residence. The use of the platform implies acceptance of such transfers when they are necessary for the provision of the service.'}
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">{isEs ? '7. Derechos del Usuario' : '7. User Rights'}</h2>
            <p>
              {isEs
                ? 'El usuario puede solicitar el acceso, la rectificación o la eliminación de sus datos personales enviando una solicitud a:'
                : 'The user may request access, rectification, or deletion of their personal data by sending a request to:'}
            </p>
            <p className="mt-2">
              <ContactEmail />
            </p>
            <p className="mt-2">
              {isEs
                ? 'TodoDJS podrá solicitar información adicional para verificar la identidad del solicitante antes de tramitar cualquier solicitud relacionada con datos personales.'
                : 'TodoDJS may request additional information to verify the identity of the requestor before processing any request related to personal data.'}
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">{isEs ? '8. Seguridad' : '8. Security'}</h2>
            <p>
              {isEs
                ? 'TodoDJS adopta medidas técnicas y organizativas razonables orientadas a proteger la información de los usuarios frente a accesos no autorizados, alteración, pérdida o uso indebido.'
                : 'TodoDJS adopts reasonable technical and organizational measures aimed at protecting user information against unauthorized access, alteration, loss, or misuse.'}
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">{isEs ? '9. Menores de Edad' : '9. Minors'}</h2>
            <p>
              {isEs
                ? 'Los servicios de TodoDJS están destinados exclusivamente a mayores de 18 años. No recopilamos conscientemente información de menores de edad.'
                : 'TodoDJS services are intended exclusively for those over 18 years of age. We do not knowingly collect information from minors.'}
            </p>
          </section>

        </div>
      </div>
    </div>
  );
}
