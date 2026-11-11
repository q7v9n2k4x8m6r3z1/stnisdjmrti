import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, UserPlus, Edit, Trash2, Shield, Crown, User, Loader, X, ChevronLeft, ChevronRight, Users, RefreshCw, Ban, CheckCircle, Download, FileDown } from 'lucide-react';
import API_URL from '../../config/api';
import { hasPaidAccess } from '../../utils/subscriptionAccess';

const API = API_URL;
const getToken = () => localStorage.getItem('token');
const authHeaders = (json = false) => {
  const h = {};
  const token = getToken();
  if (token) h['Authorization'] = `Bearer ${token}`;
  if (json) h['Content-Type'] = 'application/json';
  return h;
};

// `forcedSegment` locks the view to one segment and hides the stat cards —
// used to power the standalone "Piracy Detection" tab without duplicating
// this whole component.
export default function AdminUsers({ forcedSegment = null, title, subtitle } = {}) {
  const { t, i18n } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [activeSegment, setActiveSegment] = useState(forcedSegment);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 25, pages: 1 });
  const [stats, setStats] = useState({ totalUsers: 0, freeCount: 0, individualMonthlyCount: 0, individualQuarterlyCount: 0, sharedMonthlyCount: 0, sharedQuarterlyCount: 0, flaggedCount: 0, newThisMonth: 0 });
  const [editingUser, setEditingUser] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [bulkSyncing, setBulkSyncing] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);
  const [blockModal, setBlockModal] = useState(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const fetchUsers = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: 25 });
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (activeSegment) params.set('segment', activeSegment);
      const res = await fetch(`${API}/users?${params}`, { headers: authHeaders() });
      if (!res.ok) {
        console.error('Users API HTTP error:', res.status, await res.text());
        return;
      }
      const data = await res.json();
      if (data.success) {
        setUsers(data.data);
        setPagination(data.pagination);
        if (data.stats) setStats(data.stats);
      }
    } catch (err) {
      console.error('Failed to fetch users:', err.message || err);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, activeSegment]);

  useEffect(() => { fetchUsers(1); }, [fetchUsers]);

  const handleSegmentClick = (segment) => {
    if (forcedSegment) return; // locked view (Piracy Detection tab)
    setActiveSegment(prev => (prev === segment ? null : segment));
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (activeSegment) params.set('segment', activeSegment);
      const res = await fetch(`${API}/users/export?${params}`, { headers: authHeaders() });
      if (!res.ok) { console.error('Export failed:', res.status); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `users-export-${activeSegment || 'all'}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (err) {
      console.error('Export error:', err);
    } finally {
      setExporting(false);
    }
  };

  // Preview first, write only on an explicit second click.
  //
  // This button used to mutate every matching account on one click with no way
  // to see what it would do. It wrote a month of unpaid access to a customer's
  // record and nobody noticed until an audit went looking. Previewing costs one
  // extra click and makes the riskiest control in this panel reviewable.
  const handleBulkSync = async (dryRun = true) => {
    setBulkSyncing(true);
    setBulkResult(null);
    try {
      const res = await fetch(`${API}/users/bulk-sync-stripe${dryRun ? '?dryRun=1' : ''}`, {
        method: 'POST',
        headers: authHeaders()
      });
      const data = await res.json();
      setBulkResult(data);
      // Only a real write can change the table underneath us.
      if (data.success && !data.dryRun) fetchUsers(pagination.page);
    } catch (err) {
      setBulkResult({ success: false, message: err.message });
    } finally {
      setBulkSyncing(false);
    }
  };

  const handleDelete = async (userId) => {
    try {
      const res = await fetch(`${API}/users/${userId}`, { method: 'DELETE', headers: authHeaders() });
      const data = await res.json();
      if (data.success) {
        setDeleteConfirm(null);
        fetchUsers(pagination.page);
      }
    } catch (err) { console.error('Delete failed:', err); }
  };

  const handleBlockUser = async (userId, reason) => {
    try {
      const res = await fetch(`${API}/users/${userId}/block`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify({ reason })
      });
      const data = await res.json();
      if (data.success) { setBlockModal(null); fetchUsers(pagination.page); }
      else alert(data.message || 'Failed to block user');
    } catch (err) { console.error('Block failed:', err); }
  };

  const handleLiftSuspension = async (userId) => {
    try {
      const res = await fetch(`${API}/users/${userId}/lift-download-suspension`, {
        method: 'PUT',
        headers: authHeaders()
      });
      const data = await res.json();
      if (data.success) fetchUsers(pagination.page);
      else alert(data.message || 'Failed to lift suspension');
    } catch (err) { console.error('Lift suspension failed:', err); }
  };

  const handleUnblockUser = async (userId) => {
    try {
      const res = await fetch(`${API}/users/${userId}/unblock`, {
        method: 'PUT',
        headers: authHeaders()
      });
      const data = await res.json();
      if (data.success) fetchUsers(pagination.page);
      else alert(data.message || 'Failed to unblock user');
    } catch (err) { console.error('Unblock failed:', err); }
  };

  const handleEditSave = async (userId, updates) => {
    try {
      const res = await fetch(`${API}/users/${userId}`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify(updates)
      });
      const data = await res.json();
      if (data.success) {
        setEditingUser(null);
        fetchUsers(pagination.page);
        // Setting a paying customer to Free also stops their Stripe billing —
        // or reports that it could not, which the admin must act on.
        if (data.warning || data.message) alert(data.warning || data.message);
      } else {
        alert(data.message || 'Failed to update user');
      }
    } catch (err) {
      console.error('Update failed:', err);
      alert('Network error — could not save changes');
    }
  };

  const getRoleIcon = (role) => {
    switch (role) {
      case 'admin': return Shield;
      default: return User;
    }
  };

  // Map any planId variant to a display label
  const PLAN_LABELS = {
    'free':                  'Free',
    'individual_monthly':    'Individual Monthly',
    'individual_quarterly':  'Individual Quarterly',
    'individual-monthly':    'Individual Monthly',
    'individual-quarterly':  'Individual Quarterly',
    'shared_monthly':        'Shared Monthly',
    'shared_quarterly':      'Shared Quarterly',
    'shared-monthly':        'Shared Monthly',
    'shared-quarterly':      'Shared Quarterly',
    'premium':               'Premium (Individual)',
    'pro':                   'Pro (Shared)',
  };

  // Normalize any planId/plan value to the canonical underscore form used in the DB seed
  const normalizePlan = (raw) => {
    if (!raw || raw === 'free') return 'free';
    const map = {
      'individual-monthly':   'individual_monthly',
      'individual-quarterly': 'individual_quarterly',
      'shared-monthly':       'shared_monthly',
      'shared-quarterly':     'shared_quarterly',
      'premium':              'individual_monthly',
      'pro':                  'shared_monthly',
    };
    return map[raw] || raw;
  };

  // The shared rule, not a local one. This was its own implementation and it
  // disagreed: it required status === 'active', so a customer who had
  // cancelled but was still inside the period they paid for — someone who can
  // download right now, because the backend says so — rendered here as a grey
  // avatar labelled "Free" with a "Sub: Cancelled" tag. This is the screen
  // used to answer "is this customer OK?", so it produced confident wrong
  // answers. hasPaidAccess is what the backend and UserDashboard both use.
  const isSubActive = (u) => hasPaidAccess(u.subscription);

  const getPlanLabel = (u) => {
    if (u.role === 'admin') return t('admin.adminRole');
    const raw = u.subscription?.planId || u.subscription?.plan || null;
    if (!raw || raw === 'free') return 'Free';
    return PLAN_LABELS[raw] || normalizePlan(raw).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  };

  const getRoleColor = (u) => {
    if (u.role === 'admin') return 'from-red-500 to-pink-500';
    if (!isSubActive(u)) return 'from-gray-500 to-gray-600';
    const raw = u.subscription?.planId || u.subscription?.plan || 'free';
    const plan = normalizePlan(raw);
    if (['shared_monthly', 'shared_quarterly'].includes(plan)) return 'from-orange-500 to-red-500';
    if (['individual_monthly', 'individual_quarterly'].includes(plan)) return 'from-purple-500 to-pink-500';
    return 'from-gray-500 to-gray-600';
  };

  const timeAgo = (date) => {
    if (!date) return '—';
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t('timeAgo.justNow');
    if (mins < 60) return t('timeAgo.minutesAgo', { count: mins });
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return t('timeAgo.hoursAgo', { count: hrs });
    const days = Math.floor(hrs / 24);
    return t('timeAgo.daysAgo', { count: days });
  };

  const startIdx = (pagination.page - 1) * pagination.limit + 1;
  const endIdx = Math.min(pagination.page * pagination.limit, pagination.total);

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-3xl font-bold text-white mb-2">{title || t('admin.memberManagement')}</h2>
          <p className="text-brand-text-tertiary">{subtitle || t('admin.managePermissions')}</p>
        </div>
        <div className="flex items-start gap-3">
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-green-600/20 hover:bg-green-600/30 border border-green-500/30 text-green-300 text-sm font-medium transition-colors disabled:opacity-50"
            title="Export the currently filtered list as CSV"
          >
            {exporting ? <Loader className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
            {exporting ? 'Exporting...' : 'Export CSV'}
          </button>
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleBulkSync(true)}
                disabled={bulkSyncing}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 text-sm font-medium transition-colors disabled:opacity-50"
                title="Ask Stripe what would change. Writes nothing."
              >
                <RefreshCw className={`w-4 h-4 ${bulkSyncing ? 'animate-spin' : ''}`} />
                {bulkSyncing ? 'Checking Stripe...' : 'Preview Stripe sync'}
              </button>
              {/* Only offered once a preview has actually found changes to make. */}
              {bulkResult?.success && bulkResult?.dryRun && (bulkResult.data?.changed ?? 0) > 0 && (
                <button
                  onClick={() => handleBulkSync(false)}
                  disabled={bulkSyncing}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 text-amber-300 text-sm font-semibold transition-colors disabled:opacity-50"
                  title="Write the changes listed below"
                >
                  Apply {bulkResult.data.changed} change{bulkResult.data.changed === 1 ? '' : 's'}
                </button>
              )}
            </div>
            {bulkResult && (
              <div className="flex flex-col items-end gap-1 max-w-md">
                <p className={`text-[11px] font-semibold ${
                  !bulkResult.success ? 'text-red-400' : bulkResult.dryRun ? 'text-blue-300' : 'text-green-400'
                }`}>
                  {bulkResult.success
                    ? `${bulkResult.dryRun ? '👁' : '✓'} ${bulkResult.message}`
                    : `✗ ${bulkResult.message}`}
                </p>

                {/* On a preview, the point is to see WHAT would change before
                    anything is written. Nothing has been saved at this stage. */}
                {bulkResult.success && bulkResult.dryRun && (() => {
                  const changes = (bulkResult.data?.results || []).filter(r => r.changed);
                  if (!changes.length) {
                    return (
                      <p className="text-[10px] text-brand-text-tertiary">
                        Nothing would change — every account already matches Stripe.
                      </p>
                    );
                  }
                  const when = (d) => (d ? String(d).slice(0, 10) : '—');
                  return (
                    <div className="w-full text-right bg-dark-elevated border border-blue-500/20 rounded-lg p-2 max-h-48 overflow-y-auto">
                      {changes.map((r, i) => (
                        <p key={`${r.email}-${i}`} className="text-[10px] leading-relaxed">
                          <span className="text-white">{r.email}</span>{' '}
                          <span className="text-brand-text-tertiary">
                            {[
                              r.before?.status !== r.status && `${r.before?.status ?? '—'} → ${r.status}`,
                              when(r.before?.endDate) !== when(r.endDate) &&
                                `expires ${when(r.before?.endDate)} → ${when(r.endDate)}`,
                              // An account can change by having a dead Stripe id
                              // repaired and nothing else — that still needs applying.
                              r.idsRepaired && (r.result === 'no_stripe_subscription_found'
                                ? 'old/invalid Stripe ids cleared (no subscription — normal for a free account)'
                                : 'Stripe ids repaired'),
                            ].filter(Boolean).join(', ')}
                          </span>
                        </p>
                      ))}
                    </div>
                  );
                })()}
                {/* The API already returns a per-user `results` array naming every
                    failure and skip — it was simply discarded here, so "3 failed"
                    was unactionable and an admin had to read PM2 logs to find out
                    WHICH three. Surface them. */}
                {bulkResult.success && (() => {
                  const rows = bulkResult.data?.results || [];
                  // An account whose only change is clearing dead ids already
                  // appears in the change list above; listing it here too as
                  // "no_stripe_subscription_found" read like conflicting data
                  // about the same customer.
                  const problems = rows.filter(r => r.result !== 'synced' && !(r.idsRepaired && bulkResult.dryRun));
                  const LABELS = {
                    no_stripe_subscription_found: 'no Stripe subscription (never paid, or free)',
                    removed_by_admin: 'skipped — set to Free by an admin',
                    admin_grant: 'skipped — admin-granted plan, not billed by Stripe',
                  };
                  if (!problems.length) return null;
                  return (
                    <div className="w-full text-right bg-dark-elevated border border-white/10 rounded-lg p-2 max-h-40 overflow-y-auto">
                      {problems.map((r, i) => (
                        <p key={`${r.email}-${i}`} className="text-[10px] leading-relaxed">
                          <span className={r.result === 'error' ? 'text-red-400' : 'text-yellow-400'}>
                            {r.result === 'error' ? '✗' : '–'}
                          </span>{' '}
                          <span className="text-white">{r.email}</span>{' '}
                          <span className="text-brand-text-tertiary">
                            {r.result === 'error' ? r.error : (LABELS[r.result] || r.result)}
                          </span>
                        </p>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stats — derived from the granular plan counts the API returns.
          Individual/Shared each sum their monthly + quarterly tiers.
          Each card is a quick filter: clicking it re-fetches the table below
          scoped to that segment; clicking the active card clears the filter. */}
      {!forcedSegment && (() => {
        const individualPlans = (stats?.individualMonthlyCount ?? 0) + (stats?.individualQuarterlyCount ?? 0);
        const sharedPlans = (stats?.sharedMonthlyCount ?? 0) + (stats?.sharedQuarterlyCount ?? 0);
        const freeUsers = stats?.freeCount ?? 0;
        const flaggedUsers = stats?.flaggedCount ?? 0;
        const cards = [
          { segment: null, value: stats?.totalUsers ?? 0, label: t('admin.totalMembers') },
          { segment: 'free', value: freeUsers, label: t('admin.freeMembers', 'Free Users') },
          { segment: 'individual', value: individualPlans, label: t('admin.individualMembers', 'Individual Plans') },
          { segment: 'shared', value: sharedPlans, label: t('admin.sharedMembers', 'Shared Plans') },
          { segment: 'flagged', value: flaggedUsers, label: 'Flagged / Piracy', accent: true },
          { segment: 'new', value: stats?.newThisMonth ?? 0, label: t('admin.newThisMonth') },
        ];
        return (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6 mb-8">
            {cards.map((c) => {
              const isActive = activeSegment === c.segment;
              return (
                <button
                  key={c.label}
                  type="button"
                  onClick={() => handleSegmentClick(c.segment)}
                  className={`text-left bg-dark-elevated rounded-xl p-6 border transition-all ${
                    isActive
                      ? 'border-accent ring-2 ring-accent/40'
                      : c.accent && c.value > 0
                        ? 'border-orange-500/30 hover:border-orange-500/60'
                        : 'border-white/10 hover:border-white/25'
                  }`}
                >
                  <div className={`text-3xl font-bold mb-1 ${c.accent && c.value > 0 ? 'text-orange-400' : 'text-white'}`}>{c.value.toLocaleString()}</div>
                  <p className="text-sm text-brand-text-tertiary">{c.label}</p>
                </button>
              );
            })}
          </div>
        );
      })()}

      {/* Search */}
      <div className="bg-dark-elevated rounded-xl p-4 border border-white/10 mb-6 flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-brand-text-tertiary" />
          <input
            type="text"
            placeholder={t('admin.searchMembers')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-dark-surface border border-white/10 rounded-lg text-white placeholder-brand-text-tertiary focus:outline-none focus:border-accent transition-colors"
          />
        </div>
        {!forcedSegment && activeSegment && (
          <button
            onClick={() => setActiveSegment(null)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent/10 border border-accent/30 text-accent text-sm font-medium hover:bg-accent/20 transition-colors flex-shrink-0"
          >
            <X className="w-3.5 h-3.5" /> Clear filter
          </button>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader className="w-8 h-8 text-accent animate-spin" />
        </div>
      )}

      {/* Users Table */}
      {!loading && users.length > 0 && (
        <div className="bg-dark-elevated rounded-xl border border-white/10 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10 bg-dark-surface">
                  <th className="text-left px-6 py-4 text-xs font-semibold text-brand-text-tertiary uppercase tracking-wider">{t('admin.member')}</th>
                  <th className="text-left px-6 py-4 text-xs font-semibold text-brand-text-tertiary uppercase tracking-wider">{t('admin.phone')}</th>
                  <th className="text-left px-6 py-4 text-xs font-semibold text-brand-text-tertiary uppercase tracking-wider">{t('admin.rolePlan')}</th>
                  <th className="text-left px-6 py-4 text-xs font-semibold text-brand-text-tertiary uppercase tracking-wider">{t('admin.joined')}</th>
                  <th className="text-left px-6 py-4 text-xs font-semibold text-brand-text-tertiary uppercase tracking-wider">{t('admin.lastLogin')}</th>
                  <th className="text-left px-6 py-4 text-xs font-semibold text-brand-text-tertiary uppercase tracking-wider">{t('library.downloads')}</th>
                  {/* "Account", not "Status": this column is user.isActive — whether the
    account is enabled — and has nothing to do with the subscription, which
    is shown in the Role/Plan column. Both read "Active", and the ambiguity
    caused a real mistake: an account showing "Subscription: Cancelled /
    Status: Active" was read as a billing fault and disabled by hand, which
    returns 401 on every request, not just downloads. */}
<th className="text-left px-6 py-4 text-xs font-semibold text-brand-text-tertiary uppercase tracking-wider" title="Whether the account is enabled. Subscription state is in the Role / Plan column.">{t('admin.accountStatus', 'Account')}</th>
                  <th className="text-left px-6 py-4 text-xs font-semibold text-brand-text-tertiary uppercase tracking-wider">{t('admin.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {users.map((user) => {
                  const RoleIcon = getRoleIcon(user.role);
                  return (
                    <tr key={user._id} className="hover:bg-dark-surface transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${getRoleColor(user)} flex items-center justify-center`}>
                            <span className="text-white font-bold text-sm">{(user.name || '?').charAt(0).toUpperCase()}</span>
                          </div>
                          <div>
                            <div className="font-semibold text-white">{user.name}</div>
                            <div className="text-sm text-brand-text-tertiary">{user.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-brand-text-tertiary">
                        <div>{user.phoneNumber || '—'}</div>
                        {user.instagram && (
                          <a
                            href={`https://instagram.com/${user.instagram}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] text-accent hover:underline"
                          >
                            @{user.instagram}
                          </a>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <RoleIcon className="w-4 h-4 text-accent" />
                          <div>
                            <span className="text-sm font-medium text-white">{getPlanLabel(user)}</span>
                            {/* past_due is shown on its own line whatever the access
                                window says: "Active" alone hid that Stripe's last
                                charge failed, and the admin could not tell whether
                                the customer could still download. The answer is the
                                same rule the download endpoints apply. */}
                            {user.role !== 'admin' && user.subscription?.status === 'past_due' ? (
                              <div className="text-[10px] text-red-400 font-medium">
                                Payment failed · {isSubActive(user)
                                  ? `can download until ${new Date(user.subscription.endDate).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' })} (already paid)`
                                  : 'cannot download'}
                              </div>
                            ) : user.role !== 'admin' && !isSubActive(user) && (user.subscription?.planId || (user.subscription?.plan && user.subscription?.plan !== 'free')) && (
                              <div className="text-[10px] text-yellow-500/80 font-medium">
                                {user.subscription?.status === 'cancelled' ? 'Sub: Cancelled' : user.subscription?.status === 'expired' ? 'Sub: Expired' : 'Sub: Inactive'} · cannot download
                              </div>
                            )}
                            {user.role !== 'admin' && user.subscription?.adminRevokedAt && (
                              <div className="text-[10px] text-brand-text-tertiary">Set to Free by admin — Stripe sync will not restore</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-brand-text-tertiary">
                        {new Date(user.createdAt).toLocaleDateString(i18n.language, { month: 'short', day: 'numeric', year: 'numeric' })}
                      </td>
                      <td className="px-6 py-4 text-sm text-brand-text-tertiary">{timeAgo(user.lastLogin)}</td>
                      <td className="px-6 py-4">
                        <div className="text-sm font-semibold text-white">{(user.downloads?.total || 0).toLocaleString()}</div>
                        {(user.downloads?.today || 0) > 0 && (
                          <div className="text-[10px] text-accent">+{user.downloads.today} today</div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1">
                          {user.isBlocked ? (
                            <span className="px-2 py-1 rounded-full text-xs font-semibold bg-orange-500/20 text-orange-400 border border-orange-500/30 flex items-center gap-1 w-fit">
                              <Ban className="w-3 h-3" /> Blocked
                            </span>
                          ) : (
                            <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                              user.isActive !== false
                                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                : 'bg-red-500/20 text-red-400 border border-red-500/30'
                            }`}>
                              {user.isActive !== false ? t('admin.activeStatus') : t('admin.inactiveStatus')}
                            </span>
                          )}
                          {user.downloadWarningLevel === 1 && !user.downloadSuspended && (
                            <span className="px-2 py-1 rounded-full text-xs font-semibold bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 flex items-center gap-1 w-fit">
                              <Download className="w-3 h-3" /> DL Warning
                            </span>
                          )}
                          {user.downloadSuspended && (
                            <span className="px-2 py-1 rounded-full text-xs font-semibold bg-orange-500/20 text-orange-400 border border-orange-500/30 flex items-center gap-1 w-fit">
                              <Download className="w-3 h-3" /> DL Paused {user.downloadPausedUntil ? `until ${new Date(user.downloadPausedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <button onClick={() => setEditingUser(user)} className="p-2 hover:bg-dark-elevated rounded-lg transition-colors text-brand-text-tertiary hover:text-white">
                            <Edit className="w-4 h-4" />
                          </button>
                          {user.role !== 'admin' && (
                            user.isBlocked ? (
                              <button onClick={() => handleUnblockUser(user._id)} className="p-2 hover:bg-dark-elevated rounded-lg transition-colors text-orange-400 hover:text-green-400" title="Unblock user">
                                <CheckCircle className="w-4 h-4" />
                              </button>
                            ) : (
                              <button onClick={() => setBlockModal(user)} className="p-2 hover:bg-dark-elevated rounded-lg transition-colors text-brand-text-tertiary hover:text-orange-400" title="Block user">
                                <Ban className="w-4 h-4" />
                              </button>
                            )
                          )}
                          {user.role !== 'admin' && (user.downloadSuspended || user.downloadWarningLevel > 0) && (
                            <button onClick={() => handleLiftSuspension(user._id)} className="p-2 hover:bg-dark-elevated rounded-lg transition-colors text-amber-400 hover:text-green-400" title="Clear download restrictions">
                              <CheckCircle className="w-4 h-4" />
                            </button>
                          )}
                          {user.role !== 'admin' && (
                            <button onClick={() => setDeleteConfirm(user)} className="p-2 hover:bg-dark-elevated rounded-lg transition-colors text-brand-text-tertiary hover:text-red-400">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="px-6 py-4 border-t border-white/10 flex items-center justify-between">
            <div className="text-sm text-brand-text-tertiary">
              {t('admin.showing')} <span className="font-semibold text-white">{startIdx}-{endIdx}</span> {t('common.of')} <span className="font-semibold text-white">{pagination.total.toLocaleString()}</span> {t('admin.members')}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => fetchUsers(pagination.page - 1)}
                disabled={pagination.page <= 1}
                className="px-3 py-1.5 rounded-lg bg-dark-surface hover:bg-dark-elevated border border-white/10 text-white text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
              >
                <ChevronLeft className="w-4 h-4" /> {t('actions.back')}
              </button>
              <span className="text-sm text-white font-medium px-2">{pagination.page} / {pagination.pages}</span>
              <button
                onClick={() => fetchUsers(pagination.page + 1)}
                disabled={pagination.page >= pagination.pages}
                className="px-3 py-1.5 rounded-lg bg-dark-surface hover:bg-dark-elevated border border-white/10 text-white text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
              >
                {t('actions.next')} <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && users.length === 0 && (
        <div className="text-center py-20">
          <Users className="w-16 h-16 mx-auto mb-4 text-brand-text-tertiary opacity-30" />
          <p className="text-brand-text-tertiary text-lg">{debouncedSearch ? t('admin.noMembersSearch') : t('admin.noMembers')}</p>
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-dark-surface rounded-2xl border border-white/10 p-8 max-w-md w-full mx-4">
            <h3 className="text-xl font-bold text-white mb-2">{t('admin.deleteMember')}</h3>
            <p className="text-brand-text-tertiary mb-1">{t('admin.deleteConfirm')}</p>
            <p className="text-white font-semibold mb-6">{deleteConfirm.name} ({deleteConfirm.email})</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 px-4 py-2.5 rounded-lg bg-dark-elevated hover:bg-dark-surface border border-white/10 text-white font-medium transition-colors">{t('common.cancel')}</button>
              <button onClick={() => handleDelete(deleteConfirm._id)} className="flex-1 px-4 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium transition-colors">{t('common.delete')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingUser && (
        <EditUserModal user={editingUser} onClose={() => setEditingUser(null)} onSave={handleEditSave} />
      )}

      {/* Block Modal */}
      {blockModal && (
        <BlockUserModal user={blockModal} onClose={() => setBlockModal(null)} onBlock={handleBlockUser} />
      )}
    </div>
  );
}

function EditUserModal({ user, onClose, onSave }) {
  const { t } = useTranslation();
  const [role, setRole] = useState(user.role || 'user');
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [manualSubId, setManualSubId] = useState(user.subscription?.stripeSubscriptionId || '');

  // Normalize any legacy/hyphenated planId to the canonical underscore form
  const normalizePlan = (raw) => {
    if (!raw || raw === 'free') return 'free';
    const map = {
      'individual-monthly':   'individual_monthly',
      'individual-quarterly': 'individual_quarterly',
      'shared-monthly':       'shared_monthly',
      'shared-quarterly':     'shared_quarterly',
      'premium':              'individual_monthly',
      'pro':                  'shared_monthly',
    };
    return map[raw] || raw;
  };
  // (A third copy of the access rule lived here, computed and then never
  // referenced. Removed rather than left waiting to be used.)
  const [plan, setPlan] = useState(
    normalizePlan(user.subscription?.planId || user.subscription?.plan || 'free')
  );
  const [isActive, setIsActive] = useState(user.isActive !== false);

  // Stripe owns the paid period for a Stripe-managed subscription — the expiry
  // field is read-only there. It is editable only for admin grants, which had
  // no expiry at all before: status 'active' with a null endDate never expires,
  // so a comp granted once lasted forever with no way to time-box it.
  const isStripeManaged = !!user.subscription?.stripeSubscriptionId;
  const toDateInput = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
  const [grantExpiry, setGrantExpiry] = useState(toDateInput(user.subscription?.endDate));

  const hasPaidPlan = !!(user.subscription?.planId || (user.subscription?.plan && user.subscription?.plan !== 'free'));

  const handleSyncStripe = async () => {
    if (!manualSubId.trim()) {
      setSyncResult({ ok: false, message: 'Enter a Stripe Subscription ID (sub_...)' });
      return;
    }
    setSyncLoading(true);
    setSyncResult(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/users/${user._id}/sync-stripe`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ stripeSubscriptionId: manualSubId.trim() })
      });
      const data = await res.json();
      if (data.success) {
        setSyncResult({ ok: true, endDate: data.data.endDate, status: data.data.status });
      } else {
        setSyncResult({ ok: false, message: data.message });
      }
    } catch (err) {
      setSyncResult({ ok: false, message: err.message });
    } finally {
      setSyncLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-dark-surface rounded-2xl border border-white/10 p-8 max-w-lg w-full mx-4">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold text-white">{t('admin.editMember')}</h3>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors"><X className="w-5 h-5 text-white" /></button>
        </div>
        <div className="mb-4">
          <p className="text-white font-semibold">{user.name}</p>
          <p className="text-sm text-brand-text-tertiary">{user.email}</p>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-brand-text-tertiary mb-1">{t('admin.roleLabel')}</label>
            <select value={role} onChange={e => setRole(e.target.value)} className="w-full px-4 py-2.5 bg-dark-elevated border border-white/10 rounded-lg text-white focus:outline-none focus:border-accent">
              <option value="user">{t('admin.userRole')}</option>
              <option value="admin">{t('admin.adminRole')}</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-brand-text-tertiary mb-1">{t('admin.subscriptionPlan')}</label>
            <select value={plan} onChange={e => setPlan(e.target.value)} className="w-full px-4 py-2.5 bg-dark-elevated border border-white/10 rounded-lg text-white focus:outline-none focus:border-accent">
              <option value="free">Free</option>
              <optgroup label="Individual">
                <option value="individual_monthly">Individual Monthly — €19.99/mo</option>
                <option value="individual_quarterly">Individual Quarterly — €54.99/3mo</option>
              </optgroup>
              <optgroup label="Shared (2 users)">
                <option value="shared_monthly">Shared Monthly — €29.99/mo</option>
                <option value="shared_quarterly">Shared Quarterly — €79.99/3mo</option>
              </optgroup>
            </select>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-brand-text-tertiary">{t('admin.activeStatus')}</label>
            <button
              onClick={() => setIsActive(!isActive)}
              className={`w-12 h-6 rounded-full transition-colors relative ${isActive ? 'bg-green-500' : 'bg-gray-600'}`}
            >
              <div className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-transform ${isActive ? 'translate-x-6' : 'translate-x-0.5'}`} />
            </button>
          </div>
        </div>
          {/* Grant expiry — only meaningful for a paid plan */}
          {plan !== 'free' && (
            <div className="mt-4">
              <label className="block text-sm font-medium text-brand-text-tertiary mb-1">
                Access expires
              </label>
              <input
                type="date"
                value={grantExpiry}
                disabled={isStripeManaged}
                onChange={e => setGrantExpiry(e.target.value)}
                className="w-full px-4 py-2.5 bg-dark-elevated border border-white/10 rounded-lg text-white focus:outline-none focus:border-accent disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <p className="text-[10px] text-brand-text-tertiary mt-1">
                {isStripeManaged
                  ? 'Managed by Stripe — the paid period is set by billing and cannot be edited here.'
                  : grantExpiry
                    ? 'Access ends at the start of this day. Clear the field for a permanent grant.'
                    : 'Permanent grant — this never expires. Set a date to time-box it.'}
              </p>
            </div>
          )}

          {/* Stripe Sync — shown for all users with a paid plan */}
          {hasPaidPlan && (
            <div className="mt-4 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-blue-400">Sync from Stripe</span>
                <button
                  onClick={handleSyncStripe}
                  disabled={syncLoading}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 text-xs font-medium transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${syncLoading ? 'animate-spin' : ''}`} />
                  {syncLoading ? 'Syncing...' : 'Sync'}
                </button>
              </div>
              <input
                type="text"
                value={manualSubId}
                onChange={e => setManualSubId(e.target.value)}
                placeholder="Stripe Subscription ID (sub_...)"
                className="w-full px-3 py-1.5 bg-dark-elevated border border-white/10 rounded-lg text-white text-xs placeholder-brand-text-tertiary focus:outline-none focus:border-blue-400 mb-1"
              />
              <p className="text-[10px] text-brand-text-tertiary">
                Current expiry: {syncResult?.endDate
                  ? new Date(syncResult.endDate).toLocaleDateString()
                  : user.subscription?.endDate
                    ? new Date(user.subscription.endDate).toLocaleDateString()
                    : '— (missing — paste Stripe sub ID above)'}
              </p>
              {syncResult && (
                <p className={`text-[10px] mt-1 font-semibold ${syncResult.ok ? 'text-green-400' : 'text-red-400'}`}>
                  {syncResult.ok ? `✓ Synced — status: ${syncResult.status}, expires: ${new Date(syncResult.endDate).toLocaleDateString()}` : `✗ ${syncResult.message}`}
                </p>
              )}
            </div>
          )}
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-lg bg-dark-elevated hover:bg-dark-surface border border-white/10 text-white font-medium transition-colors">{t('common.cancel')}</button>
          <button
            onClick={() => onSave(user._id, {
              role,
              plan,
              isActive,
              // Only send an expiry for admin grants; the backend ignores it for
              // Stripe-managed subscriptions, but there is no reason to send it.
              // '' clears the date and means "permanent", which the backend maps to null.
              ...(isStripeManaged ? {} : { endDate: grantExpiry || null }),
            })}
            className="flex-1 px-4 py-2.5 rounded-lg bg-accent hover:bg-accent-hover text-white font-medium transition-colors"
          >
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

const BLOCK_REASONS = [
  { value: 'account_sharing', label: 'Account sharing' },
  { value: 'content_sharing', label: 'Content sharing' },
  { value: 'abusive_use',     label: 'Abusive use' },
  { value: 'piracy',          label: 'Piracy' },
  { value: 'other',           label: 'Other' },
];

function BlockUserModal({ user, onClose, onBlock }) {
  const [reason, setReason] = useState('account_sharing');
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    await onBlock(user._id, reason);
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-dark-surface rounded-2xl border border-white/10 p-8 max-w-md w-full">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-orange-500/10 border border-orange-500/30 flex items-center justify-center">
            <Ban className="w-5 h-5 text-orange-400" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Block user</h3>
            <p className="text-sm text-brand-text-tertiary">{user.name} · {user.email}</p>
          </div>
        </div>

        <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-4 mb-6 text-sm text-orange-300">
          The user will immediately lose access, receive a suspension email, and see a blocked screen on their next login.
        </div>

        <div className="mb-6">
          <label className="block text-sm font-medium text-brand-text-tertiary mb-2">Reason for blocking</label>
          <div className="space-y-2">
            {BLOCK_REASONS.map(r => (
              <label key={r.value} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${reason === r.value ? 'bg-orange-500/10 border-orange-500/40' : 'bg-white/5 border-white/10 hover:border-white/20'}`}>
                <input type="radio" name="blockReason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} className="accent-orange-500" />
                <span className="text-sm text-white">{r.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-lg bg-dark-elevated hover:bg-dark-surface border border-white/10 text-white font-medium transition-colors">
            Cancel
          </button>
          <button onClick={handleConfirm} disabled={loading} className="flex-1 px-4 py-2.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? <Loader className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
            Block user
          </button>
        </div>
      </div>
    </div>
  );
}
