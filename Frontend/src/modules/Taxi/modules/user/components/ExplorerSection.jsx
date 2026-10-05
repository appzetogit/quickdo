import React from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import indiaGateImg from '@/assets/india_gate_real.png';
import jaipurImg from '@/assets/jaipur.avif';
import tajMahalImg from '@/assets/taj mahal.jpeg';

const ExplorerSection = () => {
  const navigate = useNavigate();

  const indiaCities = [
    {
      title: 'Taj Mahal',
      image: tajMahalImg,
      label: 'Agra',
      code: 'AGR',
      drop: 'Taj Mahal, Agra',
    },
    {
      title: 'Hawa Mahal',
      image: jaipurImg,
      label: 'Jaipur',
      code: 'JAI',
      drop: 'Hawa Mahal, Jaipur',
    },
    {
      title: 'India Gate',
      image: indiaGateImg,
      label: 'New Delhi',
      code: 'DEL',
      drop: 'India Gate, New Delhi',
    },
  ];

  const handleExploreDestination = (city) => {
    navigate('/taxi/user/ride/select-location', {
      state: {
        drop: city.drop || city.title,
      },
    });
  };

  return (
    <div className="w-full mb-8 mt-6">
      <div className="px-5 mb-3">
        <h2 className="text-[18px] font-black text-white tracking-tight leading-tight">
          Explore India
        </h2>
        <p className="mt-1 text-[12px] font-medium text-slate-400">
          Top tourist destinations across the country
        </p>
      </div>

      <div 
        className="flex gap-4 overflow-x-auto snap-x snap-mandatory hide-scrollbar px-5 pb-8 flex-nowrap"
        style={{ scrollBehavior: 'smooth' }}
      >
        {indiaCities.map((city, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-20px" }}
            transition={{ duration: 0.4, delay: idx * 0.1 }}
            className="snap-start flex-shrink-0 w-[240px]"
          >
            <button
              type="button"
              onClick={() => handleExploreDestination(city)}
              className="w-full group text-left transition-all active:scale-[0.98] cursor-pointer outline-none block"
            >
              <div className="rounded-[16px] bg-[#1e293b] overflow-hidden h-[260px] flex flex-col">
                {/* Image Top Half */}
                <div className="h-[160px] w-full overflow-hidden relative">
                  <img
                    src={city.image}
                    alt={city.title}
                    loading="lazy"
                    onError={(e) => {
                      e.target.onerror = null;
                      e.target.src = 'https://images.unsplash.com/photo-1524492412937-b28074a5d7da?auto=format&fit=crop&w=400&q=80';
                    }}
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                  <div className="absolute top-3 left-3 bg-white px-2 py-1 rounded text-[10px] font-black text-slate-900 tracking-wider uppercase">
                    {city.code}
                  </div>
                </div>
                
                {/* Content Bottom Half */}
                <div className="p-4 flex flex-col justify-between flex-1">
                  <div>
                    <h4 className="text-[18px] font-black text-white leading-tight">
                      {city.title}
                    </h4>
                    <p className="text-[12px] text-slate-400 font-medium mt-1">
                      {city.label}
                    </p>
                  </div>
                  
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-[12px] font-bold text-blue-400">Book outstation</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400">
                      <path d="M5 12h14M12 5l7 7-7 7"/>
                    </svg>
                  </div>
                </div>
              </div>
            </button>
          </motion.div>
        ))}
      </div>
      
      <style>{`
        .hide-scrollbar::-webkit-scrollbar { display: none !important; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none !important; }
      `}</style>
    </div>
  );
};

export default ExplorerSection;
