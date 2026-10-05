import React from 'react';
import { motion } from 'framer-motion';

/**
 * LogoLoader Component
 * @param {boolean} fullScreen - If true, shows a full-screen overlay (for initial app load). 
 *                               If false, shows an inline loader (for route transitions).
 * @param {boolean} overlay - If true with fullScreen, uses solid white background. 
 *                            If false, uses transparent background (doesn't hide BottomNav).
 * @param {string} size - Size classes for the logo
 */
const LogoLoader = ({ fullScreen = false, overlay = false, inline = false, size = "w-20 h-20" }) => {
  // For route transitions (default), use a non-blocking loader
  // For initial app load, use fullScreen with overlay
  // For inline loading (e.g. buttons), use inline
  const containerClasses = fullScreen
    ? overlay
      ? "fixed inset-0 flex items-center justify-center bg-white z-[9999]"
      : "fixed inset-0 flex items-center justify-center bg-white/80 backdrop-blur-sm z-[100]"
    : inline
      ? "flex items-center justify-center"
      : "flex items-center justify-center w-full min-h-[60vh] pb-20"; // Leave space for bottom nav

  return (
    <div className={containerClasses}>
      <motion.div
        initial={{ scale: 0.9, opacity: 0.7 }}
        animate={{
          scale: [0.9, 1.05, 0.9],
          opacity: [0.7, 1, 0.7],
        }}
        transition={{
          duration: 1.2,
          repeat: Infinity,
          ease: "easeInOut"
        }}
        className={`relative ${size} flex items-center justify-center`}
      >
        <img
          src="/truliq-logo.png"
          alt="Truliq"
          className="w-full h-full object-contain"
        />
        {/* Subtle ripple effect */}
        <motion.div
          className="absolute inset-0 rounded-full border-2 border-teal-200"
          animate={{
            scale: [1, 1.4],
            opacity: [0.6, 0]
          }}
          transition={{
            duration: 1,
            repeat: Infinity,
            ease: "easeOut"
          }}
        />
      </motion.div>
    </div>
  );
};

export default LogoLoader;

