import React, { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { Music, Mic, Navigation, ShieldCheck, Mail, Globe, Zap, Star } from 'lucide-react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'


gsap.registerPlugin(ScrollTrigger)

const features = [
  {
    icon: Music, title: 'Personalized Content',
    description: 'Stream music, play podcasts, or join premium mobile games directly on the in-car console.',
    color: '#ff5100'
  },
  {
    icon: Mic, title: 'Interactive Voice Assistant',
    description: 'Adjust cabin temperature, set destination routes, or change music tracks hands-free.',
    color: '#e11d48'
  },
  {
    icon: Navigation, title: 'Real-Time Recommendations',
    description: 'Receive traffic-optimized navigation guides and localized tips during your transit.',
    color: '#1d4ed8'
  },
  {
    icon: Zap, title: 'Instant Booking Engine',
    description: 'Our smart dispatch matches you to the nearest driver in under 60 seconds, 24/7.',
    color: '#10b981'
  },
]

export default function Showcase() {
  const sectionRef = useRef(null)
  const leftRef = useRef(null)
  const imageRef = useRef(null)

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from(leftRef.current?.children, {
        x: -40, opacity: 0, duration: 0.8, stagger: 0.12, ease: 'power3.out',
        scrollTrigger: { trigger: leftRef.current, start: 'top 80%', once: true }
      })
      gsap.from(imageRef.current, {
        x: 50, opacity: 0, scale: 0.95, duration: 1.0, ease: 'power3.out',
        scrollTrigger: { trigger: imageRef.current, start: 'top 82%', once: true }
      })
    }, sectionRef)
    return () => ctx.revert()
  }, [])

  return (
    <section
      ref={sectionRef}
      className="py-20 overflow-hidden relative border-t border-slate-800"
      style={{ fontFamily: "'Poppins', sans-serif", background: '#060B0A' }}
    >
      {/* Background effects */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-0 w-[500px] h-[500px] rounded-full bg-[#ff5100]/[0.04] blur-[140px]" />
        <div className="absolute bottom-0 right-0 w-[600px] h-[400px] rounded-full bg-[#1d4ed8]/[0.04] blur-[120px]" />
        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
            backgroundSize: '50px 50px'
          }}
        />
      </div>

      <div className="max-w-7xl mx-auto px-6 relative z-10">

        {/* Single unified two-column layout — text left, image right, same row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 xl:gap-20 items-center">

          {/* Left Column: All text + features */}
          <div ref={leftRef} className="text-left space-y-8">

            {/* Section label */}
            <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500 mb-1">
              Smart Transit
            </p>

            {/* Main heading */}
            <div className="space-y-4">
              <h2 className="text-3xl sm:text-4xl xl:text-5xl font-black text-white tracking-tight leading-tight">
                Comfort <span className="text-slate-600">•</span> Convenience <span className="text-slate-600">•</span> Safety
              </h2>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#10b981]/10 border border-[#10b981]/20 text-[#10b981] text-[10px] font-black uppercase tracking-wider">
                <ShieldCheck className="w-3.5 h-3.5" />
                Passenger Insurance Included
              </div>
              <p className="text-slate-400 text-sm sm:text-base leading-relaxed max-w-lg">
                Enrolling 1 Lac+ Drivers across India. Quick Drop does more than just drive you — interactive voice controls, media playlists, and local insights directly to your ride.
              </p>
            </div>

            {/* Feature Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {features.map((feature, index) => {
                const Icon = feature.icon
                return (
                  <div
                    key={index}
                    className="group p-4 rounded-2xl border border-slate-800 hover:border-slate-700 bg-slate-900/40 hover:bg-slate-900/70 transition-all duration-300 cursor-default"
                  >
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center mb-3 transition-all duration-300 group-hover:scale-110"
                      style={{ background: `${feature.color}15`, border: `1px solid ${feature.color}25`, color: feature.color }}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <h5 className="text-xs font-bold text-white mb-1 group-hover:text-slate-100 transition-colors">{feature.title}</h5>
                    <p className="text-[11px] text-slate-500 leading-relaxed group-hover:text-slate-400 transition-colors">{feature.description}</p>
                  </div>
                )
              })}
            </div>

            {/* Contact links */}
            <div className="pt-6 border-t border-slate-800/60 flex flex-col sm:flex-row gap-4 text-xs text-slate-500">
              <a href="mailto:k9bharatrides@gmail.com" className="flex items-center gap-1.5 hover:text-[#10b981] transition-colors">
                <Mail className="w-4 h-4 text-[#10b981]" />
                k9bharatrides@gmail.com
              </a>
              <a href="https://quickdropsindia.com" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:text-[#10b981] transition-colors">
                <Globe className="w-4 h-4 text-[#10b981]" />
                quickdropsindia.com
              </a>
            </div>
          </div>

          {/* Right Column: Showcase 3D Grid */}
          <div ref={imageRef} className="relative">
            {/* Animated glow ring */}
            <div
              className="absolute inset-0 rounded-[36px] blur-xl opacity-20 animate-pulse"
              style={{ background: 'linear-gradient(135deg, #1d4ed8, #10b981)', animationDuration: '4s' }}
            />

            <div className="relative rounded-[32px] border border-slate-700/60 shadow-2xl group h-[320px] sm:h-[460px] flex items-center justify-center bg-slate-900/50 p-4">
              {/* Inner mesh */}
              <div className="absolute inset-0 bg-gradient-to-t from-[#060B0A]/80 via-[#060B0A]/20 to-transparent z-10 pointer-events-none rounded-[32px]" />

              <div className="grid grid-cols-2 gap-4 w-full h-full z-0" style={{ perspective: '1000px' }}>
                {[
                  { src: '/food/delivery2.jpg', delay: 0 },
                  { src: '/food/taxi1.jpeg', delay: 0.15 },
                  { src: '/food/taxi2.jpeg', delay: 0.3 },
                  { src: '/food/delivery3.jpeg', delay: 0.45 }
                ].map((item, idx) => (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, rotateX: 20, rotateY: -20, scale: 0.9 }}
                    whileInView={{ opacity: 1, rotateX: 0, rotateY: 0, scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.8, delay: item.delay, type: 'spring', bounce: 0.4 }}
                    whileHover={{ scale: 1.05, rotateX: 5, rotateY: -5, zIndex: 10, boxShadow: '0 20px 40px rgba(0,0,0,0.4)' }}
                    className="relative rounded-2xl overflow-hidden border border-white/5 bg-slate-800"
                    style={{ transformStyle: 'preserve-3d' }}
                  >
                    <img
                      src={item.src}
                      alt="Quick Drop Service"
                      className="w-full h-full object-cover transition-transform duration-700 hover:scale-110"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 hover:opacity-100 transition-opacity duration-300" />
                  </motion.div>
                ))}
              </div>

              {/* Float badges */}
              <div className="absolute top-5 left-5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 backdrop-blur-md border border-white/10 text-white text-[9px] font-black uppercase tracking-wider shadow-lg z-20 hover:scale-105 transition-transform cursor-pointer">
                <ShieldCheck className="w-3.5 h-3.5 text-[#10b981]" />
                100% Insured
              </div>

              <div className="absolute bottom-5 right-5 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-[#1d4ed8] to-[#10b981] text-white text-[10px] font-black uppercase tracking-wider shadow-lg z-20 hover:scale-105 transition-transform cursor-pointer">
                Smart Fleet & Delivery
              </div>
            </div>
          </div>

        </div>
      </div>
    </section>
  )
}
