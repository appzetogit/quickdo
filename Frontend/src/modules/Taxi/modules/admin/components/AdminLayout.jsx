import React, { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { socketService } from '../../../shared/api/socket';
import { useSettings } from '../../../shared/context/SettingsContext';
import { getSupportConversations, markSupportMessagesRead } from '../../shared/chat/chatApi';
import { adminService } from '../services/adminService';
import { hasAdminPermission } from '../constants/adminAccess';
import {
  clearUnifiedAdminSession,
  getUnifiedAdminProfile,
  syncAdminSessionBridge,
} from '../services/adminSession';
import toast from 'react-hot-toast';
import {
  BarChart3,
  Bell,
  Briefcase,
  Car,
  Bus,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  Globe,
  Home,
  IndianRupee,
  Layers,
  LogOut,
  MapPin,
  MessageCircle,
  Monitor,
  Package,
  PlusCircle,
  Search,
  Settings,
  Settings2,
  Share2,
  ShieldCheck,
  Smartphone,
  Star,
  Trash2,
  TrendingUp,
  Truck,
  UserCog,
  Users,
  UtensilsCrossed,
  Wallet,
  Wrench,
  ShoppingBasket,
  Pill,
  Zap,
  SlidersHorizontal,
} from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import quickSpicyLogo from "@food/assets/k9-logo.jpg";
import { getCachedSettings, loadBusinessSettings, normalizeCompanyName } from "@food/utils/businessSettings";
import { refreshAdminAccess, useAdminAccess, hasPanel, isRestricted, canOpenPath } from "@food/utils/adminAccess";
import { SERVICE_PROVIDER_ENABLED } from "@/config/features";

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

const ADMIN_MODE = 'admin';
const OWNER_MODE = 'owner';
const MODE_STORAGE_KEY = 'adminPanelMode';
const SIDEBAR_EXPANSION_STORAGE_KEY = 'adminSidebarExpandedGroups';
const NOTIFICATION_DISMISS_STORAGE_KEY = 'adminNotificationDismissals';

const pathMatches = (pathname, targetPath) =>
  pathname === targetPath || pathname.startsWith(`${targetPath}/`);

const hasActiveChild = (pathname, items = []) =>
  items.some((item) => {
    if (item.path && pathMatches(pathname, item.path)) return true;
    if (item.subItems) return hasActiveChild(pathname, item.subItems);
    return false;
  });

const flattenItems = (sections = []) =>
  sections.flatMap((section) => section.items ?? []);

const flattenSearchEntries = (items = [], parentLabels = []) =>
  items.flatMap((item) => {
    const currentTrail = [...parentLabels, item.label].filter(Boolean);

    if (item.path) {
      return [
        {
          label: item.label,
          path: item.path,
          trail: parentLabels,
          keywords: currentTrail.join(' ').toLowerCase(),
        },
      ];
    }

    if (item.subItems) {
      return flattenSearchEntries(item.subItems, currentTrail);
    }

    return [];
  });

const readAdminProfile = () => {
  if (typeof window === 'undefined') {
    return { admin_type: 'superadmin', permissions: ['*'], name: 'Admin' };
  }

  try {
    const parsed = getUnifiedAdminProfile();
    return parsed || { admin_type: 'superadmin', permissions: ['*'], name: 'Admin' };
  } catch {
    return { admin_type: 'superadmin', permissions: ['*'], name: 'Admin' };
  }
};

const useCachedLogo = (src) => {
  const [cachedSrc, setCachedSrc] = useState(src);

  useEffect(() => {
    if (!src || src.startsWith('data:')) {
      setCachedSrc(src);
      return;
    }

    const cacheKey = `img_cache_${src}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      setCachedSrc(cached);
    } else {
      setCachedSrc(src);
    }

    fetch(src)
      .then(res => res.blob())
      .then(blob => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64data = reader.result;
          if (base64data !== cached) {
            try { localStorage.setItem(cacheKey, base64data); } catch (e) { }
            setCachedSrc(base64data);
          }
        }
        reader.readAsDataURL(blob);
      }).catch(() => setCachedSrc(src));
  }, [src]);

  return cachedSrc;
};

const filterSidebarItemsByAccess = (items = [], adminProfile = {}) =>
  items.flatMap((item) => {
    const selfAllowed = !item.permission || hasAdminPermission(adminProfile, item.permission);

    if (item.subItems) {
      const filteredSubItems = filterSidebarItemsByAccess(item.subItems, adminProfile);
      if (!selfAllowed && filteredSubItems.length === 0) {
        return [];
      }
      if (filteredSubItems.length === 0) {
        return [];
      }
      return [{ ...item, subItems: filteredSubItems }];
    }

    return selfAllowed ? [item] : [];
  });

const filterSidebarSectionsByAccess = (sections = [], adminProfile = {}) =>
  sections
    .map((section) => ({
      ...section,
      items: filterSidebarItemsByAccess(section.items || [], adminProfile),
    }))
    .filter((section) => section.items.length > 0);

const NOTIFICATION_PAGE_SIZE = 5;

const readDismissedNotifications = () => {
  if (typeof window === 'undefined') {
    return { ride_requests: [], bookings: [], chats: [] };
  }

  try {
    const saved = window.localStorage.getItem(NOTIFICATION_DISMISS_STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) : {};

    return {
      ride_requests: Array.isArray(parsed?.ride_requests) ? parsed.ride_requests : [],
      bookings: Array.isArray(parsed?.bookings) ? parsed.bookings : [],
      chats: Array.isArray(parsed?.chats) ? parsed.chats : [],
    };
  } catch {
    return { ride_requests: [], bookings: [], chats: [] };
  }
};

const getNotificationEntryId = (tab, item = {}) => {
  if (tab === 'ride_requests') {
    return String(item.id || item.requestId || '').trim();
  }

  if (tab === 'bookings') {
    return String(item._id || item.id || item.booking_reference || '').trim();
  }

  return String(item.id || '').trim();
};

const dedupeAdminChatNotifications = (items = []) => {
  const seen = new Set();

  return items.filter((item) => {
    const key = String(item.id || '').trim();

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
};

const formatRelativeAdminTime = (value) => {
  const date = value ? new Date(value) : null;

  if (!date || Number.isNaN(date.getTime())) {
    return 'Just now';
  }

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(1, Math.floor(diffMs / 60000));

  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }

  return date.toLocaleDateString();
};

const looksLikeCoordinateLabel = (value = '') =>
  /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(String(value || '').trim());

const formatAdminNotificationLocation = (value, fallback) => {
  const text = String(value || '').trim();

  if (!text || looksLikeCoordinateLabel(text)) {
    return fallback;
  }

  return text;
};

const resolvePageTitle = (pathname, sections, appName) => {
  const findLabel = (items = []) => {
    for (const item of items) {
      if (item.path && pathMatches(pathname, item.path)) return item.label;
      if (item.subItems) {
        const nested = findLabel(item.subItems);
        if (nested) return nested;
      }
    }
    return null;
  };

  const label = findLabel(flattenItems(sections));
  if (label) return label;
  if (pathname.includes('/owners')) return 'Owner Management';
  if (pathname.includes('/fleet')) return 'Fleet Management';
  if (pathname.includes('/settings')) return 'Settings';
  if (pathname.includes('/reports')) return 'Reports';
  return `${appName || 'App'} Admin`;
};

const normalizeHexColor = (value, fallback = '') => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return fallback;

  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  const shortHexMatch = withHash.match(/^#([0-9a-fA-F]{3})$/);
  if (shortHexMatch) {
    const [r, g, b] = shortHexMatch[1].split('');
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }

  if (/^#([0-9a-fA-F]{6})$/.test(withHash)) {
    return withHash.toUpperCase();
  }

  return fallback;
};

const getSidebarItemCount = (item, unreadCountsByPath = {}) => {
  if (item?.path) {
    return Math.max(0, Number(unreadCountsByPath[item.path] || 0));
  }

  if (Array.isArray(item?.subItems)) {
    return item.subItems.reduce((sum, child) => sum + getSidebarItemCount(child, unreadCountsByPath), 0);
  }

  return 0;
};

const SidebarBadge = ({ count, isActive = false }) => {
  if (count <= 0) {
    return null;
  }

  return (
    <span
      // isActive here means "sits on an open/containing group chip", which is now a
      // light surface -- bg-white/20 text-white was legible only while that chip was
      // a translucent white lift on black, and would have been white-on-cream.
      // The default badge sits on either the light rail or the dark active pill, so
      // it drops the 50% alpha and goes solid: half-opacity orange under white text
      // was already thin on black and is unreadable on cream.
      className={`ml-auto inline-flex min-w-[1.5rem] items-center justify-center rounded-full px-2 py-0.5 text-[10px] font-black ${isActive ? 'bg-[var(--sb-ink)] text-[var(--sb-surface)]' : 'bg-primary-orange text-white'
        }`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
};

const SidebarItem = ({ icon, label, path, isCollapsed, sidebarTextColor, unreadCount = 0 }) => (
  <NavLink
    to={path}
    end
    className={({ isActive }) =>
      cn(
        "group flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-300 relative",
        // The current page inverts to a dark pill -- the strongest mark in the rail,
        // and the same one the Food panel uses. Hover is a flat warm tint and resting
        // is transparent, so the three states stay clearly ranked.
        isActive
          ? "bg-[var(--sb-active-bg)] text-[var(--sb-active-ink)] shadow-[0_2px_8px_rgba(26,26,26,0.18)] border border-[var(--sb-active-bg)]"
          : "text-[var(--sb-ink-soft)] hover:text-[var(--sb-ink)] hover:bg-[var(--sb-hover)]"
      )
    }
  >
    {React.createElement(icon, { size: 18, className: 'shrink-0' })}
    {!isCollapsed && <span className="min-w-0 flex-1 text-[14px] font-bold tracking-tight">{label}</span>}
    {!isCollapsed && (
      <SidebarBadge count={unreadCount} />
    )}
  </NavLink>
);

const SidebarGroup = ({
  icon,
  label,
  subItems,
  isCollapsed,
  pathname,
  forceOpen = false,
  groupKey,
  expandedGroups,
  setExpandedGroups,
  sidebarTextColor,
  unreadCountsByPath,
}) => {
  const isActive = hasActiveChild(pathname, subItems);
  const isOpen = expandedGroups.includes(groupKey);
  const isExpanded = forceOpen || isActive || isOpen;
  const unreadCount = subItems.reduce((sum, item) => sum + getSidebarItemCount(item, unreadCountsByPath), 0);
  const toggleGroup = () => {
    setExpandedGroups((current) =>
      current.includes(groupKey)
        ? current.filter((key) => key !== groupKey)
        : [...current, groupKey]
    );
  };

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={toggleGroup}
        className={cn(
          "group w-full flex items-center justify-between px-4 py-2.5 rounded-xl transition-all duration-300",
          // A raised chip, not the dark pill. This fires on merely *expanded* as well
          // as active, so inverting it would paint a big black block for any group the
          // operator opened, competing with the one item that is actually current.
          // The border and shadow keep it distinct from a passing hover, which is the
          // same fill with no edge.
          isActive || isExpanded
            ? "bg-[var(--sb-hover)] text-[var(--sb-ink)] shadow-sm border border-[var(--sb-border)]"
            : "text-[var(--sb-ink-soft)] hover:text-[var(--sb-ink)] hover:bg-[var(--sb-hover)]"
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          {React.createElement(icon, {
            size: 18,
            className: 'shrink-0',
          })}
          {!isCollapsed && <span className="truncate text-[14px] font-bold tracking-tight">{label}</span>}
        </div>
        {!isCollapsed && (
          <div className="ml-3 flex items-center gap-2">
            <SidebarBadge count={unreadCount} isActive={isActive || isExpanded} />
            <ChevronRight size={14} className={cn("transition-transform duration-300", isExpanded && "rotate-90")} />
          </div>
        )}
      </button>

      {!isCollapsed && isExpanded && (
        <div className="pl-6 pr-2 space-y-1">
          {subItems.map((item) =>
            item.subItems ? (
              <NestedGroup
                key={item.label}
                label={item.label}
                subItems={item.subItems}
                pathname={pathname}
                forceOpen={forceOpen}
                groupKey={`${groupKey}:${item.label}`}
                expandedGroups={expandedGroups}
                setExpandedGroups={setExpandedGroups}
                sidebarTextColor={sidebarTextColor}
                unreadCountsByPath={unreadCountsByPath}
              />
            ) : (
              <NavLink
                key={item.path}
                to={item.path}
                end
                className={({ isActive: childActive }) =>
                  cn(
                    "flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] font-medium transition-all duration-300",
                    childActive
                      ? "bg-[var(--sb-active-bg)] text-[var(--sb-active-ink)] font-semibold"
                      : "text-[var(--sb-ink-faint)] hover:text-[var(--sb-ink)] hover:bg-[var(--sb-hover)]"
                  )
                }
              >
                {/* bg-current, so the bullet tracks the link's own colour: it needs to
                    be light on the dark active pill and dark at rest, and it renders
                    outside the className callback that knows which. */}
                <div className={cn("h-1 w-1 shrink-0 rounded-full", "bg-current")} />
                <span className="min-w-0 flex-1">{item.label}</span>
                <SidebarBadge count={getSidebarItemCount(item, unreadCountsByPath)} />
              </NavLink>
            )
          )}
        </div>
      )}
    </div>
  );
};

const NestedGroup = ({
  label,
  subItems,
  pathname,
  forceOpen = false,
  groupKey,
  expandedGroups,
  setExpandedGroups,
  sidebarTextColor,
  unreadCountsByPath,
}) => {
  const isActive = hasActiveChild(pathname, subItems);
  const isOpen = expandedGroups.includes(groupKey);
  const isExpanded = forceOpen || isActive || isOpen;
  const unreadCount = subItems.reduce((sum, item) => sum + getSidebarItemCount(item, unreadCountsByPath), 0);
  const toggleGroup = () => {
    setExpandedGroups((current) =>
      current.includes(groupKey)
        ? current.filter((key) => key !== groupKey)
        : [...current, groupKey]
    );
  };

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={toggleGroup}
        className={cn(
          "group w-full flex items-center justify-between px-3 py-1.5 rounded-xl transition-all duration-300",
          // Same reasoning as SidebarGroup: a chip for "open", never the dark pill.
          isActive || isExpanded
            ? "bg-[var(--sb-hover)] text-[var(--sb-ink)] shadow-sm border border-[var(--sb-border)]"
            : "text-[var(--sb-ink-soft)] hover:text-[var(--sb-ink)] hover:bg-[var(--sb-hover)]"
        )}
      >
        <span className="flex min-w-0 items-center gap-3 text-[12px] font-medium">
          {/* bg-current in both states now that the open chip is light -- the old
              white dot (and its dark:slate-900 twin, which would have fought it)
              existed only to show up against the black rail. */}
          <div className={cn("h-1 w-1 shrink-0 rounded-full", "bg-current")} />
          <span className="truncate">{label}</span>
        </span>
        <span className="ml-3 flex items-center gap-2">
          <SidebarBadge count={unreadCount} isActive={isActive || isExpanded} />
          <ChevronRight size={12} className={cn("transition-transform duration-300", isExpanded && "rotate-90")} />
        </span>
      </button>

      {isExpanded && (
        <div className="pl-4 space-y-1">
          {subItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end
              className={({ isActive: childActive }) =>
                cn(
                  "flex items-center gap-3 px-3 py-1.5 rounded-xl text-[12px] font-medium transition-all duration-300",
                  childActive
                    ? "bg-[var(--sb-active-bg)] text-[var(--sb-active-ink)] font-semibold"
                    : "text-[var(--sb-ink-faint)] hover:text-[var(--sb-ink)] hover:bg-[var(--sb-hover)]"
                )
              }
            >
              <div className="h-0.5 w-0.5 shrink-0 rounded-full bg-current" />
              <span className="min-w-0 flex-1">{item.label}</span>
              <SidebarBadge count={getSidebarItemCount(item, unreadCountsByPath)} />
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
};

const ModeSwitcher = ({ mode, setMode }) => {
  const [isOpen, setIsOpen] = useState(false);

  const options = [
    { id: ADMIN_MODE, label: 'Admin', subtitle: 'Core control panel' },
    { id: OWNER_MODE, label: 'Owner', subtitle: 'Owner management modules' },
  ];

  const active = options.find((option) => option.id === mode) || options[0];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="group flex items-center gap-3 rounded-2xl border border-neutral-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-2 shadow-sm transition-all hover:border-amber-400/30 hover:shadow-md active:scale-95"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#f8fafc] dark:bg-slate-900mber-50 text-amber-600 group-hover:bg-[#f8fafc] dark:bg-slate-900mber-600 group-hover:text-white transition-all">
          <Briefcase size={16} />
        </div>
        <div className="text-left leading-tight">
          <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">Panel Mode</p>
          <p className="text-[13px] font-extrabold text-neutral-900 dark:text-neutral-100">{active.label}</p>
        </div>
        <ChevronDown size={14} className="text-neutral-300 transition-transform group-hover:text-amber-400" />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-2xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-2 shadow-2xl ring-1 ring-black/5 animate-in fade-in slide-in-from-top-2 duration-200">
          {options.map((option) => {
            const selected = option.id === mode;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  setMode(option.id);
                  setIsOpen(false);
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-all ${selected ? 'bg-[#f8fafc] dark:bg-slate-900mber-600 text-white shadow-lg shadow-amber-200' : 'hover:bg-neutral-50 dark:bg-slate-900'
                  }`}
              >
                <span
                  className={`h-2.5 w-2.5 rounded-full transition-all ${selected ? 'bg-white dark:bg-slate-900' : 'bg-neutral-300'
                    }`}
                />
                <span className="flex-1">
                  <span className={`block text-[13px] font-bold ${selected ? 'text-white' : 'text-neutral-900 dark:text-neutral-100'}`}>
                    {option.label}
                  </span>
                  <span className={`block text-[11px] ${selected ? 'text-amber-100' : 'text-neutral-500'}`}>
                    {option.subtitle}
                  </span>
                </span>
                {selected && <div className="h-1.5 w-1.5 rounded-full bg-white dark:bg-slate-900 animate-pulse" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

const AdminLayout = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { settings, activeLogo } = useSettings();
  const cachedLogo = useCachedLogo(activeLogo);
  const role = readAdminProfile()?.role || 'superadmin';
  const adminThemeColor = normalizeHexColor(settings.customization?.admin_theme_color, '#405189');
  const sidebarTextColor = normalizeHexColor(settings.customization?.sidebar_text_color, '#CBD5E1');
  const [isSidebarOpen] = useState(true);
  const [isCollapsed, setCollapsed] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [notificationTab, setNotificationTab] = useState('ride_requests');
  const [searchTerm, setSearchTerm] = useState('');
  const [rideRequestFeed, setRideRequestFeed] = useState({
    results: [],
    paginator: { current_page: 1, last_page: 1, total: 0 },
  });
  const [bookingsFeed, setBookingsFeed] = useState([]);
  const [chatNotifications, setChatNotifications] = useState([]);
  const [chatUnreadCount, setChatUnreadCount] = useState(0);
  const [rideRequestPage, setRideRequestPage] = useState(1);
  const [bookingPage, setBookingPage] = useState(1);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [dismissedNotifications, setDismissedNotifications] = useState(() => readDismissedNotifications());
  const [expandedSidebarGroups, setExpandedSidebarGroups] = useState(() => {
    if (typeof window === 'undefined') {
      return [];
    }

    try {
      const saved = window.localStorage.getItem(SIDEBAR_EXPANSION_STORAGE_KEY);
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const userMenuRef = useRef(null);
  const notificationsMenuRef = useRef(null);
  const [adminProfile, setAdminProfile] = useState(() => readAdminProfile());

  const appName = settings.general?.app_name || 'Quick Drop';
  const [businessCompanyName, setBusinessCompanyName] = useState(() => {
    const cached = getCachedSettings();
    return normalizeCompanyName(cached?.companyName) || settings.general?.app_name || 'Quick Drop';
  });

  useEffect(() => {
    const syncName = () => {
      const cached = getCachedSettings();
      if (cached?.companyName) {
        setBusinessCompanyName(normalizeCompanyName(cached.companyName));
      }
    };
    syncName();
    loadBusinessSettings().then((s) => {
      if (s?.companyName) {
        setBusinessCompanyName(normalizeCompanyName(s.companyName));
      }
    }).catch(() => {});
    window.addEventListener('businessSettingsUpdated', syncName);
    return () => window.removeEventListener('businessSettingsUpdated', syncName);
  }, []);

  // Which panels this admin may switch to: a sub-admin only sees theirs.
  const panelAccess = useAdminAccess();
  const showPanel = (service) => hasPanel(panelAccess, service);
  const restrictedAdmin = isRestricted(panelAccess);
  /*
   * Where Master opens from here. Not gated on owner: /admin/master/admins maps
   * to the `subadmins` permission, so a sub-admin given it may open Admin
   * Accounts even though the other Master screens are owner-only.
   */
  const masterEntry = ["/admin/master/settings", "/admin/master/admins"]
    .find((path) => canOpenPath(panelAccess, path)) || null;

  const taxiTitle = businessCompanyName.toLowerCase().endsWith('taxi')
    ? businessCompanyName
    : `${businessCompanyName} Taxi`;
  useEffect(() => {
    // A fresh object each time: the menu filter also reads the shared access
    // record (hasAdminPermission), and must re-run when that arrives.
    const syncAdminProfile = () => setAdminProfile({ ...readAdminProfile() });
    window.addEventListener('storage', syncAdminProfile);
    syncAdminProfile();
    refreshAdminAccess().then(syncAdminProfile);
    return () => window.removeEventListener('storage', syncAdminProfile);
  }, []);

  // Global event listener to prevent negative values in number inputs
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleInput = (e) => {
      if (e.target && e.target.tagName === 'INPUT' && e.target.type === 'number') {
        if (e.target.value !== '' && Number(e.target.value) < 0) {
          e.target.value = 0;
          // Trigger change event for React to pick it up
          e.target.dispatchEvent(new Event('input', { bubbles: true }));
          e.target.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    };
    const handleKeyDown = (e) => {
      if (e.target && e.target.tagName === 'INPUT' && e.target.type === 'number') {
        if (e.key === '-' || e.key === 'e' || e.key === 'E') {
          e.preventDefault();
        }
      }
    };

    document.addEventListener('input', handleInput, true);
    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('input', handleInput, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(NOTIFICATION_DISMISS_STORAGE_KEY, JSON.stringify(dismissedNotifications));
  }, [dismissedNotifications]);

  const dismissedRideRequestSet = useMemo(
    () => new Set((dismissedNotifications.ride_requests || []).map((item) => String(item).trim()).filter(Boolean)),
    [dismissedNotifications],
  );

  const dismissedBookingSet = useMemo(
    () => new Set((dismissedNotifications.bookings || []).map((item) => String(item).trim()).filter(Boolean)),
    [dismissedNotifications],
  );

  const dismissedChatSet = useMemo(
    () => new Set((dismissedNotifications.chats || []).map((item) => String(item).trim()).filter(Boolean)),
    [dismissedNotifications],
  );

  const visibleRideRequestResults = useMemo(
    () => rideRequestFeed.results.filter((item) => !dismissedRideRequestSet.has(getNotificationEntryId('ride_requests', item))),
    [dismissedRideRequestSet, rideRequestFeed.results],
  );

  const visibleBookingsFeed = useMemo(
    () => bookingsFeed.filter((item) => !dismissedBookingSet.has(getNotificationEntryId('bookings', item))),
    [bookingsFeed, dismissedBookingSet],
  );

  const visibleChatNotifications = useMemo(
    () => chatNotifications.filter((item) => !dismissedChatSet.has(getNotificationEntryId('chats', item))),
    [chatNotifications, dismissedChatSet],
  );

  const dismissNotification = (tab, item) => {
    const id = getNotificationEntryId(tab, item);
    if (!id) return;

    setDismissedNotifications((current) => {
      const existingItems = Array.isArray(current?.[tab]) ? current[tab] : [];
      if (existingItems.includes(id)) {
        return current;
      }

      return {
        ...current,
        [tab]: [id, ...existingItems].slice(0, 500),
      };
    });
  };

  const dismissCurrentNotifications = () => {
    if (notificationTab === 'ride_requests') {
      visibleRideRequestResults.forEach((item) => dismissNotification('ride_requests', item));
      return;
    }

    if (notificationTab === 'bookings') {
      visibleBookingsFeed.forEach((item) => dismissNotification('bookings', item));
      return;
    }

    visibleChatNotifications.forEach((item) => dismissNotification('chats', item));
  };

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(
      SIDEBAR_EXPANSION_STORAGE_KEY,
      JSON.stringify(expandedSidebarGroups)
    );
  }, [expandedSidebarGroups]);

  const adminSections = useMemo(
    () => [
      {
        title: 'Home',
        items: [
          {
            icon: UserCog,
            label: 'Admin Management',
            subItems: [
              { label: 'Admins', path: '/admin/master/admins', permission: 'subadmins.manage' },
            ],
          },
          { icon: Home, label: 'Dashboard', path: '/taxi/admin/dashboard', permission: 'dashboard.view' },
          { icon: IndianRupee, label: 'Admin Earnings', path: '/taxi/admin/earnings', permission: 'earnings.view' },
          { icon: MessageCircle, label: 'Chat', path: '/taxi/admin/chat', permission: 'chat.view' },
          {
            icon: TrendingUp,
            label: 'Promotions Management',
            subItems: [
              { label: 'Promo Code', path: '/taxi/admin/promotions/promo-codes', permission: 'promotions.view' },
              { label: 'Push Notifications', path: '/taxi/admin/promotions/send-notification', permission: 'promotions.view' },
              //{ label: 'Banner Image', path: '/taxi/admin/promotions/banner-image', permission: 'promotions.view' },
            ],
          },
          {
            icon: IndianRupee,
            label: 'Price Management',
            subItems: [
              { label: 'Service Location', path: '/taxi/admin/pricing/service-location', permission: 'service_locations.view' },
              { label: 'Zone', path: '/taxi/admin/pricing/zone', permission: 'zones.view' },
              { label: 'Airport', path: '/taxi/admin/pricing/airport', permission: 'airports.view' },
              { label: 'App Modules', path: '/taxi/admin/pricing/app-modules', permission: 'settings.view' },
              { label: 'Vehicle Type', path: '/taxi/admin/pricing/vehicle-type', permission: 'vehicle_types.view' },
              // Rental is intentionally hidden from the admin sidebar (not removed).
              // The routes/pages still exist and stay reachable by URL - uncomment to restore.
              /*{
                label: 'Rental',
                subItems: [
                  { label: 'Service Stores', path: '/taxi/admin/pricing/service-stores', permission: 'service_stores.view' },
                  { label: 'Rental Vehicles', path: '/taxi/admin/pricing/rental-vehicles', permission: 'rental.view' },
                  { label: 'Track Vehicles', path: '/taxi/admin/pricing/rental-tracking', permission: 'rental.view' },
                  { label: 'Rental Requests', path: '/taxi/admin/pricing/rental-requests', permission: 'rental.view' },
                  { label: 'Rental Quote Requests', path: '/taxi/admin/pricing/rental-quotes', permission: 'rental.view' },
                  { label: 'Rental Package Types', path: '/taxi/admin/pricing/rental-packages', permission: 'rental.view' },
                  { label: 'Package Pricing', path: '/taxi/admin/pricing/package-pricing', permission: 'rental.view' },
                ],
              },*/
              { label: 'Set Price', path: '/taxi/admin/pricing/set-price', permission: 'set_prices.view' },
              { label: 'Surge Time Slots', path: '/taxi/admin/pricing/surge', permission: 'set_prices.view' },
              { label: 'Ride Insurance', path: '/taxi/admin/pricing/ride-insurance', permission: 'set_prices.view' },
              { label: 'Goods Types', path: '/taxi/admin/pricing/goods-types', permission: 'goods_types.view' },
            ],
          },
          // Bus Service is intentionally hidden from the admin sidebar (not removed).
          // The routes/pages still exist and stay reachable by URL - uncomment to restore.
          /*{
            icon: Bus,
            label: 'Bus Service',
            subItems: [
              { label: 'Fleet Manager', path: '/taxi/admin/bus-service', permission: 'bus_service.view' },
              { label: 'Bus Commission', path: '/taxi/admin/bus-service/commission', permission: 'bus_service.view' },
              { label: 'Bus Bookings', path: '/taxi/admin/bus-service/bookings', permission: 'bus_service.view' },
            ],
          },*/
          // Car Pooling is intentionally hidden from the admin sidebar (not
          // removed). The routes/pages still exist and stay reachable by URL -
          // uncomment to restore.
          /*{
            icon: Share2,
            label: 'Car Pooling',
            subItems: [
              { label: 'Pooling Vehicles', path: '/taxi/admin/pooling/vehicles', permission: 'pooling.view' },
              { label: 'Pooling Commission', path: '/taxi/admin/pooling/commission', permission: 'pooling.view' },
              { label: 'Routes & Stops', path: '/taxi/admin/pooling/routes', permission: 'pooling.view' },
              { label: 'Pooling Bookings', path: '/taxi/admin/pooling/bookings', permission: 'pooling.view' },
            ],
          },*/
          {
            icon: MapPin,
            label: 'Geofencing',
            subItems: [
              { label: 'Heat Map', path: '/taxi/admin/geo/heatmap', permission: 'geofencing.view' },
              { label: "God's Eye", path: '/taxi/admin/geo/gods-eye', permission: 'geofencing.view' },
              { label: 'Peak Zone', path: '/taxi/admin/geo/peak-zone', permission: 'geofencing.view' },
            ],
          },
          { icon: Car, label: 'Trip Requests', path: '/taxi/admin/trips', permission: 'trips.view' },
          { icon: Package, label: 'Delivery Requests', path: '/taxi/admin/deliveries', permission: 'deliveries.view' },
          { icon: Clock, label: 'Ongoing Requests', path: '/taxi/admin/ongoing', permission: 'ongoing.view' },
        ],
      },
      {
        title: 'Users',
        items: [
          {
            icon: Users,
            label: 'Customer Management',
            subItems: [
              { label: 'User List', path: '/taxi/admin/users', permission: 'users.view' },
              { label: 'Subscription Management', path: '/taxi/admin/users/subscriptions', permission: 'users.view' },
              { label: 'Delete Request Users', path: '/taxi/admin/users/delete-requests', permission: 'users.view' },
              { label: 'User Bulk Upload', path: '/taxi/admin/users/bulk-upload', permission: 'users.view' },
            ],
          },
          { icon: Wallet, label: 'Wallet Payment', path: '/taxi/admin/wallet/payment', permission: 'wallet.view' },
          {
            icon: Car,
            label: 'Driver Management',
            subItems: [
              { label: 'Pending Drivers', path: '/taxi/admin/drivers/pending', permission: 'drivers.view' },
              { label: 'Approved Drivers', path: '/taxi/admin/drivers', permission: 'drivers.view' },
              { label: 'Active Drivers', path: '/taxi/admin/drivers/active', permission: 'drivers.view' },
              { label: 'Subscription', path: '/taxi/admin/drivers/subscription', permission: 'drivers.view' },
              { label: 'Drivers Ratings', path: '/taxi/admin/drivers/ratings', permission: 'drivers.view' },
              {
                label: 'Driver Wallet',
                subItems: [
                  { label: 'Withdrawal Requests', path: '/taxi/admin/drivers/wallet/withdrawals', permission: 'wallet.view' },
                  { label: 'Negative Balance Drivers', path: '/taxi/admin/drivers/wallet/negative', permission: 'wallet.view' },
                ],
              },
              { label: 'Delete Request Drivers', path: '/taxi/admin/drivers/delete-requests', permission: 'drivers.view' },
              { label: 'Driver Needed Documents', path: '/taxi/admin/drivers/documents', permission: 'drivers.view' },
              { label: 'Driver Bulk Upload', path: '/taxi/admin/drivers/bulk-upload', permission: 'drivers.view' },
              { label: 'Payment Methods', path: '/taxi/admin/drivers/payment-methods', permission: 'wallet.view' },
            ],
          },
          {
            icon: Share2,
            label: 'Referral Management',
            subItems: [
              { label: 'Referral Dashboard', path: '/taxi/admin/referrals/dashboard', permission: 'referrals.view' },
              { label: 'User Referral Settings', path: '/taxi/admin/referrals/user-settings', permission: 'referrals.view' },
              { label: 'Driver Referral Settings', path: '/taxi/admin/referrals/driver-settings', permission: 'referrals.view' },
              { label: 'Referral Translation', path: '/taxi/admin/referrals/translation', permission: 'referrals.view' },
            ],
          },
          {
            icon: Briefcase,
            label: 'Owner Management',
            subItems: [
              { label: 'Owner Dashboard', path: '/taxi/admin/owners/dashboard', permission: 'owners.view' },
              { label: 'Pending Owners', path: '/taxi/admin/owners/pending', permission: 'owners.view' },
              { label: 'Manage Owners', path: '/taxi/admin/owners', permission: 'owners.view' },
              { label: 'Fleet Drivers', path: '/taxi/admin/fleet/drivers', permission: 'owners.view' },
              { label: 'Pending Fleet Drivers', path: '/taxi/admin/fleet/blocked', permission: 'owners.view' },
              { label: 'Manage Fleet', path: '/taxi/admin/fleet/manage', permission: 'owners.view' },
              { label: 'Owner Needed Document', path: '/taxi/admin/owners/documents', permission: 'owners.view' },
              { label: 'Fleet Needed Document', path: '/taxi/admin/fleet/documents', permission: 'owners.view' },
              { label: 'Deleted Owners', path: '/taxi/admin/owners/deleted', permission: 'owners.view' },
              { label: 'Bookings', path: '/taxi/admin/owners/bookings', permission: 'owners.view' },
            ],
          },
          {
            icon: FileText,
            label: 'Report',
            subItems: [
              { label: 'User Report', path: '/taxi/admin/reports/user', permission: 'reports.view' },
              { label: 'Driver Report', path: '/taxi/admin/reports/driver', permission: 'reports.view' },
              { label: 'Driver Duty Report', path: '/taxi/admin/reports/driver-duty', permission: 'reports.view' },
              // { label: 'Owner Report', path: '/taxi/admin/reports/owner', permission: 'reports.view' },
              { label: 'Finance Report', path: '/taxi/admin/reports/finance', permission: 'reports.view' },
              { label: 'Fleet Finance Report', path: '/taxi/admin/reports/fleet-finance', permission: 'reports.view' },
            ],
          },
          {
            icon: ShieldCheck,
            label: 'Safety Center',
            subItems: [
              { label: 'Live SOS Dashboard', path: '/taxi/admin/safety/sos', permission: 'settings.view' },
              { label: 'Safety Settings', path: '/taxi/admin/safety/settings', permission: 'settings.view' },
            ],
          },
          {
            icon: ShieldCheck,
            label: 'Support Management',
            subItems: [
              { label: 'Ticket Title', path: '/taxi/admin/support/ticket-title', permission: 'support.view' },
              { label: 'Support Tickets', path: '/taxi/admin/support/tickets', permission: 'support.view' },
            ],
          },
        ],
      },
      {
        title: 'Masters',
        items: [
          { icon: Globe, label: 'Language', path: '/taxi/admin/masters/languages', permission: 'settings.view' },
          // { icon: Star, label: 'Preferences', path: '/taxi/admin/masters/preferences' },
          // { icon: ShieldCheck, label: 'Roles', path: '/taxi/admin/masters/roles' },
        ],
      },
      {
        title: 'Settings',
        items: [
          {
            icon: Settings,
            label: 'Business Settings',
            permission: 'settings.view',
            subItems: [
              { label: 'General Settings', path: '/taxi/admin/settings/business/general', permission: 'settings.view' },
              { label: 'Landing Page CMS', path: '/taxi/admin/settings/cms/home', permission: 'settings.view' },
              { label: 'Customization Settings', path: '/taxi/admin/settings/business/customization', permission: 'settings.view' },
              { label: 'Logo Management', path: '/taxi/admin/settings/business/logos', permission: 'settings.view' },
              { label: 'Transport Ride Settings', path: '/taxi/admin/settings/business/transport-ride', permission: 'settings.view' },
              { label: 'Bid Ride Settings', path: '/taxi/admin/settings/business/bid-ride', permission: 'settings.view' },
            ],
          },
          {
            icon: Smartphone,
            label: 'App Settings',
            permission: 'settings.view',
            subItems: [
              { label: 'Wallet Settings', path: '/taxi/admin/settings/app/wallet', permission: 'settings.view' },
              { label: 'Tip Settings', path: '/taxi/admin/settings/app/tip', permission: 'settings.view' },
              { label: 'Mobile App Landing/Onboard Screens Settings', path: '/taxi/admin/settings/app/onboard', permission: 'settings.view' },
            ],
          },
          {
            icon: Settings2,
            label: 'Third-party Settings',
            permission: 'settings.view',
            subItems: [
              // Payments, SMS and email are set once for every service in Master Settings.
              { label: 'Payments, SMS & Email (Master)', path: '/admin/master/settings', permission: 'settings.view' },
              { label: 'Firebase Settings', path: '/taxi/admin/settings/third-party/firebase', permission: 'settings.view' },
              { label: 'Map and Map APIs Settings', path: '/taxi/admin/settings/third-party/map-apis', permission: 'settings.view' },
              // { label: 'Notification Channel', path: '/taxi/admin/settings/third-party/notification-channel' },
            ],
          },
          // {
          //   icon: PlusCircle,
          //   label: 'Addons',
          //   subItems: [{ label: 'Dispatcher Addons', path: '/taxi/admin/settings/addons/dispatcher' }],
          // },
          {
            icon: Monitor,
            label: 'CMS-Landing Website',
            permission: 'settings.view',
            subItems: [
              { label: 'Header-Footer', path: '/taxi/admin/settings/cms/header-footer', permission: 'settings.view' },
              { label: 'Home', path: '/taxi/admin/settings/cms/home', permission: 'settings.view' },
              { label: 'About Us', path: '/taxi/admin/settings/cms/about', permission: 'settings.view' },
              { label: 'Driver', path: '/taxi/admin/settings/cms/driver', permission: 'settings.view' },
              { label: 'User', path: '/taxi/admin/settings/cms/user', permission: 'settings.view' },
              { label: 'Contact', path: '/taxi/admin/settings/cms/contact', permission: 'settings.view' },
              { label: 'Privacy Policy, T&C and DMV', path: '/taxi/admin/settings/cms/legal', permission: 'settings.view' },
            ],
          },
        ],
      },
    ],
    []
  );

  /*
  const ownerSections = useMemo(
    () => [
      {
        title: 'Owner Mode',
        items: [
          {
            icon: Briefcase,
            label: 'Owner Management',
            subItems: [
              { label: 'Owner Dashboard', path: '/taxi/admin/owners/dashboard', permission: 'owners.view' },
              { label: 'Pending Owners', path: '/taxi/admin/owners/pending', permission: 'owners.view' },
              { label: 'Manage Owners', path: '/taxi/admin/owners', permission: 'owners.view' },
              {
                label: 'Owner Wallet',
                subItems: [{ label: 'Withdrawal Requests', path: '/taxi/admin/owners/wallet/withdrawals', permission: 'wallet.view' }],
              },
              {
                label: 'Fleet Management',
                subItems: [
                  { label: 'Fleet Drivers', path: '/taxi/admin/fleet/drivers', permission: 'owners.view' },
                  { label: 'Pending Fleet Drivers', path: '/taxi/admin/fleet/blocked', permission: 'owners.view' },
                  { label: 'Fleet Needed Document', path: '/taxi/admin/fleet/documents', permission: 'owners.view' },
                  { label: 'Manage Fleet', path: '/taxi/admin/fleet/manage', permission: 'owners.view' },
                ],
              },
              { label: 'Owner Needed Document', path: '/taxi/admin/owners/documents', permission: 'owners.view' },
              { label: 'Deleted Owners', path: '/taxi/admin/owners/deleted', permission: 'owners.view' },
              { label: 'Bookings', path: '/taxi/admin/owners/bookings', permission: 'owners.view' },
            ],
          },
        ],
      },
    ],
    []
  );
  */

  const isOwnerRoute = location.pathname.startsWith('/taxi/admin/owners') || location.pathname.startsWith('/taxi/admin/fleet');
  const isAdminChatRoute = pathMatches(location.pathname, '/taxi/admin/chat');
  const mode = ADMIN_MODE;
  const sidebarSections = useMemo(
    () => filterSidebarSectionsByAccess(adminSections, adminProfile),
    [adminProfile, adminSections],
  );
  const unreadCountsByPath = useMemo(
    () => ({
      '/taxi/admin/chat': chatUnreadCount,
    }),
    [chatUnreadCount],
  );
  const pageTitle = resolvePageTitle(location.pathname, sidebarSections, appName);
  const searchEntries = useMemo(() => flattenSearchEntries(flattenItems(sidebarSections)), [sidebarSections]);
  const filteredSearchEntries = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) {
      return searchEntries.slice(0, 10);
    }

    return searchEntries
      .filter((entry) => entry.keywords.includes(query) || entry.path.toLowerCase().includes(query))
      .slice(0, 14);
  }, [searchEntries, searchTerm]);

  const pagedBookings = useMemo(() => {
    const total = visibleBookingsFeed.length;
    const lastPage = Math.max(1, Math.ceil(total / NOTIFICATION_PAGE_SIZE));
    const currentPage = Math.min(bookingPage, lastPage);
    const start = (currentPage - 1) * NOTIFICATION_PAGE_SIZE;

    return {
      results: visibleBookingsFeed.slice(start, start + NOTIFICATION_PAGE_SIZE),
      paginator: {
        current_page: currentPage,
        last_page: lastPage,
        total,
      },
    };
  }, [bookingPage, visibleBookingsFeed]);

  const activeNotificationMeta =
    notificationTab === 'ride_requests'
      ? rideRequestFeed.paginator
      : notificationTab === 'bookings'
        ? pagedBookings.paginator
        : { current_page: 1, last_page: 1, total: chatNotifications.length };

  const totalNotificationItems =
    Math.max(0, Number(rideRequestFeed?.paginator?.total || 0) - dismissedRideRequestSet.size) +
    visibleBookingsFeed.length +
    visibleChatNotifications.length;

  const currentNotificationCount =
    notificationTab === 'ride_requests'
      ? visibleRideRequestResults.length
      : notificationTab === 'bookings'
        ? pagedBookings.results.length
        : visibleChatNotifications.length;

  const setMode = (nextMode) => {
    localStorage.setItem(MODE_STORAGE_KEY, nextMode);

    if (nextMode === OWNER_MODE && !isOwnerRoute) {
      navigate('/taxi/admin/owners/dashboard');
    }

    if (nextMode === ADMIN_MODE && isOwnerRoute) {
      navigate('/taxi/admin/dashboard');
    }
  };

  useEffect(() => {
    const handleDocumentClick = (event) => {
      if (!userMenuRef.current?.contains(event.target)) {
        setIsUserMenuOpen(false);
      }

      if (!notificationsMenuRef.current?.contains(event.target)) {
        setIsNotificationsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleDocumentClick);
    return () => {
      document.removeEventListener('mousedown', handleDocumentClick);
    };
  }, []);

  useEffect(() => {
    setIsSearchOpen(false);
    setSearchTerm('');
    setIsNotificationsOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const { token } = syncAdminSessionBridge();

    if (!token || mode !== ADMIN_MODE) {
      setChatUnreadCount(0);
      return undefined;
    }

    let active = true;

    const syncUnreadChats = async () => {
      try {
        const response = await getSupportConversations(token);
        const conversations = response?.data?.conversations || [];
        const unreadTotal = conversations.reduce(
          (sum, conversation) => sum + Math.max(0, Number(conversation?.unreadCount || 0)),
          0,
        );

        if (!active) {
          return;
        }

        if (isAdminChatRoute) {
          const unreadConversationKeys = conversations
            .filter((conversation) => Number(conversation?.unreadCount || 0) > 0)
            .map((conversation) => conversation.conversationKey)
            .filter(Boolean);

          if (unreadConversationKeys.length > 0) {
            await Promise.all(
              unreadConversationKeys.map((conversationKey) => markSupportMessagesRead(conversationKey, token)),
            );
          }

          if (!active) {
            return;
          }

          setChatNotifications([]);
          setChatUnreadCount(0);
          return;
        }

        setChatUnreadCount(unreadTotal);
      } catch (error) {
        if (!active) {
          return;
        }

        console.error('Failed to sync admin chat unread count:', error);
      }
    };

    syncUnreadChats();

    return () => {
      active = false;
    };
  }, [isAdminChatRoute, mode]);

  useEffect(() => {
    if (!isNotificationsOpen) return undefined;

    let isMounted = true;

    const fetchNotifications = async () => {
      setNotificationsLoading(true);

      try {
        if (notificationTab === 'ride_requests') {
          const response = await adminService.getRideRequests({
            page: rideRequestPage,
            limit: NOTIFICATION_PAGE_SIZE,
            tab: 'all',
            search: '',
          });

          if (!isMounted) return;

          setRideRequestFeed({
            results: response?.data?.results || response?.results || [],
            paginator: response?.data?.paginator || response?.paginator || { current_page: 1, last_page: 1, total: 0 },
          });
          return;
        }

        if (notificationTab === 'chats') {
          return;
        }

        const response = await adminService.getOwnerBookings();
        if (!isMounted) return;

        setBookingsFeed(response?.data?.results || response?.results || []);
      } catch (error) {
        console.error('Failed to load admin notifications:', error);

        if (!isMounted) return;

        if (notificationTab === 'ride_requests') {
          setRideRequestFeed({
            results: [],
            paginator: { current_page: 1, last_page: 1, total: 0 },
          });
        } else if (notificationTab === 'bookings') {
          setBookingsFeed([]);
        }
      } finally {
        if (isMounted) {
          setNotificationsLoading(false);
        }
      }
    };

    fetchNotifications();

    return () => {
      isMounted = false;
    };
  }, [bookingPage, isNotificationsOpen, notificationTab, rideRequestPage]);

  useEffect(() => {
    if (!isSearchOpen) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsSearchOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isSearchOpen]);

  useEffect(() => {
    const { token } = syncAdminSessionBridge();
    if (!token && !window.location.pathname.includes('/admin/login')) {
      navigate('/admin/login');
      return undefined;
    }

    if (!token) return undefined;

    socketService.connect({ role: 'admin', token });

    socketService.on('new_sos', (data) => {
      console.log('SOS ALERT RECEIVED:', data);
      alert(`SOS ALERT: Driver ${data.driver_name} is in trouble!`);
    });

    socketService.on('new_driver_registration', (data) => {
      console.log('New driver registration:', data);
    });

    const handleSupportChatNotification = (payload = {}) => {
      const senderRole = String(payload.senderRole || payload.sender?.role || '').toLowerCase();
      const receiverRole = String(payload.receiverRole || payload.receiver?.role || '').toLowerCase();
      const messageBody = String(payload.message || payload.body || '').trim();

      if (!messageBody || senderRole === 'admin' || receiverRole !== 'admin') {
        return;
      }

      if (isAdminChatRoute) {
        if (payload.conversationKey) {
          markSupportMessagesRead(payload.conversationKey, token).catch((error) => {
            console.error('Failed to mark live admin chat message as read:', error);
          });
        }

        setChatNotifications([]);
        setChatUnreadCount(0);
        return;
      }

      const senderName =
        String(payload.sender?.name || '').trim() ||
        (senderRole === 'driver' ? 'Driver' : senderRole === 'user' ? 'User' : 'Support contact');

      const nextItem = {
        id: `support-chat:${payload.id || payload._id || payload.conversationKey || `${Date.now()}-${messageBody}`}`,
        title: `${senderName} sent a new chat`,
        body: messageBody,
        senderRole: senderRole || 'user',
        createdAt: payload.createdAt || new Date().toISOString(),
      };

      let wasAdded = false;

      setChatNotifications((current) => {
        const next = dedupeAdminChatNotifications([nextItem, ...current]).slice(0, 25);
        wasAdded = next.some((item) => item.id === nextItem.id) && !current.some((item) => item.id === nextItem.id);
        return next;
      });

      if (wasAdded) {
        setChatUnreadCount((current) => current + 1);
        toast(nextItem.body, {
          duration: 4500,
          className: 'font-bold text-[13px] rounded-2xl shadow-xl border border-sky-50 bg-white dark:bg-slate-900',
        });
      }
    };

    socketService.on('chat:message', handleSupportChatNotification);

    return () => {
      socketService.off('new_sos');
      socketService.off('new_driver_registration');
      socketService.off('chat:message', handleSupportChatNotification);
    };
  }, [isAdminChatRoute, navigate]);

  const handleLogout = () => {
    socketService.disconnect();
    clearUnifiedAdminSession();
    setIsUserMenuOpen(false);
    navigate('/admin/login');
  };

  return (
    <div className="flex h-screen overflow-hidden bg-neutral-200 dark:bg-slate-950 font-sans text-gray-900 dark:text-gray-100">
      <aside
        // Sidebar palette, shared with the Food admin rail (see Food's
        // AdminSidebar.jsx, which defines the same tokens) so the two panels read as
        // one product rather than two bolted together. Declared here rather than in
        // ~60 utility classes so the rail can be retuned in one place, and declared on
        // the <aside> so SidebarItem/SidebarGroup/NestedGroup -- which render inside
        // it -- inherit the same values without being passed a theme prop.
        //
        // Warm, not grey: the admin canvas around this rail is already light
        // (bg-neutral-100 on bg-neutral-200), so a few degrees of warmth separates the
        // rail from the canvas without a hard colour change.
        //
        // The active state inverts to a dark pill. On a light ground a lightly tinted
        // fill is easy to miss, and this rail has a lot of destinations to scan.
        style={{
          '--sb-surface': '#FAF8F5',
          '--sb-surface-raised': '#FFFFFF',
          '--sb-border': '#E8E2D9',
          '--sb-hover': '#F1ECE4',
          '--sb-ink': '#1A1A1A',
          // Warm grey-brown, ~9:1 on --sb-surface.
          '--sb-ink-soft': '#5C5247',
          // Section labels, inactive icons and bullets. ~5.1:1 -- past AA.
          '--sb-ink-faint': '#6E655B',
          '--sb-active-bg': '#1A1A1A',
          '--sb-active-ink': '#FFFFFF',
        }}
        className={cn(
          "relative z-50 flex h-screen flex-col overflow-hidden transition-all duration-300 ease-in-out bg-[var(--sb-surface)] border-r border-[var(--sb-border)]",
          isCollapsed ? 'w-20' : 'w-80',
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        <div className="flex h-full flex-col">
          {/* Header with Logo and Brand */}
          <div className="shrink-0 px-3 py-3 border-b border-[var(--sb-border)] bg-[var(--sb-surface-raised)]">
            <div className="flex items-center justify-between mb-3">
              {!isCollapsed && (
                <div className="flex items-center gap-3.5">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--sb-border)] bg-[var(--sb-hover)] p-1 transition-all">
                    <img src={cachedLogo || settings?.logos?.admin || settings?.logos?.landing} alt={taxiTitle} className="h-9 w-9 object-contain" />
                  </div>
                  <div className="flex flex-col">
                    <h3 className="text-[15px] font-extrabold leading-tight text-[var(--sb-ink)] tracking-tight">
                      {taxiTitle}
                    </h3>
                    <div className="mt-1 flex items-center gap-1.5">
                      {/* emerald-600 rather than 500: the lighter shade was chosen to
                          glow on a near-black rail and sits at roughly 2.3:1 on this
                          one. The outward glow goes with it -- on a light ground it
                          reads as a smudge rather than a light source. */}
                      <div className="h-1.5 w-1.5 rounded-full bg-emerald-600 animate-pulse" />
                      <span className="text-[11px] font-bold uppercase tracking-widest text-[var(--sb-ink-faint)]">
                        {restrictedAdmin ? "Sub-admin" : "System Admin"}
                      </span>
                    </div>
                  </div>
                </div>
              )}
              {isCollapsed && (
                <div className="w-full flex items-center justify-center">
                  <div className="w-10 h-10 rounded-lg bg-[var(--sb-hover)] flex items-center justify-center ring-1 ring-[var(--sb-border)]">
                    <img src={cachedLogo || settings?.logos?.admin || settings?.logos?.landing} alt={taxiTitle} className="w-8 h-8 object-contain" />
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCollapsed((current) => !current)}
                  className="text-[var(--sb-ink-soft)] hover:text-[var(--sb-ink)] transition-all duration-200 hover:scale-110 p-1.5 rounded-lg hover:bg-[var(--sb-hover)]"
                  title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                >
                  {isCollapsed ? (
                    <ChevronRight className="w-4 h-4" />
                  ) : (
                    <ChevronLeft className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Admin Panel Label */}
            {!isCollapsed && (
              <div className="mb-3">
                <h2 className="text-sm font-semibold text-[var(--sb-ink-soft)] uppercase tracking-wider text-left">
                  Admin Panel
                </h2>
              </div>
            )}

            {/* Module Switcher Tabs */}
            {!isCollapsed && (
              <div className="flex p-1 bg-[var(--sb-surface-raised)] backdrop-blur-sm rounded-xl mb-1 border border-[var(--sb-border)] shadow-inner">
                {/* Master: the cross-module engine, same screens from every panel.
                    Shown when this admin can open at least one of them, and it
                    opens on the first one they may. */}
                {masterEntry && <button
                  type="button"
                  onClick={() => navigate(masterEntry)}
                  className={cn(
                    "flex-1 min-w-0 flex flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] leading-none font-bold rounded-lg transition-all duration-300",
                    "text-[var(--sb-ink-faint)] hover:text-[var(--sb-ink-soft)] hover:bg-[var(--sb-hover)]"
                  )}
                >
                  <SlidersHorizontal className="w-3.5 h-3.5 text-[var(--sb-ink-faint)]" />
                  Master
                </button>}
                {showPanel("food") && <button
                  type="button"
                  onClick={() => navigate("/admin/food")}
                  className={cn(
                    "flex-1 min-w-0 flex flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] leading-none font-bold rounded-lg transition-all duration-300",
                    "text-[var(--sb-ink-faint)] hover:text-[var(--sb-ink-soft)] hover:bg-[var(--sb-hover)]"
                  )}
                >
                  <UtensilsCrossed className="w-3.5 h-3.5 text-[var(--sb-ink-faint)]" />
                  Food
                </button>}
                <button
                  type="button"
                  onClick={() => navigate("/taxi/admin/dashboard")}
                  className={cn(
                    "flex-1 min-w-0 flex flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] leading-none font-bold rounded-lg transition-all duration-300",
                    // Was bg-white/text-black, which marked the current module only
                    // because the strip behind it was dark. On a light strip that is
                    // the least distinguishable fill available, so the active tab
                    // inverts to the dark pill the rest of the rail uses for "current".
                    "bg-[var(--sb-active-bg)] text-[var(--sb-active-ink)] shadow-[0_2px_8px_rgba(26,26,26,0.18)]"
                  )}
                >
                  <Truck className="w-3.5 h-3.5 text-[var(--sb-active-ink)]" />
                  Taxi
                </button>
                {/* Services: per site (config/features.js), the same flag that
                    gates the /admin/sp route. */}
                {SERVICE_PROVIDER_ENABLED && showPanel("serviceProvider") && <button
                  type="button"
                  onClick={() => navigate("/admin/sp/dashboard")}
                  className={cn(
                    "flex-1 min-w-0 flex flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] leading-none font-bold rounded-lg transition-all duration-300",
                    "text-[var(--sb-ink-faint)] hover:text-[var(--sb-ink-soft)] hover:bg-[var(--sb-hover)]"
                  )}
                >
                  <Wrench className="w-3.5 h-3.5 text-[var(--sb-ink-faint)]" />
                  Services
                </button>}
                {showPanel("quickCommerce") && <button
                  type="button"
                  onClick={() => navigate("/admin/quick-commerce")}
                  className={cn(
                    "flex-1 min-w-0 flex flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] leading-none font-bold rounded-lg transition-all duration-300",
                    "text-[var(--sb-ink-faint)] hover:text-[var(--sb-ink-soft)] hover:bg-[var(--sb-hover)]"
                  )}
                >
                  <ShoppingBasket className="w-3.5 h-3.5 text-[var(--sb-ink-faint)]" />
                  Quick
                </button>}
                {/* Medical sits beside Quick in every panel's switcher; it was only
                    added to the food one, so it vanished on the way here. */}
                {showPanel("medical") && <button
                  type="button"
                  onClick={() => navigate("/admin/medical")}
                  className={cn(
                    "flex-1 min-w-0 flex flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] leading-none font-bold rounded-lg transition-all duration-300",
                    "text-[var(--sb-ink-faint)] hover:text-[var(--sb-ink-soft)] hover:bg-[var(--sb-hover)]"
                  )}
                >
                  <Pill className="w-3.5 h-3.5 text-[var(--sb-ink-faint)]" />
                  Medical
                </button>}
              </div>
            )}
          </div>

          <nav className="no-scrollbar mt-0 flex-1 space-y-8 overflow-y-auto px-4 pb-12 scroll-smooth">
            {sidebarSections.map((section) => (
              <div key={section.title} className="space-y-1">
                {!isCollapsed && (
                  <div className="px-4 mb-4 flex items-center gap-2">
                    {/* The accent bar and label were white-on-near-black. The dark:
                        variant is dropped with them: this rail is light in both
                        schemes now, so a slate-900 bar would have been an invisible
                        bar fighting the default. */}
                    <div className="h-3 w-1 rounded-full bg-[var(--sb-ink-faint)]" />
                    <span className="text-[12px] font-black uppercase tracking-widest text-[var(--sb-ink-faint)]">
                      {section.title}
                    </span>
                  </div>
                )}
                {section.items.map((item) =>
                  item.subItems ? (
                    <SidebarGroup
                      key={item.label}
                      {...item}
                      forceOpen={mode === OWNER_MODE}
                      isCollapsed={isCollapsed}
                      pathname={location.pathname}
                      groupKey={`${section.title}:${item.label}`}
                      expandedGroups={expandedSidebarGroups}
                      setExpandedGroups={setExpandedSidebarGroups}
                      sidebarTextColor={sidebarTextColor}
                      unreadCountsByPath={unreadCountsByPath}
                    />
                  ) : (
                    <SidebarItem
                      key={item.path}
                      {...item}
                      isCollapsed={isCollapsed}
                      sidebarTextColor={sidebarTextColor}
                      unreadCount={getSidebarItemCount(item, unreadCountsByPath)}
                    />
                  )
                )}
              </div>
            ))}
          </nav>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-neutral-100 dark:bg-slate-950">
        <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-neutral-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="h-6 w-1 rounded-full bg-[#f8fafc] dark:bg-slate-900mber-600" />
            <h2 className="text-[15px] font-bold tracking-tight text-neutral-800 dark:text-neutral-200">{pageTitle}</h2>
          </div>

          <div className="flex items-center gap-3">
            <div className="mr-1 flex items-center gap-1 border-r border-gray-100 pr-4 leading-none">
              <button
                type="button"
                onClick={() => setIsSearchOpen((current) => !current)}
                className="rounded-lg p-2 text-neutral-400 transition-all hover:bg-neutral-50 dark:bg-slate-900 hover:text-amber-600"
              >
                <Search size={18} />
              </button>

              <div ref={notificationsMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setIsNotificationsOpen((current) => !current)}
                  className="relative rounded-lg p-2 text-neutral-400 transition-all hover:bg-neutral-50 dark:bg-slate-900 hover:text-amber-600"
                >
                  <Bell size={18} />
                  {totalNotificationItems > 0 ? (
                    <span className="absolute right-1.5 top-1.5 inline-flex h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-white" />
                  ) : null}
                </button>

                <div
                  className={`absolute right-0 top-full z-50 mt-2 w-[360px] overflow-hidden rounded-[24px] border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl transition-all ${isNotificationsOpen ? 'pointer-events-auto scale-100 opacity-100' : 'pointer-events-none scale-95 opacity-0'
                    }`}
                >
                  <div className="border-b border-slate-100 dark:border-slate-800 px-4 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-extrabold text-slate-900">Notifications</p>
                        <p className="mt-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400 dark:text-slate-500">
                          Latest bookings, ride requests, and support chats
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {currentNotificationCount > 0 ? (
                          <button
                            type="button"
                            onClick={dismissCurrentNotifications}
                            className="rounded-full border border-slate-200 dark:border-slate-800 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 dark:text-slate-500 transition-all hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
                          >
                            Clear
                          </button>
                        ) : null}
                        <span className="rounded-full bg-[#f8fafc] dark:bg-slate-900mber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700">
                          {totalNotificationItems}
                        </span>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2 rounded-2xl bg-slate-50 dark:bg-slate-800 p-1">
                      <button
                        type="button"
                        onClick={() => {
                          setNotificationTab('ride_requests');
                          setRideRequestPage(1);
                        }}
                        className={`rounded-xl px-3 py-2 text-xs font-bold transition-all ${notificationTab === 'ride_requests'
                          ? 'bg-white dark:bg-slate-900 text-slate-900 shadow-sm'
                          : 'text-slate-500 dark:text-slate-400 dark:text-slate-500 hover:text-slate-900'
                          }`}
                      >
                        Ride Requests
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setNotificationTab('bookings');
                          setBookingPage(1);
                        }}
                        className={`rounded-xl px-3 py-2 text-xs font-bold transition-all ${notificationTab === 'bookings'
                          ? 'bg-white dark:bg-slate-900 text-slate-900 shadow-sm'
                          : 'text-slate-500 dark:text-slate-400 dark:text-slate-500 hover:text-slate-900'
                          }`}
                      >
                        Bookings
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setNotificationTab('chats');
                        }}
                        className={`rounded-xl px-3 py-2 text-xs font-bold transition-all ${notificationTab === 'chats'
                          ? 'bg-white dark:bg-slate-900 text-slate-900 shadow-sm'
                          : 'text-slate-500 dark:text-slate-400 dark:text-slate-500 hover:text-slate-900'
                          }`}
                      >
                        Chats
                      </button>
                    </div>
                  </div>

                  <div className="max-h-[420px] overflow-y-auto p-3">
                    {notificationsLoading ? (
                      <div className="flex items-center justify-center px-4 py-12 text-sm font-semibold text-slate-500 dark:text-slate-400 dark:text-slate-500">
                        Loading notifications...
                      </div>
                    ) : notificationTab === 'ride_requests' ? (
                      visibleRideRequestResults.length === 0 ? (
                        <div className="rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 px-4 py-8 text-center">
                          <p className="text-sm font-bold text-slate-900">No ride requests found</p>
                          <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400 dark:text-slate-500">New ride requests will show up here.</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {visibleRideRequestResults.map((item) => (
                            <button
                              key={item.id || item.requestId}
                              type="button"
                              onClick={() => {
                                navigate('/taxi/admin/trips');
                                setIsNotificationsOpen(false);
                              }}
                              className="relative w-full rounded-2xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 text-left transition-all hover:border-indigo-200 hover:bg-indigo-50/40"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-bold text-slate-900">
                                    {item.requestId} · {item.userName}
                                  </p>
                                  <p className="mt-1 truncate text-xs font-semibold text-slate-500 dark:text-slate-400 dark:text-slate-500">
                                    Pickup: {formatAdminNotificationLocation(item.pickupLabel, 'Pickup location set')}
                                  </p>
                                </div>
                                <span className="shrink-0 rounded-full bg-[#f8fafc] dark:bg-slate-900mber-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-700">
                                  {item.tripStatus || 'Upcoming'}
                                </span>
                              </div>
                              <div className="mt-2 flex items-center justify-between gap-3 text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                                <span>
                                  Destination: {formatAdminNotificationLocation(item.dropLabel, 'Destination set')}
                                </span>
                                <span>{formatRelativeAdminTime(item.date)}</span>
                              </div>
                              <span
                                role="button"
                                tabIndex={0}
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  dismissNotification('ride_requests', item);
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    dismissNotification('ride_requests', item);
                                  }
                                }}
                                className="absolute right-3 top-3 inline-flex rounded-lg p-1.5 text-slate-400 dark:text-slate-500 transition-all hover:bg-rose-50 hover:text-rose-600"
                                aria-label="Delete notification"
                              >
                                <Trash2 size={14} />
                              </span>
                            </button>
                          ))}
                        </div>
                      )
                    ) : notificationTab === 'bookings' ? pagedBookings.results.length === 0 ? (
                      <div className="rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 px-4 py-8 text-center">
                        <p className="text-sm font-bold text-slate-900">No bookings found</p>
                        <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400 dark:text-slate-500">Recent bookings will show up here.</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {pagedBookings.results.map((item) => (
                          <button
                            key={item._id || item.id || item.booking_reference}
                            type="button"
                            onClick={() => {
                              navigate('/taxi/admin/owners/bookings');
                              setIsNotificationsOpen(false);
                            }}
                            className="relative w-full rounded-2xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 text-left transition-all hover:border-indigo-200 hover:bg-indigo-50/40"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-bold text-slate-900">
                                  {item.booking_reference || 'Booking'} · {item.customer_name || 'Customer'}
                                </p>
                                <p className="mt-1 truncate text-xs font-semibold text-slate-500 dark:text-slate-400 dark:text-slate-500">
                                  {item.pickup_location || 'Pickup'} to {item.dropoff_location || 'Drop'}
                                </p>
                              </div>
                              <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                                {item.booking_status || 'Pending'}
                              </span>
                            </div>
                            <div className="mt-2 flex items-center justify-between gap-3 text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                              <span>{item.owner_id?.name || item.owner_id?.company_name || 'Owner booking'}</span>
                              <span>{formatRelativeAdminTime(item.trip_date || item.createdAt)}</span>
                            </div>
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                dismissNotification('bookings', item);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  dismissNotification('bookings', item);
                                }
                              }}
                              className="absolute right-3 top-3 inline-flex rounded-lg p-1.5 text-slate-400 dark:text-slate-500 transition-all hover:bg-rose-50 hover:text-rose-600"
                              aria-label="Delete notification"
                            >
                              <Trash2 size={14} />
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : visibleChatNotifications.length === 0 ? (
                      <div className="rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 px-4 py-8 text-center">
                        <p className="text-sm font-bold text-slate-900">No new chats found</p>
                        <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400 dark:text-slate-500">New user and driver support messages will show up here.</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {visibleChatNotifications.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                              navigate('/taxi/admin/chat');
                              setChatNotifications([]);
                              setIsNotificationsOpen(false);
                            }}
                            className="relative w-full rounded-2xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 text-left transition-all hover:border-indigo-200 hover:bg-indigo-50/40"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-bold text-slate-900">{item.title}</p>
                                <p className="mt-1 truncate text-xs font-semibold text-slate-500 dark:text-slate-400 dark:text-slate-500">{item.body}</p>
                              </div>
                              <span className="shrink-0 rounded-full bg-sky-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-sky-700">
                                {item.senderRole}
                              </span>
                            </div>
                            <div className="mt-2 flex items-center justify-end text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                              <span>{formatRelativeAdminTime(item.createdAt)}</span>
                            </div>
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                dismissNotification('chats', item);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  dismissNotification('chats', item);
                                }
                              }}
                              className="absolute right-3 top-3 inline-flex rounded-lg p-1.5 text-slate-400 dark:text-slate-500 transition-all hover:bg-rose-50 hover:text-rose-600"
                              aria-label="Delete notification"
                            >
                              <Trash2 size={14} />
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-3 border-t border-slate-100 dark:border-slate-800 px-4 py-3">
                    <button
                      type="button"
                      disabled={(activeNotificationMeta?.current_page || 1) <= 1}
                      onClick={() => {
                        if (notificationTab === 'ride_requests') {
                          setRideRequestPage((current) => Math.max(1, current - 1));
                        } else {
                          setBookingPage((current) => Math.max(1, current - 1));
                        }
                      }}
                      className="rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-1.5 text-xs font-bold text-slate-600 dark:text-slate-300 transition-all hover:bg-slate-50 dark:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Previous
                    </button>

                    <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                      Page {activeNotificationMeta?.current_page || 1} of {activeNotificationMeta?.last_page || 1}
                    </span>

                    <button
                      type="button"
                      disabled={(activeNotificationMeta?.current_page || 1) >= (activeNotificationMeta?.last_page || 1)}
                      onClick={() => {
                        if (notificationTab === 'ride_requests') {
                          setRideRequestPage((current) => current + 1);
                        } else {
                          setBookingPage((current) => current + 1);
                        }
                      }}
                      className="rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-1.5 text-xs font-bold text-slate-600 dark:text-slate-300 transition-all hover:bg-slate-50 dark:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div ref={userMenuRef} className="relative">
              <button
                type="button"
                className="group flex cursor-pointer items-center gap-3 rounded-full border border-gray-100 bg-gray-50 px-3 py-1.5 transition-all hover:bg-gray-100"
                onClick={() => setIsUserMenuOpen((current) => !current)}
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-slate-500 dark:text-slate-400 dark:text-slate-500 transition-all group-hover:bg-primary group-hover:text-white">
                  <Users size={14} />
                </div>
                <div className="text-left leading-tight">
                  <span className="block text-[11px] font-black text-gray-950">
                    {adminProfile?.name || 'Admin'}
                  </span>
                  <span className="block text-[9px] font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                    {adminProfile?.admin_type === 'subadmin' ? adminProfile?.role || 'Subadmin' : 'Superadmin'}
                  </span>
                </div>
                <ChevronDown size={14} className="text-gray-300" />
              </button>

              <div
                className={`absolute right-0 top-full z-50 mt-2 w-48 rounded-2xl border border-gray-100 bg-white dark:bg-slate-900 p-2 shadow-xl transition-all ${isUserMenuOpen ? 'pointer-events-auto scale-100 opacity-100' : 'pointer-events-none scale-95 opacity-0'
                  }`}
              >
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleLogout();
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-red-600 transition-all hover:bg-red-50"
                >
                  <LogOut size={16} />
                  <span className="text-[12px] font-bold">Logout Session</span>
                </button>
              </div>
            </div>
          </div>
        </header>

        {isSearchOpen && (
          <div
            className="fixed inset-0 z-[70] bg-slate-900/10 backdrop-blur-[1px]"
            onClick={() => setIsSearchOpen(false)}
          >
            <div className="mx-auto mt-20 w-full max-w-2xl px-4">
              <div
                className="overflow-hidden rounded-[28px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="border-b border-slate-100 dark:border-slate-800 px-5 py-4">
                  <div className="flex items-center gap-3 rounded-2xl border border-neutral-200 dark:border-slate-800 bg-neutral-50 dark:bg-slate-900 px-4 py-3">
                    <Search size={18} className="text-neutral-400" />
                    <input
                      autoFocus
                      type="text"
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      placeholder="Search sidebar options..."
                      className="w-full bg-transparent text-sm font-semibold text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-500"
                    />
                    <button
                      type="button"
                      onClick={() => setIsSearchOpen(false)}
                      className="rounded-lg px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 hover:bg-slate-200/70"
                    >
                      Close
                    </button>
                  </div>
                </div>

                <div className="max-h-[420px] overflow-y-auto p-3">
                  {filteredSearchEntries.length === 0 ? (
                    <div className="rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 px-4 py-8 text-center">
                      <p className="text-sm font-bold text-slate-900">No sidebar option found</p>
                      <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400 dark:text-slate-500">Try searching for drivers, trips, pricing, reports, or settings.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {filteredSearchEntries.map((entry) => (
                        <button
                          key={entry.path}
                          type="button"
                          onClick={() => {
                            navigate(entry.path);
                            setIsSearchOpen(false);
                            setSearchTerm('');
                          }}
                          className="flex w-full items-center justify-between gap-4 rounded-2xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 text-left transition-all hover:border-indigo-200 hover:bg-indigo-50/50"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-slate-900">{entry.label}</p>
                            <p className="mt-1 truncate text-[11px] font-semibold text-slate-500 dark:text-slate-400 dark:text-slate-500">
                              {[...entry.trail, entry.path].join(' • ')}
                            </p>
                          </div>
                          <ChevronRight size={16} className="shrink-0 text-slate-300" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        <main className="no-scrollbar flex-1 overflow-y-auto p-4 scroll-smooth lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default AdminLayout;
