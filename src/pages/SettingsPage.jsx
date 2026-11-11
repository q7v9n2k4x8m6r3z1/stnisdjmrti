import { User, Bell, CreditCard, Volume2, Smartphone, Globe, Eye, EyeOff, Check, AlertTriangle, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import DeviceManagement from '../components/DeviceManagement';
import API_URL from '../config/api';

export default function SettingsPage({ user, onUserUpdate, onLogout }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  // ── Inline form toggles ──
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // ── Email change ──
  const [newEmail, setNewEmail] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailMsg, setEmailMsg] = useState(null);

  // ── Password change ──
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);
  const [pwMsg, setPwMsg] = useState(null);

  // ── Delete account ──
  const [deleteText, setDeleteText] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState(null);

  // ── Subscription ──
  const [subStatus, setSubStatus] = useState(null);
  const [subLoading, setSubLoading] = useState(true);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [subMsg, setSubMsg] = useState(null);

  // ── Audio prefs (localStorage) ──
  const [audioQuality, setAudioQuality] = useState(() => localStorage.getItem('audioQuality') || 'high');
  const [autoDownload, setAutoDownload] = useState(() => localStorage.getItem('autoDownload') === 'true');

  // ── Notifications (localStorage) ──
  const [notifications, setNotifications] = useState(() => {
    try { return JSON.parse(localStorage.getItem('notifications')) || { newReleases: true, downloads: true, playlists: false, marketing: false }; }
    catch { return { newReleases: true, downloads: true, playlists: false, marketing: false }; }
  });

  const token = localStorage.getItem('token');
  const authHeaders = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };

  // Persist audio prefs + notifications to localStorage
  useEffect(() => { localStorage.setItem('audioQuality', audioQuality); }, [audioQuality]);
  useEffect(() => { localStorage.setItem('autoDownload', String(autoDownload)); }, [autoDownload]);
  useEffect(() => { localStorage.setItem('notifications', JSON.stringify(notifications)); }, [notifications]);

  // Fetch real subscription status
  useEffect(() => {
    if (!user) { setSubLoading(false); return; }
    (async () => {
      try {
        const res = await fetch(`${API_URL}/subscriptions/status`, { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        if (data.success) setSubStatus(data.data || null);
      } catch {}
      setSubLoading(false);
    })();
  }, [user]);

  // ── Handlers ──
  const handleEmailChange = async (e) => {
    e.preventDefault();
    setEmailLoading(true); setEmailMsg(null);
    try {
      const res = await fetch(`${API_URL}/auth/updatedetails`, { method: 'PUT', headers: authHeaders, body: JSON.stringify({ email: newEmail }) });
      const data = await res.json();
      if (data.success) {
        onUserUpdate?.({ ...user, email: newEmail });
        setEmailMsg({ type: 'success', text: 'Email updated successfully' });
        setShowEmailForm(false); setNewEmail('');
      } else { setEmailMsg({ type: 'error', text: data.message || 'Failed to update email' }); }
    } catch { setEmailMsg({ type: 'error', text: 'Network error. Please try again.' }); }
    setEmailLoading(false);
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) { setPwMsg({ type: 'error', text: 'New passwords do not match' }); return; }
    if (newPassword.length < 6) { setPwMsg({ type: 'error', text: 'Password must be at least 6 characters' }); return; }
    setPwLoading(true); setPwMsg(null);
    try {
      const res = await fetch(`${API_URL}/auth/updatepassword`, { method: 'PUT', headers: authHeaders, body: JSON.stringify({ currentPassword, newPassword }) });
      const data = await res.json();
      if (data.success) {
        if (data.token) localStorage.setItem('token', data.token);
        setPwMsg({ type: 'success', text: 'Password updated successfully' });
        setShowPasswordForm(false); setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      } else { setPwMsg({ type: 'error', text: data.message || 'Incorrect current password' }); }
    } catch { setPwMsg({ type: 'error', text: 'Network error. Please try again.' }); }
    setPwLoading(false);
  };

  const handleDeleteAccount = async () => {
    if (deleteText !== 'DELETE') return;
    setDeleteLoading(true); setDeleteMsg(null);
    try {
      const res = await fetch(`${API_URL}/auth/me`, { method: 'DELETE', headers: authHeaders });
      const data = await res.json();
      if (data.success) { localStorage.removeItem('token'); onLogout?.(); }
      else { setDeleteMsg({ type: 'error', text: data.message || 'Failed to delete account' }); }
    } catch { setDeleteMsg({ type: 'error', text: 'Network error. Please try again.' }); }
    setDeleteLoading(false);
  };

  const handleCancelSubscription = async () => {
    setCancelLoading(true); setSubMsg(null);
    try {
      const res = await fetch(`${API_URL}/subscriptions/cancel`, { method: 'PUT', headers: authHeaders });
      const data = await res.json();
      if (data.success) {
        setSubStatus(prev => ({ ...prev, subscription: { ...prev?.subscription, cancelAtPeriodEnd: true } }));
        if (data.stripeConfirmed === false) {
          setSubMsg({ type: 'warning', text: 'Cancelled locally but Stripe could not be reached. Please contact support to confirm the cancellation.' });
        } else {
          setSubMsg({ type: 'success', text: 'Subscription cancelled. Access continues until end of billing period.' });
        }
        setShowCancelConfirm(false);
      } else { setSubMsg({ type: 'error', text: data.message || 'Failed to cancel subscription' }); }
    } catch { setSubMsg({ type: 'error', text: 'Network error. Please try again.' }); }
    setCancelLoading(false);
  };

  // ── Shared UI helpers ──
  const Toggle = ({ checked, onChange }) => (
    <label className="relative inline-flex items-center cursor-pointer">
      <input type="checkbox" checked={checked} onChange={onChange} className="sr-only peer" />
      <div className="w-11 h-6 bg-white/10 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent" />
    </label>
  );

  const MsgBanner = ({ msg }) => !msg ? null : (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium mt-2 ${
      msg.type === 'success' ? 'bg-green-500/10 text-green-400 border border-green-500/20'
      : msg.type === 'warning' ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
      : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
      {msg.type === 'success' ? <Check className="w-3.5 h-3.5 flex-shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />}
      {msg.text}
    </div>
  );

  const SectionCard = ({ icon: Icon, title, subtitle, children }) => (
    <div className="rounded-2xl bg-white/[0.02] backdrop-blur-sm border border-white/10 shadow-lg shadow-black/10 overflow-hidden">
      <div className="p-6 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center"><Icon className="w-5 h-5 text-accent" strokeWidth={1.5} /></div>
          <div><h2 className="text-lg font-bold text-white">{title}</h2><p className="text-xs text-brand-text-tertiary">{subtitle}</p></div>
        </div>
      </div>
      {children}
    </div>
  );

  const subSub = subStatus?.subscription;
  const renewsDate = subSub?.endDate ? new Date(subSub.endDate).toLocaleDateString() : null;
  const subStatusColor = subStatus?.isActive ? 'text-green-400 bg-green-500/10 border-green-500/20'
    : subSub?.status === 'cancelled' ? 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20'
    : 'text-red-400 bg-red-500/10 border-red-500/20';
  const subStatusLabel = subStatus?.isActive ? 'Active' : subSub?.status === 'cancelled' ? 'Cancelled' : 'Inactive';

  if (!user) return (
    <div className="min-h-screen bg-dark-bg pt-20 flex items-center justify-center">
      <p className="text-brand-text-tertiary text-sm">Please log in to access settings.</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-dark-bg pt-20 pb-10">
      <div className="max-w-4xl mx-auto px-4 md:px-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">{t('settingsPage.title', 'Settings')}</h1>
          <p className="text-sm text-brand-text-tertiary">{t('settingsPage.managePreferences', 'Manage your account and preferences')}</p>
        </div>

        <div className="space-y-6">

          {/* ── Account ── */}
          <SectionCard icon={User} title={t('settingsPage.account', 'Account')} subtitle={t('settingsPage.manageAccount', 'Manage your account information')}>
            <div className="p-6 space-y-1">

              {/* Email */}
              <div className="py-3 border-b border-white/5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-white mb-1">{t('settingsPage.emailAddress', 'Email Address')}</div>
                    <div className="text-xs text-brand-text-tertiary">{user.email}</div>
                  </div>
                  <button onClick={() => { setShowEmailForm(v => !v); setEmailMsg(null); }} className="px-4 py-2 rounded-lg bg-white/[0.06] hover:bg-white/10 border border-white/10 text-white text-xs font-semibold transition-all flex items-center gap-1.5">
                    {t('settingsPage.change', 'Change')} {showEmailForm ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>
                </div>
                {showEmailForm && (
                  <form onSubmit={handleEmailChange} className="mt-4 space-y-3 p-4 rounded-xl bg-white/[0.03] border border-white/10">
                    <div>
                      <label className="block text-xs text-brand-text-tertiary mb-1.5">New Email Address</label>
                      <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="new@email.com" required className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm outline-none focus:border-accent/50 placeholder:text-white/20 transition-all" />
                    </div>
                    <MsgBanner msg={emailMsg} />
                    <div className="flex gap-2">
                      <button type="submit" disabled={emailLoading || !newEmail} className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-xs font-semibold transition-all disabled:opacity-50 flex items-center gap-2">
                        {emailLoading && <Loader2 className="w-3 h-3 animate-spin" />} Save
                      </button>
                      <button type="button" onClick={() => { setShowEmailForm(false); setEmailMsg(null); setNewEmail(''); }} className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 text-xs font-semibold transition-all">Cancel</button>
                    </div>
                  </form>
                )}
              </div>

              {/* Password */}
              <div className="py-3 border-b border-white/5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-white mb-1">{t('auth.password', 'Password')}</div>
                    <div className="text-xs text-brand-text-tertiary">••••••••</div>
                  </div>
                  <button onClick={() => { setShowPasswordForm(v => !v); setPwMsg(null); }} className="px-4 py-2 rounded-lg bg-white/[0.06] hover:bg-white/10 border border-white/10 text-white text-xs font-semibold transition-all flex items-center gap-1.5">
                    {t('settingsPage.change', 'Change')} {showPasswordForm ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>
                </div>
                {showPasswordForm && (
                  <form onSubmit={handlePasswordChange} className="mt-4 space-y-3 p-4 rounded-xl bg-white/[0.03] border border-white/10">
                    <div>
                      <label className="block text-xs text-brand-text-tertiary mb-1.5">Current Password</label>
                      <div className="relative">
                        <input type={showCurrentPw ? 'text' : 'password'} value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} placeholder="Current password" required className="w-full px-3 py-2 pr-9 rounded-lg bg-white/5 border border-white/10 text-white text-sm outline-none focus:border-accent/50 placeholder:text-white/20 transition-all" />
                        <button type="button" onClick={() => setShowCurrentPw(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60">{showCurrentPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}</button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-brand-text-tertiary mb-1.5">New Password</label>
                      <div className="relative">
                        <input type={showNewPw ? 'text' : 'password'} value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="New password (min 6 chars)" required className="w-full px-3 py-2 pr-9 rounded-lg bg-white/5 border border-white/10 text-white text-sm outline-none focus:border-accent/50 placeholder:text-white/20 transition-all" />
                        <button type="button" onClick={() => setShowNewPw(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60">{showNewPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}</button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-brand-text-tertiary mb-1.5">Confirm New Password</label>
                      <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Confirm new password" required className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm outline-none focus:border-accent/50 placeholder:text-white/20 transition-all" />
                    </div>
                    <MsgBanner msg={pwMsg} />
                    <div className="flex gap-2">
                      <button type="submit" disabled={pwLoading || !currentPassword || !newPassword || !confirmPassword} className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-xs font-semibold transition-all disabled:opacity-50 flex items-center gap-2">
                        {pwLoading && <Loader2 className="w-3 h-3 animate-spin" />} Update Password
                      </button>
                      <button type="button" onClick={() => { setShowPasswordForm(false); setPwMsg(null); setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); }} className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 text-xs font-semibold transition-all">Cancel</button>
                    </div>
                  </form>
                )}
              </div>

              {/* Delete Account — hidden for admin */}
              {user.role !== 'admin' && (
                <div className="py-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-white mb-1">{t('settingsPage.deleteAccount', 'Delete Account')}</div>
                      <div className="text-xs text-brand-text-tertiary">{t('settingsPage.deleteAccountDesc', 'Permanently delete your account and all data')}</div>
                    </div>
                    <button onClick={() => setShowDeleteConfirm(v => !v)} className="px-4 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs font-semibold transition-all">{t('common.delete', 'Delete')}</button>
                  </div>
                  {showDeleteConfirm && (
                    <div className="mt-4 p-4 rounded-xl bg-red-500/5 border border-red-500/20">
                      <p className="text-xs text-red-400 mb-3 font-medium">⚠️ This action is irreversible. Type <strong>DELETE</strong> to confirm.</p>
                      <input type="text" value={deleteText} onChange={e => setDeleteText(e.target.value)} placeholder="Type DELETE" className="w-full px-3 py-2 rounded-lg bg-white/5 border border-red-500/30 text-white text-sm outline-none focus:border-red-500/60 placeholder:text-white/20 mb-3 transition-all" />
                      <MsgBanner msg={deleteMsg} />
                      <div className="flex gap-2 mt-2">
                        <button onClick={handleDeleteAccount} disabled={deleteText !== 'DELETE' || deleteLoading} className="px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white text-xs font-semibold transition-all disabled:opacity-40 flex items-center gap-2">
                          {deleteLoading && <Loader2 className="w-3 h-3 animate-spin" />} Delete My Account
                        </button>
                        <button onClick={() => { setShowDeleteConfirm(false); setDeleteText(''); setDeleteMsg(null); }} className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 text-xs font-semibold transition-all">Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </SectionCard>

          {/* ── Subscription ── */}
          <SectionCard icon={CreditCard} title={t('subscription.title', 'Subscription')} subtitle={t('settingsPage.manageSubscription', 'Manage your billing and plan')}>
            <div className="p-6">
              {subLoading ? (
                <div className="flex items-center gap-2 text-brand-text-tertiary"><Loader2 className="w-4 h-4 animate-spin" /><span className="text-sm">Loading…</span></div>
              ) : subStatus?.hasSubscription ? (
                <>
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-semibold text-white capitalize">{subStatus?.plan?.name || subSub?.plan || 'Pro'} Plan</span>
                        <span className={`px-2 py-0.5 rounded-full border text-xs font-bold ${subStatusColor}`}>{subStatusLabel}</span>
                      </div>
                      {renewsDate && <div className="text-xs text-brand-text-tertiary">{subSub?.status === 'cancelled' ? `Access until ${renewsDate}` : `Renews ${renewsDate}`}</div>}
                    </div>
                  </div>
                  <MsgBanner msg={subMsg} />
                  <div className="flex gap-3 mt-4">
                    <button onClick={() => navigate('/pricing')} className="flex-1 px-4 py-2 rounded-lg bg-white/[0.06] hover:bg-white/10 border border-white/10 text-white text-sm font-semibold transition-all">Change Plan</button>
                    {/* Not gated on isActive: a past_due customer whose paid
                        period has lapsed has no access, but Stripe is still
                        retrying their card — they must be able to stop it. */}
                    {['active', 'past_due'].includes(subSub?.status) && !subSub?.cancelAtPeriodEnd && !showCancelConfirm && (
                      <button onClick={() => setShowCancelConfirm(true)} className="flex-1 px-4 py-2 rounded-lg bg-white/[0.06] hover:bg-red-500/10 border border-white/10 hover:border-red-500/20 text-white hover:text-red-400 text-sm font-semibold transition-all">Cancel Plan</button>
                    )}
                  </div>
                  {showCancelConfirm && (
                    <div className="mt-4 p-4 rounded-xl bg-white/[0.02] border border-white/10">
                      <p className="text-sm text-white/80 mb-3">Cancel your subscription? You'll keep access until <strong>{renewsDate}</strong>.</p>
                      <div className="flex gap-2">
                        <button onClick={handleCancelSubscription} disabled={cancelLoading} className="px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white text-xs font-semibold transition-all flex items-center gap-2 disabled:opacity-50">
                          {cancelLoading && <Loader2 className="w-3 h-3 animate-spin" />} Yes, Cancel
                        </button>
                        <button onClick={() => setShowCancelConfirm(false)} className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 text-xs font-semibold transition-all">Keep Subscription</button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-white mb-1">No active subscription</div>
                    <div className="text-xs text-brand-text-tertiary">Subscribe to unlock full access</div>
                  </div>
                  <button onClick={() => navigate('/pricing')} className="px-5 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition-all">View Plans</button>
                </div>
              )}
            </div>
          </SectionCard>

          {/* ── Language ── */}
          <SectionCard icon={Globe} title="Language" subtitle="Choose your display language">
            <div className="p-6">
              <div className="flex gap-3">
                {[{ code: 'en', label: '🇺🇸 English' }, { code: 'es', label: '🇪🇸 Español' }].map(lang => (
                  <button key={lang.code} onClick={() => { i18n.changeLanguage(lang.code); localStorage.setItem('i18nextLng', lang.code); }}
                    className={`px-5 py-2.5 rounded-xl text-sm font-semibold border transition-all ${i18n.language === lang.code ? 'bg-accent/15 border-accent/40 text-accent' : 'bg-white/[0.03] border-white/10 text-white/60 hover:text-white hover:bg-white/[0.06]'}`}>
                    {lang.label}
                  </button>
                ))}
              </div>
            </div>
          </SectionCard>

          {/* ── Audio Preferences ── (future feature)
          <SectionCard icon={Volume2} title={t('settingsPage.audioPreferences', 'Audio Preferences')} subtitle={t('settingsPage.configurePlayback', 'Configure playback settings')}>
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between py-3 border-b border-white/5">
                <div>
                  <div className="text-sm font-semibold text-white mb-1">{t('settingsPage.streamingQuality', 'Streaming Quality')}</div>
                  <div className="text-xs text-brand-text-tertiary">{t('settingsPage.higherQualityData', 'Higher quality uses more data')}</div>
                </div>
                <select value={audioQuality} onChange={e => setAudioQuality(e.target.value)} className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm font-semibold outline-none focus:border-accent/50 transition-all cursor-pointer">
                  <option value="low">{t('settingsPage.qualityLow', 'Low')}</option>
                  <option value="medium">{t('settingsPage.qualityMedium', 'Medium')}</option>
                  <option value="high">{t('settingsPage.qualityHigh', 'High')}</option>
                </select>
              </div>
              <div className="flex items-center justify-between py-3">
                <div>
                  <div className="text-sm font-semibold text-white mb-1">{t('settingsPage.autoDownload', 'Auto Download')}</div>
                  <div className="text-xs text-brand-text-tertiary">{t('settingsPage.autoDownloadDesc', 'Automatically download new releases')}</div>
                </div>
                <Toggle checked={autoDownload} onChange={e => setAutoDownload(e.target.checked)} />
              </div>
            </div>
          </SectionCard> */}

          {/* ── Devices ── */}
          <SectionCard icon={Smartphone} title={t('settingsPage.devicesAndSecurity', 'Devices & Security')} subtitle={t('settingsPage.manageDevices', 'Manage your active devices')}>
            <div className="p-0"><DeviceManagement /></div>
          </SectionCard>

          {/* ── Notifications ── (future feature)
          <SectionCard icon={Bell} title={t('settingsPage.notifications', 'Notifications')} subtitle={t('settingsPage.chooseUpdates', 'Choose what notifications you receive')}>
            <div className="p-6 space-y-4">
              {Object.entries(notifications).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between py-3 border-b border-white/5 last:border-0">
                  <div className="text-sm font-semibold text-white capitalize">{t(`settingsPage.notif_${key}`, key.replace(/([A-Z])/g, ' $1').trim())}</div>
                  <Toggle checked={value} onChange={e => setNotifications(prev => ({ ...prev, [key]: e.target.checked }))} />
                </div>
              ))}
            </div>
          </SectionCard> */}

        </div>
      </div>
    </div>
  );
}
