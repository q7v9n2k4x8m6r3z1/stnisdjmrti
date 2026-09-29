import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  LayoutDashboard, 
  Music, 
  Disc, 
  ListMusic, 
  Users, 
  TrendingUp, 
  Database, 
  Palette, 
  Settings, 
  Shield,
  ShieldAlert,
  Monitor,
  CreditCard,
  FolderOpen,
  Upload,
  X,
  Menu,
  Tag,
  Music2,
  Ticket,
  Mail
} from 'lucide-react';
import AdminOverview from './AdminOverview';
import AdminTracks from './AdminTracks';
import AdminAlbums from './AdminAlbums';
import AdminPlaylists from './AdminPlaylists';
import AdminUsers from './AdminUsers';
import AdminAnalytics from './AdminAnalytics';
import AdminPools from './AdminPools';
import AdminGenres from './AdminGenres';
import AdminSubscriptions from './AdminSubscriptions';
import AdminSettings from './AdminSettings';
import AdminSecurity from './AdminSecurity';
import AdminRecordPool from './AdminRecordPool';
import AdminDownloadStats from './AdminDownloadStats';
import UploadProgressTracker from './UploadProgressTracker';
import AdminMashups from './AdminMashups';
import AdminCategories from './AdminCategories';
import AdminMashupCategories from './AdminMashupCategories';
import AdminUserDevices from './AdminUserDevices';
import AdminCoupons from './AdminCoupons';
import AdminCampaigns from './AdminCampaigns';
import ErrorBoundary from '../ErrorBoundary';
import API_URL from '../../config/api';

export default function AdminDashboard({ onClose, user, onUserUpdate }) {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] = useState('overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [uncategorizedCount, setUncategorizedCount] = useState(0);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [missingThumbnailCollections, setMissingThumbnailCollections] = useState([]);
  const [thumbBannerDismissed, setThumbBannerDismissed] = useState(false);

  const fetchUncategorizedCount = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/categories/uncategorized/count`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const d = await res.json();
      if (d.success) setUncategorizedCount(d.count || 0);
    } catch { /* non-fatal */ }
  }, []);

  const fetchMissingThumbnails = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/collections?all=true`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const d = await res.json();
      if (d.success) {
        const missing = (d.data || []).filter(c => c.missingThumbnail && c.status === 'completed');
        setMissingThumbnailCollections(missing);
      }
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => {
    fetchUncategorizedCount();
    fetchMissingThumbnails();
  }, [fetchUncategorizedCount, fetchMissingThumbnails]);

  useEffect(() => {
    const onNavigate = (e) => {
      const section = e?.detail?.section;
      const collectionId = e?.detail?.collectionId;
      if (collectionId) {
        try {
          localStorage.setItem('admin:recordpool:openCollectionId', String(collectionId));
        } catch {}
      }
      if (section) {
        setActiveSection(section);
        setSidebarOpen(false);
      }
    };

    window.addEventListener('admin:navigate', onNavigate);
    return () => window.removeEventListener('admin:navigate', onNavigate);
  }, []);

  const navItems = [
    { id: 'overview', label: t('admin.overview'), icon: LayoutDashboard },
    { id: 'recordpool', label: t('admin.recordPool'), icon: FolderOpen },
    { id: 'mashups', label: t('admin.mashups'), icon: ListMusic },
    { id: 'uploads', label: t('admin.uploadTracks'), icon: Upload },
    { id: 'downloads', label: t('library.downloads'), icon: TrendingUp },
    { id: 'tracks', label: t('admin.tracks'), icon: Music },
    { id: 'users', label: t('admin.users'), icon: Users },
    { id: 'piracy', label: 'Piracy Detection', icon: ShieldAlert },
    { id: 'devices', label: t('admin.devicesAndSessions'), icon: Monitor },
    { id: 'subscriptions', label: t('admin.subscriptions'), icon: CreditCard },
    { id: 'coupons', label: t('coupons.title', 'Discount Codes'), icon: Ticket },
    { id: 'campaigns', label: t('campaigns.title', 'Email Campaigns'), icon: Mail },
    { id: 'analytics', label: t('admin.analytics'), icon: Database },
    { id: 'categories', label: t('admin.categories'), icon: Tag },
    { id: 'mashupCategories', label: 'Mashup Categories', icon: Music2 },
    { id: 'genres', label: t('admin.genres'), icon: Palette },
    { id: 'settings', label: t('admin.settings'), icon: Settings },
    { id: 'security', label: t('admin.security'), icon: Shield },
  ];

  const renderContent = () => {
    switch (activeSection) {
      case 'overview':
        return <AdminOverview onNavigate={setActiveSection} />;
      case 'recordpool':
        return <AdminRecordPool />;
      case 'mashups':
        return <AdminMashups />;
      case 'uploads':
        return <UploadProgressTracker />;
      case 'downloads':
        return <AdminDownloadStats />;
      case 'tracks':
        return <AdminTracks />;
      case 'albums':
        return <AdminAlbums />;
      case 'playlists':
        return <AdminPlaylists />;
      case 'users':
        return <AdminUsers />;
      case 'piracy':
        return (
          <AdminUsers
            forcedSegment="flagged"
            title="Piracy Detection"
            subtitle="Users blocked or flagged by the anti-abuse system"
          />
        );
      case 'devices':
        return <AdminUserDevices />;
      case 'subscriptions':
        return <AdminSubscriptions />;
      case 'coupons':
        return <AdminCoupons />;
      case 'campaigns':
        return <AdminCampaigns />;
      case 'analytics':
        return <AdminAnalytics />;
      case 'pools':
        return <AdminPools />;
      case 'categories':
        return <AdminCategories />;
      case 'mashupCategories':
        return <AdminMashupCategories />;
      case 'genres':
        return <AdminGenres />;
      case 'settings':
        return <AdminSettings user={user} onUserUpdate={onUserUpdate} />;
      case 'security':
        return <AdminSecurity />;
      default:
        return <AdminOverview />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-dark-bg">
      {/* Top Bar */}
      <div className="h-14 md:h-16 bg-dark-elevated border-b border-white/10 flex items-center justify-between px-4 md:px-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="md:hidden w-9 h-9 rounded-lg bg-dark-surface flex items-center justify-center text-white"
          >
            <Menu className="w-5 h-5" />
          </button>
          <Shield className="w-5 h-5 md:w-6 md:h-6 text-accent" />
          <h1 className="text-base md:text-xl font-bold text-white">{t('admin.adminDashboard')}</h1>
        </div>
        <button
          onClick={onClose}
          className="w-9 h-9 md:w-10 md:h-10 rounded-full bg-dark-surface hover:bg-dark-elevated flex items-center justify-center transition-all duration-200 hover:scale-110"
        >
          <X className="w-5 h-5 text-white" />
        </button>
      </div>

      <div className="flex h-[calc(100vh-3.5rem)] md:h-[calc(100vh-4rem)]">
        {/* Mobile sidebar overlay */}
        {sidebarOpen && (
          <div
            className="md:hidden fixed inset-0 z-40 bg-black/50"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        <div className={`
          fixed md:relative z-50 md:z-auto
          top-14 md:top-0 bottom-0 left-0
          w-64 bg-dark-elevated border-r border-white/10 overflow-y-auto
          transition-transform duration-300 md:transition-none
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}>
          <nav className="p-4 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeSection === item.id;
              
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveSection(item.id);
                    setSidebarOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                    isActive
                      ? 'bg-accent text-white shadow-lg shadow-accent/30'
                      : 'text-brand-text-secondary hover:bg-dark-surface hover:text-white'
                  }`}
                >
                  <Icon className="w-5 h-5" strokeWidth={2} />
                  <span className="font-medium">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto bg-dark-bg">
          {/* Missing thumbnail banner */}
          {missingThumbnailCollections.length > 0 && !thumbBannerDismissed && (
            <div className="flex items-center justify-between gap-3 px-5 py-3 bg-blue-500/10 border-b border-blue-500/20">
              <div className="flex items-center gap-2 text-blue-400 text-sm">
                <span className="font-bold text-base">🖼</span>
                <span>{t('admin.missingThumbnailBanner', { count: missingThumbnailCollections.length })}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setActiveSection('recordpool'); setThumbBannerDismissed(true); }}
                  className="px-3 py-1 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 text-xs font-semibold rounded-lg transition-all"
                >
                  {t('admin.goToRecordPool')}
                </button>
                <button onClick={() => setThumbBannerDismissed(true)} className="text-blue-400/60 hover:text-blue-400 transition-all">
                  <X size={14} />
                </button>
              </div>
            </div>
          )}

          {/* Uncategorized tracks banner */}
          {uncategorizedCount > 0 && !bannerDismissed && (
            <div className="flex items-center justify-between gap-3 px-5 py-3 bg-amber-500/10 border-b border-amber-500/20">
              <div className="flex items-center gap-2 text-amber-400 text-sm">
                <span className="font-bold text-base">⚠</span>
                <span>{t('admin.uncategorizedBanner', { count: uncategorizedCount })}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setActiveSection('categories'); setBannerDismissed(true); }}
                  className="px-3 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-xs font-semibold rounded-lg transition-all"
                >
                  {t('admin.reviewNow')}
                </button>
                <button onClick={() => setBannerDismissed(true)} className="text-amber-400/60 hover:text-amber-400 transition-all">
                  <X size={14} />
                </button>
              </div>
            </div>
          )}
          <ErrorBoundary key={activeSection}>
            {renderContent()}
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
}
