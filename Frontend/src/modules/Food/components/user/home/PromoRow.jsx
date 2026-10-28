import React from 'react';
import { motion } from 'framer-motion';
import discountPromoIcon from "@food/assets/category-icons/discount_promo.png";
import gourmetPromoIcon from "@food/assets/explore more icons/gourmet.png";
import pricePromoIcon from "@food/assets/category-icons/price_promo.png";
import collectionPromoIcon from "@food/assets/explore more icons/collection.png";
import { useValueShelfCap, valueShelfHeading, valueShelfName } from "@food/utils/valueShelf";

export default function PromoRow({ handleVegModeChange, navigate, isVegMode, toggleRef }) {
  // Both lines on this card named a price the shelf may no longer run at.
  const valueShelfCap = useValueShelfCap();

  const promoCardsData = [
    {
      id: 'offers',
      title: "Hot Deals",
      value: "Offers",
      icon: discountPromoIcon,
    },
    {
      id: 'gourmet',
      title: "Premium",
      value: "Gourmet",
      icon: gourmetPromoIcon,
    },
    {
      id: 'under-250',
      title: valueShelfHeading(valueShelfCap),
      value: valueShelfName(valueShelfCap),
      icon: pricePromoIcon,
    },
    {
      id: 'collections',
      title: "Favorites",
      value: "Collections",
      icon: collectionPromoIcon,
    },
  ];

  return (
    <div className="relative w-full max-w-md mx-auto px-4 py-8 mb-2">
      {/* Subtle background glow for the whole section */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-rose-50/30 to-transparent pointer-events-none" />
      
      <div className="relative z-10 grid grid-cols-4 gap-3 justify-items-center">
        {promoCardsData.map((promo, idx) => (
          <motion.div
            key={idx}
            ref={promo.id === 'gourmet' ? toggleRef : null}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.08, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            whileHover={{ y: -6 }}
            whileTap={{ scale: 0.92 }}
            className="flex flex-col items-center group cursor-pointer w-full"
            onClick={() => {
              if (promo.id === 'gourmet') navigate('/food/user/gourmet');
              else if (promo.id === 'offers') navigate('/food/user/offers');
              else if (promo.id === 'under-250') navigate('/food/user/under-250');
              else if (promo.id === 'collections') navigate('/food/user/profile/favorites');
            }}
          >
            {/* Premium App-Icon Style Image Container */}
            <div className="relative w-[72px] h-[72px] sm:w-[84px] sm:h-[84px] flex items-center justify-center rounded-[18px] bg-white shadow-[0_8px_20px_rgba(0,0,0,0.06)] border border-gray-100/50 overflow-hidden mb-2.5 transition-all duration-300 group-hover:shadow-[0_12px_25px_rgba(225,29,72,0.2)] group-hover:border-rose-100">
              <img
                src={promo.icon}
                alt={promo.value}
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
              />
            </div>

            {/* Refined Typography */}
            <div className="flex flex-col items-center text-center w-full">
              <span className="text-[13px] sm:text-[14px] font-black text-[#0f172a] dark:text-gray-100 tracking-tight leading-tight mb-0.5 group-hover:text-[#d82c23] transition-colors">
                {promo.value}
              </span>
              <span className="text-[10px] sm:text-[11px] font-bold text-[#e11d48] dark:text-rose-400 capitalize whitespace-nowrap tracking-wide">
                {promo.title}
              </span>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
