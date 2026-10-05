import React from 'react';
import { motion } from 'framer-motion';
import { ShoppingBasket, Zap, Clock, Star } from 'lucide-react';
import OptimizedImage from '@food/components/OptimizedImage';

const quickCategories = [
  { name: 'Dairy, Bread & Eggs', image: 'https://images.unsplash.com/photo-1550583760-706c4210077c?w=100&h=100&fit=crop' },
  { name: 'Vegetables & Fruits', image: 'https://images.unsplash.com/photo-1610348725531-843dff563e2c?w=100&h=100&fit=crop' },
  { name: 'Snacks & Munchies', image: 'https://images.unsplash.com/photo-1599490659223-e1539e7af924?w=100&h=100&fit=crop' },
  { name: 'Soft Drinks & Ice', image: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=100&h=100&fit=crop' },
  { name: 'Cleaning Essentials', image: 'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=100&h=100&fit=crop' },
  { name: 'Personal Care', image: 'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?w=100&h=100&fit=crop' },
  { name: 'Pet Care', image: 'https://images.unsplash.com/photo-1583337130417-3346a1be7dee?w=100&h=100&fit=crop' },
  { name: 'Baby Care', image: 'https://images.unsplash.com/photo-1555252333-978fe3f780c4?w=100&h=100&fit=crop' },
];

export default function QuickSection() {
  return (
    <div className="relative min-h-[400px] bg-white pt-2 pb-10">
      {/* "Coming Soon" Overlay */}
      <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-white/60 backdrop-blur-[2px]">
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="bg-[#ff6d00] text-white px-8 py-3 rounded-2xl shadow-2xl flex flex-col items-center gap-1 border-4 border-white"
        >
          <Zap className="h-8 w-8 fill-white" />
          <span className="text-xl font-black uppercase tracking-tighter italic">Coming Soon</span>
          <span className="text-xs font-bold opacity-80 uppercase tracking-widest leading-none">Instant Grocery</span>
        </motion.div>
      </div>

      <div className="px-4 space-y-6 opacity-40 grayscale-[0.5] select-none pointer-events-none">
        {/* Banner */}
        <div className="bg-yellow-50 rounded-2xl p-4 flex justify-between items-center border border-yellow-100">
          <div className="space-y-1">
            <h3 className="text-sm font-black text-yellow-900 leading-tight">Munchies <br />at 10 PM?</h3>
            <p className="text-[10px] font-bold text-yellow-700 uppercase">Get them in 10 mins</p>
          </div>
          <ShoppingBasket className="h-10 w-10 text-yellow-500 opacity-50" />
        </div>

        {/* Categories Grid */}
        <div className="space-y-4">
          <h4 className="text-sm font-bold text-gray-900 px-1">Shop by category</h4>
          <div className="grid grid-cols-4 gap-x-2 gap-y-4">
            {quickCategories.map((cat, idx) => (
              <div key={idx} className="flex flex-col items-center gap-1.5 animate-pulse" style={{ animationDelay: `${idx * 100}ms` }}>
                <div className="w-full aspect-square bg-gray-50 rounded-xl overflow-hidden shadow-sm border border-gray-100 flex items-center justify-center p-1">
                  <OptimizedImage src={cat.image} alt={cat.name} className="w-full h-full object-contain rounded-lg" />
                </div>
                <span className="text-[9px] font-bold text-gray-600 text-center leading-tight">
                  {cat.name}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Features */}
        <div className="flex justify-between px-2 pt-4 border-t border-gray-50">
          <div className="flex flex-col items-center gap-1">
            <div className="h-8 w-8 rounded-full bg-blue-50 flex items-center justify-center">
              <Clock className="h-4 w-4 text-blue-500" />
            </div>
            <span className="text-[8px] font-bold text-gray-400">FAST DELIVERY</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <div className="h-8 w-8 rounded-full bg-primary-orange/5 flex items-center justify-center">
              <Star className="h-4 w-4 text-primary-orange/50" />
            </div>
            <span className="text-[8px] font-bold text-gray-400">TOP BRANDS</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <div className="h-8 w-8 rounded-full bg-green-50 flex items-center justify-center">
              <ShoppingBasket className="h-4 w-4 text-green-500" />
            </div>
            <span className="text-[8px] font-bold text-gray-400">BEST PRICES</span>
          </div>
        </div>
      </div>
    </div>
  );
}
