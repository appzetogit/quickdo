import React from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Clock3, ShieldCheck, Sparkles, Zap, Bike, Car, Wallet, IndianRupee } from 'lucide-react';

const rotatingCards = [
  {
    icon: Clock3,
    bgIcon: Bike,
    iconClass: 'text-amber-500 shadow-amber-500/20',
    title: 'In a hurry?',
    description: 'Auto & Bike for shorter wait times.',
    actionClass: 'bg-amber-100 text-amber-600',
    path: '/taxi/user/ride/select-location',
    gradient: 'from-amber-50/80 via-orange-50/40 to-white',
    border: 'border-amber-200/40'
  },
  {
    icon: ShieldCheck,
    bgIcon: Car,
    iconClass: 'text-emerald-500 shadow-emerald-500/20',
    title: 'Need space?',
    description: 'Cab for luggage or comfort.',
    actionClass: 'bg-emerald-100 text-emerald-600',
    path: '/taxi/user/ride/select-location',
    gradient: 'from-emerald-50/80 via-teal-50/40 to-white',
    border: 'border-emerald-200/40'
  },
];

const PromoCard = ({ icon: Icon, bgIcon: BgIcon, iconClass, title, description, actionClass, path, gradient, border, onNavigate }) => (
  <motion.div
    whileHover={{ y: -6, scale: 1.02 }}
    whileTap={{ scale: 0.98 }}
    transition={{ type: "spring", stiffness: 400, damping: 25 }}
    onClick={() => onNavigate(path)}
    className={`relative min-h-[160px] overflow-hidden rounded-[26px] border ${border} bg-gradient-to-br ${gradient} p-5 shadow-[0_8px_20px_rgba(15,23,42,0.03)] cursor-pointer group hover:shadow-[0_20px_40px_rgba(15,23,42,0.08)]`}
  >
    {/* Animated background glow */}
    <div className="absolute top-0 right-0 -mt-10 -mr-10 h-32 w-32 rounded-full bg-white/60 blur-2xl transition-transform duration-700 group-hover:scale-150" />
    
    <motion.div 
      initial={{ rotate: -12, scale: 1 }}
      whileHover={{ rotate: 0, scale: 1.2, x: -10, y: -10 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="absolute -bottom-6 -right-6 z-0 opacity-[0.05]"
    >
      <BgIcon size={130} strokeWidth={1} />
    </motion.div>

    <div className="relative z-10 flex flex-col h-full justify-between">
      <div>
        <div className={`inline-flex items-center justify-center rounded-[14px] bg-white p-2.5 shadow-lg ${iconClass}`}>
          <Icon size={20} strokeWidth={3} />
        </div>
        <h3 className="mt-4 text-[17px] font-black leading-tight tracking-tight text-slate-900">{title}</h3>
        <p className="mt-1 max-w-[130px] text-[12px] font-bold leading-relaxed text-slate-500">{description}</p>
      </div>
      
      <div className={`mt-5 inline-flex h-9 w-9 items-center justify-center rounded-full transition-transform duration-300 group-hover:translate-x-1 ${actionClass}`}>
        <ArrowRight size={16} strokeWidth={3} />
      </div>
    </div>
  </motion.div>
);

const PromoBanners = () => {
  const navigate = useNavigate();

  return (
    <div className="px-5 space-y-6 mb-8 mt-2">
      <motion.div 
        initial={{ opacity: 0, x: -10 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.4 }}
        className="mb-4 ml-1 flex items-center justify-between"
      >
        <h2 className="text-[20px] font-black text-slate-900 tracking-tight">Recommended for you</h2>
        <motion.div 
          animate={{ rotate: [0, 15, -15, 0] }} 
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-50"
        >
          <Sparkles size={16} className="text-amber-500" />
        </motion.div>
      </motion.div>

      <div className="grid grid-cols-2 gap-3.5">
        {rotatingCards.map((card, index) => (
          <motion.div 
            key={index}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: index * 0.15, type: "spring", stiffness: 300, damping: 20 }}
          >
            <PromoCard {...card} onNavigate={navigate} />
          </motion.div>
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.3, type: "spring" }}
        whileHover={{ scale: 1.02, y: -4 }}
        whileTap={{ scale: 0.98 }}
        onClick={() => navigate('/taxi/user/ride/select-location')}
        className="relative overflow-hidden rounded-[28px] cursor-pointer shadow-[0_20px_40px_rgba(15,23,42,0.12)] group mt-2"
      >
        <div className="absolute inset-0 bg-[#0F172A]" />
        <motion.div 
          animate={{ 
            scale: [1, 1.25, 1],
            opacity: [0.25, 0.45, 0.25],
          }}
          transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -top-[50%] -left-[20%] w-[150%] h-[150%] rounded-full bg-[radial-gradient(circle,rgba(56,189,248,0.4)_0%,transparent_60%)] blur-2xl pointer-events-none" 
        />
        <motion.div 
          animate={{ 
            scale: [1, 1.4, 1],
            opacity: [0.15, 0.35, 0.15],
            x: [0, -20, 0]
          }}
          transition={{ duration: 9, repeat: Infinity, ease: "easeInOut", delay: 1 }}
          className="absolute -bottom-[50%] -right-[20%] w-[150%] h-[150%] rounded-full bg-[radial-gradient(circle,rgba(16,185,129,0.3)_0%,transparent_60%)] blur-2xl pointer-events-none" 
        />
        
        {/* Glass overlay */}
        <div className="absolute inset-0 bg-white/[0.02] backdrop-blur-[2px]" />

        <div className="relative z-10 flex min-h-[195px] p-6 justify-between items-center">
          <div className="max-w-full">
            <motion.div 
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.5 }}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[10.5px] font-black uppercase tracking-[0.2em] text-cyan-300 backdrop-blur-md border border-white/20 shadow-[0_4px_12px_rgba(0,0,0,0.1)]"
            >
              <Zap size={12} strokeWidth={3} className="text-cyan-300" />
              Special Offer
            </motion.div>

            <h3 className="mt-4 text-[24px] font-black leading-tight tracking-tight text-white drop-shadow-md">
              Better savings <br className="hidden sm:block" />on your next ride.
            </h3>
            <p className="mt-2.5 text-[13px] font-bold leading-relaxed text-slate-300 max-w-[200px]">Book quickly & unlock exclusive discounts today.</p>

            <div className="mt-6 relative inline-flex group/btn">
              <div className="absolute -inset-1 bg-gradient-to-r from-cyan-400 to-emerald-400 rounded-full blur opacity-40 group-hover/btn:opacity-75 transition duration-500 group-hover/btn:duration-200"></div>
              <div className="relative inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-[13px] font-black text-slate-900 transition-all duration-300 group-hover/btn:scale-105">
                Ride Now
                <ArrowRight size={16} strokeWidth={3} />
              </div>
            </div>
          </div>
          
          {/* Shimmer Effect overlay */}
          <motion.div 
            animate={{ x: ["-100%", "200%"] }}
            transition={{ duration: 3, repeat: Infinity, ease: "linear", delay: 1 }}
            className="absolute inset-0 z-20 w-[50%] bg-gradient-to-r from-transparent via-white/10 to-transparent skew-x-[-20deg] pointer-events-none"
          />
        </div>
      </motion.div>
    </div>
  );
};

export default PromoBanners;
