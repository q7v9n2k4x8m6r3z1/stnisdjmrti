import { useState, useEffect, useCallback } from 'react';
import { Crown, Calendar, CreditCard, Users, Smartphone, Trash2, Loader, AlertCircle, X, CheckCircle, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import API_URL from '../config/api';

// Stripe promise loaded dynamically from backend to avoid placeholder env var issues
let cachedStripePromise = null;

const CARD_BRANDS = {
  visa: '💳',
  mastercard: '💳',
  amex: '💳',
  discover: '💳',
};

function UpdateCardForm({ onSuccess, onCancel, isSpanish }) {
  const stripe = useStripe();
  const elements = useElements();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSaving(true);
    setError('');

    const { error: submitErr } = await elements.submit();
    if (submitErr) { setError(submitErr.message); setSaving(false); return; }

    const { setupIntent, error: confirmErr } = await stripe.confirmSetup({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: 'if_required'
    });

    if (confirmErr) { setError(confirmErr.message); setSaving(false); return; }

    if (setupIntent?.payment_method) {
      try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/subscriptions/payment-method`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ paymentMethodId: setupIntent.payment_method })
        });
        const data = await res.json();
        if (data.success) { onSuccess(); }
        else { setError(data.message || 'Failed to save payment method'); }
      } catch (err) { setError('Network error. Please try again.'); }
    }
    setSaving(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement options={{ layout: 'accordion', defaultCollapsed: false }} />
      {error && <p className="text-red-400 text-sm">{error}</p>}
      <div className="flex gap-3 pt-2">
        <button type="submit" disabled={!stripe || saving}
          className="flex-1 py-2.5 bg-accent hover:bg-accent-hover text-white font-semibold rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
          {saving && <Loader className="w-4 h-4 animate-spin" />}
          {saving ? (isSpanish ? 'Guardando…' : 'Saving…') : (isSpanish ? 'Guardar tarjeta' : 'Save card')}
        </button>
        <button type="button" onClick={onCancel}
          className="px-4 py-2.5 border border-white/10 text-brand-text-tertiary hover:text-white rounded-lg transition-colors">
          {isSpanish ? 'Cancelar' : 'Cancel'}
        </button>
      </div>
    </form>
  );
}

export default function SubscriptionDashboard({ user, onUpdate }) {
  const { t, i18n } = useTranslation();
  const isSpanish = i18n.language?.startsWith('es');
  const fmtEur = (n) => new Intl.NumberFormat(isSpanish ? 'es-ES' : 'en-US', { style: 'currency', currency: 'EUR' }).format(parseFloat(n));

  const [subscriptionData, setSubscriptionData] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState(null);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Update card modal
  const [showUpdateCard, setShowUpdateCard] = useState(false);
  const [setupClientSecret, setSetupClientSecret] = useState('');
  const [setupLoading, setSetupLoading] = useState(false);
  const [cardUpdated, setCardUpdated] = useState(false);
  const [stripePromise, setStripePromise] = useState(null);

  const token = localStorage.getItem('token');
  const authHeaders = { Authorization: `Bearer ${token}` };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, pmRes, devRes] = await Promise.all([
        fetch(`${API_URL}/subscriptions/status`, { headers: authHeaders }),
        fetch(`${API_URL}/subscriptions/payment-method`, { headers: authHeaders }),
        fetch(`${API_URL}/subscriptions/devices`, { headers: authHeaders })
      ]);
      const [statusData, pmData, devData] = await Promise.all([
        statusRes.json(), pmRes.json(), devRes.json()
      ]);
      if (statusData.success) setSubscriptionData(statusData.data);
      if (pmData.success) setPaymentMethod(pmData.data);
      if (devData.success) setDevices(devData.data);
    } catch (err) {
      setError(isSpanish ? 'Error al cargar la suscripción' : 'Failed to load subscription');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const openUpdateCard = async () => {
    setSetupLoading(true);
    setShowUpdateCard(true);
    try {
      const [intentRes, configRes] = await Promise.all([
        fetch(`${API_URL}/subscriptions/setup-intent`, { method: 'POST', headers: authHeaders }),
        fetch(`${API_URL}/stripe/config`)
      ]);
      const [intentData, configData] = await Promise.all([intentRes.json(), configRes.json()]);

      if (!intentData.success) {
        setShowUpdateCard(false);
        setError(isSpanish ? 'Error al conectar con Stripe' : 'Failed to connect to Stripe');
        return;
      }

      const publishableKey = configData.publishableKey || import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '';
      if (!cachedStripePromise && publishableKey) {
        cachedStripePromise = loadStripe(publishableKey);
      }
      setStripePromise(cachedStripePromise);
      setSetupClientSecret(intentData.clientSecret);
    } catch {
      setShowUpdateCard(false);
    } finally {
      setSetupLoading(false);
    }
  };

  const handleCardUpdated = async () => {
    setShowUpdateCard(false);
    setSetupClientSecret('');
    setCardUpdated(true);
    await fetchAll();
    if (onUpdate) onUpdate();
    setTimeout(() => setCardUpdated(false), 5000);
  };

  const handleCancelSubscription = async () => {
    if (!confirm(isSpanish ? '¿Cancelar tu suscripción?' : 'Cancel your subscription?')) return;
    try {
      const res = await fetch(`${API_URL}/subscriptions/cancel`, {
        method: 'PUT', headers: authHeaders
      });
      const data = await res.json();
      if (data.success) { fetchAll(); if (onUpdate) onUpdate(); }
      else alert(data.message);
    } catch { alert(isSpanish ? 'Error al cancelar' : 'Failed to cancel'); }
  };

  const handleReactivate = async () => {
    try {
      const res = await fetch(`${API_URL}/payment/reactivate-subscription`, {
        method: 'POST', headers: authHeaders
      });
      const data = await res.json();
      if (data.success) { fetchAll(); if (onUpdate) onUpdate(); }
      else alert(data.message);
    } catch { alert(isSpanish ? 'Error al reactivar' : 'Failed to reactivate'); }
  };

  const handleRemoveDevice = async (deviceId) => {
    if (!confirm(t('subscriptionMgmt.removeDeviceConfirm'))) return;
    try {
      const res = await fetch(`${API_URL}/subscriptions/devices/${deviceId}`, {
        method: 'DELETE', headers: authHeaders
      });
      const data = await res.json();
      if (data.success) fetchAll();
      else alert(data.message);
    } catch { alert(isSpanish ? 'Error al eliminar dispositivo' : 'Failed to remove device'); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader className="w-8 h-8 text-accent animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-red-500/10 border border-red-500/20 rounded-xl">
        <div className="flex items-center gap-3">
          <AlertCircle className="w-6 h-6 text-red-400" />
          <p className="text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  if (!subscriptionData?.hasSubscription || !subscriptionData?.subscription) {
    return (
      <div className="text-center py-16">
        <Crown className="w-16 h-16 text-brand-text-tertiary mx-auto mb-4" />
        <h3 className="text-xl font-bold text-white mb-2">
          {isSpanish ? 'Sin suscripción activa' : 'No active subscription'}
        </h3>
        <p className="text-brand-text-tertiary mb-6">
          {isSpanish ? 'Suscríbete para acceder a todas las descargas.' : 'Subscribe to unlock all downloads.'}
        </p>
        <button onClick={() => window.location.href = '/pricing'}
          className="px-6 py-3 rounded-lg bg-accent hover:bg-accent-hover text-white font-semibold transition-all">
          {isSpanish ? 'Ver planes' : 'View plans'}
        </button>
      </div>
    );
  }

  const { subscription, plan, daysRemaining } = subscriptionData;
  const isPastDue = subscription.status === 'past_due';
  const isCancelled = subscription.status === 'cancelled';
  // Billed by Stripe whenever a Stripe subscription is attached — including an
  // account an admin also touched (grantedByAdmin). Excluding those hid the
  // card and the Cancel button from customers Stripe was still charging every
  // month, leaving them no way to stop the payments themselves.
  const isStripeManaged = !!subscription.stripeSubscriptionId;
  // past_due is cancellable too: a customer whose card failed must be able to
  // stop Stripe retrying, not only to update the card. The backend accepts it.
  const canCancel = ['active', 'past_due'].includes(subscription.status) && !subscription.cancelAtPeriodEnd;

  const normalizePlanName = (raw) => {
    if (!raw || raw === 'free') return 'Free';
    if (['premium', 'individual-monthly', 'individual-quarterly'].includes(raw)) return 'Premium';
    if (['pro', 'shared-monthly', 'shared-quarterly'].includes(raw)) return 'Pro';
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  };
  const planName = plan ? (isSpanish ? plan.nameEs : plan.name) : normalizePlanName(subscription?.plan || subscription?.planId);

  const nextPaymentDate = subscription.endDate ? new Date(subscription.endDate).toLocaleDateString(isSpanish ? 'es-ES' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
  const startDateFmt = subscription.startDate ? new Date(subscription.startDate).toLocaleDateString(isSpanish ? 'es-ES' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';

  const statusColors = {
    active: 'text-green-400',
    cancelled: 'text-yellow-400',
    past_due: 'text-red-400',
    expired: 'text-red-400',
    inactive: 'text-brand-text-tertiary'
  };
  const statusLabels = {
    active: isSpanish ? 'Activo' : 'Active',
    cancelled: isSpanish ? 'Cancelado' : 'Cancelled',
    past_due: isSpanish ? 'Pago fallido' : 'Payment failed',
    expired: isSpanish ? 'Expirado' : 'Expired',
    inactive: isSpanish ? 'Inactivo' : 'Inactive'
  };

  const cardBrandIcon = (brand) => {
    const b = (brand || '').toLowerCase();
    if (b === 'visa') return (
      <span className="inline-flex items-center justify-center w-10 h-6 bg-blue-700 rounded text-white text-xs font-black tracking-widest">VISA</span>
    );
    if (b === 'mastercard') return (
      <span className="inline-flex items-center justify-center w-10 h-6 rounded overflow-hidden">
        <span className="w-5 h-5 bg-red-500 rounded-full -mr-2 opacity-90" />
        <span className="w-5 h-5 bg-yellow-400 rounded-full opacity-90" />
      </span>
    );
    if (b === 'amex') return <span className="inline-flex items-center justify-center w-10 h-6 bg-sky-600 rounded text-white text-[9px] font-bold">AMEX</span>;
    return <CreditCard className="w-5 h-5 text-brand-text-tertiary" />;
  };

  return (
    <div className="space-y-5">

      {/* ── Payment failure banner ── */}
      {isPastDue && (
        <div className="flex items-start gap-4 p-4 rounded-xl bg-red-500/10 border border-red-500/30">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-red-400">
              {isSpanish
                ? 'Tu último pago no pudo completarse. Actualiza tu método de pago para recuperar el acceso.'
                : 'Your last payment could not be completed. Update your payment method to regain access.'}
            </p>
            <button onClick={openUpdateCard}
              className="mt-2 text-sm text-white font-semibold underline underline-offset-2 hover:text-red-300 transition-colors">
              {isSpanish ? 'Actualizar tarjeta →' : 'Update card →'}
            </button>
          </div>
        </div>
      )}

      {/* ── Card updated success ── */}
      {cardUpdated && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-green-500/10 border border-green-500/20">
          <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
          <p className="text-sm text-green-400 font-medium">
            {isSpanish ? 'Método de pago actualizado correctamente.' : 'Payment method updated successfully.'}
          </p>
        </div>
      )}

      {/* ── Cancellation scheduled ── */}
      {subscription.cancelAtPeriodEnd && !isPastDue && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/20">
          <AlertCircle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-yellow-400">
            {isSpanish
              ? `Tu suscripción se cancelará el ${nextPaymentDate}. Seguirás teniendo acceso hasta esa fecha.`
              : `Your subscription will cancel on ${nextPaymentDate}. You'll retain access until then.`}
          </p>
        </div>
      )}

      {/* ── Main subscription table ── */}
      <div className="bg-dark-surface/95 backdrop-blur-xl rounded-2xl border border-white/10 overflow-hidden">
        <div className="px-6 py-4 border-b border-white/5">
          <h2 className="text-lg font-bold text-white">
            {isSpanish ? 'Suscripción y pagos' : 'Subscription & Payments'}
          </h2>
        </div>

        <table className="w-full">
          <tbody className="divide-y divide-white/5">
            {/* Plan */}
            <tr>
              <td className="px-6 py-4 w-40 text-sm font-medium text-brand-text-secondary whitespace-nowrap">
                {isSpanish ? 'Suscripción' : 'Subscription'}
              </td>
              <td className="px-6 py-4 text-sm text-white font-semibold">{planName}</td>
            </tr>

            {/* Status */}
            <tr>
              <td className="px-6 py-4 text-sm font-medium text-brand-text-secondary whitespace-nowrap">
                {isSpanish ? 'Estado' : 'Status'}
              </td>
              <td className="px-6 py-4">
                <span className={`text-sm font-semibold ${statusColors[subscription.status] || 'text-white'}`}>
                  {statusLabels[subscription.status] || subscription.status}
                </span>
              </td>
            </tr>

            {/* Start date */}
            <tr>
              <td className="px-6 py-4 text-sm font-medium text-brand-text-secondary whitespace-nowrap">
                {isSpanish ? 'Fecha de inicio' : 'Start date'}
              </td>
              <td className="px-6 py-4 text-sm text-white">{startDateFmt}</td>
            </tr>

            {/* Next payment / expiry */}
            <tr>
              <td className="px-6 py-4 text-sm font-medium text-brand-text-secondary whitespace-nowrap">
                {isCancelled || isPastDue
                  ? (isSpanish ? 'Acceso hasta' : 'Access until')
                  : (isSpanish ? 'Próximo pago' : 'Next payment')}
              </td>
              <td className="px-6 py-4 text-sm text-white">
                {plan?.price && !isCancelled && !isPastDue
                  ? `${fmtEur(plan.price)} ${isSpanish ? 'el' : 'on'} ${nextPaymentDate}`
                  : nextPaymentDate}
              </td>
            </tr>

            {/* Payment method */}
            {isStripeManaged && (
              <tr>
                <td className="px-6 py-4 text-sm font-medium text-brand-text-secondary whitespace-nowrap">
                  {isSpanish ? 'Método de pago' : 'Payment Method'}
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    {paymentMethod ? (
                      <>
                        {cardBrandIcon(paymentMethod.brand)}
                        <span className="text-sm text-white">
                          •••• {paymentMethod.last4}
                          <span className="text-brand-text-tertiary ml-2 text-xs">
                            Expires: {String(paymentMethod.expMonth).padStart(2, '0')} / {paymentMethod.expYear}
                          </span>
                        </span>
                      </>
                    ) : (
                      <span className="text-sm text-brand-text-tertiary">—</span>
                    )}
                  </div>
                  <button onClick={openUpdateCard} disabled={setupLoading}
                    className="mt-1.5 text-sm text-accent hover:text-white transition-colors font-medium flex items-center gap-1">
                    {setupLoading && <Loader className="w-3 h-3 animate-spin" />}
                    {isSpanish ? 'Actualización' : 'Update'}
                  </button>
                </td>
              </tr>
            )}

            {/* Actions */}
            {isStripeManaged && (
              <tr>
                <td className="px-6 py-4 text-sm font-medium text-brand-text-secondary whitespace-nowrap">
                  {isSpanish ? 'Acciones' : 'Actions'}
                </td>
                <td className="px-6 py-4 space-x-4">
                  {canCancel && (
                    <button onClick={handleCancelSubscription}
                      className="text-sm text-accent hover:text-white transition-colors font-medium">
                      {isSpanish ? 'Cancelar suscripción' : 'Cancel subscription'}
                    </button>
                  )}
                  {subscription.cancelAtPeriodEnd && (
                    <button onClick={handleReactivate}
                      className="text-sm text-green-400 hover:text-white transition-colors font-medium flex items-center gap-1">
                      <RefreshCw className="w-3.5 h-3.5" />
                      {isSpanish ? 'Reactivar' : 'Reactivate'}
                    </button>
                  )}
                  {isPastDue && (
                    <button onClick={openUpdateCard} disabled={setupLoading}
                      className="text-sm text-red-400 hover:text-white transition-colors font-medium flex items-center gap-1">
                      {setupLoading ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <CreditCard className="w-3.5 h-3.5" />}
                      {isSpanish ? 'Actualizar tarjeta' : 'Update card'}
                    </button>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Device management ── */}
      {plan?.type === 'shared' && (
        <div className="bg-dark-surface/95 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
          <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-accent" />
            {t('subscription.devices')}
          </h3>
          <p className="text-sm text-brand-text-tertiary mb-4">
            {t('subscriptionMgmt.devicesRegistered', { current: devices.length, max: plan?.features?.maxDevices ?? '—' })}
          </p>
          <div className="space-y-2">
            {devices.map((device) => (
              <div key={device.deviceId}
                className="flex items-center justify-between p-3 bg-dark-elevated rounded-lg border border-white/5">
                <div className="flex items-center gap-3">
                  <Smartphone className="w-4 h-4 text-brand-text-tertiary" />
                  <div>
                    <p className="text-sm font-medium text-white">
                      {typeof device.deviceInfo === 'object'
                        ? (device.deviceInfo?.deviceName || device.deviceInfo?.browser || 'Unknown')
                        : (device.deviceInfo || 'Unknown')}
                    </p>
                    <p className="text-xs text-brand-text-tertiary">
                      {t('subscriptionMgmt.lastActive')} {new Date(device.lastActive).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <button onClick={() => handleRemoveDevice(device.deviceId)}
                  className="p-1.5 rounded hover:bg-red-500/10 text-red-400 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            {devices.length === 0 && <p className="text-sm text-brand-text-tertiary">{t('subscriptionMgmt.noDevicesYet')}</p>}
          </div>
        </div>
      )}

      {/* ── Update card modal ── */}
      {showUpdateCard && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-md bg-dark-surface rounded-2xl border border-white/10 p-4 sm:p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold text-white">
                {isSpanish ? 'Actualizar método de pago' : 'Update payment method'}
              </h3>
              <button onClick={() => { setShowUpdateCard(false); setSetupClientSecret(''); }}
                className="p-1.5 rounded-lg hover:bg-white/5 text-brand-text-tertiary hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {isPastDue && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <p className="text-xs text-red-400">
                  {isSpanish
                    ? 'Hay un pago pendiente. Al guardar la nueva tarjeta, intentaremos cobrarlo automáticamente.'
                    : 'There is an outstanding payment. Saving your new card will trigger an immediate retry.'}
                </p>
              </div>
            )}

            {setupLoading || !setupClientSecret ? (
              <div className="flex items-center justify-center py-12">
                <Loader className="w-8 h-8 text-accent animate-spin" />
              </div>
            ) : (
              <Elements stripe={stripePromise} options={{ clientSecret: setupClientSecret, appearance: { theme: 'night', variables: { colorPrimary: '#e50914' } } }}>
                <UpdateCardForm
                  onSuccess={handleCardUpdated}
                  onCancel={() => { setShowUpdateCard(false); setSetupClientSecret(''); }}
                  isSpanish={isSpanish}
                />
              </Elements>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
