import React from 'react';
import { motion } from 'framer-motion';
import { ArrowRightCircle, Sparkles } from 'lucide-react';
import bannerFood1 from "@food/assets/category-icons/food.png.png"; // Burger
const tacoImg = "https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=200&h=200&fit=crop";
const platterImg = "https://images.unsplash.com/photo-1544025162-d76694265947?w=200&h=200&fit=crop";

export default function FestBanner() {
  return (
    <div className="relative overflow-hidden bg-[#ff6d00] min-h-[340px] sm:min-h-[420px] isolate" style={{ perspective: "1500px" }}>
      {/* Premium Mesh Gradient Background */}
      <div className="absolute inset-0 z-0 overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] bg-[#ff2e8c] rounded-full blur-[120px] animate-pulse opacity-80" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] bg-[#e00266] rounded-full blur-[120px] animate-pulse opacity-70" style={{ animationDelay: '1s' }} />
        <div className="absolute top-[20%] right-[10%] w-[40%] h-[40%] bg-white/20 rounded-full blur-[80px] animate-pulse" />
      </div>

      {/* Abstract Animated Lines */}
      <div className="absolute inset-0 z-0 opacity-10 mix-blend-overlay pointer-events-none">
        <motion.svg 
          viewBox="0 0 100 100" 
          preserveAspectRatio="none" 
          className="w-full h-full"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 2 }}
        >
          <motion.path 
            d="M -10 30 Q 20 10 50 30 T 110 30" 
            stroke="white" 
            strokeWidth="0.2" 
            fill="none" 
            animate={{ d: [
              "M -10 30 Q 20 10 50 30 T 110 30",
              "M -10 25 Q 25 15 55 35 T 110 25",
              "M -10 30 Q 20 10 50 30 T 110 30"
            ]}}
            transition={{ repeat: Infinity, duration: 10, ease: "easeInOut" }}
          />
          <motion.path 
            d="M -10 50 Q 30 70 60 40 T 110 60" 
            stroke="white" 
            strokeWidth="0.15" 
            fill="none" 
            animate={{ d: [
              "M -10 50 Q 30 70 60 40 T 110 60",
              "M -10 55 Q 35 60 55 45 T 110 65",
              "M -10 50 Q 30 70 60 40 T 110 60"
            ]}}
            transition={{ repeat: Infinity, duration: 12, ease: "easeInOut", delay: 1 }}
          />
        </motion.svg>
      </div>

      <div className="relative z-10 flex flex-col items-center pt-8 sm:pt-12 px-4 text-center">
        {/* Floating Category Label */}
        <motion.div
           initial={{ y: 20, opacity: 0 }}
           animate={{ y: 0, opacity: 1 }}
           className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/20 mb-4"
        >
          <Sparkles className="w-3 h-3 text-yellow-300" />
          <span className="text-[10px] font-bold text-white uppercase tracking-[0.2em] pt-0.5">Seasonal Event</span>
        </motion.div>

        {/* Central Glass Card Content */}
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", damping: 15, stiffness: 100 }}
          className="relative px-6 py-8 sm:px-10 sm:py-10 rounded-[2.5rem] bg-white/5 backdrop-blur-[16px] border border-white/20 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.3)] max-w-[90%]"
        >
          {/* Internal Glint */}
          <div className="absolute inset-0 rounded-[2.5rem] overflow-hidden pointer-events-none">
            <motion.div 
              animate={{ x: ['-200%', '200%'] }}
              transition={{ duration: 4, repeat: Infinity, repeatDelay: 2 }}
              className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent skew-x-[-20deg] w-[150%] h-full"
            />
          </div>

          <div className="relative z-10 flex flex-col items-center gap-1 sm:gap-2">
            <h2 className="text-4xl sm:text-5xl lg:text-6xl font-black text-white italic tracking-tighter drop-shadow-2xl uppercase">
              FLAVOUR <span className="text-yellow-300">FEST</span>
            </h2>
            <p className="text-[10px] sm:text-xs font-bold text-white/60 tracking-[0.3em] uppercase mb-4">The ultimate culinary celebration</p>
            
            <motion.div 
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.98 }}
              className="flex items-center gap-3 px-6 py-3 bg-white text-[#ff6d00] rounded-2xl shadow-xl cursor-pointer group transition-all"
            >
              <span className="text-sm font-black uppercase tracking-wider">UPTO 60% OFF</span>
              <ArrowRightCircle className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
            </motion.div>
          </div>
        </motion.div>
        
        {/* Spatial Floating Food Items */}
        <div className="absolute inset-0 z-20 pointer-events-none overflow-hidden sm:overflow-visible">
          {/* Left Item */}
          <motion.div 
            animate={{ 
                y: [-8, 8, -8], 
                rotateZ: [-5, 5, -5],
                z: [20, 50, 20] 
            }}
            transition={{ repeat: Infinity, duration: 6, ease: "easeInOut" }}
            className="absolute left-[5%] top-[55%] w-[24%] sm:w-[15%] aspect-square z-10 pointer-events-auto"
          >
            <div className="absolute inset-0 bg-black/40 blur-2xl translate-y-8 scale-90 rounded-full" />
            <img 
                src={tacoImg} 
                alt="taco" 
                className="w-full h-full object-cover rounded-3xl border-4 border-white/60 shadow-2xl backdrop-blur-md" 
            />
          </motion.div>

          {/* Right Item */}
          <motion.div 
            animate={{ 
                y: [8, -8, 8], 
                rotateZ: [5, -5, 5],
                z: [30, 60, 30] 
            }}
            transition={{ repeat: Infinity, duration: 7, ease: "easeInOut", delay: 0.5 }}
            className="absolute right-[5%] top-[55%] w-[24%] sm:w-[15%] aspect-square z-10 pointer-events-auto"
          >
            <div className="absolute inset-0 bg-black/40 blur-2xl translate-y-8 scale-90 rounded-full" />
            <div className="relative w-full h-full rounded-3xl border-4 border-white/60 bg-white shadow-2xl overflow-hidden p-2">
                <img 
                    src={bannerFood1} 
                    alt="burger" 
                    className="w-full h-full object-contain" 
                />
            </div>
          </motion.div>

          {/* Center/Lower Shadow for better grounding of the glass card in space */}
          <div className="absolute bottom-[5%] left-1/2 -translate-x-1/2 w-[60%] h-4 bg-black/30 blur-[20px] rounded-full scale-x-110" />
        </div>
      </div>
    </div>
  );
}
