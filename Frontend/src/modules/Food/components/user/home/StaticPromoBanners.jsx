import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export default function StaticPromoBanners({ banners = [] }) {
  const [currentSlide, setCurrentSlide] = useState(0);

  useEffect(() => {
    if (banners.length <= 1) return;
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % banners.length);
    }, 4000);
    return () => clearInterval(timer);
  }, [banners.length]);

  if (!banners || banners.length === 0) return null;

  return (
    <motion.div 
      className="relative w-full px-5 pb-6 z-20 max-w-2xl mx-auto"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="relative w-full rounded-2xl overflow-hidden bg-white border border-gray-100 shadow-[0_4px_15px_rgba(0,0,0,0.03)]">
        
        <div
          className="flex aspect-[2.2/1] sm:aspect-[2.5/1] transition-transform duration-700 ease-out"
          style={{ transform: `translateX(-${currentSlide * 100}%)` }}
        >
          {banners.map((banner, idx) => {
            const hasText = !!banner.title;
            
            return (
              <div
                key={banner._id || banner.id || idx}
                className={`w-full h-full shrink-0 flex items-center justify-between cursor-pointer ${
                  hasText 
                    ? `px-5 bg-gradient-to-r ${
                        idx % 3 === 0 
                          ? 'from-orange-50/50 to-red-50/50' 
                          : idx % 3 === 1 
                            ? 'from-red-50/50 to-pink-50/50' 
                            : 'from-orange-50/50 to-pink-50/50'
                      }`
                    : 'bg-gray-100'
                }`}
                onClick={() => {
                  if (banner.ctaLink) {
                      window.location.href = banner.ctaLink;
                  }
                }}
              >
                {hasText ? (
                  <div className="flex justify-between items-center h-full w-full">
                    <div className="flex flex-col items-start w-[70%]">
                      <div className="text-[20px] leading-[1.1] font-black text-[#0f172a] tracking-tight mb-1">{banner.title}</div>
                      <div className="text-[10px] font-bold text-[#64748b]">{banner.ctaText}</div>
                    </div>
                    <div className="w-[30%] flex justify-end">
                      {banner.imageUrl && (
                        <img src={banner.imageUrl} alt={banner.title} className="w-[50px] h-[50px] object-contain drop-shadow-sm" />
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="w-full h-full relative">
                    <img 
                      src={banner.imageUrl} 
                      alt="Promotion" 
                      className="w-full h-full object-cover" 
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Pagination Dots */}
        {banners.length > 1 && (
          <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1.5">
            {banners.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all duration-500 ${
                  i === currentSlide 
                    ? 'bg-gray-800 w-4' 
                    : 'bg-gray-300 w-1.5'
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
