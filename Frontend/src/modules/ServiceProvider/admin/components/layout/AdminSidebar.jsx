import { useState, useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  FiHome,
  FiUsers,
  FiBriefcase,
  FiUser,
  FiShoppingBag,
  FiGrid,
  FiDollarSign,
  FiFileText,
  FiBell,
  FiSettings,
  FiChevronDown,
  FiX,
  FiPackage,
  FiTrash2,
  FiStar,
  FiShield,
} from "react-icons/fi";
import { UtensilsCrossed, Truck, Wrench, ShoppingBasket, Pill, ChevronDown } from "lucide-react";
import adminMenu from "../../config/adminMenu.json";
import dashboardService from "../../services/dashboardService";
import { getSettings } from "../../services/settingsService";
import { getCachedSettings, loadBusinessSettings, normalizeCompanyName } from "@food/utils/businessSettings";
import { useSettings } from "../../../../Taxi/shared/context/SettingsContext";
import quickSpicyLogo from "@food/assets/k9-logo.jpg";

// Icon mapping for menu items
const iconMap = {
  Dashboard: FiHome,
  Users: FiUsers,
  Vendors: FiBriefcase,
  Workers: FiUser,
  Bookings: FiShoppingBag,
  "User Catalog": FiGrid,
  "Vendor Services": FiGrid,
  "Vendor Parts": FiPackage,
  Payments: FiDollarSign,
  Reports: FiFileText,
  Notifications: FiBell,
  "Scrap Items": FiTrash2,
  Reviews: FiStar,
  Settlements: FiDollarSign,
  Settings: FiSettings,
  Plans: FiPackage,
  "Worker Plans": FiBriefcase,
  Legal: FiShield,
};

// Helper function to convert child name to route path
const getChildRoute = (parentRoute, childName) => {
  const routeMap = {
    "/admin/sp/users": {
      "All Users": "/admin/sp/users/all",
      "User Bookings": "/admin/sp/users/bookings",
      "Transactions": "/admin/sp/users/transactions",
      "User Analytics": "/admin/sp/users/analytics",
    },
    "/admin/sp/vendors": {
      "All Vendors": "/admin/sp/vendors/all",
      "Vendor Bookings": "/admin/sp/vendors/bookings",
      "Vendor Analytics": "/admin/sp/vendors/analytics",
      "Vendor Payments": "/admin/sp/vendors/payments",
    },
    "/admin/sp/workers": {
      "All Workers": "/admin/sp/workers/all",
      "Worker Jobs": "/admin/sp/workers/jobs",
      "Worker Analytics": "/admin/sp/workers/analytics",
      "Worker Payments": "/admin/sp/workers/payments",
    },
    "/admin/sp/bookings": {
      "All Bookings": "/admin/sp/bookings",
      "Booking Tracking": "/admin/sp/bookings/tracking",
      "Booking Notifications": "/admin/sp/bookings/notifications",
    },
    "/admin/sp/user-categories": {
      "Home": "/admin/sp/user-categories/home",
      "Manage Categories": "/admin/sp/user-categories/categories",
      "Manage Brands": "/admin/sp/user-categories/brands",
      "Manage Services": "/admin/sp/user-categories/sections",
    },
    "/admin/sp/payments": {
      "Payment Overview": "/admin/sp/payments/overview",
      "User Payments": "/admin/sp/payments/users",
      "Worker Payments": "/admin/sp/payments/workers",
      "Vendor Payments": "/admin/sp/payments/vendors",
      "Admin Revenue": "/admin/sp/payments/revenue",
      "Payment Reports": "/admin/sp/payments/reports",
    },
    "/admin/sp/reports": {
      "Revenue Report": "/admin/sp/reports/revenue",
      "Booking Report": "/admin/sp/reports/bookings",
      "Payment Report": "/admin/sp/payments/reports",
    },
    "/admin/sp/notifications": {
      "Push Notifications": "/admin/sp/notifications/push",
      "Custom Messages": "/admin/sp/notifications/messages",
      "Notification Settings": "/admin/sp/notifications/settings",
    },
    "/admin/sp/settings": {
      "General Settings": "/admin/sp/settings/general",
      "Worker Assignment": "/admin/sp/settings/worker-assignment",
      "Service Configuration": "/admin/sp/settings/service-config",
      "System Settings": "/admin/sp/settings/system",
    },
    "/admin/sp/settlements": {
      "Pending": "/admin/sp/settlements/pending",
      "Withdrawals": "/admin/sp/settlements/withdrawals",
      "Vendors with Due": "/admin/sp/settlements/vendors",
      "History": "/admin/sp/settlements/history",
    },
    "/admin/sp/legal": {
      "Terms & Conditions": "/admin/sp/legal/terms",
      "Privacy Policy": "/admin/sp/legal/privacy",
      "Support": "/admin/sp/legal/support",
    },
  };

  return routeMap[parentRoute]?.[childName] || parentRoute;
};

const AdminSidebar = ({ isOpen, onClose }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [expandedItems, setExpandedItems] = useState({});
  const [isMobile, setIsMobile] = useState(false);
  const [adminUser, setAdminUser] = useState({ name: 'Admin', email: '', role: 'admin' });
  const [counts, setCounts] = useState({
    bookings: 0,
    vendors: 0,
    withdrawals: 0,
    pendingSettlements: 0,
    scraps: 0
  });
  const [isWorkerMode, setIsWorkerMode] = useState(false);
  const [businessCompanyName, setBusinessCompanyName] = useState(() => {
    const cached = getCachedSettings();
    return normalizeCompanyName(cached?.companyName) || 'Quick Drop';
  });
  const [logoUrl, setLogoUrl] = useState(() => getCachedSettings()?.logo?.url || null);

  useEffect(() => {
    const syncName = () => {
      const cached = getCachedSettings();
      if (cached?.companyName) {
        setBusinessCompanyName(normalizeCompanyName(cached.companyName));
      }
      if (cached?.logo?.url) {
        setLogoUrl(cached.logo.url);
      }
    };
    syncName();
    loadBusinessSettings().then((s) => {
      if (s?.companyName) {
        setBusinessCompanyName(normalizeCompanyName(s.companyName));
      }
      if (s?.logo?.url) {
        setLogoUrl(s.logo.url);
      }
    }).catch(() => {});
    window.addEventListener('businessSettingsUpdated', syncName);
    return () => window.removeEventListener('businessSettingsUpdated', syncName);
  }, []);

  const servicesTitle = businessCompanyName.toLowerCase().endsWith('services')
    ? businessCompanyName
    : `${businessCompanyName} Services`;

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await getSettings();
        if (res.success && res.settings) {
          setIsWorkerMode(res.settings.bookingModel === 'worker');
        }
      } catch (error) {
        console.error("Error fetching settings for sidebar:", error);
      }
    };
    fetchSettings();
  }, []);

  // Load admin user from storage
  useEffect(() => {
    try {
      const storedData = sessionStorage.getItem('adminData') || localStorage.getItem('adminData');
      const stored = JSON.parse(storedData || '{}');
      if (stored.name || stored.email) {
        setAdminUser({
          name: stored.name || 'Admin',
          email: stored.email || '',
          role: stored.role || 'admin'
        });
      }
    } catch (e) {
      console.error('Failed to parse admin data:', e);
    }
  }, []);

  // Filter menu items by role and settings
  const filteredMenu = useMemo(() => {
    return adminMenu.filter(item => {
      if (item.isHidden) return false;
      if (item.title === 'Scrap Items' || item.title === 'Plans') return false; // Hiding Scrap Items and Plans
      if (isWorkerMode && (item.title === 'Vendors' || item.title === 'Vendor Services' || item.title === 'Vendor Parts')) {
        return false;
      }
      if (!item.allowedRoles) return true;
      return item.allowedRoles.includes(adminUser.role);
    }).map(item => {
      if (isWorkerMode && item.children) {
        return {
          ...item,
          children: item.children.filter(child =>
            !child.includes('Vendor') &&
            child !== 'Vendors with Due'
          )
        };
      }
      return item;
    });
  }, [adminUser.role, isWorkerMode]);

  // Fetch pending counts for badges
  useEffect(() => {
    const fetchCounts = async () => {
      try {
        const response = await dashboardService.getStats();
        if (response.success && response.data?.stats) {
          const stats = response.data.stats;
          setCounts({
            bookings: stats.pendingBookings || 0,
            vendors: stats.pendingVendors || 0,
            withdrawals: stats.pendingWithdrawals || 0,
            pendingSettlements: stats.pendingSettlements || 0,
            scraps: stats.pendingScraps || 0
          });
        }
      } catch (error) {
        console.error("Error fetching sidebar counts:", error);
      }
    };

    fetchCounts();
    // Refresh every 30 seconds
    const interval = setInterval(fetchCounts, 30000);
    return () => clearInterval(interval);
  }, []);

  // Check if mobile on mount and resize
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Auto-close sidebar on mobile when route changes
  // Auto-close sidebar on mobile when route changes
  useEffect(() => {
    // Only close if screen is small (mobile)
    if (window.innerWidth < 1024) {
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]); // Remove onClose to prevent re-triggering when parent re-renders

  // Auto-expand menu items when their route is active
  useEffect(() => {
    const activeItem = filteredMenu.find((item) => {
      if (item.route === "/admin/sp/dashboard") {
        return location.pathname === "/admin/sp/dashboard";
      }
      const isChildRoute =
        location.pathname.startsWith(item.route) &&
        location.pathname !== item.route;
      return isChildRoute;
    });
    if (activeItem && activeItem.children && activeItem.children.length > 0) {
      setExpandedItems((prev) => {
        if (prev[activeItem.title]) {
          return prev;
        }
        return {
          [activeItem.title]: true,
        };
      });
    }
  }, [location.pathname, filteredMenu]);

  // Check if a menu item is active
  const isActive = (route) => {
    if (route === "/admin/sp/dashboard") {
      return location.pathname === "/admin/sp/dashboard";
    }

    // Special case for User Catalog to avoid overlap with Vendor Services/Parts
    if (route === "/admin/sp/user-categories") {
      if (location.pathname.startsWith("/admin/sp/user-categories/vendor-")) {
        return false;
      }
    }

    // Strict prefix check: either exact match OR followed by a slash
    return location.pathname === route || location.pathname.startsWith(route + '/');
  };

  // Toggle expanded state for menu items with children
  const toggleExpand = (title, closeOthers = true) => {
    setExpandedItems((prev) => {
      if (closeOthers) {
        return {
          [title]: !prev[title],
        };
      } else {
        return {
          ...prev,
          [title]: !prev[title],
        };
      }
    });
  };

  // Handle menu item click
  const handleMenuItemClick = (route, parentTitle = null) => {
    if (parentTitle) {
      setExpandedItems((prev) => {
        return {
          [parentTitle]: true,
        };
      });
    }
    navigate(route);
    if (window.innerWidth < 1024) {
      onClose();
    }
  };

  // Render menu item
  const renderMenuItem = (item) => {
    const Icon = iconMap[item.title] || FiHome;
    const hasChildren = item.children && item.children.length > 0;
    const isExpanded = expandedItems[item.title];
    const active = isActive(item.route);

    return (
      <div key={item.route} className="mb-1">
        {/* Main Menu Item */}
        <div
          className={`
            flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 cursor-pointer text-sm
            ${active
              ? "bg-white/10 text-white font-semibold border border-white/15 shadow-sm"
              : "text-neutral-400 hover:text-white hover:bg-white/5"
            }
          `}
          onClick={() => {
            if (hasChildren) {
              toggleExpand(item.title, true);
            } else {
              handleMenuItemClick(item.route);
            }
          }}>
          <Icon
            className={`text-lg flex-shrink-0 ${active ? "text-white" : "text-neutral-400"
              }`}
          />
          <span className="font-semibold flex-1 text-sm">{item.title}</span>

          {/* Badge Display */}
          {item.title === "Bookings" && counts.bookings > 0 && (
            <span className="bg-red-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full shadow-sm animate-pulse mr-2">
              {counts.bookings > 99 ? '99+' : counts.bookings}
            </span>
          )}
          {item.title === "Vendors" && counts.vendors > 0 && (
            <span className="bg-red-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full shadow-sm animate-pulse mr-2">
              {counts.vendors > 99 ? '99+' : counts.vendors}
            </span>
          )}
          {item.title === "Settlements" && (counts.withdrawals + counts.pendingSettlements) > 0 && (
            <span className="bg-red-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full shadow-sm animate-pulse mr-2">
              {(counts.withdrawals + counts.pendingSettlements) > 99 ? '99+' : (counts.withdrawals + counts.pendingSettlements)}
            </span>
          )}
          {item.title === "Scrap Items" && counts.scraps > 0 && (
            <span className="bg-red-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full shadow-sm animate-pulse mr-2">
              {counts.scraps > 99 ? '99+' : counts.scraps}
            </span>
          )}

          {hasChildren && (
            <motion.div
              animate={{ rotate: isExpanded ? 180 : 0 }}
              transition={{ duration: 0.2 }}>
              <ChevronDown className="text-neutral-400 text-sm w-4 h-4" />
            </motion.div>
          )}
        </div>

        {/* Children Items */}
        <AnimatePresence>
          {hasChildren && isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden">
              <div className="ml-4 mt-1 pl-3 border-l border-neutral-800 space-y-1">
                {item.children.map((child, index) => {
                  const childRoute = getChildRoute(item.route, child);
                  const isChildActive =
                    location.pathname === childRoute ||
                    (childRoute !== item.route &&
                      location.pathname.startsWith(childRoute));

                  return (
                    <div
                      key={index}
                      onClick={() =>
                        handleMenuItemClick(childRoute, item.title)
                      }
                      className={`
                        px-3 py-2 text-xs rounded-lg transition-colors cursor-pointer flex justify-between items-center
                        ${isChildActive
                          ? "bg-white/10 text-white font-semibold"
                          : "text-neutral-400 hover:text-white hover:bg-white/5"
                        }
                      `}>
                      <span>{child}</span>
                      {item.title === "Settlements" && child === "Pending" && counts.pendingSettlements > 0 && (
                        <span className="bg-red-500 text-white text-[10px] h-5 min-w-[20px] px-1.5 flex items-center justify-center rounded-full">
                          {counts.pendingSettlements}
                        </span>
                      )}
                      {item.title === "Settlements" && child === "Withdrawals" && counts.withdrawals > 0 && (
                        <span className="bg-orange-500 text-white text-[10px] h-5 min-w-[20px] px-1.5 flex items-center justify-center rounded-full">
                          {counts.withdrawals}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  const { activeLogo, settings: appSettings } = useSettings() || {};
  const effectiveLogo = activeLogo || appSettings?.customization?.logos?.admin || appSettings?.logos?.admin || appSettings?.customization?.logos?.landing || logoUrl || quickSpicyLogo;

  // Sidebar content
  const sidebarContent = (
    <div className="h-full w-full flex flex-col bg-neutral-950 border-r border-neutral-800/60 overflow-hidden">
      {/* Header Section */}
      <div className="shrink-0 px-3 py-3 border-b border-neutral-800/60 bg-neutral-900">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/5 bg-white/5 p-1 transition-all">
              <img
                src={effectiveLogo}
                alt={servicesTitle}
                className="h-9 w-9 object-contain"
                onError={(e) => {
                  if (e.target.src !== quickSpicyLogo) {
                    e.target.src = quickSpicyLogo;
                  }
                }}
              />
            </div>
            <div className="flex flex-col min-w-0">
              <h3 className="text-[15px] font-extrabold leading-tight text-white tracking-tight truncate">
                {servicesTitle}
              </h3>
              <div className="mt-1 flex items-center gap-1.5">
                <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                  {adminUser.role === 'super_admin' ? '⭐ Super Admin' : 'System Admin'}
                </span>
              </div>
            </div>
          </div>

          {/* Close Button - Mobile Only */}
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/5 rounded-lg transition-colors flex-shrink-0 lg:hidden text-neutral-300 hover:text-white"
            aria-label="Close sidebar">
            <FiX className="text-xl" />
          </button>
        </div>

        {/* Admin Panel Label */}
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-neutral-300 uppercase tracking-wider text-left">
            Admin Panel
          </h2>
        </div>

        {/* Platform module switcher */}
        <div className="flex p-1 bg-neutral-800/40 backdrop-blur-sm rounded-xl mb-1 border border-white/5 shadow-inner">
          <button
            type="button"
            onClick={() => navigate("/admin/food")}
            className="flex-1 min-w-0 flex flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] leading-none font-bold rounded-lg transition-all duration-300 text-neutral-400 hover:text-neutral-200 hover:bg-white/5">
            <UtensilsCrossed className="w-3.5 h-3.5 text-neutral-500" />
            Food
          </button>
          <button
            type="button"
            onClick={() => navigate("/taxi/admin/dashboard")}
            className="flex-1 min-w-0 flex flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] leading-none font-bold rounded-lg transition-all duration-300 text-neutral-400 hover:text-neutral-200 hover:bg-white/5">
            <Truck className="w-3.5 h-3.5 text-neutral-500" />
            Taxi
          </button>
          <button
            type="button"
            onClick={() => navigate("/admin/sp/dashboard")}
            className="flex-1 min-w-0 flex flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] leading-none font-bold rounded-lg transition-all duration-300 bg-white text-black shadow-[0_4px_12px_rgba(255,255,255,0.15)]">
            <Wrench className="w-3.5 h-3.5 text-black" />
            Services
          </button>
          <button
            type="button"
            onClick={() => navigate("/admin/quick-commerce")}
            className="flex-1 min-w-0 flex flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] leading-none font-bold rounded-lg transition-all duration-300 text-neutral-400 hover:text-neutral-200 hover:bg-white/5">
            <ShoppingBasket className="w-3.5 h-3.5 text-neutral-500" />
            Quick
          </button>
          <button
            type="button"
            onClick={() => navigate("/admin/medical")}
            className="flex-1 min-w-0 flex flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] leading-none font-bold rounded-lg transition-all duration-300 text-neutral-400 hover:text-neutral-200 hover:bg-white/5">
            <Pill className="w-3.5 h-3.5 text-neutral-500" />
            Medical
          </button>
        </div>
      </div>

      {/* Navigation Menu */}
      <nav className="flex-1 overflow-y-auto p-3 admin-sidebar-scroll lg:pb-3 space-y-1">
        {filteredMenu.map((item) => renderMenuItem(item))}
      </nav>
    </div>
  );

  return (
    <>
      <style>{`
        .admin-sidebar-scroll::-webkit-scrollbar {
          width: 5px;
        }
        .admin-sidebar-scroll::-webkit-scrollbar-track {
          background: rgba(17, 24, 39, 0.4);
        }
        .admin-sidebar-scroll::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.15);
          border-radius: 4px;
        }
        .admin-sidebar-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.3);
        }
        .admin-sidebar-scroll {
          scrollbar-width: thin;
          scrollbar-color: rgba(255, 255, 255, 0.15) rgba(17, 24, 39, 0.4);
        }
      `}</style>

      {/* Mobile: Overlay Backdrop */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 z-[99998] lg:hidden backdrop-blur-sm"
          />
        )}
      </AnimatePresence>

      {/* Sidebar - Mobile Drawer */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed left-0 top-0 bottom-0 w-80 z-[99999] lg:hidden shadow-2xl"
          >
            {sidebarContent}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sidebar - Desktop Fixed */}
      <div
        className="hidden lg:flex fixed left-0 top-0 bottom-0 z-30 w-80"
      >
        {sidebarContent}
      </div>
    </>
  );
};

export default AdminSidebar;


