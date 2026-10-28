import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { userService } from '../services/userService';

const getServiceAction = (serviceType, navigate) => {
  switch (serviceType?.toLowerCase()) {
    case 'normal': return () => navigate('/taxi/user/ride/select-location');
    case 'outstation': return () => navigate('/taxi/user/ride/select-location?rideType=outstation');
    case 'bid': return () => navigate('/taxi/user/ride/select-location?rideType=bid');
    case 'pooling': return () => navigate('/taxi/user/pooling');
    default: return () => navigate('/taxi/user/ride/select-location');
  }
};

const ServiceGrid = () => {
  const navigate = useNavigate();
  const [appModules, setAppModules] = useState([]);

  useEffect(() => {
    const fetchModules = async () => {
      try {
        const res = await userService.getAppModules();
        const data = res.data?.data?.results || res.data?.results || (Array.isArray(res.data?.data) ? res.data.data : []);
        setAppModules(data);
      } catch (err) {
        console.error("Failed to fetch app modules", err);
      }
    };
    fetchModules();
  }, []);

  const services = useMemo(() => {
    return appModules
      .filter(m => m.active !== false && m.service_type?.toLowerCase() !== 'rental')
      .sort((a, b) => (a.order_by || 99) - (b.order_by || 99))
      .map(m => ({
        id: m._id || m.id,
        title: m.name,
        adminIcon: m.mobile_menu_icon,
        action: getServiceAction(m.service_type, navigate)
      }));
  }, [navigate, appModules]);

  return (
    <div className="w-full mt-2 mb-4 relative z-10">
      <div 
        className="flex gap-4 overflow-x-auto snap-x snap-mandatory hide-scrollbar px-5 pb-2 flex-nowrap"
        style={{ scrollBehavior: 'smooth' }}
      >
        {services.map((service, index) => {
          return (
            <motion.div
              key={service.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              whileTap={{ scale: 0.95 }}
              onClick={service.action}
              className="snap-start flex-shrink-0 flex flex-col items-center justify-start gap-2 cursor-pointer w-[72px]"
            >
              <div className="w-[64px] h-[64px] rounded-full bg-[#1e293b] flex items-center justify-center p-3">
                {service.adminIcon ? (
                  <img src={service.adminIcon} alt={service.title} className="w-full h-full object-contain" />
                ) : (
                  <span className="text-[9px] font-bold text-slate-400">NO IMG</span>
                )}
              </div>
              <span className="text-[12px] font-bold text-white text-center leading-tight whitespace-nowrap overflow-hidden text-ellipsis w-full">
                {service.title}
              </span>
            </motion.div>
          );
        })}
      </div>
      <style>{`
        .hide-scrollbar::-webkit-scrollbar { display: none !important; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none !important; }
      `}</style>
    </div>
  );
};

export default ServiceGrid;
