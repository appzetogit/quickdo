import React, { Suspense, useEffect, useRef, useState, lazy } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowRight, Car, Utensils } from 'lucide-react'
import { gsap } from 'gsap'

import premiumCar from '../assets/premium-royal-car.png'
import taxiHeroBg from '../../Taxi/assets/landing/hero-bg.png'

const ThreeBackground = lazy(() => import('./ThreeBackground'))

export default function Hero({ settings }) {
  const statsRef = useRef(null)
  const [bgIndex, setBgIndex] = useState(0)
  const [isDesktop, setIsDesktop] = useState(false)

  useEffect(() => {
    const handleResize = () => {
      setIsDesktop(window.innerWidth >= 768)
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const slides = [
    {
      img: '/hero2.png',
      line1: 'Your city,',
      line2: 'at your fingertips.',
      desc: settings?.hero_description || 'Order premium rides, track deliveries in real time, send couriers securely, and book logistics instantly. All in one super-app.'
    },
    {
      img: taxiHeroBg,
      line1: 'Your rides,',
      line2: 'booked in seconds.',
      desc: 'Travel in comfort with verified professional captains, real-time GPS tracking, and instant safety features.'
    },
    {
      img: premiumCar,
      line1: 'Your food,',
      line2: 'delivered hot & fresh.',
      desc: 'Order from local favorites or search top dining options with swift contactless cargo deliveries.'
    }
  ]

  useEffect(() => {
    const timer = setInterval(() => {
      setBgIndex((prev) => (prev + 1) % slides.length)
    }, 6000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (statsRef.current) {
      gsap.fromTo(
        statsRef.current.querySelectorAll('[data-stat]'),
        { y: 20, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.5, stagger: 0.1, ease: 'power3.out', delay: 0.9 }
      )
    }
  }, [])

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.1, delayChildren: 0.1 } }
  }

  const itemVariants = {
    hidden: { y: 30, opacity: 0 },
    visible: { y: 0, opacity: 1, transition: { type: 'spring', stiffness: 75, damping: 18 } }
  }

  const textTransitionVariants = {
    initial: { opacity: 0, y: 15 },
    animate: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' } },
    exit: { opacity: 0, y: -15, transition: { duration: 0.4, ease: 'easeIn' } }
  }

  return (
    <section
      className="relative min-h-screen flex items-center justify-center overflow-hidden z-10"
      style={{
        fontFamily: "'Poppins', sans-serif",
        background: '#FAFBFC'
      }}
    >
      {/* Background Slideshow with white-washed light overlays */}
      {slides.map((slide, idx) => {
        // Only load background image if it is current active or next in queue to prevent massive initial download size on load!
        const shouldLoad = bgIndex === idx || (bgIndex + 1) % slides.length === idx;
        return (
          <div
            key={idx}
            className="absolute inset-0 transition-opacity duration-[1500ms] ease-in-out pointer-events-none"
            style={{
              backgroundImage: shouldLoad ? `linear-gradient(rgba(250, 251, 252, 0.40), rgba(250, 251, 252, 0.55)), url(${slide.img})` : 'none',
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              opacity: bgIndex === idx ? 0.85 : 0,
              zIndex: 0
            }}
          />
        )
      })}

      {/* Three.js 3D background */}
      {isDesktop && (
        <Suspense fallback={null}>
          <div style={{ opacity: 0.04 }} className="absolute inset-0 z-0 pointer-events-none">
            <ThreeBackground />
          </div>
        </Suspense>
      )}

      {/* Animated drifting glowing orbs behind copy */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute -top-[10%] left-[20%] w-[350px] h-[350px] rounded-full bg-gradient-to-br from-[#ff5100] to-[#e11d48] opacity-5 blur-[110px] animate-drift-orange" />
        <div className="absolute top-[40%] left-[5%] w-[400px] h-[400px] rounded-full bg-gradient-to-br from-[#1d4ed8] to-[#10b981] opacity-5 blur-[120px] animate-drift-blue" />
      </div>

      <div className="max-w-4xl mx-auto px-6 lg:px-8 w-full pt-32 pb-20 relative z-10 flex flex-col items-center justify-center">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="space-y-8 text-center max-w-3xl"
        >
          {/* Section Heading Name */}
          <p className="text-xs font-black uppercase tracking-[0.2em] text-transparent bg-clip-text bg-gradient-to-r from-[#d94600] via-[#be123c] to-[#1e40af]">
            Welcome to Quick Drop
          </p>

          {/* Headline Slogans Carousel wrapper */}
          <div className="min-h-[140px] sm:min-h-[180px] flex items-center justify-center">
            <AnimatePresence mode="wait">
              <motion.h1
                key={bgIndex}
                variants={textTransitionVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="text-5xl sm:text-6xl lg:text-7.5xl font-black tracking-tight text-slate-900 leading-[1.08] select-none"
                style={{
                  textShadow: '0 4px 20px rgba(15,23,42,0.03)'
                }}
              >
                {slides[bgIndex].line1}<br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#d94600] via-[#be123c] via-[#1e40af] to-[#047857]">
                  {slides[bgIndex].line2.split(' ')[0]} {slides[bgIndex].line2.split(' ')[1] || ''}
                </span>{' '}
                {slides[bgIndex].line2.split(' ').slice(2).join(' ')}
              </motion.h1>
            </AnimatePresence>
          </div>

          {/* Description Carousel wrapper */}
          <div className="min-h-[60px] flex items-center justify-center max-w-2xl mx-auto">
            <AnimatePresence mode="wait">
              <motion.p
                key={bgIndex}
                variants={textTransitionVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="text-slate-900 text-lg sm:text-xl leading-relaxed font-bold"
              >
                {slides[bgIndex].desc}
              </motion.p>
            </AnimatePresence>
          </div>

          {/* CTA Buttons - App Download Badges */}
          <motion.div variants={itemVariants} className="flex flex-wrap gap-4 justify-center pt-6">
            <a
              href="https://play.google.com/store/apps/details?id=com.k9bharat.user"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-transform duration-200 hover:scale-[1.04]"
            >
              <img
                src="https://upload.wikimedia.org/wikipedia/commons/7/78/Google_Play_Store_badge_EN.svg"
                alt="Get it on Google Play"
                className="h-12 w-auto"
              />
            </a>
            <a
              href="https://www.apple.com/app-store/"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-transform duration-200 hover:scale-[1.04]"
            >
              <img
                src="https://upload.wikimedia.org/wikipedia/commons/3/3c/Download_on_the_App_Store_Badge.svg"
                alt="Download on the App Store"
                className="h-12 w-auto"
              />
            </a>
          </motion.div>
        </motion.div>

        {/* Services pill strip */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8, duration: 0.7 }}
          className="mt-20 flex flex-wrap justify-center gap-3"
        >
          {['🚕 Ride Hailing', '🍔 Food Delivery', '📦 Courier', '✈️ Airport Transfer', '🏍️ Hourly Rentals', '🚛 Cargo'].map((s) => {
            const isFood = s.includes('Food') || s.includes('Courier') || s.includes('Rentals');
            const isRide = s.includes('Ride') || s.includes('Airport') || s.includes('Cargo');
            let borderColor = 'rgba(15,23,42,0.1)';
            let textColor = 'rgba(15,23,42,0.7)';
            let bg = 'rgba(15,23,42,0.02)';
            let scaleClass = '';

            if (isFood) {
              borderColor = 'rgba(255,81,0,0.3)';
              textColor = '#ff5100';
              bg = 'rgba(255,81,0,0.06)';
              scaleClass = 'scale-105 shadow-md shadow-[#ff5100]/5';
            } else if (isRide) {
              borderColor = 'rgba(29,78,216,0.3)';
              textColor = '#1d4ed8';
              bg = 'rgba(29,78,216,0.06)';
              scaleClass = 'scale-105 shadow-md shadow-[#1d4ed8]/5';
            }

            return (
              <span key={s}
                className={`px-4 py-2 rounded-full text-sm font-semibold border transition-all duration-300 ${scaleClass}`}
                style={{
                  borderColor,
                  color: textColor,
                  background: bg
                }}>
                {s}
              </span>
            );
          })}
        </motion.div>
      </div>

      {/* Wave bottom transition */}
      <div className="absolute bottom-0 left-0 right-0 pointer-events-none">
        <svg viewBox="0 0 1440 80" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" className="w-full h-16 sm:h-20">
          <path d="M0,40 C360,80 1080,0 1440,40 L1440,80 L0,80 Z" fill="#F8FAFC" />
        </svg>
      </div>
    </section>
  )
}
