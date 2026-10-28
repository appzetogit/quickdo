import { useNavigate, useLocation } from "react-router-dom"
import { useMemo } from "react"
import { motion } from "framer-motion"
import {
  FileText,
  Package,
  Wallet,
  Compass,
} from "lucide-react"

const getOrdersTabs = (basePath = "/restaurant") => [
  { id: "orders", label: "Orders", icon: FileText, route: `${basePath}` },
  { id: "inventory", label: "Inventory", icon: Package, route: `${basePath}/inventory` },
  { id: "payouts", label: "Payouts", icon: Wallet, route: `${basePath}/hub-finance` },
  { id: "explore", label: "Explore", icon: Compass, route: `${basePath}/explore` },
]

const findActiveTab = (tabs, pathname) =>
  tabs
    .slice()
    .sort((a, b) => b.route.length - a.route.length)
    .find((tab) => pathname === tab.route || pathname.startsWith(tab.route + "/"))

export default function BottomNavOrders() {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const basePath = pathname.startsWith("/food/restaurant")
    ? "/food/restaurant"
    : pathname.startsWith("/restaurant")
      ? "/food/restaurant"
      : "/restaurant"

  const tabs = useMemo(() => getOrdersTabs(basePath), [basePath])

  const isInternalPage = pathname.includes("/create-offers")
  if (isInternalPage) {
    return null
  }

  const activeTab = useMemo(() => {
    const match = findActiveTab(tabs, pathname)
    return match?.id || "orders"
  }, [tabs, pathname])

  const handleTabClick = (tab) => {
    if (tab.route && tab.route !== pathname) {
      navigate(tab.route)
    }
  }

  return (
    <div className="lg:hidden fixed bottom-0 left-0 right-0 w-full z-[60] select-none">
      <div className="flex items-center justify-around h-16 bg-gray-950 dark:bg-zinc-950 border-t border-zinc-800 shadow-[0_-8px_30px_rgba(0,0,0,0.35)] px-2 py-1">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id

          return (
            <button
              key={tab.id}
              onClick={() => handleTabClick(tab)}
              aria-current={isActive ? "page" : undefined}
              className={`flex flex-1 flex-col items-center justify-center gap-1.5 py-1.5 transition-all duration-300 relative ${isActive
                  ? "text-[#ff6d00]"
                  : "text-zinc-500 hover:text-zinc-400"
                }`}
            >
              <div className="relative">
                <Icon
                  className={`h-5.5 w-5.5 transition-all duration-300 ${isActive ? "text-[#ff6d00] scale-110" : "text-zinc-500"}`}
                />
              </div>
              <span
                className={`text-[10px] font-extrabold tracking-wide transition-all ${isActive ? "text-[#ff6d00]" : "text-zinc-500"}`}
              >
                {tab.label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
