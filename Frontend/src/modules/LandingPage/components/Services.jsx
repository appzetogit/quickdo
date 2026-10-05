import React, { useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { Car, Utensils, Package, Plane, Bike, Truck } from 'lucide-react'
import { LANDING_THEME } from '../constants/theme'

gsap.registerPlugin(ScrollTrigger)

const services = [
  {
    icon: Car, title: 'Ride Hailing',
    description: 'Book rides in seconds. Budget shares to premium private cabs with vetted drivers.',
    bg: LANDING_THEME.blue.bg, accent: LANDING_THEME.blue.primary, secondary: LANDING_THEME.blue.accent,
    gradient: 'from-[#1d4ed8] to-[#10b981]'
  },
  {
    icon: Utensils, title: 'Food & Dining',
    description: 'Delicious meals delivered from local favorites or book a table at top restaurants.',
    bg: LANDING_THEME.orange.bg, accent: LANDING_THEME.orange.primary, secondary: LANDING_THEME.orange.accent,
    gradient: 'from-[#ff5100] to-[#e11d48]'
  },
  {
    icon: Package, title: 'Courier & Parcels',
    description: 'Send packages instantly with live end-to-end tracking. Documents, gifts, business goods.',
    bg: LANDING_THEME.orange.bg, accent: LANDING_THEME.orange.primary, secondary: LANDING_THEME.orange.accent,
    gradient: 'from-[#ff5100] to-[#e11d48]'
  },
  {
    icon: Plane, title: 'Airport Transfers',
    description: 'Stress-free airport drop-offs and pick-ups with dedicated luggage assistance.',
    bg: LANDING_THEME.blue.bg, accent: LANDING_THEME.blue.primary, secondary: LANDING_THEME.blue.accent,
    gradient: 'from-[#1d4ed8] to-[#10b981]'
  },
  /*{
    icon: Bike, title: 'Hourly Rentals',
    description: 'Rent motorcycles, scooters, or cars with smart keyless check-in and flexible KYC.',
    bg: LANDING_THEME.orange.bg, accent: LANDING_THEME.orange.primary, secondary: LANDING_THEME.orange.accent,
    gradient: 'from-[#ff5100] to-[#e11d48]'
  },*/
  {
    icon: Truck, title: 'Cargo & Logistics',
    description: 'Heavy-duty trucks and vans for warehouse moves and large corporate transport demands.',
    bg: LANDING_THEME.blue.bg, accent: LANDING_THEME.blue.primary, secondary: LANDING_THEME.blue.accent,
    gradient: 'from-[#1d4ed8] to-[#10b981]'
  },
]

function ServiceCard({ service }) {
  const cardRef = useRef(null)
  const glowRef = useRef(null)
  const [isHovered, setIsHovered] = useState(false)
  const Icon = service.icon

  useEffect(() => {
    const card = cardRef.current
    const glow = glowRef.current
    if (!card) return

    const onMove = (e) => {
      const rect = card.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const dx = (x - rect.width / 2) / rect.width
      const dy = (y - rect.height / 2) / rect.height
      gsap.to(card, { rotateX: -dy * 6, rotateY: dx * 6, duration: 0.35, ease: 'power2.out', transformPerspective: 1000 })
      if (glow) gsap.to(glow, { x: x - rect.width / 2, y: y - rect.height / 2, opacity: 1, duration: 0.3 })
    }
    const onLeave = () => {
      gsap.to(card, { rotateX: 0, rotateY: 0, scale: 1, duration: 0.6, ease: 'elastic.out(1,0.6)' })
      if (glow) gsap.to(glow, { opacity: 0, duration: 0.3 })
      setIsHovered(false)
    }
    const onEnter = () => {
      gsap.to(card, { scale: 1.02, duration: 0.3 })
      setIsHovered(true)
    }

    card.addEventListener('mousemove', onMove)
    card.addEventListener('mouseleave', onLeave)
    card.addEventListener('mouseenter', onEnter)
    return () => {
      card.removeEventListener('mousemove', onMove)
      card.removeEventListener('mouseleave', onLeave)
      card.removeEventListener('mouseenter', onEnter)
    }
  }, [])

  return (
    <div
      ref={cardRef}
      data-service-card
      className="group relative rounded-[28px] border overflow-hidden cursor-pointer will-change-transform bg-white flex flex-col"
      style={{
        borderColor: isHovered ? `${service.accent}50` : 'rgba(226,232,240,0.8)',
        boxShadow: isHovered ? `0 24px 48px ${service.accent}15` : '0 4px 24px 0 rgba(0,0,0,0.04)',
        transformStyle: 'preserve-3d',
        transition: 'border-color 0.4s, box-shadow 0.4s'
      }}
    >
      {/* Cursor glow */}
      <div ref={glowRef}
        className="pointer-events-none absolute w-56 h-56 rounded-full -translate-x-1/2 -translate-y-1/2 opacity-0"
        style={{ background: `radial-gradient(circle, ${service.accent}15 0%, transparent 70%)`, top: '50%', left: '50%', zIndex: 0 }}
      />

      {/* Top accent line */}
      <div
        className="h-[3px] w-full rounded-t-[28px]"
        style={{ background: `linear-gradient(90deg, ${service.accent}, ${service.secondary})` }}
      />

      {/* Card Body */}
      <div className="relative z-10 p-6 flex flex-col flex-1 text-left">
        {/* Title row with inline Icon */}
        <div className="flex items-center gap-2.5 mb-3">
          <Icon className="w-5 h-5 shrink-0" style={{ color: service.accent }} />
          <h3
            className="text-base font-extrabold text-slate-900 transition-colors duration-200"
            style={{ color: isHovered ? service.accent : '' }}
          >{service.title}</h3>
        </div>

        <p className="text-slate-500 text-sm leading-relaxed flex-1">{service.description}</p>
      </div>
    </div>
  )
}

export default function Services() {
  const sectionRef = useRef(null)
  const headerRef = useRef(null)

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from(headerRef.current?.children, {
        y: 40, opacity: 0, duration: 0.9, stagger: 0.1, ease: 'power3.out',
        scrollTrigger: { trigger: headerRef.current, start: 'top 85%', once: true }
      })
    }, sectionRef)
    return () => ctx.revert()
  }, [])

  const serviceNames = services.map(s => s.title)

  return (
    <section
      id="services"
      ref={sectionRef}
      className="pt-12 pb-8 relative overflow-hidden"
      style={{
        fontFamily: "'Poppins', sans-serif",
        background: 'radial-gradient(1000px circle at 80% 90%, rgba(37,99,235,0.03), transparent 60%), #F8FAFC'
      }}
    >
      {/* Subtle grid */}
      <div className="absolute inset-0 opacity-[0.015]"
        style={{
          backgroundImage: 'linear-gradient(rgba(0,0,0,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.1) 1px, transparent 1px)',
          backgroundSize: '40px 40px'
        }} />

      {/* Floating blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-10 left-10 w-72 h-72 rounded-full bg-[#ff5100]/5 blur-[80px] animate-pulse" style={{ animationDuration: '8s' }} />
        <div className="absolute top-1/3 right-10 w-96 h-96 rounded-full bg-[#1d4ed8]/5 blur-[100px] animate-pulse" style={{ animationDuration: '12s' }} />
      </div>

      <div className="max-w-7xl mx-auto px-6 lg:px-8 relative z-10">
        {/* Header */}
        <div ref={headerRef} className="text-center max-w-2xl mx-auto mb-4 space-y-3">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400 mb-1">Five Superpowers</p>
          <h2 className="text-4xl sm:text-5xl font-black tracking-tight text-slate-900">
            One App.{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#ff5100] via-[#e11d48] via-[#1d4ed8] to-[#10b981]">
              Five Superpowers.
            </span>
          </h2>
          <p className="text-slate-500 text-base leading-relaxed font-medium">
            Everything you need in one place — rides, food, parcels, airports, and cargo.
          </p>
        </div>

        {/* Decorative Service Name Marquee Strip */}
        <div className="relative overflow-hidden py-4 mb-6 border-y border-slate-200/60">
          <div className="flex gap-8 animate-scroll w-max" style={{ animationDuration: '18s' }}>
            {[...serviceNames, ...serviceNames, ...serviceNames].map((name, idx) => (
              <span
                key={idx}
                className="text-xs font-black uppercase tracking-[0.18em] whitespace-nowrap"
                style={{ color: idx % 2 === 0 ? '#ff5100' : '#1d4ed8', opacity: 0.4 + (idx % 3) * 0.2 }}
              >
                {name} •
              </span>
            ))}
          </div>
        </div>

        {/* Auto-Scrolling Cards */}
        <div className="relative w-full overflow-hidden py-4 pointer-events-auto">
          <div className="absolute left-0 top-0 bottom-0 w-24 bg-gradient-to-r from-[#F8FAFC] to-transparent z-20 pointer-events-none" />
          <div className="absolute right-0 top-0 bottom-0 w-24 bg-gradient-to-l from-[#F8FAFC] to-transparent z-20 pointer-events-none" />

          <div
            className="flex gap-6 animate-scroll hover:[animation-play-state:paused] w-max select-none"
            style={{ animationDuration: '32s' }}
          >
            {[...services, ...services].map((service, idx) => (
              <div key={idx} className="w-[340px] shrink-0 whitespace-normal pointer-events-auto">
                <ServiceCard service={service} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
