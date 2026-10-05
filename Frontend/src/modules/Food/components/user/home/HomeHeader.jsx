import { useState, useEffect, useMemo } from 'react';

import { Link, useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, ChevronDown, Search, Mic, Bell, CheckCircle2, Tag, Gift, AlertCircle, Clock, BellOff, X, ChevronRight, ShoppingBag, Sparkles, Utensils, Car, Menu, User } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@food/components/ui/popover";
import { Badge } from "@food/components/ui/badge";
import { Avatar, AvatarFallback } from "@food/components/ui/avatar";
import foodIcon from "@food/assets/category-icons/food.png.png";
import taxiIcon from "@food/assets/category-icons/taxi.png.png";
import quickIcon from "@food/assets/category-icons/quick.png";
import hotelIcon from "@food/assets/category-icons/hotel.png";
import burgerAvatar from "@food/assets/burger_avatar.png";
import dalTadka from "@food/assets/menu-items/dal_tadka_1771226053751.png";
import vegSpringRoll from "@food/assets/menu-items/veg_spring_roll_1771226110508.png";
import vegChowmein from "@food/assets/menu-items/veg_chowmein_noodles_1771226095511.png";
import rotiFlatbread from "@food/assets/menu-items/roti_flatbread_1771226034716.png";
import steamedRice from "@food/assets/menu-items/steamed_rice_1771226079364.png";
import useNotificationInbox from "@food/hooks/useNotificationInbox";

const ICON_MAP = {
  CheckCircle2,
  Tag,
  Gift,
  AlertCircle
};

const DIAL_ITEMS = [
  { id: 1, name: "Dal Tadka", image: dalTadka },
  { id: 2, name: "Spring Roll", image: vegSpringRoll },
  { id: 3, name: "Chowmein", image: vegChowmein },
  { id: 4, name: "Roti", image: rotiFlatbread },
  { id: 5, name: "Steamed Rice", image: steamedRice },
  { id: 6, name: "Cheese Burger", image: burgerAvatar },
  { id: 7, name: "Special Meal", image: foodIcon },
];



export default function HomeHeader({
  activeTab,
  setActiveTab,
  location,
  savedAddressText,
  handleLocationClick,
  handleSearchFocus,
  placeholderIndex,
  placeholders,
  handleVegModeChange,
  isVegMode,
  vegModeToggleRef,
  isCategoryStuck = false,
}) {
  const navigate = useNavigate();
  const routeLocation = useLocation();

  const isTaxi = routeLocation.pathname.includes('/taxi');
  const theme = {
    activeBg: isTaxi ? 'bg-[#2563eb]' : 'bg-[#d82c23]',
    activeHex: isTaxi ? '#2563eb' : '#d82c23',
    inactiveHex: isTaxi ? '#09101d' : '#6e0d09',
    containerHex: isTaxi ? '#0b1528' : '#9c1c16',
  };

  const [dialIndex, setDialIndex] = useState(0);

  useEffect(() => {
    if (isTaxi) return;
    const interval = setInterval(() => {
      setDialIndex((prev) => (prev + 1) % DIAL_ITEMS.length);
    }, 3500); // Orbit every 3.5 seconds
    return () => clearInterval(interval);
  }, [isTaxi]);

  const handleDialPanEnd = (event, info) => {
    if (info.offset.y < -30) {
      setDialIndex((prev) => (prev + 1) % DIAL_ITEMS.length);
    } else if (info.offset.y > 30) {
      setDialIndex((prev) => (prev - 1 + DIAL_ITEMS.length) % DIAL_ITEMS.length);
    }
  };

  const handleDialWheel = (event) => {
    if (Math.abs(event.deltaY) > 10) {
      if (event.deltaY > 0) {
        setDialIndex((prev) => (prev + 1) % DIAL_ITEMS.length);
      } else {
        setDialIndex((prev) => (prev - 1 + DIAL_ITEMS.length) % DIAL_ITEMS.length);
      }
    }
  };

  const [notifications, setNotifications] = useState(() => {
    const saved = localStorage.getItem('food_user_notifications');
    return saved ? JSON.parse(saved) : [];
  });
  const {
    items: broadcastNotifications,
    unreadCount: broadcastUnreadCount,
    dismiss: dismissBroadcastNotification,
  } = useNotificationInbox("user", { limit: 20 });

  useEffect(() => {
    const syncNotifications = () => {
      const saved = localStorage.getItem('food_user_notifications');
      setNotifications(saved ? JSON.parse(saved) : []);
    };

    // Listen for updates from the main Notifications page
    window.addEventListener('notificationsUpdated', syncNotifications);
    // Also listen for new notifications being added via listeners in Notifications.jsx (indirectly via localStorage update)
    // But since localStorage doesn't fire events on same window, we can use a custom event or a simple interval if needed.
    // However, the Notifications.jsx already multi-dispatches.

    return () => window.removeEventListener('notificationsUpdated', syncNotifications);
  }, []);

  const festCategories = [
    { id: "food", name: "Food", icon: foodIcon, bgColor: "bg-white dark:bg-[#1a1a1a]" },
    { id: "quick", name: "Quick", icon: quickIcon, bgColor: "bg-white dark:bg-[#1a1a1a]" },
    { id: "taxi", name: "Taxi", icon: taxiIcon, bgColor: "bg-white dark:bg-[#1a1a1a]" },
    { id: "hotel", name: "Hotel", icon: hotelIcon, bgColor: "bg-white dark:bg-[#1a1a1a]" },
  ];

  const mergedNotifications = useMemo(() => {
    const localItems = Array.isArray(notifications)
      ? notifications.map((item) => ({ ...item, source: "local" }))
      : [];
    const broadcastItems = (broadcastNotifications || []).map((item) => ({
      ...item,
      source: "broadcast",
      time: item.createdAt
        ? new Date(item.createdAt).toLocaleString("en-IN", {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        })
        : "Just now",
      type: "broadcast",
      icon: "Bell",
      iconColor: "text-blue-600",
    }));

    return [...broadcastItems, ...localItems].sort(
      (a, b) =>
        new Date(b.createdAt || b.timestamp || 0).getTime() -
        new Date(a.createdAt || a.timestamp || 0).getTime()
    );
  }, [broadcastNotifications, notifications]);

  const unreadCount = notifications.filter(n => !n.read).length + broadcastUnreadCount;

  const handleDeleteNotification = (id, source = "local") => {
    if (source === "broadcast") {
      dismissBroadcastNotification(id);
      return;
    }
    setNotifications((prev) => {
      const next = prev.filter((notification) => notification.id !== id);
      localStorage.setItem('food_user_notifications', JSON.stringify(next));
      window.dispatchEvent(new CustomEvent('notificationsUpdated', { detail: { count: next.filter((n) => !n.read).length } }));
      return next;
    });
  };

  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 95);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);


  return (
    <div className="contents">
      <div className="contents" style={{ fontFamily: "'Sora', sans-serif" }}>
        
        {/* 1. Top Navigation Bar */}
        <motion.div 
          className="flex items-center justify-between px-5 pt-6 pb-5 bg-gradient-to-r from-[#d82c23] to-[#ff6d00] rounded-b-[24px] shadow-[0_10px_20px_rgba(216,44,35,0.15)] relative z-50 w-full max-w-2xl mx-auto"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* Left: Location Icon */}
          <div 
            className="bg-white p-2.5 rounded-[14px] border border-gray-100 shadow-[0_4px_12px_rgba(0,0,0,0.04)] cursor-pointer hover:bg-gray-50 active:scale-95 transition-all flex items-center justify-center"
            onClick={handleLocationClick}
          >
            <MapPin className={`h-5 w-5 ${isTaxi ? 'text-blue-600' : 'text-[#d82c23]'}`} />
          </div>

          {/* Center: Service Tabs (acting as logo) */}
          <div className="flex bg-gray-100/80 p-1 rounded-2xl shadow-inner">
            <button
              onClick={() => navigate('/food/user')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all duration-300 ${
                routeLocation.pathname.includes('/food')
                  ? 'bg-white shadow-sm text-[#d82c23]'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <img src={foodIcon} alt="Food" className="w-4 h-4 object-contain" />
              <span className="font-extrabold text-[11px] tracking-wide">Food</span>
            </button>
            <button
              onClick={() => navigate('/taxi/user')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all duration-300 ${
                routeLocation.pathname.includes('/taxi')
                  ? 'bg-white shadow-sm text-[#2563eb]'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <img src={taxiIcon} alt="Rides" className="w-5 h-5 object-contain -ml-0.5" />
              <span className="font-extrabold text-[11px] tracking-wide">Rides</span>
            </button>
          </div>

          {/* Right: Notifications & Profile/Veg */}
          <div className="flex items-center gap-3">
            <Popover>
              <PopoverTrigger asChild>
                <div className="relative bg-white p-2.5 rounded-[14px] border border-gray-100 shadow-[0_4px_12px_rgba(0,0,0,0.04)] cursor-pointer hover:bg-gray-50 active:scale-95 transition-all">
                  <Bell className="h-5 w-5 text-gray-700" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white animate-pulse" />
                  )}
                </div>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-0 overflow-hidden border-none shadow-2xl rounded-2xl mt-2" align="end">
                <div className="bg-white dark:bg-gray-900">
                  <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-gray-50/50 dark:bg-gray-800/50">
                    <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                      Notifications
                      {unreadCount > 0 && (
                        <Badge variant="secondary" className="bg-primary-orange/10 text-accent-orange border-none text-[10px] h-4">
                          {unreadCount} New
                        </Badge>
                      )}
                    </h3>
                    <Link to="/food/user/notifications" className="text-xs font-bold text-accent-orange hover:text-accent-orange/90">
                      {mergedNotifications.length > 0 ? "View All" : ""}
                    </Link>
                  </div>
                  <div className="max-h-96 overflow-y-auto">
                    {mergedNotifications.length > 0 ? (
                      mergedNotifications.slice(0, 5).map((notif) => {
                        const Icon = ICON_MAP[notif.icon] || Bell;
                        return (
                          <div
                            key={notif.id}
                            className={`p-4 flex items-start gap-3 border-b border-gray-50 dark:border-gray-800 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer ${!notif.read ? 'bg-primary-orange/5/20' : ''}`}
                          >
                            <div className={`mt-1 p-2 rounded-full ${notif.type === "order" ? "bg-green-100/50 text-green-600" : "bg-primary-orange/10/50 text-accent-orange"}`}>
                              <Icon className="h-4 w-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2 mb-0.5">
                                <span className="text-sm font-bold text-gray-900 dark:text-white truncate">{notif.title}</span>
                                <div className="flex items-center gap-1">
                                  <span className="text-[10px] text-gray-400 whitespace-nowrap">{notif.time}</span>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      handleDeleteNotification(notif.id, notif.source);
                                    }}
                                    className="rounded-full p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </div>
                              <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 leading-relaxed">
                                {notif.message}
                              </p>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="p-8 text-center flex flex-col items-center gap-2">
                        <BellOff className="h-10 w-10 text-gray-200" />
                        <p className="text-xs text-gray-400 font-medium">All caught up!</p>
                      </div>
                    )}
                  </div>
                  <div className="p-3 bg-gray-50/50 dark:bg-gray-800/50 text-center">
                    <Link to="/food/user/notifications" className="text-xs font-bold text-gray-400 hover:text-gray-600">
                      {mergedNotifications.length > 0 ? "Manage Settings" : "Check Notifications Page"}
                    </Link>
                  </div>
                </div>
              </PopoverContent>
            </Popover>

            {/* User Profile */}
            <div className="relative group">
              <Link to="/food/user/profile">
                <div className="bg-gradient-to-br from-[#fde68a] to-[#f59e0b] p-[2px] rounded-full border border-gray-100 shadow-[0_4px_12px_rgba(0,0,0,0.05)] cursor-pointer active:scale-95 transition-transform hover:shadow-md">
                  <Avatar className="h-9 w-9 bg-white border-2 border-white">
                    <AvatarFallback className="bg-transparent text-amber-700 font-bold"><User size={20} /></AvatarFallback>
                  </Avatar>
                </div>
              </Link>
            </div>
          </div>
        </motion.div>

        {/* 3. Sticky Smart Search Bar & Veg Toggle */}
        <div
          className={`sticky top-[0px] z-[70] w-full max-w-2xl mx-auto transition-all duration-500 px-5 pb-4 pt-3 flex items-center gap-3 ${
            isScrolled 
              ? 'bg-white/95 backdrop-blur-xl shadow-[0_4px_20px_rgba(0,0,0,0.03)] border-b border-gray-100' 
              : 'border-transparent'
          }`}
        >
          <motion.div
            className={`flex-1 relative p-[1.5px] rounded-full cursor-pointer group transition-all duration-300 shadow-[0_2px_16px_rgba(0,0,0,0.04)] hover:shadow-[0_8px_24px_rgba(216,44,35,0.15)] bg-gradient-to-r from-[#d82c23] to-[#ff6d00]`}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
            onClick={handleSearchFocus}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleSearchFocus();
              }
            }}
          >
            <div className="flex items-center w-full h-full bg-white rounded-full p-1.5 pl-4 pr-2">
              <Search className={`h-[20px] w-[20px] mr-3 transition-colors duration-300 text-[#8c94a1] group-hover:text-[#ff6d00]`} strokeWidth={2.5} />
              
              <div className="flex-1 overflow-hidden relative h-6 flex items-center mt-0.5">
                <AnimatePresence mode="wait">
                  <motion.span
                    key={placeholderIndex}
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -20, opacity: 0 }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                    className="absolute inset-0 flex items-center text-[15px] font-semibold text-[#8c94a1] truncate tracking-wide group-hover:text-gray-700 transition-colors"
                  >
                    {placeholders?.[placeholderIndex] || 'Search "desserts"'}
                  </motion.span>
                </AnimatePresence>
              </div>
              
              <div className="w-[1px] h-6 bg-gray-100 mx-3"></div>
              
              <div className="p-2.5 rounded-full bg-[#f8f9fa] text-[#6b7280] group-hover:bg-gradient-to-br group-hover:from-orange-50 group-hover:to-red-50 group-hover:text-[#d82c23] transition-all flex items-center justify-center">
                <Mic className="h-[18px] w-[18px]" strokeWidth={2.5} />
              </div>
            </div>
          </motion.div>

          {/* Veg Mode Toggle (Moved next to search) */}
          <div 
            className="flex-shrink-0 bg-white h-[52px] w-[52px] rounded-[18px] shadow-[0_4px_12px_rgba(0,0,0,0.06)] border border-gray-100 cursor-pointer active:scale-95 transition-all hover:shadow-[0_8px_20px_rgba(0,0,0,0.1)] flex flex-col items-center justify-center gap-1"
            onClick={() => handleVegModeChange && handleVegModeChange(!isVegMode)}
            ref={vegModeToggleRef}
            title={isVegMode ? "Switch to All Food" : "Switch to Pure Veg"}
          >
            <div className={`w-5 h-5 rounded-[4px] border-[2px] flex items-center justify-center transition-colors ${isVegMode ? 'border-green-600 bg-green-50' : 'border-gray-400 bg-gray-50'}`}>
               <div className={`w-2.5 h-2.5 rounded-full transition-colors ${isVegMode ? 'bg-green-600' : 'bg-gray-400'}`} />
            </div>
            <span className={`text-[9px] font-extrabold uppercase tracking-wider ${isVegMode ? 'text-green-700' : 'text-gray-500'}`}>Veg</span>
          </div>
        </div>

        {/* 2. Hero Greeting Banner (The large colorful card matching screenshot) */}
        <motion.div 
          className="px-5 pt-3 pb-2 w-full max-w-2xl mx-auto z-20 relative"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1, ease: 'easeOut' }}
        >
          <div className={`relative w-full rounded-[28px] overflow-hidden shadow-[0_20px_40px_rgba(216,44,35,0.15)] bg-gradient-to-br ${isTaxi ? 'from-[#2563eb] via-[#1d4ed8] to-[#1e3a8a]' : 'from-[#d82c23] via-[#b3241d] to-[#7f1a14]'} p-6 flex items-center min-h-[190px]`}>
            {/* Background embellishments */}
            <div className="absolute inset-0 opacity-[0.15] mix-blend-overlay bg-[url('https://www.transparenttextures.com/patterns/stardust.png')]"></div>
            <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-2xl"></div>
            <div className="absolute bottom-0 left-10 w-32 h-32 bg-black/10 rounded-full blur-xl"></div>
            
            <div className="flex justify-between items-center w-full relative z-10 h-full">
              {/* Left Column (Greeting & Action Card) */}
              <div className="flex flex-col items-start w-[65%] justify-center h-full pt-1">
                <span className="text-[#fde68a] text-[13px] font-bold tracking-wide mb-0.5 drop-shadow-sm">
                  Welcome back,
                </span>
                <h1 className="text-[34px] font-black text-white tracking-tight leading-none mb-1.5 drop-shadow-md">
                  {isTaxi ? 'Rider!' : 'Foodie!'}
                </h1>
                <p className="text-white/90 text-[12px] font-medium leading-snug mb-3.5 max-w-[90%]">
                  {isTaxi ? "Let's find you a quick and safe ride today." : "Let's find something delicious for you today."}
                </p>
                
                {/* Horizontal rule (like screenshot) */}
                <div className="w-8 h-1 bg-[#fde68a] rounded-full mb-4 shadow-sm"></div>

                {/* Removed Location Action Card (Moved to top nav) */}
              </div>

              {/* Right Column (The Dial Design) */}
              <div className="absolute right-0 top-0 bottom-0 w-[200px] pointer-events-none z-20">
                {isTaxi ? (
                  <div className="absolute -right-4 top-1/2 -translate-y-1/2 w-[150px] h-[150px]">
                    <motion.img 
                      src={taxiIcon} 
                      alt="Hero Graphic" 
                      className="w-full h-full object-contain scale-[1.2] drop-shadow-[0_20px_30px_rgba(0,0,0,0.5)]"
                      animate={{ y: [0, -10, 0], rotate: [0, 2, -2, 0] }}
                      transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                    />
                  </div>
                ) : (
                  <div className="absolute top-1/2 -translate-y-1/2 -right-[120px] w-[260px] h-[260px] pointer-events-auto">
                    {/* White Semi-Circle Background */}
                    <div className="absolute inset-0 bg-white rounded-full shadow-[-10px_0_30px_rgba(0,0,0,0.1)] border border-gray-100"></div>
                    
                    {/* Red Inner Circle */}
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[130px] h-[130px] bg-gradient-to-br from-[#d82c23] to-[#9f1239] rounded-full shadow-inner flex flex-col items-start justify-center border-[6px] border-white ml-2 pointer-events-none pl-5">
                      <span className="text-white/90 font-bold text-[9px] uppercase tracking-wider mb-0.5">Cravings??</span>
                      <span className="text-white font-black text-[12px] leading-[1.1] drop-shadow-md tracking-tight">
                        Grab your<br/>fav food
                      </span>
                    </div>

                    {/* Rotating Track */}
                    <motion.div 
                      className="absolute inset-0 cursor-grab active:cursor-grabbing z-10"
                      animate={{ rotate: -(dialIndex * (360 / DIAL_ITEMS.length)) }}
                      transition={{ type: "spring", stiffness: 200, damping: 25 }}
                      drag="y"
                      dragConstraints={{ top: 0, bottom: 0 }}
                      onPanEnd={handleDialPanEnd}
                      onWheel={handleDialWheel}
                    >
                      {DIAL_ITEMS.map((item, i) => {
                        const angle = i * (360 / DIAL_ITEMS.length);
                        const isActive = i === dialIndex;
                        return (
                          <motion.div 
                            key={item.id}
                            className="absolute top-1/2 left-1/2"
                            style={{ rotate: angle }}
                          >
                            <motion.div 
                              className={`absolute rounded-full shadow-lg bg-white overflow-hidden border-2 border-white cursor-pointer`}
                              style={{ x: -125, y: "-50%", left: "-50%" }}
                              animate={{
                                width: isActive ? 85 : 65,
                                height: isActive ? 85 : 65,
                                zIndex: isActive ? 10 : 0,
                                borderWidth: isActive ? 3 : 2
                              }}
                              onMouseEnter={() => setDialIndex(i)}
                              onClick={() => setDialIndex(i)}
                            >
                               <motion.div 
                                  className="w-full h-full pointer-events-none"
                                  animate={{ rotate: -(angle - (dialIndex * (360 / DIAL_ITEMS.length))) }}
                                  transition={{ type: "spring", stiffness: 200, damping: 25 }}
                               >
                                  <img src={item.image} className="w-full h-full object-cover scale-110" alt={item.name} />
                               </motion.div>
                            </motion.div>
                          </motion.div>
                        );
                      })}
                    </motion.div>

                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>

        {/* Search bar was moved from here */}


      </div>
    </div>
  );
}
