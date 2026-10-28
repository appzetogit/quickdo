import React from 'react';
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Leaf, AlertCircle, RefreshCw, X } from "lucide-react";

const VegModePopups = ({ 
  showVegModePopup, 
  showSwitchOffPopup, 
  onCloseVegPopup, 
  onCloseSwitchOffPopup,
  onConfirmSwitchOff 
}) => {
  return (
    <>
      {/* Pure Veg Mode Confirmation Overlay */}
      {createPortal(
        <AnimatePresence>
          {showVegModePopup && (
            <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onCloseVegPopup}
              />
              <motion.div
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                className="relative bg-white dark:bg-[#1a1a1a] rounded-3xl p-6 sm:p-8 max-w-sm w-full shadow-2xl overflow-hidden border border-green-100 dark:border-green-900/30"
              >
                {/* Decorative Elements */}
                <div className="absolute -top-10 -right-10 w-32 h-32 bg-green-500/10 rounded-full blur-3xl" />
                <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-green-500/10 rounded-full blur-3xl" />

                <div className="relative text-center">
                  <div className="w-20 h-20 bg-green-100 dark:bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-6 ring-8 ring-green-50 dark:ring-green-500/5">
                    <Leaf className="w-10 h-10 text-green-600 dark:text-green-400" />
                  </div>
                  <h3 className="text-2xl font-black text-gray-900 dark:text-white mb-3">Pure Veg Mode</h3>
                  <p className="text-gray-600 dark:text-gray-400 text-sm leading-relaxed mb-8">
                    We've filtered your feed to show only 100% vegetarian restaurants. Enjoy your meat-free browsing!
                  </p>
                  <button
                    onClick={onCloseVegPopup}
                    className="w-full py-4 bg-green-600 hover:bg-green-700 text-white font-bold rounded-2xl shadow-lg shadow-green-500/25 transition-all duration-300 transform active:scale-95"
                  >
                    Great, thanks!
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Pure Veg Mode Switch Off Confirmation */}
      {createPortal(
        <AnimatePresence>
          {showSwitchOffPopup && (
            <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onCloseSwitchOffPopup}
              />
              <motion.div
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                className="relative bg-white dark:bg-[#1a1a1a] rounded-3xl p-6 sm:p-8 max-w-sm w-full shadow-2xl overflow-hidden border border-primary-orange/10 dark:border-accent-orange/50/30"
              >
                <div className="absolute -top-10 -right-10 w-32 h-32 bg-primary-orange/50/10 rounded-full blur-3xl" />

                <div className="relative text-center">
                  <div className="w-20 h-20 bg-primary-orange/5 dark:bg-primary-orange/50/20 rounded-full flex items-center justify-center mx-auto mb-6 ring-8 ring-primary-orange/5/50 dark:ring-primary-orange/50/5">
                    <AlertCircle className="w-10 h-10 text-accent-orange dark:text-primary-orange/80" />
                  </div>
                  <h3 className="text-2xl font-black text-gray-900 dark:text-white mb-3">Switching Off?</h3>
                  <p className="text-gray-600 dark:text-gray-400 text-sm leading-relaxed mb-8">
                    This will re-enable non-vegetarian options in your feed. Are you sure you want to continue?
                  </p>
                  <div className="flex flex-col gap-3">
                    <button
                      onClick={onConfirmSwitchOff}
                      className="w-full py-4 bg-accent-orange hover:bg-accent-orange/90 text-white font-bold rounded-2xl shadow-lg shadow-primary-orange/50/25 transition-all duration-300 transform active:scale-95 flex items-center justify-center gap-2"
                    >
                      <RefreshCw className="w-4 h-4" />
                      Yes, Switch Off
                    </button>
                    <button
                      onClick={onCloseSwitchOffPopup}
                      className="w-full py-4 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-bold rounded-2xl transition-all duration-300"
                    >
                      Keep it On
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
};

export default React.memo(VegModePopups);
