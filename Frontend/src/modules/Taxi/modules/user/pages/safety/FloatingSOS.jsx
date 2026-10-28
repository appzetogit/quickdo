import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert, X, AlertTriangle, Phone } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../../shared/api/axiosInstance';

const FloatingSOS = ({ rideId, driverId, location, rideStatus }) => {
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const handleSOS = async () => {
    setIsSending(true);
    try {
      await api.post('/safety/sos', {
        trip_id: rideId,
        driver_id: driverId,
        latitude: location?.lat,
        longitude: location?.lng,
        ride_status: rideStatus,
      });
      toast.success('Emergency alert sent! Help is on the way.', { duration: 5000 });
      setShowConfirm(false);
    } catch (err) {
      toast.error('Failed to send SOS. Please call emergency services directly.');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setShowConfirm(true)}
        className="absolute right-6 -top-5 z-[50] w-11 h-11 bg-red-600 text-white rounded-full flex items-center justify-center shadow-[0_4px_12px_rgba(220,38,38,0.4)] transition-transform active:scale-90 border-2 border-white"
        aria-label="Emergency SOS"
      >
        <ShieldAlert size={20} strokeWidth={3} />
      </button>

      <AnimatePresence>
        {showConfirm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-5 bg-slate-900/40 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white rounded-[24px] p-6 w-full max-w-xs shadow-2xl relative"
            >
              <button
                onClick={() => setShowConfirm(false)}
                className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500"
              >
                <X size={18} />
              </button>

              <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertTriangle size={32} strokeWidth={2.5} />
              </div>
              
              <h3 className="text-[18px] font-black text-center text-slate-900 leading-tight">
                Emergency Alert
              </h3>
              <p className="text-[13px] text-center text-slate-500 mt-2 font-medium">
                Are you sure you want to send an emergency SOS? Your live location and ride details will be shared immediately.
              </p>

              <div className="flex flex-col gap-3 mt-6">
                <button
                  onClick={handleSOS}
                  disabled={isSending}
                  className="w-full bg-red-600 text-white font-bold py-3.5 rounded-xl shadow-[0_4px_12px_rgba(220,38,38,0.25)] flex items-center justify-center gap-2"
                >
                  {isSending ? 'Sending...' : 'Send SOS'}
                </button>
                <button
                  onClick={() => setShowConfirm(false)}
                  className="w-full bg-slate-100 text-slate-700 font-bold py-3.5 rounded-xl"
                >
                  Cancel
                </button>
              </div>

              <div className="mt-4 pt-4 border-t border-slate-100 text-center">
                <button 
                  onClick={() => window.location.href = 'tel:100'}
                  className="text-blue-600 font-bold text-[14px] flex items-center justify-center gap-1.5 w-full"
                >
                  <Phone size={16} />
                  Call Police Directly
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
};

export default FloatingSOS;
