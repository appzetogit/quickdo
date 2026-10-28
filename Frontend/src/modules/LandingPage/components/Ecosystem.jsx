import React, { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { UtensilsCrossed, Car, ArrowRight, CheckCircle2, Zap, Clock, Star } from 'lucide-react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import k9Logo from '../assets/k9-logo.png'

gsap.registerPlugin(ScrollTrigger)

const selectionOptions = [
  {
    id: 'food',
    name: 'Food Delivery',
    subtitle: 'Order gourmet dining instantly',
    description: 'Order from local favorites delivered directly to your doorstep. Powered by live tracking, heat-insulated cargo carrier fleets, and dynamic route dispatch algorithms.',
    icon: UtensilsCrossed,
    gradient: 'from-[#ff5100] to-[#e11d48]',
    primary: '#ff5100',
    secondary: '#e11d48',
    path: '/food/user',
    highlights: ['Instant restaurant matching', 'Live food prep tracking', 'Contactless hot delivery'],
  },
  {
    id: 'taxi',
    name: 'Ride Hailing',
    subtitle: 'Secure & private taxi booking',
    description: 'Book reliable premium rides on demand. Vetted drivers, real-time route optimization, transparent fares, and instant security alert integrations.',
    icon: Car,
    gradient: 'from-[#1d4ed8] to-[#10b981]',
    primary: '#1d4ed8',
    secondary: '#10b981',
    path: '/taxi/user',
    highlights: ['SOS dashboard integration', 'Shared ride fare splitting', 'Premium standard vehicles'],
  }
]

export default function Ecosystem() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('food')
  const sectionRef = useRef(null)
  const cardRef = useRef(null)

  const activeOption = selectionOptions.find(o => o.id === activeTab)

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from(cardRef.current, {
        y: 60, opacity: 0, duration: 1, ease: 'power3.out',
        scrollTrigger: { trigger: cardRef.current, start: 'top 88%', once: true }
      })
    }, sectionRef)
    return () => ctx.revert()
  }, [])

  return (
    <section ref={sectionRef} className="py-16 bg-white overflow-hidden border-t border-slate-100" style={{ fontFamily: "'Poppins', sans-serif" }}>
      <div className="max-w-6xl mx-auto px-6">

        {/* Section Label */}
        <div className="text-center mb-10">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400 mb-3">Unified Ecosystem</p>
          <h2 className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight">
            Choose Your{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#ff5100] via-[#e11d48] via-[#1d4ed8] to-[#10b981]">
              Experience
            </span>
          </h2>
        </div>

        {/* Main Widget Card */}
        <div
          ref={cardRef}
          className="rounded-[32px] overflow-hidden shadow-2xl border border-slate-200/60 bg-white flex flex-col lg:flex-row"
          style={{ minHeight: '520px' }}
        >
          {/* Left Dark Branding Panel */}
          <div className="lg:w-[42%] bg-[#060B0A] p-10 sm:p-12 text-white flex flex-col justify-between relative overflow-hidden">
            {/* Animated ambient orbs */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              <motion.div
                animate={{ x: [0, 20, 0], y: [0, -20, 0] }}
                transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute -top-[20%] -left-[10%] w-[70%] h-[70%] rounded-full blur-[100px]"
                style={{ background: `${activeOption.primary}18` }}
              />
              <motion.div
                animate={{ x: [0, -15, 0], y: [0, 15, 0] }}
                transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
                className="absolute top-[55%] right-[5%] w-[55%] h-[55%] rounded-full blur-[90px]"
                style={{ background: `${activeOption.secondary}12` }}
              />
            </div>

            <div className="relative z-10 space-y-10">
              {/* Brand */}
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 flex items-center justify-center bg-white rounded-xl shadow-lg overflow-hidden">
                  <img src={k9Logo} alt="Quick Drop" className="w-full h-full object-cover" loading="lazy" />
                </div>
                <span className="text-xl font-black tracking-tight text-white">Quick Drop</span>
              </div>

              {/* Tagline */}
              <div className="space-y-4">
                <h3 className="text-3xl sm:text-4xl font-extrabold tracking-tighter leading-[1.1] text-white">
                  The unified <br />
                  <span
                    className="text-transparent bg-clip-text"
                    style={{ backgroundImage: `linear-gradient(90deg, ${activeOption.primary}, ${activeOption.secondary})` }}
                  >
                    ecosystem
                  </span>
                  <br />for everything.
                </h3>
                <p className="text-slate-400 text-sm leading-relaxed max-w-xs">
                  Food delivery, ride-hailing, and logistics on a single enterprise-grade framework designed for contemporary urban transit.
                </p>
              </div>

            </div>

            {/* Footer tags */}
            <div className="relative z-10 flex gap-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-8">
              <span>Food</span>
              <span style={{ color: activeOption.primary }}>•</span>
              <span>Rides</span>
              <span className="text-[#1d4ed8]">•</span>
              <span>Logistics</span>
            </div>
          </div>

          {/* Right Interactive Panel */}
          <div className="flex-1 p-10 sm:p-12 flex flex-col justify-between bg-slate-50/60">
            <div className="space-y-8">
              <div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {selectionOptions.map((opt) => {
                    const isSelected = activeTab === opt.id
                    const Icon = opt.icon
                    return (
                      <button
                        key={opt.id}
                        onClick={() => setActiveTab(opt.id)}
                        className={`relative p-6 rounded-2xl border-2 text-left transition-all duration-300 group overflow-hidden ${isSelected
                            ? 'border-transparent shadow-lg scale-[1.02]'
                            : 'border-slate-200 hover:border-slate-300 bg-white hover:shadow-md'
                          }`}
                        style={isSelected ? {
                          background: `linear-gradient(135deg, ${opt.primary}12, ${opt.secondary}08)`,
                          borderColor: `${opt.primary}40`
                        } : {}}
                      >
                        {isSelected && (
                          <div
                            className="absolute inset-0 rounded-2xl opacity-10 blur-xl pointer-events-none"
                            style={{ background: `radial-gradient(circle, ${opt.primary}, transparent)` }}
                          />
                        )}
                        <div
                          className="w-12 h-12 rounded-xl flex items-center justify-center mb-4 transition-all duration-300"
                          style={{
                            background: isSelected ? `linear-gradient(135deg, ${opt.primary}, ${opt.secondary})` : `${opt.primary}12`,
                            color: isSelected ? 'white' : opt.primary
                          }}
                        >
                          <Icon className="w-6 h-6" />
                        </div>
                        <p className={`text-sm font-black tracking-tight transition-colors ${isSelected ? 'text-slate-900' : 'text-slate-600'}`}>
                          {opt.name}
                        </p>
                        <p className="text-[11px] mt-0.5 font-medium" style={{ color: isSelected ? opt.primary : '#94a3b8' }}>
                          {opt.subtitle}
                        </p>
                      </button>
                    )
                  })}
                </div>

                {/* Tab Content */}
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeTab}
                    initial={{ opacity: 0, x: 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -16 }}
                    transition={{ duration: 0.35, ease: 'easeOut' }}
                    className="space-y-6 mt-8"
                  >
                    <p className="text-slate-650 text-sm leading-relaxed font-medium">{activeOption.description}</p>

                    <div className="grid grid-cols-1 gap-2.5">
                      {activeOption.highlights.map((h, i) => (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, x: 12 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.07, duration: 0.3 }}
                          className="flex items-center gap-2.5 text-xs text-slate-600 font-semibold"
                        >
                          <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: activeOption.primary }} />
                          <span>{h}</span>
                        </motion.div>
                      ))}
                    </div>
                  </motion.div>
                </AnimatePresence>
              </div>

              {/* CTA - App Download Badges */}
              <div className="pt-8 border-t border-slate-200 mt-8 flex gap-4 justify-center">
                <a
                  href="https://play.google.com/store/apps/details?id=com.k9bharat.user"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="transition-transform duration-200 hover:scale-[1.04]"
                >
                  <img
                    src="https://upload.wikimedia.org/wikipedia/commons/7/78/Google_Play_Store_badge_EN.svg"
                    alt="Get it on Google Play"
                    className="h-10 w-auto"
                    loading="lazy"
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
                    className="h-10 w-auto"
                    loading="lazy"
                  />
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
