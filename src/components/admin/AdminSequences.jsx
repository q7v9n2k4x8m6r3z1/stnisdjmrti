import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  GitBranch, Plus, X, Loader, Trash2, AlertCircle, Clock, ArrowDown, Users, Play,
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
  draft:  'bg-gray-500/20 text-gray-400 border-gray-500/30',
  active: 'bg-green-500/20 text-green-400 border-green-500/30',
  paused: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
};

const field = 'w-full px-3 py-2.5 bg-dark-elevated border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-accent transition-colors';
const label = 'block text-xs font-semibold text-brand-text-tertiary uppercase tracking-wider mb-1.5';

export default function AdminSequences() {
  const { t } = useTranslation();
  const [rows, setRows] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [seqRes, campRes] = await Promise.all([
        fetch(`${API}/sequences`, { headers: authHeaders() }),
        fetch(`${API}/campaigns`, { headers: authHeaders() }),
      ]);
      const seq = await seqRes.json();
      const camp = await campRes.json();
      if (seq.success) setRows(seq.data || []); else setError(seq.message);
      if (camp.success) setCampaigns(camp.data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const openEditor = async (id) => {
    if (!id) {
      setEditing({
        isNew: true, name: '', steps: [], maxPerRun: 50,
        audience: { segment: 'free', registeredWithinDays: 7, minAccountAgeHours: 24, excludeStripeHistory: true },
      });
      return;
    }
    setBusyId(id);
    try {
      const res = await fetch(`${API}/sequences/${id}`, { headers: authHeaders() });
      const data = await res.json();
      if (data.success) setEditing(data.data); else setError(data.message);
    } finally { setBusyId(null); }
  };

  const handleSave = async (seq) => {
    const isNew = seq.isNew;
    const res = await fetch(isNew ? `${API}/sequences` : `${API}/sequences/${seq._id}`, {
      method: isNew ? 'POST' : 'PUT',
      headers: authHeaders(true),
      body: JSON.stringify(seq),
    });
    const data = await res.json();
    if (!data.success) return data.message || 'Save failed';
    setEditing(null);
    fetchAll();
    return null;
  };

  const setStatus = async (row, status) => {
    setBusyId(row._id);
    try {
      const res = await fetch(`${API}/sequences/${row._id}`, {
        method: 'PUT', headers: authHeaders(true), body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (data.success) fetchAll(); else setError(data.message);
    } finally { setBusyId(null); }
  };

  const handleDelete = async (id) => {
    setBusyId(id);
    try {
      const res = await fetch(`${API}/sequences/${id}`, { method: 'DELETE', headers: authHeaders() });
      const data = await res.json();
      if (data.success) { setConfirmDelete(null); fetchAll(); } else setError(data.message);
    } finally { setBusyId(null); }
  };

  return (
    <div className="p-4 md:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 md:mb-8">
        <div className="min-w-0">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-1 md:mb-2">
            {t('sequences.title', 'Email Sequences')}
          </h2>
          <p className="text-sm md:text-base text-brand-text-tertiary">
            {t('sequences.subtitle', 'Several emails sent over days, stopping automatically when someone subscribes.')}
          </p>
        </div>
        <button onClick={() => openEditor(null)}
          className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors flex-shrink-0">
          <Plus className="w-4 h-4" />
          {t('sequences.create', 'New sequence')}
        </button>
      </div>

      <div className="mb-6 flex items-start gap-2 px-4 py-3 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-200 text-sm">
        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <span>
          {t('sequences.notice', 'Each step is an existing campaign. Before every step the person is re-checked against the audience — anyone who no longer matches, usually because they subscribed, stops receiving the rest.')}
        </span>
      </div>

      {error && (
        <div className="mb-6 flex items-start gap-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /><span>{error}</span>
        </div>
      )}

      {loading && <div className="flex justify-center py-16"><Loader className="w-8 h-8 text-accent animate-spin" /></div>}

      {!loading && rows.length === 0 && (
        <div className="text-center py-20">
          <GitBranch className="w-16 h-16 mx-auto mb-4 text-brand-text-tertiary opacity-30" />
          <p className="text-brand-text-tertiary text-lg">{t('sequences.empty', 'No sequences yet')}</p>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="space-y-3">
          {rows.map(row => (
            <div key={row._id} className="bg-dark-elevated rounded-xl border border-white/10 p-4 sm:p-5">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-white truncate">{row.name}</h3>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${STATUS_STYLE[row.status]}`}>
                      {t(`sequences.status_${row.status}`, row.status)}
                    </span>
                  </div>
                  <p className="text-xs text-brand-text-tertiary mt-1">
                    {row.steps?.length || 0} {t('sequences.steps', 'steps')} · {row.audience?.segment}
                  </p>
                  <div className="flex gap-4 mt-2 text-xs">
                    <span className="text-blue-300">{row.enrollments?.active || 0} {t('sequences.inProgress', 'in progress')}</span>
                    <span className="text-green-400">{row.enrollments?.exited || 0} {t('sequences.converted', 'exited early')}</span>
                    <span className="text-brand-text-tertiary">{row.enrollments?.completed || 0} {t('sequences.finished', 'finished')}</span>
                  </div>
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                  {row.status !== 'active' && row.steps?.length > 0 && (
                    <button onClick={() => setStatus(row, 'active')} disabled={busyId === row._id}
                      className="px-3 py-1.5 rounded-lg bg-green-600/20 border border-green-500/30 text-green-300 text-xs font-medium hover:bg-green-600/30 transition-colors disabled:opacity-40">
                      {t('sequences.activate', 'Activate')}
                    </button>
                  )}
                  {row.status === 'active' && (
                    <button onClick={() => setStatus(row, 'paused')} disabled={busyId === row._id}
                      className="px-3 py-1.5 rounded-lg bg-orange-600/20 border border-orange-500/30 text-orange-300 text-xs font-medium hover:bg-orange-600/30 transition-colors disabled:opacity-40">
                      {t('sequences.pause', 'Pause')}
                    </button>
                  )}
                  <button onClick={() => openEditor(row._id)} disabled={busyId === row._id}
                    className="p-2 hover:bg-dark-surface rounded-lg text-brand-text-tertiary hover:text-white transition-colors disabled:opacity-40">
                    <GitBranch className="w-4 h-4" />
                  </button>
                  <button onClick={() => setConfirmDelete(row)} disabled={busyId === row._id}
                    className="p-2 hover:bg-dark-surface rounded-lg text-brand-text-tertiary hover:text-red-400 transition-colors disabled:opacity-40">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <SequenceEditor
          sequence={editing}
          campaigns={campaigns}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-dark-surface rounded-2xl border border-white/10 p-6 sm:p-8 max-w-md w-full">
            <h3 className="text-xl font-bold text-white mb-2">{t('sequences.deleteTitle', 'Delete this sequence?')}</h3>
            <p className="text-white font-semibold mb-4 break-words">{confirmDelete.name}</p>
            <p className="text-brand-text-tertiary text-sm mb-6">
              {t('sequences.deleteBody', 'Everyone part way through stops where they are. Records of emails already sent are kept, so discount codes already issued keep working.')}
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

function SequenceEditor({ sequence, campaigns, onClose, onSave }) {
  const { t } = useTranslation();
  const [form, setForm] = useState(sequence);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [audience, setAudience] = useState(null);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setAud = (k, v) => setForm(f => ({ ...f, audience: { ...(f.audience || {}), [k]: v } }));

  const setStep = (i, k, v) => setForm(f => {
    const steps = [...(f.steps || [])];
    steps[i] = { ...steps[i], [k]: v };
    return { ...f, steps };
  });
  const addStep = () => setForm(f => ({
    ...f,
    steps: [...(f.steps || []), { campaignId: campaigns[0]?._id || '', delayHours: (f.steps?.length ? 72 : 0) }],
  }));
  const removeStep = (i) => setForm(f => ({ ...f, steps: (f.steps || []).filter((_, n) => n !== i) }));

  const save = async () => {
    setSaving(true);
    setErr('');
    const problem = await onSave(form);
    if (problem) setErr(problem);
    setSaving(false);
  };

  const checkAudience = async () => {
    if (form.isNew) { setAudience({ error: t('sequences.saveFirst', 'Save the sequence first') }); return; }
    setAudience({ loading: true });
    const res = await fetch(`${API}/sequences/${form._id}/audience`, { headers: authHeaders() });
    const data = await res.json();
    setAudience(data.success ? data.data : { error: data.message });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-dark-surface rounded-2xl border border-white/10 p-5 sm:p-8 max-w-3xl w-full max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold text-white">
            {form.isNew ? t('sequences.create', 'New sequence') : t('sequences.edit', 'Edit sequence')}
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
            <label className={label}>{t('sequences.name', 'Sequence name')}</label>
            <input className={field} value={form.name || ''} onChange={e => set('name', e.target.value)} />
          </div>

          {/* Audience */}
          <div className="rounded-xl border border-white/10 p-4 space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Users className="w-4 h-4 text-accent" />
              {t('sequences.audience', 'Who enters — and who stays')}
            </div>
            <p className="text-[11px] text-brand-text-tertiary -mt-2">
              {t('sequences.audienceHint', 'Checked again before every step. Someone who stops matching — usually by subscribing — receives nothing further.')}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={label}>{t('campaigns.segment', 'Segment')}</label>
                <select className={field} value={form.audience?.segment || 'free'} onChange={e => setAud('segment', e.target.value)}>
                  <option value="free">{t('campaigns.seg_free', 'Free — never subscribed')}</option>
                  <option value="cancelled">{t('campaigns.seg_cancelled', 'Cancelled')}</option>
                  <option value="paid">{t('campaigns.seg_paid', 'Paying subscribers')}</option>
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
                  {audience.alreadyEnrolled > 0 && ` · ${audience.alreadyEnrolled} ${t('sequences.alreadyIn', 'already in')}`}
                </span>
              )}
            </div>
          </div>

          {/* Steps */}
          <div className="rounded-xl border border-white/10 p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Clock className="w-4 h-4 text-accent" />
                {t('sequences.stepsTitle', 'Steps')}
              </div>
              <button onClick={addStep} disabled={!campaigns.length}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-dark-elevated hover:bg-white/10 border border-white/10 text-white text-xs font-medium transition-colors disabled:opacity-40">
                <Plus className="w-3.5 h-3.5" />
                {t('sequences.addStep', 'Add step')}
              </button>
            </div>

            {!campaigns.length && (
              <p className="text-xs text-yellow-400/80">
                {t('sequences.noCampaigns', 'Create a campaign first — each step sends one.')}
              </p>
            )}

            {(form.steps || []).map((step, i) => (
              <div key={i}>
                {i > 0 && (
                  <div className="flex items-center gap-2 py-2 pl-3 text-xs text-brand-text-tertiary">
                    <ArrowDown className="w-3.5 h-3.5" />
                    <input type="number" min="0" value={step.delayHours ?? 0}
                      onChange={e => setStep(i, 'delayHours', Number(e.target.value))}
                      className="w-20 px-2 py-1 bg-dark-elevated border border-white/10 rounded text-white text-xs focus:outline-none focus:border-accent" />
                    <span>{t('sequences.hoursLater', 'hours later')}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 bg-dark-elevated rounded-lg p-3 border border-white/10">
                  <span className="text-xs font-bold text-accent w-5 flex-shrink-0">{i + 1}</span>
                  <select className={field + ' flex-1 min-w-0'} value={String(step.campaignId || '')}
                    onChange={e => setStep(i, 'campaignId', e.target.value)}>
                    {campaigns.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
                  </select>
                  <button onClick={() => removeStep(i)}
                    className="p-2 hover:bg-dark-surface rounded-lg text-brand-text-tertiary hover:text-red-400 transition-colors flex-shrink-0">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                {step.missing && (
                  <p className="text-[10px] text-red-400 mt-1 pl-8">
                    {t('sequences.stepMissing', 'This campaign no longer exists — anyone reaching this step will stop here.')}
                  </p>
                )}
              </div>
            ))}

            {(form.steps || []).length > 0 && (
              <p className="text-[10px] text-brand-text-tertiary mt-3">
                {t('sequences.firstStepHint', 'The first step goes out as soon as someone qualifies — the account age above is already the entry delay.')}
              </p>
            )}
          </div>

          <div>
            <label className={label}>{t('sequences.maxPerRun', 'Most emails per run')}</label>
            <input type="number" min="1" className={field} value={form.maxPerRun ?? 50}
              onChange={e => set('maxPerRun', Number(e.target.value))} />
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
