import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  User, Wallet, Bell, Shield, LogOut, ChevronRight, HelpCircle, FileText,
  MapPin, Star, Package, Wrench, Gift, Trash2, Check, BusFront, 
  Settings, CreditCard, Heart, Map, MessageSquare, History, Phone
} from 'lucide-react';
import BottomNavbar from '../components/BottomNavbar';
import { clearLocalUserSession, getLocalUserToken, userAuthService } from '../services/authService';
import { clearCurrentRide } from '../services/currentRideService';
import { socketService } from '../../../shared/api/socket';
import api from '../../../shared/api/axiosInstance';

const MotionDiv = motion.div;
const MotionButton = motion.button;

const pickObject = (...values) => values.find((value) => value && typeof value === 'object' && !Array.isArray(value)) || {};

const pickNumber = (...values) => {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
};

const menuSections = [
  {
    title: 'Personal',
    items: [
      { icon: User, title: 'Profile Settings', sub: 'Manage your personal info', path: '/taxi/user/profile/settings', bg: 'bg-indigo-50', color: 'text-indigo-600' },
      { icon: MapPin, title: 'Saved Addresses', sub: 'Home, office & others', path: '/taxi/user/profile/addresses', bg: 'bg-emerald-50', color: 'text-emerald-600' },
      { icon: History, title: 'My Rides', sub: 'Rides, parcels & trips', path: '/taxi/user/activity', bg: 'bg-blue-50', color: 'text-blue-600' },
    ]
  },
  {
    title: 'Financial & Rewards',
    items: [
      { icon: Wallet, title: 'My Wallet', sub: 'Balance & transactions', path: '/taxi/user/wallet', bg: 'bg-amber-50', color: 'text-amber-600' },
      { icon: Package, title: 'Subscriptions', sub: 'Ride plans & credits', path: '/taxi/user/profile/subscriptions', bg: 'bg-indigo-50', color: 'text-indigo-600' },
      { icon: Gift, title: 'Refer & Earn', sub: 'Invite friends & get rewards', path: '/taxi/user/referral', bg: 'bg-rose-50', color: 'text-rose-600' },
      { icon: BusFront, title: 'Bus Tickets', sub: 'Manage bus bookings', path: '/taxi/user/profile/bus-bookings', bg: 'bg-primary-orange/5', color: 'text-accent-orange' },
    ]
  },
  {
    title: 'Preferences',
    items: [
      { icon: Bell, title: 'Notifications', sub: 'Offers & alerts', path: '/taxi/user/profile/notifications', bg: 'bg-purple-50', color: 'text-purple-600' },
      { icon: Shield, title: 'Women Safety Center', sub: 'SOS, Contacts, & Support', path: '/taxi/user/safety', bg: 'bg-emerald-50', color: 'text-emerald-600' },
      { icon: HelpCircle, title: 'Help & Support', sub: 'Help center & tickets', path: '/taxi/user/support/tickets', bg: 'bg-slate-50', color: 'text-slate-600' },
    ]
  },
  {
    title: 'Legal',
    items: [
      { icon: FileText, title: 'Terms & Conditions', sub: 'Read service terms', path: '/terms', bg: 'bg-primary-orange/5', color: 'text-accent-orange' },
      { icon: Shield, title: 'Privacy Policy', sub: 'How your data is handled', path: '/privacy', bg: 'bg-emerald-50', color: 'text-emerald-600' },
      { icon: CreditCard, title: 'Refund Policy', sub: 'Refunds and cancellations', path: '/refund', bg: 'bg-indigo-50', color: 'text-indigo-600' },
    ]
  }
];

const Profile = () => {
  const navigate = useNavigate();
  const [profile, setProfile] = useState({
    name: '',
    phone: '',
    profileImage: '',
    stats: {
      trips: 0,
      rating: 4.9,
      wallet: 0
    }
  });

  useEffect(() => {
    const token = getLocalUserToken();

    if (!token) {
      navigate('/taxi/user/login', { replace: true });
      return;
    }

    const loadProfile = async () => {
      try {
        let stored = {};
        try {
          stored = JSON.parse(localStorage.getItem('userInfo') || '{}');
        } catch {
          stored = {};
        }

        const [profileResponse, walletResponse, ridesResponse] = await Promise.allSettled([
          userAuthService.getCurrentUser(),
          userAuthService.getWallet(),
          api.get('/rides', { params: { page: 1, limit: 1 } }),
        ]);

        const profilePayload = profileResponse.status === 'fulfilled' ? profileResponse.value : {};
        const walletPayload = walletResponse.status === 'fulfilled' ? walletResponse.value : {};
        const ridesPayload = ridesResponse.status === 'fulfilled' ? ridesResponse.value : {};

        const profileData = pickObject(
          profilePayload?.data,
          profilePayload?.result,
          profilePayload,
        );
        const user = pickObject(
          profileData?.user,
          profileData?.data?.user,
          profileData?.profile,
          profileData,
        );
        const walletData = pickObject(
          walletPayload?.data,
          walletPayload?.wallet,
          walletPayload,
        );
        const ridesData = pickObject(
          ridesPayload?.data,
          ridesPayload?.result,
          ridesPayload,
        );
        const ridePagination = pickObject(ridesData?.pagination, ridesData?.data?.pagination);
        const dynamicTripCount = pickNumber(
          ridePagination.total,
          ridesData?.total,
          ridesData?.count,
          user.totalRides,
          user.total_trips,
          user.totalTrips,
          stored?.totalRides,
        );
        const dynamicWalletBalance = pickNumber(
          walletData.balance,
          walletData.walletBalance,
          walletData.amount,
          user.walletBalance,
          user.wallet?.balance,
          user.wallet_amount,
          stored?.walletBalance,
        );
        const dynamicRating = pickNumber(
          user.rating,
          user.avgRating,
          user.average_rating,
          stored?.rating,
          4.9,
        );
        
        setProfile({
          name: user.name || stored?.name || 'User',
          phone: user.phone || stored?.phone || '',
          profileImage: user.profileImage || user.profile_image || stored?.profileImage || '',
          stats: {
            trips: dynamicTripCount,
            rating: dynamicRating,
            wallet: dynamicWalletBalance,
          }
        });
        localStorage.setItem('userInfo', JSON.stringify({
          ...stored,
          ...user,
          walletBalance: dynamicWalletBalance,
          totalRides: dynamicTripCount,
          rating: dynamicRating,
        }));
      } catch (err) {
        console.error('Failed to load profile', err);
      }
    };

    loadProfile();
  }, [navigate]);

  const handleLogout = () => {
    clearCurrentRide();
    socketService.disconnect();
    clearLocalUserSession();

    // Normalize theme classes before route switch so /login does not momentarily
    // inherit stale dark-mode DOM classes from the previous screen.
    if (typeof document !== 'undefined') {
      const savedTheme = localStorage.getItem('appTheme') || 'light';
      const html = document.documentElement;
      const body = document.body;
      const root = document.getElementById('root');
      const shouldUseDark = savedTheme === 'dark';

      html.classList.toggle('dark', shouldUseDark);
      if (body) body.classList.toggle('dark', shouldUseDark);
      if (root) root.classList.toggle('dark', shouldUseDark);
    }

    navigate('/login', { replace: true });
  };

  const initials = (profile.name || 'User')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1
      }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { 
      opacity: 1, 
      y: 0,
      transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] }
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 max-w-lg mx-auto pb-28 relative overflow-x-hidden font-['Inter']">
      {/* Premium Header Background */}
      <div className="absolute top-0 inset-x-0 h-80 bg-slate-900 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-600/30 via-slate-900 to-slate-900" />
        <div className="absolute top-[-20%] right-[-10%] h-64 w-64 bg-indigo-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-[-5%] h-40 w-40 bg-emerald-500/5 rounded-full blur-2xl" />
      </div>

      <div className="relative z-10">
        {/* Header Section */}
        <div className="px-6 pt-12 pb-8">
          <div className="flex items-center justify-between mb-8">
            <h1 className="font-['Outfit'] text-2xl font-extrabold text-white tracking-tight">Profile</h1>
            <MotionButton
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => navigate('/taxi/user/profile/settings')}
              className="h-10 w-10 rounded-xl bg-white/10 backdrop-blur-md border border-white/10 flex items-center justify-center text-white"
            >
              <Settings size={20} />
            </MotionButton>
          </div>

          {/* Profile Hero Card */}
          <MotionDiv
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="rounded-[32px] bg-white p-6 shadow-2xl shadow-slate-900/20"
          >
            <div className="flex items-center gap-5">
              <div className="relative">
                <div className="w-20 h-20 rounded-[28px] bg-slate-900 flex items-center justify-center shadow-lg overflow-hidden border-2 border-white">
                  {profile.profileImage ? (
                    <img 
                      src={profile.profileImage} 
                      alt="User" 
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-2xl font-black text-white opacity-40">{initials || 'U'}</span>
                  )}
                </div>
                <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-emerald-500 rounded-lg border-2 border-white flex items-center justify-center shadow-sm">
                  <Check size={14} className="text-white" strokeWidth={4} />
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="font-['Outfit'] text-[22px] font-extrabold text-slate-900 truncate capitalize leading-tight">
                  {profile.name}
                </h2>
                <p className="text-[14px] font-bold text-slate-400 mt-1 flex items-center gap-1.5">
                   <Phone size={14} className="text-slate-300" />
                   {profile.phone ? `+91 ${profile.phone}` : 'Account Active'}
                </p>
              </div>
            </div>

            {/* Quick Stats Row */}
            <div className="grid grid-cols-3 gap-3 mt-8 pt-6 border-t border-slate-50">
              <div className="text-center">
                <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-300">Total Trips</p>
                <p className="font-['Outfit'] text-[18px] font-extrabold text-slate-900 mt-1">{profile.stats.trips}</p>
              </div>
              <div className="text-center border-x border-slate-50">
                <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-300">Rating</p>
                <div className="flex items-center justify-center gap-1 mt-1">
                  <Star size={14} className="text-amber-400 fill-amber-400" />
                  <p className="font-['Outfit'] text-[18px] font-extrabold text-slate-900">{profile.stats.rating}</p>
                </div>
              </div>
              <div className="text-center">
                <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-300">Credits</p>
                <p className="font-['Outfit'] text-[18px] font-extrabold text-indigo-600 mt-1">₹{profile.stats.wallet}</p>
              </div>
            </div>
          </MotionDiv>
        </div>

        {/* Menu Sections */}
        <motion.div 
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="px-6 space-y-8"
        >
          {menuSections.map((section, sIdx) => (
            <motion.div key={sIdx} variants={itemVariants} className="space-y-4">
              <h3 className="font-['Outfit'] text-[12px] font-black text-slate-400 uppercase tracking-[0.25em] ml-1">
                {section.title}
              </h3>
              
              <div className="bg-white rounded-[32px] border border-slate-100 shadow-premium overflow-hidden divide-y divide-slate-50">
                {section.items.map((item, iIdx) => (
                  <MotionButton
                    key={iIdx}
                    whileTap={{ backgroundColor: '#F8FAFC' }}
                    onClick={() => navigate(item.path)}
                    className="w-full flex items-center gap-5 px-6 py-5 text-left transition-colors"
                  >
                    <div className={`w-11 h-11 rounded-[16px] flex items-center justify-center shrink-0 ${item.bg}`}>
                      <item.icon size={20} className={item.color} strokeWidth={2.5} />
                    </div>
                    <div className="flex-1">
                      <p className="text-[15px] font-bold text-slate-900 leading-tight tracking-tight">{item.title}</p>
                      <p className="text-[12px] font-semibold text-slate-400 mt-1 opacity-80">{item.sub}</p>
                    </div>
                    <div className="h-8 w-8 rounded-full bg-slate-50 flex items-center justify-center text-slate-200">
                      <ChevronRight size={18} strokeWidth={3} />
                    </div>
                  </MotionButton>
                ))}
              </div>
            </motion.div>
          ))}

          {/* Dangerous Zone */}
          <motion.div variants={itemVariants} className="pt-4 pb-12 space-y-4">
             <MotionButton
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => navigate('/taxi/user/profile/delete-account')}
              className="w-full flex items-center gap-4 px-6 py-4 rounded-[24px] border border-red-50 text-red-500 hover:bg-red-50 transition-colors"
            >
              <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center shrink-0">
                <Trash2 size={18} strokeWidth={2.5} />
              </div>
              <p className="text-[14px] font-bold">Request Account Deletion</p>
            </MotionButton>

            <MotionButton
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleLogout}
              className="w-full h-16 rounded-[24px] bg-slate-900 text-white flex items-center justify-center gap-3 text-[15px] font-black shadow-xl shadow-slate-900/10"
            >
              <LogOut size={18} strokeWidth={3} />
              Sign Out Securely
            </MotionButton>

            <div className="text-center pt-6">
              <p className="text-[10px] font-black text-slate-300 uppercase tracking-[0.3em]">
                Version 2.4.1 • Built with Love
              </p>
            </div>
          </motion.div>
        </motion.div>
      </div>

      <BottomNavbar />
    </div>
  );
};

export default Profile;
