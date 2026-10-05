import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Home, Clock, Map, User, BusFront } from 'lucide-react';
import { useSettings } from '../../../shared/context/SettingsContext';

const BottomNavbar = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { settings } = useSettings();
  const showBusService = String(settings.transportRide?.enable_bus_service || '0') === '1';

  const navItems = [
    { icon: Home, label: 'Ride', path: '/taxi/user' },
    { icon: Clock, label: 'Rides', path: '/taxi/user/activity' },
    ...(showBusService ? [{ icon: BusFront, label: 'Bus', path: '/taxi/user/bus' }] : []),
    { icon: Map, label: 'Support', path: '/taxi/user/support' },
    { icon: User, label: 'Profile', path: '/taxi/user/profile' },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto z-[100] px-6 pb-6 pt-2 pointer-events-none">
      <div className="flex items-center justify-around bg-white/70 backdrop-blur-2xl border border-white/40 rounded-[32px] shadow-[0_20px_40px_rgba(0,0,0,0.12)] px-5 py-2 pointer-events-auto relative">
        {navItems.map(({ icon: Icon, label, path }) => {
          const isActive =
            path === '/taxi/user'
              ? pathname === path
              : pathname === path || pathname.startsWith(`${path}/`);

          return (
            <button
              key={label}
              type="button"
              onClick={() => navigate(path)}
              className="flex-1 flex flex-col items-center justify-center py-1.5 relative z-10 outline-none tap-highlight-transparent group"
            >
              <div className="relative flex flex-col items-center">
                {/* Active Sliding Background Pill */}
                <AnimatePresence>
                  {isActive && (
                    <motion.div
                      layoutId="active-pill"
                      transition={{
                        type: 'spring',
                        stiffness: 400,
                        damping: 32,
                        mass: 1
                      }}
                      className="absolute -inset-y-1.5 -inset-x-3 bg-slate-900 rounded-[18px] shadow-[0_8px_20px_rgba(15,23,42,0.25)]"
                    />
                  )}
                </AnimatePresence>
 
                {/* Icon Container with Transition */}
                <motion.div
                  animate={{ 
                    scale: isActive ? 1.15 : 1,
                    y: isActive ? -1 : 0
                  }}
                  transition={{
                    type: 'spring',
                    stiffness: 400,
                    damping: 30
                  }}
                  className="relative z-20"
                >
                  <Icon
                    size={20}
                    strokeWidth={isActive ? 2.5 : 2}
                    className={`transition-colors duration-300 ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-600'}`}
                  />
                </motion.div>
 
                {/* Label with Transition */}
                <motion.span 
                  animate={{ 
                    opacity: isActive ? 1 : 0.5,
                    y: isActive ? 2 : 1,
                    scale: isActive ? 1 : 0.95
                  }}
                  transition={{
                    duration: 0.2
                  }}
                  className={`relative z-20 text-[9px] font-black uppercase tracking-[0.12em] font-['Outfit'] mt-1 transition-colors duration-300 ${
                    isActive ? 'text-white' : 'text-slate-500'
                  }`}
                >
                  {label}
                </motion.span>
                
                {/* Subtle Bottom Glow for Active Tab */}
                {isActive && (
                  <motion.div
                    layoutId="active-glow"
                    transition={{
                      type: 'spring',
                      stiffness: 400,
                      damping: 32
                    }}
                    className="absolute -bottom-2 w-4 h-1 bg-white/20 rounded-full blur-[2px]"
                  />
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default BottomNavbar;
