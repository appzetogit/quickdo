import React, { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { ShieldCheck, Clock, Users, TrendingUp } from 'lucide-react'

gsap.registerPlugin(ScrollTrigger)

const props = [
  {
    title: 'Safety First, Always',
    description: 'Every driver undergoes strict criminal background verification and vehicle safety checkouts before joining the platform.',
    tagColor: '#10b981',
    icon: ShieldCheck
  },
  {
    title: '24/7 Client Dispatch',
    description: 'Need a late-night ride or order help? Access our instant chat support panel directly from the app dashboard.',
    tagColor: '#ff5100',
    icon: Clock
  },
  {
    title: 'Fair Payouts & Rates',
    description: 'Vibrant local networks, competitive fare calculations, and low platform commission rates keep our riders and providers happy.',
    tagColor: '#e11d48',
    icon: Users
  },
  {
    title: 'Rapid City Expansion',
    description: 'Already in 15+ cities and growing fast — we onboard new markets monthly with localized support and operations teams.',
    tagColor: '#1d4ed8',
    icon: TrendingUp
  },
]

export default function WhyUs() {
  const sectionRef = useRef(null)
  const headingRef = useRef(null)

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from(headingRef.current?.children, {
        y: 30, opacity: 0, duration: 0.7, stagger: 0.1, ease: 'power2.out',
        scrollTrigger: { trigger: headingRef.current, start: 'top 85%', once: true }
      })
    }, sectionRef)
    return () => ctx.revert()
  }, [])

  return (
    <section id="why-us" ref={sectionRef} className="pt-10 pb-12 overflow-hidden relative border-t border-slate-200/60 bg-slate-50" style={{ fontFamily: "'Poppins', sans-serif" }}>
      {/* Dot grid pattern */}
      <div className="absolute inset-0 opacity-[0.015] pointer-events-none"
        style={{ backgroundImage: 'radial-gradient(rgba(0,0,0,0.2) 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
      <div className="absolute top-0 left-1/4 w-[500px] h-[300px] rounded-full bg-[#ff5100]/[0.025] blur-[100px] pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-[400px] h-[300px] rounded-full bg-[#1d4ed8]/[0.025] blur-[120px] pointer-events-none" />

      <div className="max-w-7xl mx-auto px-6 relative z-10">

        {/* Header */}
        <div ref={headingRef} className="text-center max-w-3xl mx-auto mb-10 space-y-3">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400 mb-1">Why Choose Us</p>
          <h3 className="text-3xl sm:text-5xl font-black text-slate-900 tracking-tight leading-tight">
            A Unified Ecosystem{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#ff5100] via-[#e11d48] via-[#1d4ed8] to-[#10b981]">
              Built for Modern Commute
            </span>
          </h3>
          <p className="text-slate-500 leading-relaxed text-sm sm:text-base max-w-xl mx-auto font-medium">
            We started with a simple vision: to build an on-demand delivery and transportation service that benefits everyone — riders, providers, kitchens, and cargo.
          </p>
        </div>

        {/* Horizontal Auto-Scrolling Marquee */}
        <div className="relative w-full overflow-hidden py-2 pointer-events-auto">
          <div className="absolute left-0 top-0 bottom-0 w-20 bg-gradient-to-r from-slate-50 to-transparent z-20 pointer-events-none" />
          <div className="absolute right-0 top-0 bottom-0 w-20 bg-gradient-to-l from-slate-50 to-transparent z-20 pointer-events-none" />

          <div
            className="flex gap-5 animate-scroll hover:[animation-play-state:paused] w-max select-none"
            style={{ animationDuration: '28s' }}
          >
            {[...props, ...props, ...props].map((prop, idx) => {
              const Icon = prop.icon
              return (
                <div
                  key={idx}
                  className="w-[360px] shrink-0 whitespace-normal bg-white rounded-[20px] border border-slate-200/80 hover:border-slate-300 hover:shadow-md transition-all duration-300 text-left group overflow-hidden relative p-6"
                >
                  {/* Top accent strip */}
                  <div className="absolute top-0 left-0 right-0 h-[3px] rounded-t-[20px]"
                    style={{ background: `linear-gradient(90deg, ${prop.tagColor}, transparent)` }} />

                  <div className="flex items-center gap-2.5 mb-2">
                    <Icon className="w-5 h-5 shrink-0" style={{ color: prop.tagColor }} />
                    <h4 className="text-sm font-black text-slate-900"
                      style={{ color: prop.tagColor }}>{prop.title}</h4>
                  </div>
                  <p className="text-slate-500 text-xs sm:text-sm leading-relaxed font-medium">{prop.description}</p>
                </div>
              )
            })}
          </div>
        </div>

      </div>
    </section>
  )
}
