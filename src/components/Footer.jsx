import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Music2, Mail, Shield } from 'lucide-react';

export default function Footer() {
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const isEs = i18n.language?.startsWith('es');

  const legalLinks = [
    { label: isEs ? 'Aviso Legal' : 'Legal Notice', path: '/aviso-legal' },
    { label: isEs ? 'Privacidad' : 'Privacy Policy', path: '/privacidad' },
    { label: 'Cookies', path: '/cookies' },
    { label: isEs ? 'Términos y Condiciones' : 'Terms & Conditions', path: '/terminos' },
  ];

  return (
    <footer className="border-t border-white/5 bg-dark-bg/80 backdrop-blur-md mt-auto">
      <div className="max-w-6xl mx-auto px-6 py-10">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
          {/* Brand */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center">
                <Music2 className="w-4 h-4 text-accent" />
              </div>
              <span className="text-lg font-bold text-white">TodoDJS</span>
            </div>
            <p className="text-xs text-brand-text-tertiary leading-relaxed max-w-xs">
              {isEs
                ? 'Plataforma de música y recursos para DJs profesionales.'
                : 'Music platform and resources for professional DJs.'}
            </p>
          </div>

          {/* Legal links */}
          <div>
            <p className="text-xs font-semibold text-brand-text-tertiary uppercase tracking-widest mb-4 flex items-center gap-2">
              <Shield className="w-3.5 h-3.5" />
              {isEs ? 'Legal' : 'Legal'}
            </p>
            <ul className="space-y-2.5">
              {legalLinks.map((link) => (
                <li key={link.path}>
                  <button
                    onClick={() => navigate(link.path)}
                    className="text-sm text-brand-text-tertiary hover:text-white transition-colors duration-150"
                  >
                    {link.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div>
            <p className="text-xs font-semibold text-brand-text-tertiary uppercase tracking-widest mb-4 flex items-center gap-2">
              <Mail className="w-3.5 h-3.5" />
              {isEs ? 'Contacto' : 'Contact'}
            </p>
            <a
              href="mailto:contacto.tododjs@gmail.com"
              className="text-sm text-brand-text-tertiary hover:text-white transition-colors duration-150 block"
            >
              contacto.tododjs@gmail.com
            </a>
          </div>
        </div>

        {/* Bottom bar — copyright only. The build credit that sat here was
            removed at the owner's request; centred now that it is alone. */}
        <div className="pt-6 border-t border-white/5 flex items-center justify-center">
          <p className="text-xs text-brand-text-tertiary text-center">
            © {new Date().getFullYear()} TodoDJS.{' '}
            {isEs ? 'Todos los derechos reservados.' : 'All rights reserved.'}
          </p>
        </div>
      </div>
    </footer>
  );
}
