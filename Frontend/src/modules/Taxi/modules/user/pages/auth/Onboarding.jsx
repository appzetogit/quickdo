import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { useSettings } from '../../../../shared/context/SettingsContext';

const FALLBACK_SLIDES = [
  {
    id: 1,
    title: 'Fast & Affordable Rides',
    body: 'Bike, auto, and cab rides at the best prices in Indore. Book in seconds.',
    image: '/1_Bike.png',
    gradientFrom: '#F97316',
    gradientTo: '#EA580C',
  },
  {
    id: 2,
    title: 'Your Safety, Our Priority',
    body: 'SOS contacts, live tracking, and verified drivers on every single trip.',
    image: '/Everyones Safety Matters.jpg',
    gradientFrom: '#3B82F6',
    gradientTo: '#1D4ED8',
  },
  {
    id: 3,
    title: 'Earn with Every Referral',
    body: 'Share your code and earn ₹50 for every friend who joins Quick Drop.',
    image: '/man.png',
    gradientFrom: '#10B981',
    gradientTo: '#059669',
  },
];

const Onboarding = () => {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const appName = settings.general?.app_name || 'App';
  const [slides, setSlides] = useState(FALLBACK_SLIDES);
  const [current, setCurrent] = useState(0);
  const [direction, setDirection] = useState(1);

  useEffect(() => {
    // Guard: skip onboarding if already completed
    if (localStorage.getItem('onboarding_complete')) {
      navigate('/', { replace: true });
      return;
    }
    // Try to fetch slides from API
    fetch('/api/v1/on-boarding')
      .then(r => r.json())
      .then(data => { if (data?.slides?.length) setSlides(data.slides); })
      .catch(() => {}); // silent fallback to FALLBACK_SLIDES
  }, []);

  const finish = () => {
    localStorage.setItem('onboarding_complete', '1');
    navigate('/taxi/user/login');
  };

  const handleNext = () => {
    if (current < slides.length - 1) {
      setDirection(1);
      setCurrent(c => Math.min(c + 1, slides.length - 1));
    } else {
      finish();
    }
  };

  const slide = slides[current];
  const isLast = current === slides.length - 1;
  const slideBody = String(slide?.body || '').replace(/K9 Rides/gi, appName);

  const variants = {
    enter:  (dir) => ({ x: dir > 0 ? 60 : -60, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit:   (dir) => ({ x: dir > 0 ? -60 : 60, opacity: 0 }),
  };

  return (
    <div className="min-h-screen max-w-lg mx-auto font-sans flex flex-col overflow-hidden relative"
      style={{ background: `linear-gradient(160deg, ${slide.gradientFrom} 0%, ${slide.gradientTo} 100%)` }}>

      {/* Background blobs */}
      <div className="absolute top-0 right-0 w-64 h-64 rounded-full bg-white/10 blur-3xl pointer-events-none" />
      <div className="absolute bottom-32 left-0 w-48 h-48 rounded-full bg-black/10 blur-3xl pointer-events-none" />

      {/* Skip button */}
      <div className="flex justify-end px-6 pt-12 pb-4 relative z-10">
        <button onClick={finish}
          className="text-[12px] font-black text-white/70 uppercase tracking-widest px-4 py-2 rounded-full border border-white/20 active:bg-white/10 transition-all">
          Skip
        </button>
      </div>

      {/* Slide content */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 relative z-10">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div key={slide.id}
            custom={direction}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="flex flex-col items-center text-center">
            {/* Image */}
            <div className="w-56 h-56 mb-8 flex items-center justify-center">
              <img src={slide.image} alt={slide.title}
                className="w-full h-full object-contain drop-shadow-[0_20px_40px_rgba(0,0,0,0.25)]" />
            </div>
            {/* Text */}
            <h1 className="text-[28px] font-black text-white leading-tight tracking-tight mb-3">{slide.title}</h1>
            <p className="text-[14px] font-bold text-white/75 leading-relaxed max-w-[280px]">{slideBody}</p>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom section */}
      <div className="px-6 pb-12 relative z-10 space-y-6">
        {/* Dot indicators */}
        <div className="flex items-center justify-center gap-2">
          {slides.map((_, i) => (
            <motion.div key={i}
              animate={{ width: i === current ? 24 : 8, opacity: i === current ? 1 : 0.4 }}
              transition={{ duration: 0.25 }}
              className="h-2 rounded-full bg-white"
            />
          ))}
        </div>

        {/* CTA button */}
        <motion.button whileTap={{ scale: 0.97 }} onClick={handleNext}
          className="w-full bg-white py-4 rounded-[18px] text-[15px] font-black uppercase tracking-widest flex items-center justify-center gap-2 shadow-[0_8px_24px_rgba(0,0,0,0.15)]"
          style={{ color: slide.gradientTo }}>
          {isLast ? 'Get Started' : 'Next'}
          <ChevronRight size={17} strokeWidth={3} className="opacity-60" />
        </motion.button>
      </div>
    </div>
  );
};

export default Onboarding;
