import React, { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Car, Store, ArrowRight, CheckCircle2, Zap } from 'lucide-react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

const partners = [
  {
    type: 'driver', icon: Car,
    title: 'Become a Driver Partner',
    subtitle: 'Drive and earn on your schedule',
    description: 'Join our fleet of professional taxi and delivery partners. Take home higher earnings with low platform fees, flexible shifts, and instant wallet withdrawals.',
    benefits: ['Flexible working hours', 'Competitive commissions', 'In-app navigation & safety features', 'Fast weekly or instant cash payouts'],
    ctaText: 'Register as Driver', ctaHref: '/taxi/signup',
    color: '#00EB79', gradient: 'from-[#00EB79] to-[#10b981]',
  },
  {
    type: 'restaurant', icon: Store,
    title: 'Sell on Quick Drop',
    subtitle: 'Restaurants, stores and medical stores',
    description: 'List your restaurant, store or pharmacy on Quick Drop. Reach thousands of local customers and use our delivery fleet — register in minutes and start taking orders once approved.',
    benefits: ['Access to extensive customer database', 'Advanced order & dashboard analytics', 'Flexible pricing & promotional campaigns', 'Professional delivery network integration'],
    ctaText: 'Become a partner', ctaHref: '/partner',
    color: '#FFB800', gradient: 'from-[#FFB800] to-[#ff5100]',
  }
]

export default function Partners() {
  const [activeTab, setActiveTab] = useState('driver')
  const sectionRef = useRef(null)
  const headerRef = useRef(null)
  const cardRef = useRef(null)

  const activePartner = partners.find(p => p.type === activeTab)
  const IconComponent = activePartner.icon

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from(headerRef.current?.children, {
        y: 30, opacity: 0, duration: 0.7, stagger: 0.1, ease: 'power2.out',
        scrollTrigger: { trigger: headerRef.current, start: 'top 85%', once: true }
      })
      gsap.from(cardRef.current, {
        y: 40, opacity: 0, scale: 0.97, duration: 0.8, ease: 'power3.out',
        scrollTrigger: { trigger: cardRef.current, start: 'top 80%', once: true }
      })
    }, sectionRef)
    return () => ctx.revert()
  }, [])

  return (
    <section id="partners" ref={sectionRef} className="pt-12 pb-20 relative overflow-hidden bg-slate-950 text-white" style={{ fontFamily: "'Poppins', sans-serif" }}>
      {/* Background */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/3 left-1/4 w-[500px] h-[500px] rounded-full bg-[#00EB79]/[0.03] blur-[140px]" />
        <div className="absolute bottom-0 right-1/3 w-[400px] h-[400px] rounded-full bg-[#FFB800]/[0.03] blur-[120px]" />
        <div
          className="absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage: 'radial-gradient(rgba(255,255,255,0.15) 1px, transparent 1px)',
            backgroundSize: '24px 24px'
          }}
        />
      </div>

      <div className="max-w-6xl mx-auto px-6 relative z-10">

        {/* Header */}
        <div ref={headerRef} className="text-center max-w-3xl mx-auto mb-14 space-y-4">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500 mb-1">Partnerships</p>
          <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white">
            Grow and{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#ff5100] via-[#e11d48] via-[#1d4ed8] to-[#10b981]">
              Earn
            </span>{' '}
            with Quick Drop
          </h2>
          <p className="text-slate-400 text-sm leading-relaxed max-w-lg mx-auto">
            We support localized economic growth. Whether you are an independent driver or a local culinary business, our tools are built to scale your business.
          </p>
        </div>

        {/* Large Icon Toggle Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-md mx-auto mb-10">
          {partners.map((partner) => {
            const Icon = partner.icon
            const isSelected = activeTab === partner.type
            return (
              <button
                key={partner.type}
                onClick={() => setActiveTab(partner.type)}
                className="relative p-6 rounded-2xl border-2 text-center transition-all duration-300 group overflow-hidden"
                style={{
                  background: isSelected ? `linear-gradient(135deg, ${partner.color}15, ${partner.color}08)` : 'rgba(255,255,255,0.03)',
                  borderColor: isSelected ? `${partner.color}50` : 'rgba(255,255,255,0.08)',
                  boxShadow: isSelected ? `0 8px 30px ${partner.color}15` : ''
                }}
              >
                {isSelected && (
                  <div
                    className="absolute inset-0 rounded-2xl opacity-5 blur-2xl pointer-events-none"
                    style={{ background: `radial-gradient(circle, ${partner.color}, transparent)` }}
                  />
                )}
                <div
                  className="w-14 h-14 rounded-xl flex items-center justify-center mx-auto mb-3 transition-all duration-300 group-hover:scale-110"
                  style={{
                    background: isSelected ? `linear-gradient(135deg, ${partner.color}30, ${partner.color}15)` : 'rgba(255,255,255,0.06)',
                    color: isSelected ? partner.color : '#64748b'
                  }}
                >
                  <Icon className="w-7 h-7" />
                </div>
                <p className={`text-xs font-black uppercase tracking-wide transition-colors ${isSelected ? 'text-white' : 'text-slate-500 group-hover:text-slate-300'}`}>
                  {partner.type}
                </p>
              </button>
            )
          })}
        </div>

        {/* Tab Content Card */}
        <div
          ref={cardRef}
          className="rounded-[32px] border overflow-hidden relative"
          style={{
            background: 'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))',
            borderColor: 'rgba(255,255,255,0.08)',
            backdropFilter: 'blur(20px)'
          }}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.35 }}
              className="grid grid-cols-1 md:grid-cols-12 gap-0 items-stretch"
            >
              {/* Left: Details */}
              <div className="md:col-span-7 p-10 sm:p-12 space-y-6 border-b md:border-b-0 md:border-r border-white/[0.06]">
                <div className="flex items-center gap-4">
                  <div
                    className="h-14 w-14 rounded-2xl flex items-center justify-center border transition-all"
                    style={{ background: `${activePartner.color}15`, borderColor: `${activePartner.color}30`, color: activePartner.color }}
                  >
                    <IconComponent className="w-7 h-7" />
                  </div>
                  <div>
                    <h3 className="text-xl sm:text-2xl font-bold tracking-tight text-white">{activePartner.title}</h3>
                    <p className="text-xs sm:text-sm font-semibold mt-0.5" style={{ color: activePartner.color }}>{activePartner.subtitle}</p>
                  </div>
                </div>

                <p className="text-slate-400 text-sm leading-relaxed">{activePartner.description}</p>

                {/* Benefits */}
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  {activePartner.benefits.map((benefit, bIdx) => (
                    <motion.li
                      key={bIdx}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: bIdx * 0.08, duration: 0.3 }}
                      className="flex items-center gap-3 text-xs text-slate-300 font-medium"
                    >
                      <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: activePartner.color }} />
                      <span>{benefit}</span>
                    </motion.li>
                  ))}
                </ul>
              </div>

              {/* Right: CTA */}
              <div className="md:col-span-5 p-10 sm:p-12 flex flex-col justify-center items-start gap-6">
                <div>
                  <p className="text-slate-400 text-sm leading-relaxed mb-6">
                    Ready to get started? Register online and our onboarding team will reach out within 24 hours.
                  </p>

                  {/* CTA with pulse ring */}
                  <div className="relative w-fit">
                    <a
                      href={activePartner.ctaHref}
                      className="relative inline-flex items-center gap-2.5 font-bold px-7 py-4 rounded-full text-white text-sm k9-btn-glow-pulse"
                    >
                      <Zap className="w-4 h-4" />
                      {activePartner.ctaText}
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </a>
                  </div>
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

      </div>
    </section>
  )
}
