import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { MapPin, Search, Wallet, Utensils, Car, Bell } from 'lucide-react';
import { DEFAULT_LOCATION_LABEL, getSavedLocationLabel, LOCATION_UPDATED_EVENT } from '../services/locationStore';
import foodIcon from '@food/assets/category-icons/food.png.png';
import taxiIcon from '@food/assets/category-icons/taxi.png.png';
import { useSettings } from '../../../shared/context/SettingsContext';

const HeaderGreeting = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { settings, activeLogo } = useSettings();
  const appLogo = activeLogo || settings.general?.logo || settings.customization?.logo || '';
  const appName = settings.general?.app_name || 'App';
  const [locationLabel, setLocationLabel] = useState(getSavedLocationLabel);
  const routePrefix = location.pathname.startsWith('/taxi/user') ? '/taxi/user' : '';
  const selectLocationPath = `${routePrefix}/ride/select-location`;
  const walletPath = `${routePrefix}/wallet`;
  const isTaxi = location.pathname.includes('/taxi');
  const theme = {
    activeBg: isTaxi ? 'bg-[#2563eb]' : 'bg-[#d82c23]',
    activeHex: isTaxi ? '#2563eb' : '#d82c23',
    inactiveHex: isTaxi ? '#0c1428' : '#6e0d09',
    containerHex: isTaxi ? '#111d3a' : '#9c1c16',
  };

  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 95);
    };
    window.addEventListener('scroll', handleScroll);

    const syncLocationLabel = () => {
      setLocationLabel(getSavedLocationLabel());
    };

    syncLocationLabel();
    window.addEventListener('storage', syncLocationLabel);
    window.addEventListener(LOCATION_UPDATED_EVENT, syncLocationLabel);

    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('storage', syncLocationLabel);
      window.removeEventListener(LOCATION_UPDATED_EVENT, syncLocationLabel);
    };
  }, []);

  return (
    <>
      <div 
        className="w-full pb-0 shadow-none overflow-visible"
        style={{ backgroundColor: theme.containerHex }}
      >
        {/* 1. Top Navigation Bar (Food App Style) */}
        <motion.div 
          className="flex items-center justify-between px-5 pt-6 pb-5 bg-gradient-to-r from-[#2563eb] to-[#3b82f6] rounded-b-[24px] shadow-[0_10px_20px_rgba(37,99,235,0.15)] relative z-50 w-full"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* Left: Location Icon */}
          <div 
            className="bg-white p-2.5 rounded-[14px] border border-gray-100 shadow-[0_4px_12px_rgba(0,0,0,0.04)] cursor-pointer hover:bg-gray-50 active:scale-95 transition-all flex items-center justify-center"
            onClick={() => navigate(selectLocationPath)}
          >
            <MapPin className="h-5 w-5 text-blue-600" />
          </div>

          {/* Center: Service Tabs (acting as logo) */}
          <div className="flex bg-white/20 backdrop-blur-md p-1 rounded-2xl shadow-inner border border-white/30">
            <button
              onClick={() => navigate('/food/user')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all duration-300 text-white/80 hover:text-white hover:bg-white/10`}
            >
              <img src={foodIcon} alt="Food" className="w-4 h-4 object-contain brightness-0 invert opacity-80" />
              <span className="font-extrabold text-[11px] tracking-wide">Food</span>
            </button>
            <button
              onClick={() => navigate('/taxi/user')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all duration-300 bg-white shadow-sm text-blue-600`}
            >
              <img src={taxiIcon} alt="Rides" className="w-5 h-5 object-contain -ml-0.5" />
              <span className="font-extrabold text-[11px] tracking-wide">Rides</span>
            </button>
          </div>

          {/* Right: Wallet */}
          <div className="flex items-center gap-3">
            <div 
              className="relative bg-white p-2.5 rounded-[14px] border border-gray-100 shadow-[0_4px_12px_rgba(0,0,0,0.04)] cursor-pointer hover:bg-gray-50 active:scale-95 transition-all"
              onClick={() => navigate(walletPath)}
            >
              <Wallet className="h-5 w-5 text-gray-700" />
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-white animate-pulse" />
            </div>
          </div>
        </motion.div>
      </div>

      {/* Search Bar (Sticky Viewport) */}
      <div 
        className={`sticky top-0 z-[70] transition-all duration-300 -mt-4 pt-4 pb-4 px-5 ${
          isScrolled 
            ? 'shadow-[0_4px_20px_rgba(0,0,0,0.15)] border-b border-transparent bg-[#111d3a]' 
            : 'border-b border-transparent bg-[#111d3a]'
        }`}
      >
        {/* Address text below navbar, mimicking food app */}
        <div className="flex flex-col mb-4">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/60 mb-0.5">Pickup Location</p>
          <div className="flex items-center gap-1">
            <h2 className="text-white text-base font-bold truncate max-w-[85%]">{locationLabel}</h2>
          </div>
        </div>

        <motion.button
          type="button"
          whileTap={{ scale: 0.99 }}
          onClick={() => navigate(selectLocationPath)}
          className="flex w-full items-center gap-2 rounded-[18px] border border-transparent bg-white px-3.5 py-3.5 text-left shadow-[0_8px_24px_rgba(0,0,0,0.12)] transition-all duration-300 hover:bg-gray-50"
        >
          <Search size={16} className="text-blue-600" strokeWidth={2.5} />
          <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-gray-500">
            Search destination
          </span>
          <span className="text-[10px] font-black uppercase tracking-[0.16em] bg-blue-50 text-blue-600 px-3 py-1 rounded-full">Go</span>
        </motion.button>
      </div>
    </>
  );
};

export default HeaderGreeting;
