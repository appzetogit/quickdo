import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, AlertTriangle, Wallet, Trash2 } from 'lucide-react';

const DeleteAccountModal = ({ 
  isOpen, 
  onClose, 
  onConfirm, 
  walletAmount = 0, 
  moduleName = 'user' 
}) => {
  const [deleteText, setDeleteText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const handleConfirm = async () => {
    if (deleteText === 'DELETE') {
      setIsDeleting(true);
      await onConfirm();
      setIsDeleting(false);
    }
  };

  const isRestaurantOrDelivery = moduleName === 'restaurant' || moduleName === 'delivery';

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[999]"
          />

          {/* Modal */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto bg-white rounded-t-[32px] p-6 z-[1000] shadow-2xl safe-area-bottom"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center">
                  <AlertTriangle className="w-6 h-6 text-red-500" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Delete Account</h2>
                  <p className="text-sm text-gray-500">This action is permanent</p>
                </div>
              </div>
              <button 
                onClick={onClose}
                className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center hover:bg-gray-100 transition-colors"
              >
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            {/* Warning Content */}
            <div className="space-y-4 mb-8">
              <div className="p-4 rounded-2xl bg-red-50 border border-red-100">
                <p className="text-sm text-red-700 leading-relaxed font-medium">
                  Warning: Deleting your account will permanently remove all your data, including order history, saved addresses, and active rewards. This cannot be undone.
                </p>
              </div>

              {isRestaurantOrDelivery && walletAmount > 0 && (
                <div className="p-4 rounded-2xl bg-amber-50 border border-amber-100 flex gap-3 items-start">
                  <div className="p-2 rounded-xl bg-amber-100 shrink-0">
                    <Wallet className="w-5 h-5 text-amber-600" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-amber-900">Withdrawal Required</h4>
                    <p className="text-xs text-amber-700 mt-1 leading-relaxed">
                      You have a remaining balance of <span className="font-bold">₹{walletAmount}</span> in your wallet. 
                      Please withdraw your funds before deleting your account to avoid losing them.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Confirmation Input */}
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-600 px-1">
                  Type <span className="text-red-600 font-bold">DELETE</span> to confirm
                </label>
                <input
                  type="text"
                  value={deleteText}
                  onChange={(e) => setDeleteText(e.target.value.toUpperCase())}
                  placeholder="Type DELETE here"
                  className="w-full h-14 px-5 rounded-2xl bg-gray-50 border-2 border-gray-100 focus:border-red-500 focus:ring-0 transition-all font-bold tracking-wider placeholder:font-normal placeholder:tracking-normal"
                />
              </div>

              <button
                onClick={handleConfirm}
                disabled={deleteText !== 'DELETE' || isDeleting}
                className={`w-full h-14 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all ${
                  deleteText === 'DELETE' && !isDeleting
                    ? 'bg-red-500 text-white shadow-lg shadow-red-200 active:scale-[0.98]'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                }`}
              >
                {isDeleting ? (
                  <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <Trash2 className="w-5 h-5" />
                    Permanently Delete Account
                  </>
                )}
              </button>
              
              <button
                onClick={onClose}
                className="w-full text-center py-2 text-sm font-semibold text-gray-500 hover:text-gray-700 transition-colors"
                disabled={isDeleting}
              >
                Nevermind, keep my account
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default DeleteAccountModal;
