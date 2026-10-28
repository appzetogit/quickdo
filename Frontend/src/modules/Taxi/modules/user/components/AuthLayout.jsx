import React from 'react';
import { motion } from 'framer-motion';
import heroImg from '@/assets/landing/hero.png';
import { useSettings } from '../../../shared/context/SettingsContext';

import mobilityBanner from '@/assets/images/mobility-banner-cartoony.png';

const AuthLayout = ({ children, title, subtitle }) => {
  const { settings, activeLogo } = useSettings();
  const appName = settings.general?.app_name || 'App';
  const appLogo = activeLogo || settings.general?.logo || settings.customization?.logo || '';

  return (
    <div className="h-screen w-screen bg-[#F8F9FA] flex flex-col lg:flex-row font-display overflow-hidden fixed inset-0">
      {/* Left side (Desktop Only) */}
      <div className="hidden lg:flex flex-col justify-between lg:w-[45%] xl:w-[50%] bg-[#1A1A1A] p-12 text-white relative overflow-hidden shadow-[20px_0_40px_rgba(0,0,0,0.1)] z-10">
        {/* Subtle orange accent glow */}
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
          <div className="absolute -top-[20%] -left-[10%] w-[70%] h-[70%] bg-[#F38F24]/5 rounded-full blur-[120px]" />
          <div className="absolute top-[60%] right-[10%] w-[50%] h-[50%] bg-white/5 rounded-full blur-[100px]" />
        </div>

        <div className="relative z-10 w-full h-full flex flex-col justify-between">
          <div className="flex items-center gap-4 mb-16">
            {appLogo ? (
              <img
                src={appLogo}
                alt={`${appName} logo`}
                className="w-12 h-12 rounded-xl object-contain bg-white shadow-lg p-1"
              />
            ) : (
              <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center shadow-lg">
                <div className="w-6 h-6 bg-[#1A1A1A] rounded-md"></div>
              </div>
            )}
            <span className="text-3xl font-black tracking-tight">{appName}</span>
          </div>

          <div className="max-w-xl">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <h2 className="text-5xl font-bold tracking-tight leading-[1.1] mb-6">
                Move with <br />
                <span className="text-[#F38F24]">Safety & Style.</span>
              </h2>
              <p className="text-gray-400 text-lg leading-relaxed mb-12">
                Experience the next generation of urban mobility with {appName}. Reliable, fast, and always at your service.
              </p>

              <div className="flex gap-4">
                <div className="px-6 py-4 bg-white/5 rounded-2xl border border-white/10">
                  <p className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-1">Global Coverage</p>
                  <p className="text-white font-semibold">15,000+ Cities</p>
                </div>
                <div className="px-6 py-4 bg-white/5 rounded-2xl border border-white/10">
                  <p className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-1">Safe Rides</p>
                  <p className="text-white font-semibold">Verified Drivers</p>
                </div>
              </div>
            </motion.div>
          </div>

          <div className="flex items-center gap-6 text-xs font-semibold text-gray-500 uppercase tracking-wider mt-12">
            <span>© {appName} 2026</span>
            <a href="/terms" className="hover:text-white transition-colors">Terms</a>
            <a href="/privacy" className="hover:text-white transition-colors">Privacy</a>
          </div>
        </div>
      </div>

      {/* Right side (Main content) */}
      <div className="flex-1 h-full flex flex-col items-center justify-start lg:justify-center relative w-full bg-[#F8F9FA] overflow-y-auto lg:overflow-hidden">

        {/* Premium Mobile Background (Hidden on Desktop) */}
        <div className="lg:hidden absolute top-0 left-0 w-full h-[300px] bg-[#1A1A1A] rounded-b-[2.5rem] z-0 overflow-hidden shadow-lg">
          <div className="absolute top-0 right-0 w-64 h-64 bg-[#F38F24]/10 rounded-full blur-[60px] -mr-20 -mt-20" />
          <div className="absolute bottom-0 left-0 w-40 h-40 bg-white/5 rounded-full blur-[40px] -ml-10 -mb-10" />
        </div>

        {/* Mobile Header (Visible only on small screens) */}
        <div className="lg:hidden w-full flex flex-col items-center text-center mt-10 mb-8 z-20 px-6">
          {appLogo ? (
            <img
              src={appLogo}
              alt={`${appName} logo`}
              className="w-16 h-16 rounded-2xl object-contain bg-white p-2 mb-4 shadow-xl"
            />
          ) : (
            <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mb-4 shadow-xl">
              <div className="w-8 h-8 bg-[#1A1A1A] rounded-lg"></div>
            </div>
          )}
          <h2 className="text-2xl font-black text-white tracking-tight mb-2">{appName}</h2>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-[420px] bg-white lg:bg-transparent rounded-3xl p-6 lg:p-0 z-10 relative shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)] lg:shadow-none mx-4 lg:mx-0 mb-8 lg:mb-0"
        >
          {title && (
            <div className="mb-10 text-left">
              <h1 className="text-3xl font-black text-[#1A1A1A] tracking-tight mb-2">
                {title}
              </h1>
              {subtitle && (
                <p className="text-gray-500 text-sm">
                  {subtitle}
                </p>
              )}
            </div>
          )}
          <div className="relative z-10 w-full">
            {children}
          </div>
        </motion.div>

        {/* Helper footer link */}
        <div className="mt-auto lg:mt-12 text-center w-full max-w-[420px] z-20 pb-8 lg:pb-0">
          <p className="text-xs text-gray-400 flex items-center justify-center gap-2">
            <span className="w-4 h-4 rounded-full border border-gray-300 flex items-center justify-center font-bold text-[10px]">?</span>
            Need assistance? <a href="/support" className="text-[#1A1A1A] font-semibold hover:text-[#F38F24] transition-colors ml-1">Contact Support</a>
          </p>
        </div>
      </div>
    </div>
  );
};

export default AuthLayout;
