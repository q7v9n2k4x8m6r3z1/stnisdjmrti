import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Mail, Plus, X, Loader, Trash2, Copy, Eye, Send, Users, AlertCircle, FileUp,
} from 'lucide-react';
import API_URL from '../../config/api';

const API = API_URL;
const authHeaders = (json = false) => {
  const h = {};
  const token = localStorage.getItem('token');
  if (token) h['Authorization'] = `Bearer ${token}`;
  if (json) h['Content-Type'] = 'application/json';
  return h;
};

const STATUS_STYLE = {
  draft:   'bg-gray-500/20 text-gray-400 border-gray-500/30',
  ready:   'bg-blue-500/20 text-blue-300 border-blue-500/30',
  sending: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  sent:    'bg-green-500/20 text-green-400 border-green-500/30',
  paused:  'bg-orange-500/20 text-orange-300 border-orange-500/30',
};

export default function AdminCampaigns() {
  const { t, i18n } = useTranslation();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);      // full campaign being edited
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/campaigns`, { headers: authHeaders() });
      const data = await res.json();
      if (data.success) setRows(data.data || []);
      else setError(data.message || t('campaigns.loadFailed', 'Could not load campaigns'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  // The list omits html/text to keep it small, so open always refetches the
  // full record rather than editing a partial copy.
  const openEditor = async (id) => {
    if (!id) { setEditing({ isNew: true, name: '', subject: '', preheader: '', html: '', text: '', discountCode: '', discountValidHours: 24, audience: { segment: 'free', registeredWithinDays: 7, minAccountAgeHours: 24, excludeStripeHistory: true } }); return; }
    setBusyId(id);
    try {
      const res = await fetch(`${API}/campaigns/${id}`, { headers: authHeaders() });
      const data = await res.json();
      if (data.success) setEditing(data.data);
      else setError(data.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleSave = async (campaign) => {
    const isNew = campaign.isNew;
    const url = isNew ? `${API}/campaigns` : `${API}/campaigns/${campaign._id}`;
    const res = await fetch(url, {
      method: isNew ? 'POST' : 'PUT',
      headers: authHeaders(true),
      body: JSON.stringify(campaign),
    });
    const data = await res.json();
    if (!data.success) return data.message || 'Save failed';
    setEditing(null);
    fetchRows();
    return null;
  };

  const handleDuplicate = async (id) => {
    setBusyId(id);
    try {
      const res = await fetch(`${API}/campaigns/${id}/duplicate`, { method: 'POST', headers: authHeaders() });
      const data = await res.json();
      if (data.success) fetchRows(); else setError(data.message);
    } finally { setBusyId(null); }
  };

  const handleDelete = async (id) => {
    setBusyId(id);
    try {
      const res = await fetch(`${API}/campaigns/${id}`, { method: 'DELETE', headers: authHeaders() });
      const data = await res.json();
      if (data.success) { setConfirmDelete(null); fetchRows(); } else setError(data.message);
    } finally { setBusyId(null); }
  };

  // Opened through fetch rather than a plain link because the endpoint needs
  // the bearer token; a new tab would arrive unauthenticated.
  const openPreview = async (id) => {
    setBusyId(id);
    try {
      const res = await fetch(`${API}/campaigns/${id}/preview`, { headers: authHeaders() });
      const html = await res.text();
      const w = window.open('', '_blank');
      if (!w) { setError(t('campaigns.popupBlocked', 'Allow pop-ups to see the preview')); return; }
      w.document.write(html);
      w.document.close();
    } catch (err) {
      setError(err.message);
    } finally { setBusyId(null); }
  };

  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

  return (
    <div className="p-4 md:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 md:mb-8">
        <div className="min-w-0">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-1 md:mb-2">
            {t('campaigns.title', 'Email Campaigns')}
          </h2>
          <p className="text-sm md:text-base text-brand-text-tertiary">
            {t('campaigns.subtitle', 'Create, preview and test promotional emails. Sending is not enabled yet.')}
          </p>
        </div>
        <button
          onClick={() => openEditor(null)}
          className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors flex-shrink-0"
        >
          <Plus className="w-4 h-4" />
          {t('campaigns.create', 'New campaign')}
        </button>
      </div>

      {/* Stated plainly rather than implied by a missing button: an admin who
          builds a campaign expecting to send it should learn that now. */}
      <div className="mb-6 flex items-start gap-2 px-4 py-3 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-200 text-sm">
        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <span>
          {t('campaigns.notice', 'Campaigns can be written, previewed and tested. Sending to real audiences arrives once unsubscribe handling and bounce processing are in place.')}
        </span>
      </div>

      {error && (
        <div className="mb-6 flex items-start gap-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader className="w-8 h-8 text-accent animate-spin" />
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div className="text-center py-20">
          <Mail className="w-16 h-16 mx-auto mb-4 text-brand-text-tertiary opacity-30" />
          <p className="text-brand-text-tertiary text-lg">{t('campaigns.empty', 'No campaigns yet')}</p>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="bg-dark-elevated rounded-xl border border-white/10 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead>
                <tr className="border-b border-white/10 bg-dark-surface">
                  {[
                    t('campaigns.name', 'Campaign'),
                    t('campaigns.subjectCol', 'Subject'),
                    t('campaigns.audience', 'Audience'),
                    t('campaigns.status', 'Status'),
                    t('campaigns.created', 'Created'),
                    t('admin.actions'),
                  ].map(h => (
                    <th key={h} className="text-left px-6 py-4 text-xs font-semibold text-brand-text-tertiary uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {rows.map(row => (
                  <tr key={row._id} className="hover:bg-dark-surface transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-semibold text-white">{row.name}</div>
                      {row.discountCode && (
                        <div className="text-[10px] font-mono text-accent mt-0.5">{row.discountCode}</div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-brand-text-tertiary max-w-xs truncate">{row.subject}</td>
                    <td className="px-6 py-4 text-sm text-brand-text-tertiary capitalize">{row.audience?.segment || '—'}</td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-semibold border ${STATUS_STYLE[row.status] || STATUS_STYLE.draft}`}>
                        {t(`campaigns.status_${row.status}`, row.status)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-brand-text-tertiary">{fmtDate(row.createdAt)}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1">
                        <button onClick={() => openPreview(row._id)} disabled={busyId === row._id}
                          className="p-2 hover:bg-dark-elevated rounded-lg transition-colors text-brand-text-tertiary hover:text-white disabled:opacity-40"
                          title={t('campaigns.preview', 'Preview')}>
                          <Eye className="w-4 h-4" />
                        </button>
                        <button onClick={() => openEditor(row._id)} disabled={busyId === row._id}
                          className="p-2 hover:bg-dark-elevated rounded-lg transition-colors text-brand-text-tertiary hover:text-white disabled:opacity-40"
                          title={t('common.edit', 'Edit')}>
                          <Mail className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDuplicate(row._id)} disabled={busyId === row._id}
                          className="p-2 hover:bg-dark-elevated rounded-lg transition-colors text-brand-text-tertiary hover:text-white disabled:opacity-40"
                          title={t('campaigns.duplicate', 'Duplicate')}>
                          <Copy className="w-4 h-4" />
                        </button>
                        <button onClick={() => setConfirmDelete(row)} disabled={busyId === row._id}
                          className="p-2 hover:bg-dark-elevated rounded-lg transition-colors text-brand-text-tertiary hover:text-red-400 disabled:opacity-40"
                          title={t('common.delete')}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing && (
        <CampaignEditor
          campaign={editing}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-dark-surface rounded-2xl border border-white/10 p-6 sm:p-8 max-w-md w-full">
            <h3 className="text-xl font-bold text-white mb-2">{t('campaigns.deleteTitle', 'Delete this campaign?')}</h3>
            <p className="text-white font-semibold mb-4 break-words">{confirmDelete.name}</p>
            <p className="text-brand-text-tertiary text-sm mb-6">
              {t('campaigns.deleteBody', 'The campaign is removed. Records of emails already sent are kept, so any discount codes already issued keep working.')}
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(null)}
                className="flex-1 px-4 py-2.5 rounded-lg bg-dark-elevated hover:bg-dark-surface border border-white/10 text-white font-medium transition-colors">
                {t('common.cancel')}
              </button>
              <button onClick={() => handleDelete(confirmDelete._id)} disabled={busyId === confirmDelete._id}
                className="flex-1 px-4 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium transition-colors disabled:opacity-50">
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const field = 'w-full px-3 py-2.5 bg-dark-elevated border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-accent transition-colors';
const label = 'block text-xs font-semibold text-brand-text-tertiary uppercase tracking-wider mb-1.5';

function CampaignEditor({ campaign, onClose, onSave }) {
  const { t } = useTranslation();
  const [form, setForm] = useState(campaign);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [testEmail, setTestEmail] = useState('');
  const [testMsg, setTestMsg] = useState(null);
  const [audience, setAudience] = useState(null);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setAud = (k, v) => setForm(f => ({ ...f, audience: { ...(f.audience || {}), [k]: v } }));

  const save = async () => {
    setSaving(true);
    setErr('');
    const problem = await onSave(form);
    if (problem) setErr(problem);
    setSaving(false);
  };

  // Read the file in the browser rather than uploading it. The template is
  // just text, it goes into the record either way, and this avoids a file
  // endpoint and its attendant validation.
  const onFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => set('html', String(reader.result || ''));
    reader.readAsText(file);
  };

  const sendTest = async () => {
    if (form.isNew) { setTestMsg({ ok: false, text: t('campaigns.saveFirst', 'Save the campaign before sending a test') }); return; }
    setTestMsg(null);
    const res = await fetch(`${API}/campaigns/${form._id}/test`, {
      method: 'POST', headers: authHeaders(true), body: JSON.stringify({ email: testEmail.trim() }),
    });
    const data = await res.json();
    setTestMsg({ ok: !!data.success, text: data.message });
  };

  const checkAudience = async () => {
    if (form.isNew) { setAudience({ error: t('campaigns.saveFirst', 'Save the campaign first') }); return; }
    setAudience({ loading: true });
    const res = await fetch(`${API}/campaigns/${form._id}/audience`, { headers: authHeaders() });
    const data = await res.json();
    setAudience(data.success ? data.data : { error: data.message });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-dark-surface rounded-2xl border border-white/10 p-5 sm:p-8 max-w-3xl w-full max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold text-white">
            {form.isNew ? t('campaigns.create', 'New campaign') : t('campaigns.edit', 'Edit campaign')}
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
            <X className="w-5 h-5 text-white" />
          </button>
        </div>

        {err && (
          <div className="mb-5 flex items-start gap-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /><span>{err}</span>
          </div>
        )}

        <div className="space-y-5">
          <div>
            <label className={label}>{t('campaigns.name', 'Campaign name')}</label>
            <input className={field} value={form.name || ''} onChange={e => set('name', e.target.value)}
              placeholder={t('campaigns.namePlaceholder', 'Internal name, not shown to customers')} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={label}>{t('campaigns.subjectCol', 'Subject')}</label>
              <input className={field} value={form.subject || ''} onChange={e => set('subject', e.target.value)} />
              <p className="text-[10px] text-brand-text-tertiary mt-1">
                {t('campaigns.subjectHint', 'Around 40 characters stay visible on a phone')}
              </p>
            </div>
            <div>
              <label className={label}>{t('campaigns.preheader', 'Preheader')}</label>
              <input className={field} value={form.preheader || ''} onChange={e => set('preheader', e.target.value)} />
              <p className="text-[10px] text-brand-text-tertiary mt-1">
                {t('campaigns.preheaderHint', 'The line shown after the subject in the inbox list')}
              </p>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className={label + ' mb-0'}>{t('campaigns.html', 'Email HTML')}</label>
              <label className="flex items-center gap-1.5 text-xs text-accent hover:text-white cursor-pointer transition-colors">
                <FileUp className="w-3.5 h-3.5" />
                {t('campaigns.uploadHtml', 'Upload .html')}
                <input type="file" accept=".html,text/html" onChange={onFile} className="hidden" />
              </label>
            </div>
            <textarea className={field + ' font-mono text-xs h-48'} value={form.html || ''}
              onChange={e => set('html', e.target.value)}
              placeholder={t('campaigns.htmlPlaceholder', 'Paste the designed HTML, or upload a file')} />
            <p className="text-[10px] text-brand-text-tertiary mt-1">
              {t('campaigns.placeholders', 'Available placeholders: {{unsubscribe_url}}, {{name}}, {{preheader}}. An unsubscribe link is required in promotional email.')}
            </p>
          </div>

          <div>
            <label className={label}>{t('campaigns.text', 'Plain text version')}</label>
            <textarea className={field + ' text-xs h-24'} value={form.text || ''} onChange={e => set('text', e.target.value)} />
            <p className="text-[10px] text-brand-text-tertiary mt-1">
              {t('campaigns.textHint', 'Improves deliverability. Worth writing even though most people never see it.')}
            </p>
          </div>

          {/* Audience */}
          <div className="rounded-xl border border-white/10 p-4 space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Users className="w-4 h-4 text-accent" />
              {t('campaigns.audience', 'Audience')}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={label}>{t('campaigns.segment', 'Segment')}</label>
                <select className={field} value={form.audience?.segment || 'free'} onChange={e => setAud('segment', e.target.value)}>
                  <option value="free">{t('campaigns.seg_free', 'Free — never subscribed')}</option>
                  <option value="paid">{t('campaigns.seg_paid', 'Paying subscribers')}</option>
                  <option value="cancelled">{t('campaigns.seg_cancelled', 'Cancelled')}</option>
                  <option value="all">{t('campaigns.seg_all', 'Everyone')}</option>
                </select>
              </div>
              <div>
                <label className={label}>{t('campaigns.registeredWithin', 'Registered within (days)')}</label>
                <input type="number" min="0" className={field} value={form.audience?.registeredWithinDays ?? ''}
                  onChange={e => setAud('registeredWithinDays', e.target.value === '' ? null : Number(e.target.value))} />
              </div>
              <div>
                <label className={label}>{t('campaigns.minAge', 'Account at least (hours) old')}</label>
                <input type="number" min="0" className={field} value={form.audience?.minAccountAgeHours ?? ''}
                  onChange={e => setAud('minAccountAgeHours', e.target.value === '' ? null : Number(e.target.value))} />
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm text-white cursor-pointer">
                  <input type="checkbox" checked={!!form.audience?.excludeStripeHistory}
                    onChange={e => setAud('excludeStripeHistory', e.target.checked)} className="accent-accent w-4 h-4" />
                  {t('campaigns.excludeStripe', 'Exclude anyone who reached checkout')}
                </label>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={checkAudience}
                className="px-3 py-2 rounded-lg bg-dark-elevated hover:bg-white/10 border border-white/10 text-white text-xs font-medium transition-colors">
                {t('campaigns.checkAudience', 'How many people is this?')}
              </button>
              {audience?.loading && <Loader className="w-4 h-4 text-accent animate-spin" />}
              {audience?.error && <span className="text-xs text-red-400">{audience.error}</span>}
              {typeof audience?.count === 'number' && (
                <span className="text-xs text-brand-text-secondary">
                  <strong className="text-white">{audience.count}</strong> {t('campaigns.recipients', 'recipients')}
                  {audience.sample?.length > 0 && ` · ${audience.sample.slice(0, 3).join(', ')}…`}
                </span>
              )}
            </div>
          </div>

          {/* Offer */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={label}>{t('campaigns.discountCode', 'Discount code')}</label>
              <input className={field + ' font-mono tracking-wider'} value={form.discountCode || ''}
                onChange={e => set('discountCode', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                placeholder={t('campaigns.discountOptional', 'Optional')} />
            </div>
            <div>
              <label className={label}>{t('campaigns.discountHours', 'Code valid for (hours after send)')}</label>
              <input type="number" min="0" className={field} value={form.discountValidHours ?? 24}
                onChange={e => set('discountValidHours', Number(e.target.value))} />
              <p className="text-[10px] text-brand-text-tertiary mt-1">
                {t('campaigns.discountHoursHint', '0 means no window — the code behaves as set up in Stripe')}
              </p>
            </div>
          </div>

          {/* Test send */}
          <div className="rounded-xl border border-white/10 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-white mb-3">
              <Send className="w-4 h-4 text-accent" />
              {t('campaigns.testSend', 'Send yourself a test')}
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input className={field + ' flex-1'} type="email" value={testEmail}
                onChange={e => setTestEmail(e.target.value)} placeholder="tu@email.com" />
              <button onClick={sendTest} disabled={!testEmail.trim()}
                className="px-4 py-2.5 rounded-lg bg-dark-elevated hover:bg-white/10 border border-white/10 text-white text-sm font-medium transition-colors disabled:opacity-40 flex-shrink-0">
                {t('campaigns.sendTest', 'Send test')}
              </button>
            </div>
            {testMsg && (
              <p className={`text-xs mt-2 ${testMsg.ok ? 'text-green-400' : 'text-red-400'}`}>{testMsg.text}</p>
            )}
          </div>
        </div>

        <div className="flex gap-3 mt-7">
          <button onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-lg bg-dark-elevated hover:bg-dark-surface border border-white/10 text-white font-medium transition-colors">
            {t('common.cancel')}
          </button>
          <button onClick={save} disabled={saving}
            className="flex-1 px-4 py-2.5 rounded-lg bg-accent hover:bg-accent-hover text-white font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {saving && <Loader className="w-4 h-4 animate-spin" />}
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
