import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import {
  FiHome,
  FiUsers,
  FiShoppingBag,
  FiSettings,
} from "react-icons/fi";

const AdminBottomNav = () => {
  const location = useLocation();

  const navItems = [
    { path: "/admin/sp/dashboard", icon: FiHome, label: "Home" },
    { path: "/admin/sp/users", icon: FiUsers, label: "Users" },
    { path: "/admin/sp/bookings", icon: FiShoppingBag, label: "Bookings" },
    { path: "/admin/sp/settings", icon: FiSettings, label: "Settings" },
  ];

  const isActive = (path) => {
    if (path === "/admin/sp/dashboard") {
      return location.pathname === "/admin/sp/dashboard";
    }
    return location.pathname.startsWith(path);
  };

  // Animation variants for icon
  const iconVariants = {
    inactive: {
      scale: 1,
      color: "#878787",
    },
    active: {
      scale: 1.1,
      color: "#2874F0", // Primary color
      transition: {
        duration: 0.3,
        ease: "easeOut",
      },
    },
  };

  const navContent = (
    <nav 
      className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-[9999] shadow-[0_-2px_10px_rgba(0,0,0,0.05)] lg:hidden"
      style={{
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      <div className="flex items-center justify-around h-16 px-1" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.path);

          return (
            <Link
              key={item.path}
              to={item.path}
              className="flex flex-col items-center justify-center flex-1 h-full gap-1">
              <motion.div
                className={`relative flex items-center justify-center ${
                  active ? "text-[#2874F0]" : "text-[#878787]"
                }`}
                variants={iconVariants}
                initial="inactive"
                animate={active ? "active" : "inactive"}>
                <Icon
                  className="text-2xl"
                  style={{
                    fill: "none",
                    stroke: "currentColor",
                    strokeWidth: 2,
                  }}
                />
              </motion.div>
              <span
                className={`text-xs font-medium ${
                  active ? "text-primary-600" : "text-gray-500"
                }`}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );

  // Use portal to render outside of transformed containers
  return createPortal(navContent, document.body);
};

export default AdminBottomNav;


