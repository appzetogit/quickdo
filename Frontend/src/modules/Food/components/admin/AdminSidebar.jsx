import { useState, useEffect, useMemo } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import {
  Search,
  FileText,
  Calendar,
  Clock,
  Receipt,
  AlertTriangle,
  CheckCircle2,
  MapPin,
  Link as LinkIcon,
  UtensilsCrossed,
  Building2,
  FolderTree,
  Plus,
  Utensils,
  Megaphone,
  Send,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  X,
  LayoutDashboard,
  Gift,
  DollarSign,
  Image,
  Bell,
  MessageSquare,
  Mail,
  Users,
  Wallet,
  Award,
  Truck,
  Wrench,
  Package,
  CreditCard,
  Settings,
  SlidersHorizontal,
  LayoutGrid,
  UserCog,
  Bike,
  Ticket,
  User,
  Globe,
  Palette,
  Camera,
  LogIn,
  Database,
  Zap,
  Phone,
  IndianRupee,
  PiggyBank,
  Lock,
  ShoppingBasket,
  Pill,
  Percent,
  ShieldCheck,
} from "lucide-react"
import { cn } from "@food/utils/utils"
import { Input } from "@food/components/ui/input"

import { adminSidebarMenu } from "@food/utils/adminSidebarMenu"
import { masterSidebarMenu } from "@food/utils/masterSidebarMenu"
import { rulesFor, VERTICAL } from "@food/utils/verticalVocabulary"
import { getCachedSettings, loadBusinessSettings } from "@food/utils/businessSettings"
import quickSpicyLogo from "@food/assets/k9-logo.jpg"
import { useSettings } from "../../../Taxi/shared/context/SettingsContext"
import { useAdminAccess, filterMenuForAccess, hasPanel, isRestricted } from "@food/utils/adminAccess"
import { SERVICE_PROVIDER_ENABLED } from "@/config/features"
/**
 * Which service tabs this admin may see.
 *
 * Reads servicesAccess off the stored admin session. Fails OPEN on purpose: if the
 * session predates this field, or is unparseable, show every tab rather than hide a
 * service from someone entitled to it. The backend is the real gate -- an admin
 * without access gets 403 from the API regardless of what the sidebar renders.
 */
const useServiceAccess = () =>
  useMemo(() => {
    const showAll = { food: true, taxi: true, serviceProvider: true, quickCommerce: true }
    try {
      const raw = localStorage.getItem("admin_user") || sessionStorage.getItem("admin_user")
      if (!raw) return showAll
      const admin = JSON.parse(raw)
      const access = admin?.servicesAccess
      if (!Array.isArray(access) || access.length === 0) return showAll
      if (admin?.adminLevel === "platform_superadmin") return showAll
      return {
        food: access.includes("food"),
        taxi: access.includes("taxi"),
        serviceProvider: access.includes("serviceProvider"),
        quickCommerce: access.includes("quickCommerce"),
      }
    } catch {
      return showAll
    }
  }, [])

const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}


// Icon mapping
const iconMap = {
  // Registered explicitly: an unmapped name falls back to Utensils, so a missing
  // entry shows a fork beside Platform Settings rather than failing visibly.
  SlidersHorizontal,
  LayoutGrid,
  LayoutDashboard,
  Bike,
  Ticket,
  Percent,
  ShieldCheck,
  Pill,
  UtensilsCrossed,
  Building2,
  FileText,
  Calendar,
  Clock,
  Receipt,
  AlertTriangle,
  CheckCircle2,
  MapPin,
  Link: LinkIcon,
  FolderTree,
  Plus,
  Utensils,
  Megaphone,
  Send,
  Gift,
  DollarSign,
  Image,
  Bell,
  MessageSquare,
  Mail,
  Users,
  Wallet,
  Award,
  Truck,
  Package,
  CreditCard,
  Settings,
  UserCog,
  User,
  Globe,
  Palette,
  Camera,
  LogIn,
  Database,
  Zap,
  Phone,
  IndianRupee,
  PiggyBank,
  Lock,
  X,
}

/**
 * Which vertical's admin the operator is currently in.
 *
 * The menu in adminSidebarMenu hardcodes 68 /admin/food/... paths. Quick-commerce
 * renders these SAME screens (see AdminRouter), so without rebasing, its sidebar shows
 * food's links and clicking any of them navigates the operator back out into food.
 *
 * Add a base here when another vertical starts reusing these screens.
 */
const FOOD_ADMIN_BASE = "/admin/food"
const REUSED_ADMIN_BASES = ["/admin/quick-commerce", "/admin/medical"]

export const currentAdminBase = (pathname = "") =>
  REUSED_ADMIN_BASES.find((base) => pathname.startsWith(base)) || FOOD_ADMIN_BASE

/**
 * A food admin path as it lives in the panel for `base`. Quick and Medical call
 * their sellers stores, so /restaurants there is /stores (see AdminRouter).
 */
export const rebaseAdminPath = (path, base) => {
  if (typeof path !== "string" || !path.startsWith(FOOD_ADMIN_BASE) || base === FOOD_ADMIN_BASE) return path
  const rest = path.slice(FOOD_ADMIN_BASE.length)
  return `${base}${rest.replace(/^\/restaurants(?=\/|$|\?)/, "/stores")}`
}

/** The same, for the panel the operator is in now: for in-page links on shared screens. */
export const verticalAdminPath = (path) =>
  rebaseAdminPath(path, currentAdminBase(typeof window === "undefined" ? "" : window.location.pathname))

export const getVerticalTitle = (base = "", customName = "") => {
  const name = (customName || "Quick Drop").trim()
  if (base === "/admin/medical") {
    return name.toLowerCase().endsWith("medical") ? name : `${name} Medical`
  }
  if (base === "/admin/quick-commerce") {
    return name.toLowerCase().endsWith("quick") ? name : `${name} Quick`
  }
  if (base === "/admin/food") {
    return name.toLowerCase().endsWith("food") ? name : `${name} Food`
  }
  return name
}

/**
 * What the panel calls itself per vertical. The screens are shared; the words on them
 * must not be, or the operator cannot tell which vertical they are editing -- which is
 * exactly how quick-commerce banner uploads ended up in food.
 */
const VERTICAL_BRANDING = {
  "/admin/food": { title: "Quick Drop Food", labels: {} },
  "/admin/quick-commerce": {
    title: "Quick Drop Quick",
    labels: {
      "FOOD MANAGEMENT": "PRODUCT MANAGEMENT",
      "RESTAURANT MANAGEMENT": "SELLER MANAGEMENT",
    },
    // Word-level rewrites applied to EVERY menu label, not just section headers.
    // The first branding pass only mapped the two headers, so the items under them
    // ("Food Approval", "Restaurants List") still read as the food vertical.
    //
    // Sourced from verticalVocabulary.js rather than listed here, so the sidebar and
    // the in-page shim cannot drift apart -- this copy had only the title-case half
    // of the table and would have missed a lower-case label.
    words: rulesFor(VERTICAL.QUICK_COMMERCE),
    // A restaurant's delivery radius exists only on the food API; the
    // quick-commerce fork has no such route, so the link would open a page
    // that can only fail.
    // Food only: the cancellation window lives on the food API.
    hiddenPaths: ['/admin/food/delivery-radius', '/admin/food/order-cancellation'],
    hiddenSections: [],
    // Stock is counted per product size in quick commerce; food dishes are not.
    // First in the menu: it is what a grocery operator checks most.
    extraSectionsFirst: true,
    extraSections: [
      {
        type: "section",
        label: "INVENTORY",
        items: [{ type: "link", label: "Stock", path: "/admin/quick-commerce/stock", icon: "Package" }],
      },
    ],
  },
  /*
   * Medical is quick-commerce narrowed to pharmacies (the API scope lives in
   * services/api/axios.js), so it inherits quick-commerce's word rewrites and
   * then renames the two things that are genuinely different: the sellers are
   * pharmacies and the products are medicines.
   */
  "/admin/medical": {
    title: "Quick Drop Medical",
    labels: {
      "FOOD MANAGEMENT": "MEDICINE MANAGEMENT",
      "RESTAURANT MANAGEMENT": "PHARMACY MANAGEMENT",
    },
    // Sourced from verticalVocabulary.js, like quick-commerce above, so the
    // sidebar and the in-page shim cannot drift apart.
    words: rulesFor(VERTICAL.MEDICAL),
    hiddenPaths: [],
    hiddenSections: [],
    /*
     * Medical shows two of the shared screens and no more.
     *
     * It inherits the whole quick-commerce admin -- sixty-odd links for
     * catalogue, offers, combos, delivery fees, subscriptions, reports -- and a
     * pharmacy operator needs none of it. What they need is the zones the
     * platform serves and the list of pharmacies in them; everything specific
     * to dispensing is in the MEDICAL section below, which this does not touch.
     *
     * An ALLOWLIST rather than a list of things to hide. Hiding would mean
     * naming sixty-six paths and remembering to add the sixty-seventh the day
     * somebody extends the shared menu -- and a link nobody remembered to hide
     * is how food's screens turned up in quick-commerce before. Naming what
     * belongs here means anything new is absent until somebody decides it
     * belongs.
     *
     * Paths are the food ones, because this filter runs before rebasing.
     */
    onlyPaths: [
      '/admin/food/zone-setup',
      '/admin/food/restaurants',
    ],
    /*
     * Screens that exist only here. A prescription queue and a drug-licence
     * register have no meaning in food or general quick-commerce, so they are
     * added for this base rather than put in the shared menu and hidden from
     * the other two -- a hidden entry is one someone forgets to hide when the
     * next vertical arrives.
     *
     * Paths are already based here, so rebaseAdminMenu leaves them alone.
     */
    extraSectionsFirst: true,
    extraSections: [
      {
        type: "section",
        label: "MEDICAL",
        items: [
          {
            type: "link",
            label: "Stock",
            path: "/admin/medical/stock",
            icon: "Package",
          },
          {
            type: "link",
            label: "Pharmacy Verification",
            path: "/admin/medical/verification",
            icon: "ShieldCheck",
          },
          {
            type: "link",
            label: "Commission",
            path: "/admin/medical/commission",
            icon: "Percent",
          },
          {
            type: "link",
            label: "Prescription Orders",
            path: "/admin/medical/prescriptions",
            icon: "FileText",
          },
          {
            type: "link",
            label: "Drug Licences",
            path: "/admin/medical/drug-licences",
            icon: "ShieldCheck",
          },
          {
            type: "link",
            label: "Prescription Requests",
            path: "/admin/medical/requests",
            icon: "Send",
          },
        ],
      },
    ],
  },
}

export const brandingFor = (base) => VERTICAL_BRANDING[base] || VERTICAL_BRANDING[FOOD_ADMIN_BASE]

/** Re-point every menu path at `base`. Returns the menu untouched for food. */
export const rebaseAdminMenu = (nodes, base) => {
  if (base === FOOD_ADMIN_BASE || !Array.isArray(nodes)) return nodes
  const rebase = (path) => rebaseAdminPath(path, base)
  const { labels, words = [], hiddenPaths = [], hiddenSections = [], onlyPaths } = brandingFor(base)
  const relabel = (label) => {
    if (!label) return label
    if (labels[label]) return labels[label]
    return words.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), label)
  }
  /*
   * A vertical that names `onlyPaths` gets those links and nothing else.
   *
   * Applied before rebasing, so the list is written in the food paths the
   * shared menu actually holds. A section or an expandable survives only if
   * something inside it did -- otherwise the menu keeps empty headings, which
   * read as broken rather than as deliberately spare.
   */
  const keeps = (node) => {
    if (!onlyPaths) return true
    if (node.path) return onlyPaths.includes(node.path)
    const children = node.items || node.subItems
    return Array.isArray(children) && children.some(keeps)
  }

  const rebased = nodes
    .filter((node) => !(node.path && hiddenPaths.includes(node.path)))
    .filter((node) => !(node.label && hiddenSections.includes(node.label)))
    .filter(keeps)
    .map((node) => ({
      ...node,
      ...(node.path ? { path: rebase(node.path) } : {}),
      ...(node.label ? { label: relabel(node.label) } : {}),
      ...(node.items ? { items: rebaseAdminMenu(node.items, base) } : {}),
      ...(node.subItems ? { subItems: rebaseAdminMenu(node.subItems, base) } : {}),
    }))
  // Only at the top level: a nested call would append the vertical's own
  // sections inside every expandable item it recursed into.
  const { extraSections = [], extraSectionsFirst = false } = brandingFor(base)
  if (nodes !== adminSidebarMenu || extraSections.length === 0) return rebased
  if (!extraSectionsFirst) return [...rebased, ...extraSections]
  // Keep MASTER (platform-wide screens) above everything, then this vertical's own.
  const masterAt = rebased.findIndex((n) => n.label === "MASTER")
  return masterAt === -1
    ? [...extraSections, ...rebased]
    : [...rebased.slice(0, masterAt + 1), ...extraSections, ...rebased.slice(masterAt + 1)]
}

export default function AdminSidebar({ isOpen = false, onClose, onCollapseChange }) {
  const { activeLogo } = useSettings()
  const location = useLocation()
  const adminBase = currentAdminBase(location.pathname)
  const access = useAdminAccess()
  // A sub-admin sees only what they were given. The server refuses the rest
  // anyway; hiding it here is what makes the panel usable rather than a wall of
  // "no access" screens.
  /*
   * Master is its OWN panel, not a section bolted on top of food's menu.
   *
   * Its paths live under /admin/master, which currentAdminBase does not
   * recognise, so it falls back to the food base and the whole food menu --
   * orders, restaurants, riders -- rendered underneath the three Master links.
   * An operator who switched to Master was still looking at Food.
   *
   * While inside Master the menu is the MASTER section and nothing else, and
   * everywhere else that section is gone: it was repeated at the top of Food,
   * Quick and Medical, so the same five screens appeared in four places. The
   * switcher tab is how you reach Master now, exactly as for every other panel.
   */
  const inMaster = location.pathname.startsWith("/admin/master")
  const allowedMenu = useMemo(
    () => filterMenuForAccess(rebaseAdminMenu(adminSidebarMenu, adminBase), access) || [],
    [adminBase, access],
  )
  /*
   * The Master screens this admin may actually open, already filtered by their
   * permissions. Derived rather than gated on "is an owner": /admin/master/admins
   * resolves to the `subadmins` permission, not __owner__, so a sub-admin who
   * was given it can open Admin Accounts. Taking the section out of Food while
   * hiding the Master tab from them would strand that screen with no way in.
   */
  // Master has its own menu (utils/masterSidebarMenu.js), never rebased: its
  // links point at named services and must stay put whichever panel you came from.
  const allowedMaster = useMemo(() => filterMenuForAccess(masterSidebarMenu, access) || [], [access])
  const masterItems = useMemo(
    () =>
      allowedMaster
        .flatMap((section) => section.items || [])
        .flatMap((item) => (item.path ? [item] : item.subItems || [])),
    [allowedMaster],
  )
  const verticalMenu = useMemo(
    () => (inMaster ? allowedMaster : allowedMenu.filter((node) => node.label !== "MASTER")),
    [allowedMenu, allowedMaster, inMaster],
  )
  const navigate = useNavigate()
  const storedAccess = useServiceAccess()
  const serviceAccess = isRestricted(access)
    ? {
        food: hasPanel(access, "food"),
        taxi: hasPanel(access, "taxi"),
        serviceProvider: SERVICE_PROVIDER_ENABLED && hasPanel(access, "serviceProvider"),
        quickCommerce: hasPanel(access, "quickCommerce"),
        medical: hasPanel(access, "medical"),
      }
    : {
        ...storedAccess,
        medical: storedAccess.quickCommerce,
        // Off on a site that has not switched the module on, whatever the
        // stored session says -- the tab would lead to a route that is absent.
        serviceProvider: SERVICE_PROVIDER_ENABLED && storedAccess.serviceProvider !== false,
      }
  const [searchQuery, setSearchQuery] = useState("")
  const [badges, setBadges] = useState({})

  useEffect(() => {
    const fetchBadges = async () => {
      try {
        const res = await adminAPI.getSidebarBadges()
        if (res?.data?.success) {
          setBadges(res.data.counts || {})
        }
      } catch (error) {
        debugError("Error fetching sidebar badges:", error)
      }
    }
    fetchBadges()
    const timer = setInterval(fetchBadges, 60000)
    return () => clearInterval(timer)
  }, [])

  const getBadgeCount = (label = "", path = "") => {
    const l = label.toLowerCase()
    const p = path?.toLowerCase() || ""

    if (l.includes("food approval")) return badges.foodApprovals
    if (l === "foods") return badges.foods
    if (l === "restaurants" || l.includes("new joining request")) return badges.restaurants
    if (l.includes("restaurant complaints")) return badges.restaurantComplaints
    if (p.includes("orders/pending")) return badges.orders
    if (p.includes("offline-payments")) return badges.offlinePayments
    if (l.includes("support tickets")) return l.includes("delivery") ? badges.deliverySupportTickets : badges.userSupportTickets
    if (l.includes("withdrawal")) return l.includes("delivery") ? badges.deliveryWithdrawals : badges.restaurantWithdrawals
    if (l.includes("emergency help")) return badges.emergencyHelp
    if (l.includes("earning addon history")) return badges.earningAddons
    if (l.includes("safety emergency reports")) return badges.safetyReports
    if (l === "deliveryman" && !p.includes("join-request")) return badges.deliveryPartners // expandable parent
    if (l.includes("join-request")) return badges.deliveryPartners
    return 0
  }
  const [logoUrl, setLogoUrl] = useState(() => getCachedSettings()?.logo?.url || null)
  const [companyName, setCompanyName] = useState(() => getCachedSettings()?.companyName || null)
  // In Master the heading names the panel, not the vertical whose base the
  // path happened to fall back to.
  const displayTitle = inMaster ? "Master" : getVerticalTitle(adminBase, companyName)

  // Business settings ship logo.url as "" until an operator uploads one, so on a fresh
  // install both activeLogo and logoUrl are empty and the expanded rail rendered
  // <img src="">, which paints a broken-image icon. Resolve the source once, fall back
  // to the bundled mark, and let a dead remote URL fall back the same way.
  const logoSrc = activeLogo || logoUrl || quickSpicyLogo
  const handleLogoError = (e) => {
    if (e.target.src !== quickSpicyLogo) e.target.src = quickSpicyLogo
  }

  // Load business settings logo
  useEffect(() => {
    const loadLogo = async () => {
      try {
        // First check cache
        let cached = getCachedSettings()
        if (cached) {
          if (cached.logo?.url) {
            setLogoUrl(cached.logo.url)
          }
          if (cached.companyName) {
            setCompanyName(cached.companyName)
          }
        }

        // Always try to load fresh data to ensure we have the latest
        const settings = await loadBusinessSettings()
        if (settings) {
          if (settings.logo?.url) {
            setLogoUrl(settings.logo.url)
          }
          if (settings.companyName) {
            setCompanyName(settings.companyName)
          }
        }
      } catch (error) {
        debugError('Error loading logo:', error)
      }
    }

    // Load immediately
    loadLogo()

    // Also try after a small delay to ensure DOM is ready
    const timeoutId = setTimeout(() => {
      loadLogo()
    }, 100)

    // Listen for business settings updates
    const handleSettingsUpdate = () => {
      const cached = getCachedSettings()
      if (cached) {
        if (cached.logo?.url) {
          setLogoUrl(cached.logo.url)
        }
        if (cached.companyName) {
          setCompanyName(cached.companyName)
        }
      }
    }
    window.addEventListener('businessSettingsUpdated', handleSettingsUpdate)

    return () => {
      clearTimeout(timeoutId)
      window.removeEventListener('businessSettingsUpdated', handleSettingsUpdate)
    }
  }, [])

  // Get initial states from consolidated admin_sidebar_state
  const getInitialStates = () => {
    try {
      const saved = localStorage.getItem('admin_sidebar_state')
      if (saved) {
        return JSON.parse(saved)
      }
    } catch (e) {
      debugError('Error loading sidebar state:', e)
    }
    return { isCollapsed: false, expandedSections: {} }
  }

  const [isCollapsed, setIsCollapsed] = useState(() => getInitialStates().isCollapsed)
  const [expandedSections, setExpandedSections] = useState(() => {
    const initialState = getInitialStates().expandedSections
    if (Object.keys(initialState || {}).length > 0) return initialState

    // Generate defaults if empty
    const state = {}
    adminSidebarMenu.forEach((item) => {
      if (item.type === "section") {
        item.items.forEach((subItem) => {
          if (subItem.type === "expandable") {
            state[subItem.label.toLowerCase().replace(/\s+/g, "")] = false
          }
        })
      }
    })
    return state
  })

  // Save states to consolidated localStorage and notify parent
  useEffect(() => {
    try {
      const currentState = JSON.parse(localStorage.getItem('admin_sidebar_state') || '{}')
      localStorage.setItem('admin_sidebar_state', JSON.stringify({
        ...currentState,
        isCollapsed
      }))
      if (onCollapseChange) {
        onCollapseChange(isCollapsed)
      }
    } catch (e) {
      debugError('Error saving sidebar collapsed state:', e)
    }
  }, [isCollapsed, onCollapseChange])

  // Notify parent on initial load
  useEffect(() => {
    if (onCollapseChange) {
      onCollapseChange(isCollapsed)
    }
  }, [])

  const toggleCollapse = () => {
    setIsCollapsed(prev => !prev)
  }

  // expandedSections state is initialized above in getInitialStates consolidation


  // Filter menu items based on search query
  const filteredMenuData = useMemo(() => {
    if (!searchQuery.trim()) {
      return verticalMenu
    }

    const query = searchQuery.toLowerCase().trim()
    const filtered = []

    verticalMenu.forEach((item) => {
      if (item.type === "link") {
        if (item.label.toLowerCase().includes(query)) {
          filtered.push(item)
        }
      } else if (item.type === "section") {
        const filteredItems = []

        item.items.forEach((subItem) => {
          if (subItem.type === "link") {
            if (subItem.label.toLowerCase().includes(query)) {
              filteredItems.push(subItem)
            }
          } else if (subItem.type === "expandable") {
            const matchesLabel = subItem.label.toLowerCase().includes(query)
            const matchingSubItems = subItem.subItems?.filter(
              (si) => si.label.toLowerCase().includes(query)
            ) || []

            if (matchesLabel || matchingSubItems.length > 0) {
              filteredItems.push({
                ...subItem,
                subItems: matchesLabel ? subItem.subItems : matchingSubItems,
              })
            }
          }
        })

        if (filteredItems.length > 0) {
          filtered.push({
            ...item,
            items: filteredItems,
          })
        }
      }
    })

    return filtered
  }, [searchQuery, verticalMenu])

  // Auto-expand sections with matches when searching
  useEffect(() => {
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim()

      setExpandedSections((prev) => {
        const newExpandedState = { ...prev }

        ;[...adminSidebarMenu, ...masterSidebarMenu].forEach((item) => {
          if (item.type === "section") {
            item.items.forEach((subItem) => {
              if (subItem.type === "expandable") {
                const matchesLabel = subItem.label.toLowerCase().includes(query)
                const hasMatchingSubItems = subItem.subItems?.some(
                  (si) => si.label.toLowerCase().includes(query)
                )

                if (matchesLabel || hasMatchingSubItems) {
                  const sectionKey = subItem.label.toLowerCase().replace(/\s+/g, "")
                  newExpandedState[sectionKey] = true
                }
              }
            })
          }
        })

        return newExpandedState
      })
    }
  }, [searchQuery])

  const isActive = (path, allPaths = []) => {
    const currentPath = location.pathname.replace(/\/+$/, "") || "/"
    const targetPath = String(path || "").replace(/\/+$/, "") || "/"
    const matchesPath = (candidatePath) =>
      currentPath === candidatePath || currentPath.startsWith(`${candidatePath}/`)

    if (targetPath === "/admin" || targetPath === adminBase) {
      return currentPath === targetPath
    }

    // For subItems, check if this is the most specific match
    if (allPaths.length > 0) {
      // Sort paths by length (longest first) to find most specific match
      const sortedPaths = [...allPaths].sort((a, b) => b.length - a.length)
      const bestMatch = sortedPaths.find((candidatePath) =>
        matchesPath(String(candidatePath || "").replace(/\/+$/, "") || "/")
      )
      return (String(bestMatch || "").replace(/\/+$/, "") || "/") === targetPath
    }

    return matchesPath(targetPath)
  }

  useEffect(() => {
    try {
      const currentState = JSON.parse(localStorage.getItem('admin_sidebar_state') || '{}')
      localStorage.setItem('admin_sidebar_state', JSON.stringify({
        ...currentState,
        expandedSections
      }))
    } catch (e) {
      debugError('Error saving sidebar state:', e)
    }
  }, [expandedSections])

  const toggleSection = (sectionKey) => {
    setExpandedSections((prev) => {
      const isCurrentlyOpen = Boolean(prev[sectionKey])

      // Accordion behavior:
      // 1) If current section is open -> close it.
      // 2) If current section is closed -> open it and close all others.
      if (isCurrentlyOpen) {
        return {
          ...prev,
          [sectionKey]: false,
        }
      }

      const next = { [sectionKey]: true }
      Object.keys(prev).forEach((key) => {
        if (key !== sectionKey) {
          next[key] = false
        }
      })
      return next
    })
  }

  const renderMenuItem = (item, index, isInSection = false) => {
    if (item.type === "link") {
      const Icon = iconMap[item.icon] || Utensils
      return (
        <Link
          key={index}
          to={item.path}
          onClick={() => {
            if (window.innerWidth < 1024 && onClose) {
              onClose()
            }
          }}
          className={cn(
            "flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all duration-300 ease-out menu-item-animate text-left",
            isInSection ? "text-sm font-semibold" : "text-sm",
            isActive(item.path)
              ? "bg-[var(--sb-active-bg)] text-[var(--sb-active-ink)] font-semibold shadow-sm"
              : "text-[var(--sb-ink-soft)] hover:bg-[var(--sb-hover)] hover:text-[var(--sb-ink)]",
            isCollapsed && "justify-center px-2"
          )}
          style={{ animationDelay: `${index * 0.05}s` }}
          title={isCollapsed ? item.label : undefined}
          // Which item is current was conveyed by colour alone, so a screen reader
          // announced ~90 identical links. "page" is the correct token here because
          // these are route destinations.
          aria-current={isActive(item.path) ? "page" : undefined}
        >
          <Icon
            aria-hidden="true"
            className={cn(
              "shrink-0 transition-all duration-300 text-left",
              isInSection ? "w-4 h-4" : "w-4 h-4",
              isActive(item.path) ? "text-[var(--sb-active-ink)] scale-110" : "text-[var(--sb-ink-soft)]"
            )}
          />
          {!isCollapsed && (
            <div className="flex-1 flex items-center justify-between overflow-hidden">
              <span className={cn("text-left truncate", isInSection ? "font-semibold" : "font-medium")}>
                {item.label}
              </span>
              {getBadgeCount(item.label, item.path) > 0 && (
                <span className="shrink-0 bg-red-600 text-[#FFFFFF] text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-1 min-w-[18px] text-center">
                  {getBadgeCount(item.label, item.path) > 99 ? "99+" : getBadgeCount(item.label, item.path)}
                </span>
              )}
            </div>
          )}
          {isCollapsed && getBadgeCount(item.label, item.path) > 0 && (
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-600 rounded-full border-2 border-[var(--sb-surface)]" />
          )}
        </Link>
      )
    }

    if (item.type === "expandable") {
      const Icon = iconMap[item.icon] || Utensils
      const sectionKey = item.label.toLowerCase().replace(/\s+/g, "")
      const isExpanded = expandedSections[sectionKey] || false

      if (isCollapsed) {
        return (
          <div key={index} className="menu-item-animate" style={{ animationDelay: `${index * 0.05}s` }}>
            <button
              onClick={() => toggleSection(sectionKey)}
              className={cn(
                "w-full flex items-center justify-center px-2 py-2 rounded-lg transition-all duration-300 ease-out text-sm font-medium",
                "text-[var(--sb-ink)] hover:bg-[var(--sb-hover)]"
              )}
              title={item.label}
            >
              <div className="relative">
                <Icon className="w-4 h-4 shrink-0 text-[var(--sb-ink-soft)] transition-transform duration-300" />
                {getBadgeCount(item.label, item.path) > 0 && (
                  <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-600 rounded-full border-2 border-[var(--sb-surface)]" />
                )}
              </div>
            </button>
          </div>
        )
      }

      return (
        <div key={index} className="menu-item-animate" style={{ animationDelay: `${index * 0.05}s` }}>
          <button
            onClick={() => toggleSection(sectionKey)}
            className={cn(
              "w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg transition-all duration-300 ease-out text-sm font-medium text-left",
              "text-[var(--sb-ink)] hover:bg-[var(--sb-hover)]"
            )}
          >
            <div className="flex items-center gap-2.5 text-left flex-1 min-w-0">
              <Icon className="w-4 h-4 shrink-0 text-[var(--sb-ink-soft)] transition-transform duration-300" />
              <span className="font-medium text-left truncate">{item.label}</span>
              {getBadgeCount(item.label, item.path) > 0 && (
                <span className="shrink-0 bg-red-600 text-[#FFFFFF] text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-1 min-w-[18px] text-center">
                  {getBadgeCount(item.label, item.path) > 99 ? "99+" : getBadgeCount(item.label, item.path)}
                </span>
              )}
            </div>
            <div className="transition-transform duration-300 shrink-0" style={{ transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
              <ChevronDown className="w-4 h-4 shrink-0 text-[var(--sb-ink-soft)]" />
            </div>
          </button>
          {isExpanded && item.subItems && (
            <div className="ml-5 mt-1 space-y-1 border-[var(--sb-border)] pl-3 submenu-animate overflow-hidden">
              {item.subItems.map((subItem, subIndex) => {
                const allSubPaths = item.subItems.map(si => si.path)
                return (
                  <Link
                    key={subIndex}
                    to={subItem.path}
                    onClick={() => {
                      if (window.innerWidth < 1024 && onClose) {
                        onClose()
                      }
                    }}
                    className={cn(
                      "flex items-center gap-2 px-3 py-1.5 rounded-md transition-all duration-300 ease-out text-sm font-normal text-left",
                      isActive(subItem.path, allSubPaths)
                        ? "bg-[var(--sb-active-bg)] text-[var(--sb-active-ink)] font-semibold"
                        : "text-[var(--sb-ink-soft)] hover:bg-[var(--sb-hover)] hover:text-[var(--sb-ink)]"
                    )}
                    style={{ animationDelay: `${subIndex * 0.03}s` }}
                    aria-current={isActive(subItem.path, allSubPaths) ? "page" : undefined}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "w-1.5 h-1.5 rounded-full shrink-0 transition-all duration-300",
                        // Active-ink, not ink: this dot sits ON the dark active pill,
                        // so the ink token would be a dark dot on a dark ground.
                        isActive(subItem.path, allSubPaths)
                          ? "bg-[var(--sb-active-ink)] scale-125"
                          : "bg-[var(--sb-ink-faint)]"
                      )}
                    ></span>
                    <span className="text-left flex-1 truncate">{subItem.label}</span>
                    {/* Master entries name their own count: a plain total, or one that needs action. */}
                    {subItem.countKey && badges[subItem.countKey] > 0 && (
                      <span className="shrink-0 bg-[var(--sb-surface-raised)] border border-[var(--sb-border)] text-[var(--sb-ink-soft)] text-[10px] font-semibold px-1.5 py-0.5 rounded-full ml-1 min-w-[18px] text-center tabular-nums">
                        {badges[subItem.countKey] > 999 ? "999+" : badges[subItem.countKey]}
                      </span>
                    )}
                    {subItem.alertKey && badges[subItem.alertKey] > 0 && (
                      <span className="shrink-0 bg-red-600 text-[#FFFFFF] text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-1 min-w-[18px] text-center">
                        {badges[subItem.alertKey] > 99 ? "99+" : badges[subItem.alertKey]}
                      </span>
                    )}
                    {!subItem.countKey && !subItem.alertKey && getBadgeCount(subItem.label, subItem.path) > 0 && (
                      <span className="shrink-0 bg-red-600 text-[#FFFFFF] text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-1 min-w-[18px] text-center">
                        {getBadgeCount(subItem.label, subItem.path) > 99 ? "99+" : getBadgeCount(subItem.label, subItem.path)}
                      </span>
                    )}
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      )
    }

    return null
  }

  return (
    <>
      <style>{`
        /*
         * Sidebar palette.
         *
         * Every colour in this component resolves through one of these, so the rail
         * can be retuned here rather than across ~86 utility classes.
         *
         * Warm, not grey. The admin canvas is already light (AdminLayout uses
         * bg-neutral-100 on bg-neutral-200) and only this rail was dark, which left
         * the panel reading as two products bolted together. Warming the neutrals a
         * few degrees off pure grey separates the rail from the canvas without a hard
         * colour change, and reads as chosen rather than defaulted.
         *
         * The active state inverts to a dark pill: on a light ground a lightly tinted
         * fill is easy to miss, and this panel has ~90 destinations to scan.
         */
        .admin-sidebar-root {
          --sb-surface: #FAF8F5;
          --sb-surface-raised: #FFFFFF;
          --sb-border: #E8E2D9;
          --sb-hover: #F1ECE4;

          --sb-ink: #1A1A1A;
          /* Warm grey-brown. ~9:1 on --sb-surface, comfortably past AA. */
          --sb-ink-soft: #5C5247;
          /* Section labels and inactive icons. Darkened from the obvious #8B8177,
             which fell under 4.5:1 on this ground; this sits at ~5.1:1. */
          --sb-ink-faint: #6E655B;

          --sb-active-bg: #1A1A1A;
          --sb-active-ink: #FFFFFF;
        }

        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateX(-10px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        
        @keyframes expandDown {
          from {
            opacity: 0;
            max-height: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            max-height: 500px;
            transform: translateY(0);
          }
        }
        
        .menu-item-animate {
          animation: slideIn 0.3s ease-out forwards;
        }
        
        .submenu-animate {
          animation: expandDown 0.3s ease-out forwards;
        }
        
        .admin-sidebar-scroll {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
        }
        
        /* Scrollbar. These were white-on-dark rgba literals, which on the light rail
           would have been an invisible thumb on an invisible track. */
        .admin-sidebar-scroll::-webkit-scrollbar {
          width: 2px;
        }
        .admin-sidebar-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .admin-sidebar-scroll::-webkit-scrollbar-thumb {
          background: rgba(92, 82, 71, 0.25);
          border-radius: 10px;
          transition: background 0.2s ease;
        }
        .admin-sidebar-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(92, 82, 71, 0.45);
        }
        .admin-sidebar-scroll:hover::-webkit-scrollbar {
          width: 6px;
        }
        .admin-sidebar-scroll {
          scrollbar-width: thin;
          scrollbar-color: rgba(92, 82, 71, 0.3) transparent;
        }

        /*
         * Keyboard focus.
         *
         * Only the search input had a focus style, so tabbing through ~90 nav items
         * moved an invisible cursor. focus-visible rather than focus, so a mouse
         * click does not leave a ring behind.
         */
        .admin-sidebar-root a:focus-visible,
        .admin-sidebar-root button:focus-visible {
          outline: 2px solid var(--sb-ink);
          outline-offset: 2px;
          border-radius: 0.5rem;
        }

        /*
         * Respect a reduced-motion preference.
         *
         * The rail runs five staggered entrance animations plus a submenu expand on
         * every mount. For a vestibular disorder that is not decoration, it is a
         * symptom trigger -- and an operator opens this panel dozens of times a day.
         * The end state is identical; only the travel is removed.
         */
        @media (prefers-reduced-motion: reduce) {
          .admin-sidebar-root *,
          .admin-sidebar-root *::before,
          .admin-sidebar-root *::after {
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
            scroll-behavior: auto !important;
          }
          .admin-sidebar-root .menu-item-animate,
          .admin-sidebar-root .submenu-animate {
            animation: none !important;
            opacity: 1 !important;
            max-height: none !important;
            transform: none !important;
          }
        }
      `}</style>
      <div
        // admin-sidebar-root is where the palette custom properties are defined, so
        // every var(--sb-*) below resolves from here. It also scopes the focus-ring
        // and reduced-motion rules to this rail rather than the whole document.
        className={cn(
          "admin-sidebar-root",
          "bg-[var(--sb-surface)] border-r border-[var(--sb-border)] h-screen fixed left-0 top-0 z-50 flex flex-col overflow-hidden",
          "transform transition-all duration-300 ease-in-out",
          "lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full",
          isCollapsed ? "w-20" : "w-80"
        )}
      >
        {/* Header with Logo and Brand */}
        <div className="shrink-0 px-3 py-3 border-b border-[var(--sb-border)] bg-[var(--sb-surface-raised)] animate-[fadeIn_0.4s_ease-out]">
          <div className="flex items-center justify-between mb-3">
            {!isCollapsed && (
              <div className="flex items-center gap-3.5 animate-[slideIn_0.3s_ease-out]">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--sb-border)] bg-[var(--sb-hover)] p-1 transition-all">
                  <img
                    src={logoSrc}
                    alt={displayTitle}
                    className="h-9 w-9 object-contain"
                    onError={handleLogoError}
                  />
                </div>
                <div className="flex flex-col">
                  <h3 className="text-[15px] font-extrabold leading-tight text-[var(--sb-ink)] tracking-tight">
                    {displayTitle}
                  </h3>
                  <div className="mt-1 flex items-center gap-1.5">
                    {/* emerald-600, not 500: the lighter shade was picked to glow on
                        a near-black rail and sits at roughly 2.3:1 on this one. The
                        outward glow goes with it — on a light ground it reads as a
                        smudge rather than a light source. */}
                    <div className="h-1.5 w-1.5 rounded-full bg-emerald-600 animate-pulse" />
                    <span className="text-[11px] font-bold uppercase tracking-widest text-[var(--sb-ink-faint)]">
                      {isRestricted(access) ? "Sub-admin" : "System Admin"}
                    </span>
                  </div>
                </div>
              </div>
            )}
            {isCollapsed && (
              <div className="w-full flex items-center justify-center">
                <div className="w-10 h-10 rounded-lg bg-[var(--sb-hover)] flex items-center justify-center shadow-lg shadow-[rgba(26,26,26,0.12)] ring-1 ring-[var(--sb-border)]">
                  <img
                    src={logoSrc}
                    alt={displayTitle}
                    className="w-10 h-10 object-contain"
                    loading="lazy"
                    onError={handleLogoError}
                  />
                </div>
              </div>
            )}
            <div className="flex items-center gap-2">
              <button
                onClick={toggleCollapse}
                className="text-[var(--sb-ink-soft)] hover:text-[var(--sb-ink)] transition-all duration-200 hover:scale-110 p-1.5 rounded-lg hover:bg-[var(--sb-hover)]"
                title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                {isCollapsed ? (
                  <ChevronRight className="w-4 h-4" />
                ) : (
                  <ChevronLeft className="w-4 h-4" />
                )}
              </button>
              <button
                onClick={onClose}
                className="lg:hidden text-[var(--sb-ink-soft)] hover:text-[var(--sb-ink)] transition-all duration-200 hover:scale-110"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Admin Panel Label */}
          {!isCollapsed && (
            <div className="mb-3 animate-[slideIn_0.4s_ease-out_0.1s_both]">
              <h2 className="text-sm font-semibold text-[var(--sb-ink-soft)] uppercase tracking-wider text-left">
                Admin Panel
              </h2>
            </div>
          )}

          {/* Module Switcher Tabs */}
          {!isCollapsed && (
            <div className="flex p-1 bg-[var(--sb-surface-raised)] backdrop-blur-sm rounded-xl mb-4 border border-[var(--sb-border)] shadow-inner animate-[slideIn_0.4s_ease-out_0.15s_both]">
              {/* Master: the cross-module engine (earnings, incentives, promo
                  limits, brand, legal). Shown when the admin can open at least
                  one of its screens, and it opens on the first one they may --
                  an owner lands on Master Settings, a sub-admin with only the
                  subadmins permission lands on Admin Accounts instead of a
                  screen that would refuse them. */}
              {masterItems.length > 0 && (
              <button
                type="button"
                onClick={() => navigate(masterItems[0].path)}
                className={cn(
                  "flex-1 min-w-0 flex flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] leading-none font-bold rounded-lg transition-all duration-300",
                  location.pathname.startsWith("/admin/master")
                    ? "bg-[var(--sb-active-bg)] text-[var(--sb-active-ink)] shadow-[0_2px_8px_rgba(26,26,26,0.18)]"
                    : "text-[var(--sb-ink-faint)] hover:text-[var(--sb-ink-soft)] hover:bg-[var(--sb-hover)]"
                )}
              >
                <SlidersHorizontal
                  className={cn(
                    "w-3.5 h-3.5",
                    location.pathname.startsWith("/admin/master")
                      ? "text-[var(--sb-active-ink)]"
                      : "text-[var(--sb-ink-faint)]"
                  )}
                />
                Master
              </button>
              )}
              {serviceAccess.food && (
              <button
                type="button"
                onClick={() => navigate("/admin/food")}
                className={cn(
                  "flex-1 min-w-0 flex flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] leading-none font-bold rounded-lg transition-all duration-300",
                  location.pathname.includes("/admin/food") || location.pathname === "/admin" || location.pathname === "/admin/"
                    ? "bg-[var(--sb-active-bg)] text-[var(--sb-active-ink)] shadow-[0_2px_8px_rgba(26,26,26,0.18)]"
                    : "text-[var(--sb-ink-faint)] hover:text-[var(--sb-ink-soft)] hover:bg-[var(--sb-hover)]"
                )}
              >
                <UtensilsCrossed
                  className={cn(
                    "w-3.5 h-3.5",
                    location.pathname.includes("/admin/food") || location.pathname === "/admin" || location.pathname === "/admin/"
                      ? "text-[var(--sb-active-ink)]"
                      : "text-[var(--sb-ink-faint)]"
                  )}
                />
                Food
              </button>
              )}
              {serviceAccess.taxi && (
              <button
                type="button"
                onClick={() => navigate("/taxi/admin/dashboard")}
                className={cn(
                  "flex-1 min-w-0 flex flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] leading-none font-bold rounded-lg transition-all duration-300",
                  location.pathname.startsWith("/taxi")
                    ? "bg-[var(--sb-active-bg)] text-[var(--sb-active-ink)] shadow-[0_2px_8px_rgba(26,26,26,0.18)]"
                    : "text-[var(--sb-ink-faint)] hover:text-[var(--sb-ink-soft)] hover:bg-[var(--sb-hover)]"
                )}
              >
                <Truck
                  className={cn(
                    "w-3.5 h-3.5",
                    location.pathname.startsWith("/taxi") ? "text-[var(--sb-active-ink)]" : "text-[var(--sb-ink-faint)]"
                  )}
                />
                Taxi
              </button>
              )}
              {/* SERVICE PROVIDER TAB -- per site (config/features.js). The flag
                  also gates the /admin/sp route, so the two stay together. */}
              {serviceAccess.serviceProvider && (
              <button
                type="button"
                onClick={() => navigate("/admin/sp/dashboard")}
                className={cn(
                  "flex-1 min-w-0 flex flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] leading-none font-bold rounded-lg transition-all duration-300",
                  location.pathname.startsWith("/admin/sp")
                    ? "bg-[var(--sb-active-bg)] text-[var(--sb-active-ink)] shadow-[0_2px_8px_rgba(26,26,26,0.18)]"
                    : "text-[var(--sb-ink-faint)] hover:text-[var(--sb-ink-soft)] hover:bg-[var(--sb-hover)]"
                )}
              >
                <Wrench
                  className={cn(
                    "w-3.5 h-3.5",
                    location.pathname.startsWith("/admin/sp") ? "text-[var(--sb-active-ink)]" : "text-[var(--sb-ink-faint)]"
                  )}
                />
                Services
              </button>
              )}
              {serviceAccess.quickCommerce && (
              <button
                type="button"
                onClick={() => navigate("/admin/quick-commerce")}
                className={cn(
                  "flex-1 min-w-0 flex flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] leading-none font-bold rounded-lg transition-all duration-300",
                  location.pathname.startsWith("/admin/quick-commerce")
                    ? "bg-[var(--sb-active-bg)] text-[var(--sb-active-ink)] shadow-[0_2px_8px_rgba(26,26,26,0.18)]"
                    : "text-[var(--sb-ink-faint)] hover:text-[var(--sb-ink-soft)] hover:bg-[var(--sb-hover)]"
                )}
              >
                <ShoppingBasket
                  className={cn(
                    "w-3.5 h-3.5",
                    location.pathname.startsWith("/admin/quick-commerce") ? "text-[var(--sb-active-ink)]" : "text-[var(--sb-ink-faint)]"
                  )}
                />
                Quick
              </button>
              )}
              {/* Medical: the quick-commerce panel narrowed to pharmacies. Its own
                  switch in admin accounts, so a pharmacy team need not see groceries. */}
              {serviceAccess.medical && (
              <button
                type="button"
                onClick={() => navigate("/admin/medical")}
                className={cn(
                  "flex-1 min-w-0 flex flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] leading-none font-bold rounded-lg transition-all duration-300",
                  location.pathname.startsWith("/admin/medical")
                    ? "bg-[var(--sb-active-bg)] text-[var(--sb-active-ink)] shadow-[0_2px_8px_rgba(26,26,26,0.18)]"
                    : "text-[var(--sb-ink-faint)] hover:text-[var(--sb-ink-soft)] hover:bg-[var(--sb-hover)]"
                )}
              >
                <Pill
                  className={cn(
                    "w-3.5 h-3.5",
                    location.pathname.startsWith("/admin/medical") ? "text-[var(--sb-active-ink)]" : "text-[var(--sb-ink-faint)]"
                  )}
                />
                Medical
              </button>
              )}
            </div>
          )}

          {/* Search Bar */}
          {!isCollapsed && (
            <div className="relative animate-[slideIn_0.4s_ease-out_0.2s_both]">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--sb-ink-faint)] w-4 h-4 z-10 transition-colors duration-200" />
              <Input
                type="text"
                placeholder="Search Menu..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={cn(
                  "w-full pl-9 py-2 bg-[var(--sb-surface-raised)] border border-[var(--sb-border)] rounded-lg text-sm text-[var(--sb-ink)] placeholder:text-[var(--sb-ink-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--sb-ink)] focus:border-[var(--sb-ink)] transition-all duration-200 text-left",
                  searchQuery ? "pr-9" : "pr-3"
                )}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-[var(--sb-ink-faint)] hover:text-[var(--sb-ink)] transition-all duration-200 hover:scale-110 z-10"
                  aria-label="Clear search"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Navigation Menu */}
        <nav className="admin-sidebar-scroll flex-1 min-h-0 overflow-y-auto overscroll-y-contain px-3 py-3 space-y-2">
          {filteredMenuData.length === 0 && searchQuery.trim() ? (
            <div className="px-3 py-12 text-left animate-[fadeIn_0.4s_ease-out]">
              <p className="text-[var(--sb-ink-soft)] text-sm font-medium text-left">No menu items found</p>
              <p className="text-[var(--sb-ink-faint)] text-sm mt-2 text-left">Try a different search term</p>
            </div>
          ) : (
            filteredMenuData.map((item, index) => {
              if (item.type === "link") {
                return renderMenuItem(item, index)
              }

              if (item.type === "section") {
                return (
                  <div
                    key={index}
                    className={cn(
                      index > 0 ? "mt-4 pt-4 border-t border-[var(--sb-border)]" : "",
                      "animate-[fadeIn_0.4s_ease-out]"
                    )}
                    style={{ animationDelay: `${index * 0.1}s` }}
                  >
                    {!isCollapsed && (
                      <div className="px-3 py-2 mb-2">
                        <span className="text-[var(--sb-ink-faint)] font-bold text-sm uppercase tracking-wider text-left">
                          {item.label}
                        </span>
                      </div>
                    )}
                    <div className="space-y-1">
                      {item.items.map((subItem, subIndex) => renderMenuItem(subItem, `${index}-${subIndex}`, true))}
                    </div>
                  </div>
                )
              }

              return null
            })
          )}
        </nav>
      </div>
    </>
  )
}
