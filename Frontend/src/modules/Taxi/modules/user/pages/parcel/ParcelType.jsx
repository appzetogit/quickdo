import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { 
  ArrowLeft, 
  ChevronRight, 
  MapPin,
  ArrowRight
} from 'lucide-react';
import api from '../../../../shared/api/axiosInstance';

import trucksImg from '../../../../assets/images/delivery/trucks.png';
import bikeImg from '../../../../assets/images/delivery/bike.png';
import moversImg from '../../../../assets/images/delivery/movers.png';

const PARCEL_BOOKING_DRAFT_KEY = 'parcelBookingDraft';

const DELIVERY_CATEGORY_OPTIONS = [
  {
    id: 'trucks',
    title: 'Trucks',
    img: trucksImg,
    searchTokens: ['truck', 'lcv', 'hcv', 'mcv', 'loader'],
  },
  {
    id: '2wheeler',
    title: '2 Wheeler',
    img: bikeImg,
    searchTokens: ['bike', 'scooter', 'cycle', '2-wheeler'],
  },
  {
    id: 'movers',
    title: 'Packers & Movers',
    img: moversImg,
    searchTokens: ['mover', 'packers'],
  }
];

const ParcelType = () => {
  const [vehicleTypes, setVehicleTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pickupAddress, setPickupAddress] = useState('1A, Vandana Nagar Main Rd, Rajshri Palace Colon...');
  const navigate = useNavigate();

  useEffect(() => {
    const fetchVehicles = async () => {
      try {
        setLoading(true);
        const response = await api.get('/users/vehicle-types');
        const items = response?.results || response?.data?.results || [];
        setVehicleTypes(items.filter(v => v.active && (v.transport_type === 'delivery' || v.transport_type === 'both')));
      } catch (err) {
        console.error('Failed to load vehicles:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchVehicles();
  }, []);

  const handleCategorySelect = (category) => {
    const filteredVehicles = vehicleTypes.filter((vehicle) => {
      const configuredCategory = String(vehicle.delivery_category || '').trim().toLowerCase();
      if (configuredCategory) {
        return configuredCategory === category.id;
      }

      const name = String(vehicle.name || '').toLowerCase();
      const iconType = String(vehicle.icon_types || '').toLowerCase();
      return category.searchTokens.some((token) => name.includes(token) || iconType.includes(token));
    });

    if (loading || vehicleTypes.length === 0) return;

    const selectedVehicle = filteredVehicles[0] || vehicleTypes[0];
    const selectedVehicleIds = filteredVehicles.length
      ? filteredVehicles.map((vehicle) => vehicle?._id || vehicle?.id).filter(Boolean)
      : [selectedVehicle?._id || selectedVehicle?.id].filter(Boolean);
    const selectedVehicles = filteredVehicles.length ? filteredVehicles : selectedVehicle ? [selectedVehicle] : [];

    const nextState = {
      parcelType: 'General Parcel',
      selectedVehicle: selectedVehicle,
      selectedVehicles,
      selectedVehicleId: selectedVehicle?._id || selectedVehicle?.id,
      selectedVehicleIds,
      category: category.id,
      deliveryCategory: category.id,
      pickup: pickupAddress,
    };

    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(PARCEL_BOOKING_DRAFT_KEY, JSON.stringify(nextState));
    }

    navigate('/taxi/user/parcel/details', {
      state: nextState,
    });
  };

  return (
    <div className="min-h-screen bg-[#F5F8FF] max-w-lg mx-auto flex flex-col font-sans relative overflow-x-hidden">
      
      {/* Premium Header with Wave Background */}
      <div className="relative bg-[#0047AB] pt-10 pb-20 px-6 overflow-hidden">
        {/* Subtle Wave SVG */}
        <div className="absolute bottom-0 left-0 right-0 h-16 opacity-20 pointer-events-none">
            <svg viewBox="0 0 1440 320" className="w-full h-full preserve-3d">
                <path fill="#ffffff" fillOpacity="1" d="M0,160L48,176C96,192,192,224,288,224C384,224,480,192,576,165.3C672,139,768,117,864,128C960,139,1056,181,1152,186.7C1248,192,1344,160,1392,144L1440,128L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"></path>
            </svg>
        </div>

        <div className="relative z-10 flex flex-col gap-4">
           {/* Pickup Selector */}
           <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-[24px] p-4 flex items-center gap-4 shadow-lg border border-white/50 cursor-pointer"
            onClick={() => navigate('/taxi/user/parcel/details', { state: { editPickup: true } })}
           >
             <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center shrink-0">
               <MapPin size={20} className="text-emerald-500 fill-emerald-500/20" />
             </div>
             <div className="flex-1 min-w-0">
               <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">Pick up from</p>
               <p className="text-[13px] font-bold text-slate-900 truncate mt-0.5">{pickupAddress}</p>
             </div>
             <ChevronRight size={18} className="text-slate-400" />
           </motion.div>
        </div>
      </div>

      {/* Main Content Area */}
      <main className="flex-1 px-5 -mt-10 z-20 pb-10">
        
        {/* Category Grid */}
        <div className="grid grid-cols-3 gap-3 mb-8">
          {DELIVERY_CATEGORY_OPTIONS.map((cat, idx) => (
            <motion.button
              key={cat.id}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: idx * 0.1 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => handleCategorySelect(cat)}
              className="bg-white rounded-[24px] p-4 flex flex-col items-center gap-4 shadow-md border border-slate-100/50 hover:shadow-xl transition-shadow aspect-[0.85/1]"
            >
              <div className="bg-[#F5F8FF] w-full rounded-2xl p-3 mb-2 aspect-square flex items-center justify-center overflow-hidden">
                <img src={cat.img} alt={cat.title} className="w-full h-full object-contain" />
              </div>
              <span className="text-[11px] font-bold text-slate-800 text-center leading-tight">
                {cat.title}
              </span>
            </motion.button>
          ))}
        </div>

        {/* Promo Banner: Explore Porter Rewards */}
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.4 }}
          className="relative overflow-hidden rounded-[24px] bg-gradient-to-r from-[#312E81] via-[#4338CA] to-[#4F46E5] p-5 mb-8 shadow-lg group cursor-pointer"
        >
          {/* Decorative coin circles */}
          <div className="absolute -right-4 -top-4 w-24 h-24 bg-white/5 rounded-full blur-xl" />
          <div className="absolute right-10 bottom-2 w-12 h-12 bg-yellow-400/10 rounded-full blur-lg" />
          
          <div className="relative z-10 flex items-center justify-between">
            <div className="flex items-center gap-4">
               <div className="w-12 h-12 rounded-full bg-gradient-to-br from-yellow-300 to-yellow-600 flex items-center justify-center shadow-lg border-4 border-white/20">
                  <div className="w-6 h-6 rounded-full border-2 border-white/40 flex items-center justify-center font-black text-white text-[14px]">
                    $
                  </div>
               </div>
               <div className="text-white">
                  <h3 className="text-[17px] font-black tracking-tight leading-tight">Explore Rewards</h3>
                  <p className="text-[11px] font-bold text-white/70 mt-1">Earn 2 coins for every 100 spent</p>
               </div>
            </div>
            <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white group-hover:translate-x-1 transition-transform">
               <ArrowRight size={18} strokeWidth={3} />
            </div>
          </div>
        </motion.div>

        {/* Announcements Section */}
        

        {/* Footer Illustration */}
        <div className="mt-4 flex justify-center">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="relative w-full max-w-[320px] aspect-[16/9]"
            >
                {/* Simulated Road */}
                <div className="absolute bottom-0 left-0 right-0 h-4 bg-slate-200/50 rounded-full blur-sm" />
                <img 
                  src={trucksImg} 
                  alt="Delivery Truck" 
                  className="w-full h-full object-contain opacity-20 grayscale brightness-125"
                />
                <div className="absolute inset-0 flex items-center justify-center">
                   <div className="w-32 h-32 rounded-full bg-blue-500/5 blur-3xl" />
                </div>
                <div className="absolute top-1/2 left-4 w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center">
                    <MapPin size={24} className="text-blue-500/40" />
                </div>
            </motion.div>
        </div>

      </main>

      {/* Floating Back Button */}
      <button 
        onClick={() => navigate(-1)}
        className="fixed top-2 left-4 z-50 w-8 h-8 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center text-white border border-white/10"
      >
        <ArrowLeft size={16} />
      </button>

    </div>
  );
};

export default ParcelType;
