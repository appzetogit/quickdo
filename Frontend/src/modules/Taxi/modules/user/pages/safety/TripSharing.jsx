import React from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, HeartHandshake, Share2, Link } from 'lucide-react';

const TripSharing = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-10">
      <div className="bg-white px-5 pt-10 pb-4 shadow-sm sticky top-0 z-10 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="w-10 h-10 bg-slate-50 rounded-full flex items-center justify-center transition-all active:scale-95">
          <ArrowLeft size={20} className="text-slate-700" strokeWidth={2.5} />
        </button>
        <h1 className="text-lg font-bold text-slate-900">Live Trip Sharing</h1>
      </div>

      <div className="px-5 mt-8 flex flex-col items-center text-center">
        <div className="w-24 h-24 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600 mb-6 shadow-sm">
          <HeartHandshake size={48} strokeWidth={2} />
        </div>
        
        <h2 className="text-xl font-black text-slate-900 mb-3">Share your journey</h2>
        <p className="text-[14px] text-slate-500 mb-8 leading-relaxed max-w-xs">
          When you are on an active ride, you can generate a secure link to let your friends and family track your live location in real-time.
        </p>

        <div className="w-full bg-white border border-slate-100 p-5 rounded-[20px] shadow-sm flex flex-col gap-4 text-left">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center shrink-0">
              <Share2 size={18} />
            </div>
            <div>
              <h4 className="text-[14px] font-bold text-slate-900">Share via WhatsApp</h4>
              <p className="text-[12px] text-slate-500 mt-0.5">Send a direct message with your live tracking link.</p>
            </div>
          </div>
          <div className="h-px bg-slate-100 w-full" />
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 bg-purple-50 text-purple-600 rounded-full flex items-center justify-center shrink-0">
              <Link size={18} />
            </div>
            <div>
              <h4 className="text-[14px] font-bold text-slate-900">Copy Link</h4>
              <p className="text-[12px] text-slate-500 mt-0.5">Copy your secure URL and share it anywhere.</p>
            </div>
          </div>
        </div>

        <div className="mt-8 bg-blue-50 border border-blue-100 rounded-[16px] p-4 text-left w-full">
          <p className="text-[12px] font-bold text-blue-800">Note: Trip sharing can only be initiated while you are actively on a ride.</p>
        </div>
      </div>
    </div>
  );
};

export default TripSharing;
