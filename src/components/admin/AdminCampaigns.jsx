import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Mail, Plus, X, Loader, Trash2, Copy, Eye, Send, Users, AlertCircle, FileUp,
  Play, Pause, CheckCircle,
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
  const [confirmSend, setConfirmSend] = useState(null);   // { row, count }
  const [sendResult, setSendResult] = useState(null);
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

  // Never a bare Send button. The count is fetched first and shown in the
  // confirmation, because "send to 400 people" and "send to 4" deserve
  // different amounts of thought and the number is not otherwise on screen.
  const openConfirmSend = async (row) => {
    setBusyId(row._id);
    setError('');
    try {
      const res = await fetch(`${API}/campaigns/${row._id}/audience`, { headers: authHeaders() });
      const data = await res.json();
      setConfirmSend({ row, count: data.success ? data.data.count : null, sample: data.data?.sample || [] });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  // One batch per click, matching the endpoint. The button reports what
  // remains, so an admin sends a large audience in visible steps rather than
  // firing one request that runs for minutes with no way to stop it.
  const runSend = async (row) => {
    setBusyId(row._id);
    setError('');
    try {
      const res = await fetch(`${API}/campaigns/${row._id}/send`, { method: 'POST', headers: authHeaders() });
      const data = await res.json();
      if (!data.success) { setError(data.message); return; }
      const d = data.data;
      setSendResult({
        name: d.campaign, sent: d.sent, failed: d.failed,
        remaining: d.remaining, finished: d.finished, invalid: d.invalid || [],
      });
      fetchRows();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const setPaused = async (row, paused) => {
    setBusyId(row._id);
    try {
      const res = await fetch(`${API}/campaigns/${row._id}/${paused ? 'pause' : 'resume'}`, {
        method: 'POST', headers: authHeaders(),
      });
      const data = await res.json();
      if (data.success) fetchRows(); else setError(data.message);
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

      {/* The one rule an admin has to internalise: a draft cannot reach a
          customer. Everything else about sending is discoverable from the
          buttons; this is not. */}
      <div className="mb-6 flex items-start gap-2 px-4 py-3 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-200 text-sm">
        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <span>
          {t('campaigns.notice', 'A campaign must be set to Ready before it can be sent. Sending goes out in batches of 50, and anyone who unsubscribed, bounced or reported spam is excluded automatically.')}
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
                        {/* Only a campaign marked ready can be sent. A draft
                            has had no human approval and the server refuses it
                            anyway — showing the button would just produce an
                            error an admin has to interpret. */}
                        {(row.status === 'ready' || row.status === 'sending') && (
                          <button onClick={() => openConfirmSend(row)} disabled={busyId === row._id}
                            className="p-2 hover:bg-dark-elevated rounded-lg transition-colors text-green-400 hover:text-green-300 disabled:opacity-40"
                            title={t('campaigns.send', 'Send batch')}>
                            <Play className="w-4 h-4" />
                          </button>
                        )}
                        {row.status === 'sending' && (
                          <button onClick={() => setPaused(row, true)} disabled={busyId === row._id}
                            className="p-2 hover:bg-dark-elevated rounded-lg transition-colors text-orange-400 hover:text-orange-300 disabled:opacity-40"
                            title={t('campaigns.pause', 'Pause')}>
                            <Pause className="w-4 h-4" />
                          </button>
                        )}
                        {row.status === 'paused' && (
                          <button onClick={() => setPaused(row, false)} disabled={busyId === row._id}
                            className="p-2 hover:bg-dark-elevated rounded-lg transition-colors text-blue-400 hover:text-blue-300 disabled:opacity-40"
                            title={t('campaigns.resume', 'Resume')}>
                            <Play className="w-4 h-4" />
                          </button>
                        )}
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

      {confirmSend && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-dark-surface rounded-2xl border border-white/10 p-6 sm:p-8 max-w-md w-full">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center flex-shrink-0">
                <Send className="w-5 h-5 text-green-400" />
              </div>
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-white">{t('campaigns.confirmSendTitle', 'Send this campaign?')}</h3>
                <p className="text-sm text-brand-text-tertiary truncate">{confirmSend.row.name}</p>
              </div>
            </div>

            <div className="bg-dark-elevated rounded-xl p-4 mb-5 border border-white/10">
              <div className="text-3xl font-bold text-white">
                {confirmSend.count ?? '—'}
              </div>
              <p className="text-xs text-brand-text-tertiary mt-1">
                {t('campaigns.peopleMatch', 'people currently match this audience')}
              </p>
              {confirmSend.sample?.length > 0 && (
                <p className="text-[10px] text-brand-text-tertiary mt-2 truncate">
                  {confirmSend.sample.slice(0, 3).join(', ')}…
                </p>
              )}
            </div>

            <p className="text-sm text-brand-text-tertiary mb-6">
              {t('campaigns.confirmSendBody', 'This sends one batch of up to 50 emails now. Anyone who unsubscribed, bounced or reported spam is excluded automatically. Press again to continue through the rest.')}
            </p>

            <div className="flex gap-3">
              <button onClick={() => setConfirmSend(null)}
                className="flex-1 px-4 py-2.5 rounded-lg bg-dark-elevated hover:bg-dark-surface border border-white/10 text-white font-medium transition-colors">
                {t('common.cancel')}
              </button>
              <button
                onClick={() => { const r = confirmSend.row; setConfirmSend(null); runSend(r); }}
                disabled={!confirmSend.count}
                className="flex-1 px-4 py-2.5 rounded-lg bg-green-600 hover:bg-green-700 text-white font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                {t('campaigns.sendNow', 'Send batch')}
              </button>
            </div>
          </div>
        </div>
      )}

      {sendResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-dark-surface rounded-2xl border border-white/10 p-6 sm:p-8 max-w-md w-full">
            <div className="flex items-center gap-3 mb-5">
              <CheckCircle className="w-6 h-6 text-green-400 flex-shrink-0" />
              <h3 className="text-lg font-bold text-white">
                {sendResult.finished
                  ? t('campaigns.allSent', 'Campaign complete')
                  : t('campaigns.batchSent', 'Batch sent')}
              </h3>
            </div>

            <div className="grid grid-cols-3 gap-3 mb-5">
              {[
                { label: t('campaigns.sentCount', 'Sent'), value: sendResult.sent, color: 'text-green-400' },
                { label: t('campaigns.failedCount', 'Failed'), value: sendResult.failed, color: 'text-red-400' },
                { label: t('campaigns.remainingCount', 'Remaining'), value: sendResult.remaining, color: 'text-white' },
              ].map(s => (
                <div key={s.label} className="bg-dark-elevated rounded-lg p-3 border border-white/10">
                  <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                  <p className="text-[10px] text-brand-text-tertiary">{s.label}</p>
                </div>
              ))}
            </div>

            {sendResult.invalid?.length > 0 && (
              <div className="mb-5 bg-dark-elevated rounded-lg p-3 border border-yellow-500/20 max-h-32 overflow-y-auto">
                <p className="text-[10px] text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider">
                  {t('campaigns.badAddresses', 'Addresses that cannot receive mail')}
                </p>
                {sendResult.invalid.map((v, i) => (
                  <p key={i} className="text-[10px] text-brand-text-tertiary">
                    {v.email} — {v.reason}{v.suggestion ? ` → ${v.suggestion}` : ''}
                  </p>
                ))}
              </div>
            )}

            <p className="text-xs text-brand-text-tertiary mb-5">
              {sendResult.remaining > 0
                ? t('campaigns.moreRemain', 'Press Send again to continue with the next batch.')
                : t('campaigns.noneRemain', 'Everyone in this audience has now been sent to.')}
            </p>

            <button onClick={() => setSendResult(null)}
              className="w-full px-4 py-2.5 rounded-lg bg-accent hover:bg-accent-hover text-white font-medium transition-colors">
              {t('common.close', 'Close')}
            </button>
          </div>
        </div>
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
              {/* Only meaningful for win-backs, so only shown for them —
                  an unexplained date filter on a welcome campaign is noise. */}
              {form.audience?.segment === 'cancelled' && (
                <div>
                  <label className={label}>{t('campaigns.endedWithin', 'Subscription ended within (days)')}</label>
                  <input type="number" min="0" className={field} value={form.audience?.endedWithinDays ?? ''}
                    onChange={e => setAud('endedWithinDays', e.target.value === '' ? null : Number(e.target.value))} />
                  <p className="text-[10px] text-brand-text-tertiary mt-1">
                    {t('campaigns.endedWithinHint', 'Without this, the campaign reaches everyone who ever left')}
                  </p>
                </div>
              )}
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

          {/* Automation */}
          {!form.isNew && (
            <div className="rounded-xl border border-white/10 p-4 space-y-4">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input type="checkbox" checked={!!form.automation?.enabled}
                  onChange={e => setForm(f => ({ ...f, automation: { ...(f.automation || {}), enabled: e.target.checked } }))}
                  className="accent-accent w-4 h-4" />
                <span className="text-sm font-semibold text-white">
                  {t('campaigns.automate', 'Send automatically as people qualify')}
                </span>
              </label>
              <p className="text-[11px] text-brand-text-tertiary -mt-2">
                {t('campaigns.automateHint', 'Instead of sending once, this keeps running and reaches each person as they start matching the audience above. Still requires the campaign to be Ready.')}
              </p>

              {form.automation?.enabled && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={label}>{t('campaigns.everyHours', 'Check every (hours)')}</label>
                    <input type="number" min="1" className={field} value={form.automation?.intervalHours ?? 1}
                      onChange={e => setForm(f => ({ ...f, automation: { ...(f.automation || {}), intervalHours: Number(e.target.value) } }))} />
                  </div>
                  <div>
                    <label className={label}>{t('campaigns.maxPerRun', 'Most emails per run')}</label>
                    <input type="number" min="1" className={field} value={form.automation?.maxPerRun ?? 50}
                      onChange={e => setForm(f => ({ ...f, automation: { ...(f.automation || {}), maxPerRun: Number(e.target.value) } }))} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Approval. Kept next to the test send on purpose — the intended
              order is send yourself a test, look at it, then mark it ready. */}
          {!form.isNew && (
            <div className="rounded-xl border border-white/10 p-4">
              <label className={label}>{t('campaigns.status', 'Status')}</label>
              <select className={field} value={form.status || 'draft'} onChange={e => set('status', e.target.value)}>
                <option value="draft">{t('campaigns.status_draft', 'Draft')} — {t('campaigns.cannotSend', 'cannot be sent')}</option>
                <option value="ready">{t('campaigns.status_ready', 'Ready')} — {t('campaigns.canSend', 'can be sent')}</option>
              </select>
              <p className="text-[10px] text-brand-text-tertiary mt-1.5">
                {t('campaigns.statusHint', 'Marking a campaign Ready is the approval step. Nothing can be sent while it is a draft.')}
              </p>
            </div>
          )}

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
