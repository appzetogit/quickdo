import React from 'react';
import { motion } from 'framer-motion';

const FeaturesHighlight = () => {
  const features = [
    {
      id: 1,
      title: '0% Commission',
      description: 'Keep 100% of your earnings. No hidden fees.',
      image: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&w=400&q=80',
    },
    {
      id: 2,
      title: 'Smart Bidding',
      description: 'Negotiate and set your fare directly.',
      image: 'https://images.unsplash.com/photo-1556761175-4b46a572b786?auto=format&fit=crop&w=400&q=80',
    },
    {
      id: 3,
      title: 'Outstation',
      description: 'Comfortable trips for intercity travel.',
      image: 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?auto=format&fit=crop&w=400&q=80',
    },
    {
      id: 4,
      title: 'Fast Delivery',
      description: 'Instant parcel drop-offs across the city.',
      image: 'https://images.unsplash.com/photo-1586528116311-ad8ed7c50a30?auto=format&fit=crop&w=400&q=80',
    }
  ];

  return (
    <div className="w-full mt-4 mb-8">
      <div className="px-5 mb-3">
        <h2 className="text-[18px] font-black text-white tracking-tight">Why Quick Drop?</h2>
      </div>

      <div 
        className="flex gap-4 overflow-x-auto snap-x snap-mandatory hide-scrollbar px-5 pb-2 flex-nowrap"
        style={{ scrollBehavior: 'smooth' }}
      >
        {features.map((feat, idx) => (
          <motion.div
            key={feat.id}
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-20px" }}
            transition={{ duration: 0.4, delay: idx * 0.1 }}
            className="snap-start flex-shrink-0 w-[260px] bg-[#1e293b] rounded-[16px] overflow-hidden flex flex-col"
          >
            <div className="h-[140px] w-full overflow-hidden">
              <img 
                src={feat.image} 
                alt={feat.title} 
                className="w-full h-full object-cover"
              />
            </div>
            
            <div className="p-4 flex flex-col justify-between flex-1">
              <div>
                <h4 className="text-[16px] font-black text-white leading-tight mb-1">{feat.title}</h4>
                <p className="text-[12px] text-slate-400 font-medium leading-snug">{feat.description}</p>
              </div>
            </div>
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

export default FeaturesHighlight;
