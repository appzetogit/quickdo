import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';

const ActionCard = ({ title, description, image, bgColor, path, delay = 0 }) => {
  const navigate = useNavigate();

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-20px" }}
      transition={{ duration: 0.4, delay }}
      whileTap={{ scale: 0.96 }}
      onClick={(e) => {
        e.stopPropagation();
        navigate(path);
      }}
      className={`relative flex items-center justify-between overflow-hidden rounded-[16px] p-4 cursor-pointer w-full h-[110px] ${bgColor}`}
    >
      <div className="relative z-10 flex flex-col h-full justify-center w-[60%]">
        <h3 className="text-[18px] font-black leading-tight text-white">{title}</h3>
        <p className="mt-1 text-[12px] font-medium leading-snug text-white/80">{description}</p>
        <div className="mt-2 inline-flex items-center justify-center w-8 h-8 rounded-full bg-white/20">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        </div>
      </div>

      <div className="absolute right-0 bottom-0 h-full w-[45%] flex items-end justify-end overflow-hidden">
        <img
          src={image}
          alt=""
          style={{ color: 'transparent' }}
          className="w-full h-auto object-contain object-right-bottom transform scale-110 origin-bottom-right"
        />
      </div>
    </motion.div>
  );
};

const ActionsSection = () => {
  const location = useLocation();
  const routePrefix = location.pathname.startsWith('/taxi/user') ? '/taxi/user' : '';
  const resolvePath = (path) => `${routePrefix}${path}`;

  return (
    <div className="px-5 mt-6 mb-6">
      <motion.div 
        initial={{ opacity: 0, x: -10 }} 
        whileInView={{ opacity: 1, x: 0 }} 
        viewport={{ once: true }}
        transition={{ duration: 0.4 }}
        className="mb-3"
      >
        <h2 className="text-[18px] font-black text-white tracking-tight">What do you need today?</h2>
      </motion.div>

      <div className="flex flex-col gap-3">
        <ActionCard
          title="Ride"
          description="Bike, auto, and cab rides"
          image="/1_Bike.png"
          bgColor="bg-[#1e293b]"
          path={resolvePath('/ride/select-location')}
          delay={0.1}
        />

        <ActionCard
          title="Delivery"
          description="Send parcels across the city"
          image="/5_Parcel.png"
          bgColor="bg-[#334155]"
          path={resolvePath('/parcel/type')}
          delay={0.2}
        />
      </div>
    </div>
  );
};

export default ActionsSection;
