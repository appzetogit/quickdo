import { Link, useLocation, useNavigate } from "react-router-dom"
import { Tag, User, Truck, UtensilsCrossed } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { useValueShelfCap, valueShelfName } from "@food/utils/valueShelf"

export default function BottomNavigation() {
  const location = useLocation()
  const navigate = useNavigate()
  const pathname = location.pathname
  // The shelf names itself after the price it runs at, which business can move
  // from the admin panel. Hardcoding "Switch 99" meant a shelf set to Rs 59
  // still called itself 99 in the one place every customer sees.
  const valueShelfCap = useValueShelfCap()

  // active routes
  const isDining = pathname === "/food/dining" || pathname.startsWith("/food/user/dining")
  const isUnder250 = pathname === "/food/under-250" || pathname.startsWith("/food/user/under-250")
  const isProfile = pathname.startsWith("/food/profile") || pathname.startsWith("/food/user/profile")
  const isDelivery =
    !isDining &&
    !isUnder250 &&
    !isProfile &&
    (pathname === "/food" ||
      pathname === "/food/" ||
      pathname === "/food/user" ||
      (pathname.startsWith("/food/user") &&
        !pathname.includes("/dining") &&
        !pathname.includes("/under-250") &&
        !pathname.includes("/profile")))

  const navItems = [
    { icon: Truck, label: "Delivery", path: "/food/user", isActive: isDelivery },
    { icon: UtensilsCrossed, label: "Dining", path: "/food/user/dining", isActive: isDining },
    { icon: Tag, label: valueShelfName(valueShelfCap), path: "/food/user/under-250", isActive: isUnder250, isValueShelf: true },
    { icon: User, label: "Profile", path: "/food/user/profile", isActive: isProfile },
  ]

  return (
    // Floating nav — matches taxi design
    <div className="md:hidden fixed bottom-0 left-0 right-0 max-w-lg mx-auto z-[100] px-6 pb-6 pt-2 pointer-events-none">
      <div className="flex items-center justify-around bg-white rounded-[32px] shadow-[0_12px_40px_rgba(0,0,0,0.15)] border border-gray-100 px-5 py-2 pointer-events-auto relative">
        {navItems.map(({ icon: Icon, label, path, isActive, isValueShelf }) => (
          <button
            key={label}
            type="button"
            onClick={() => navigate(path)}
            className="flex-1 flex flex-col items-center justify-center py-1.5 relative z-10 outline-none group"
          >
            <div className="relative flex flex-col items-center">
              {/* Active sliding background pill — same spring as taxi */}
              <AnimatePresence>
                {isActive && (
                  <motion.div
                    layoutId="food-active-pill"
                    transition={{
                      type: "spring",
                      stiffness: 400,
                      damping: 32,
                      mass: 1,
                    }}
                    className={`absolute -inset-y-1.5 bg-[#ff3d00] rounded-[18px] shadow-[0_8px_20px_rgba(255,61,0,0.35)] ${isValueShelf ? "-inset-x-2.5" : "-inset-x-3.5"
                      }`}
                  />
                )}
              </AnimatePresence>

              {/* Icon with spring scale */}
              <motion.div
                animate={{
                  scale: isActive ? 1.15 : 1,
                  y: isActive ? -1 : 0,
                }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
                className="relative z-20"
              >
                <Icon
                  size={20}
                  strokeWidth={isActive ? 2.5 : 2}
                  className={`transition-colors duration-300 ${isActive ? "text-white" : "text-slate-400 group-hover:text-slate-600"
                    }`}
                />
              </motion.div>

              {/* Label */}
              <motion.span
                animate={{
                  opacity: isActive ? 1 : 0.5,
                  y: isActive ? 2 : 1,
                  scale: isActive ? 1 : 0.95,
                }}
                transition={{ duration: 0.2 }}
                className={`relative z-20 text-[9px] font-black uppercase tracking-[0.12em] mt-1 transition-colors duration-300 ${isActive ? "text-white" : "text-slate-505"
                  }`}
                style={{ fontFamily: "'Outfit', sans-serif" }}
              >
                {label}
              </motion.span>

              {/* Subtle glow for active tab */}
              {isActive && (
                <motion.div
                  layoutId="food-active-glow"
                  transition={{ type: "spring", stiffness: 400, damping: 32 }}
                  className="absolute -bottom-2 w-4 h-1 bg-white/20 rounded-full blur-[2px]"
                />
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
