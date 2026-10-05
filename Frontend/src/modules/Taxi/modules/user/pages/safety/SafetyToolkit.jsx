import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, X, HeartHandshake, FileWarning, Info, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../../../../shared/api/axiosInstance';

const SafetyToolkit = ({ rideId, driver, isOpen, onClose }) => {
  const navigate = useNavigate();
  const [isSharing, setIsSharing] = useState(false);

  const handleShareTrip = async () => {
    setIsSharing(true);
    try {
      const res = await api.post('/safety/trip/share', { trip_id: rideId });
      const token = res.data?.data?.token;
      const shareUrl = `${window.location.origin}/track-trip/${token}`;
      
      if (navigator.share) {
        await navigator.share({
          title: 'Track my ride',
          text: `I'm on a ride. Track my live location here:`,
          url: shareUrl,
        });
      } else {
        await navigator.clipboard.writeText(`Track my ride: ${shareUrl}`);
        toast.success('Tracking link copied to clipboard!');
      }
    } catch (err) {
      toast.error('Failed to generate sharing link');
    } finally {
      setIsSharing(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/40 backdrop-blur-sm sm:items-center">
          <motion.div
            initial={{ opacity: 0, y: '100%' }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="bg-white rounded-t-[24px] sm:rounded-[24px] p-6 w-full max-w-sm shadow-2xl relative"
          >
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
                  <Shield size={16} strokeWidth={2.5} />
                </div>
                <h3 className="text-[18px] font-black text-slate-900">Safety Toolkit</h3>
              </div>
              <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500">
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <button 
                onClick={handleShareTrip}
                disabled={isSharing}
                className="bg-blue-50 p-4 rounded-[16px] border border-blue-100 flex flex-col items-center justify-center gap-2 active:scale-95 transition-transform"
              >
                <HeartHandshake size={24} className="text-blue-600" />
                <span className="text-[12px] font-bold text-slate-900">{isSharing ? 'Sharing...' : 'Share Trip'}</span>
              </button>

              <button 
                onClick={() => { onClose(); navigate(`/taxi/user/safety/report-driver?rideId=${rideId}`); }}
                className="bg-orange-50 p-4 rounded-[16px] border border-orange-100 flex flex-col items-center justify-center gap-2 active:scale-95 transition-transform"
              >
                <FileWarning size={24} className="text-orange-600" />
                <span className="text-[12px] font-bold text-slate-900">Report Issue</span>
              </button>
            </div>

            <button 
              onClick={() => { onClose(); navigate('/taxi/user/safety'); }}
              className="w-full bg-slate-50 border border-slate-200 p-4 rounded-[16px] flex items-center justify-between active:scale-[0.98] transition-transform"
            >
              <div className="flex items-center gap-3">
                <Info size={20} className="text-slate-600" />
                <div className="text-left">
                  <p className="text-[14px] font-bold text-slate-900">Safety Center</p>
                  <p className="text-[11px] text-slate-500 font-medium">Manage contacts & view tips</p>
                </div>
              </div>
              <ExternalLink size={16} className="text-slate-400" />
            </button>

            {/* Driver Verification Card */}
            <div className="mt-6 border border-emerald-100 bg-emerald-50/50 rounded-[16px] p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                <Shield size={18} className="text-emerald-600" strokeWidth={2.5} />
              </div>
              <div>
                <p className="text-[13px] font-bold text-slate-900 flex items-center gap-1.5">
                  Background Verified
                </p>
                <p className="text-[11px] text-slate-600 font-medium leading-snug mt-0.5">
                  {driver?.name || 'Your driver'} has completed KYC and background checks.
                </p>
              </div>
            </div>

          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default SafetyToolkit;
