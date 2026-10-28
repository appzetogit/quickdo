import React, { useEffect, useRef } from 'react'
import { Mail, Phone, MapPin, ArrowRight } from 'lucide-react'
import k9Logo from '../assets/k9-logo.png'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useSettings } from '../../Taxi/shared/context/SettingsContext'

gsap.registerPlugin(ScrollTrigger)

export default function Footer({ settings }) {
  const { activeLogo } = useSettings()
  const appLogo = activeLogo || settings?.general?.logo || settings?.customization?.logo || '';
  const currentYear = new Date().getFullYear()
  const footerRef = useRef(null)
  const topBannerRef = useRef(null)
  const contentRef = useRef(null)

  const links = {
    company: [
      { name: 'About Us', href: '/taxi/about' }
    ],
    services: [
      { name: 'Ride Hailing', href: 'https://play.google.com/store/apps/details?id=com.k9bharat.user' },
      { name: 'Food Delivery', href: 'https://play.google.com/store/apps/details?id=com.k9bharat.user' },
      { name: 'Parcels & Logistics', href: 'https://play.google.com/store/apps/details?id=com.k9bharat.user' },
      { name: 'Airport Transfers', href: 'https://play.google.com/store/apps/details?id=com.k9bharat.user' }
    ],
    legal: [
      { name: 'Terms of Service', href: '/terms?tab=terms' },
      { name: 'Privacy Policy', href: '/terms?tab=privacy' },
      { name: 'Refund Policy', href: '/terms?tab=refund' },
      { name: 'Cancellation Policy', href: '/terms?tab=cancellation' },
      { name: 'FAQs', href: '/support' }
    ]
  }

  const socialLinks = [
    {
      svg: (
        <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      ),
      href: 'https://x.com/K9_Bharat_Rides', colorClass: 'text-white', label: 'X (Twitter)'
    },
    {
      svg: (
        <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.051.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
        </svg>
      ),
      href: 'https://www.instagram.com/k9_bharat_rides/', colorClass: 'text-[#E4405F]', label: 'Instagram'
    }
  ]

  const playStoreUrl = settings?.play_store_url || 'https://play.google.com/store/apps/details?id=com.k9bharat.user'
  const appStoreUrl = settings?.app_store_url || 'https://www.apple.com/app-store/'
  const contactAddress = settings?.contact_address || 'Quick Drop, Siliguri, West Bengal, India'
  const contactPhone = settings?.contact_phone || '+91 7358789910'
  const contactEmail = settings?.contact_email || 'k9bharatrides@gmail.com'

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from(topBannerRef.current, {
        y: 30, opacity: 0, duration: 0.8, ease: 'power3.out',
        scrollTrigger: { trigger: topBannerRef.current, start: 'top 90%', once: true }
      })
      gsap.from(contentRef.current?.children, {
        y: 25, opacity: 0, duration: 0.7, stagger: 0.1, ease: 'power3.out',
        scrollTrigger: { trigger: contentRef.current, start: 'top 92%', once: true }
      })
    }, footerRef)
    return () => ctx.revert()
  }, [])

  return (
    <footer ref={footerRef} className="relative bg-slate-950 text-slate-400 overflow-hidden border-t border-slate-900" style={{ fontFamily: "'Poppins', sans-serif" }}>
      {/* Background orbs */}
      <div className="absolute bottom-0 left-1/4 w-[400px] h-[400px] rounded-full bg-[#1d4ed8]/[0.04] blur-[120px] pointer-events-none" />
      <div className="absolute top-0 right-1/4 w-[300px] h-[300px] rounded-full bg-[#ff5100]/[0.03] blur-[100px] pointer-events-none" />

      {/* Top Download CTA Banner */}
      <div ref={topBannerRef} className="relative border-b border-slate-800/60">
        <div className="max-w-7xl mx-auto px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="text-center sm:text-left">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-transparent bg-clip-text bg-gradient-to-r from-[#ff5100] to-[#1d4ed8] mb-1">
              Available on all platforms
            </p>
            <h3 className="text-xl sm:text-2xl font-black text-white tracking-tight">
              Ready to ride? Download the app.
            </h3>
            <p className="text-slate-500 text-sm mt-1">Join the Quick Drop community today.</p>
          </div>
          <div className="flex flex-wrap gap-3 shrink-0">
            <a href={playStoreUrl} className="transition-transform duration-200 hover:scale-[1.04]">
              <img
                src="https://upload.wikimedia.org/wikipedia/commons/7/78/Google_Play_Store_badge_EN.svg"
                alt="Get it on Google Play"
                className="h-10 w-auto"
                loading="lazy"
              />
            </a>
            <a href={appStoreUrl} className="transition-transform duration-200 hover:scale-[1.04]">
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

      {/* Main Footer Grid */}
      <div className="max-w-7xl mx-auto px-6 relative z-10 pt-16 pb-8">
        <div ref={contentRef} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-12 lg:gap-8 mb-16">

          {/* Branding Column */}
          <div className="lg:col-span-4 text-left space-y-6">
            <a href="#" className="flex items-center gap-3 group w-fit">
              {appLogo ? (
                <img src={appLogo} alt="Quick Drop" className="h-11 w-auto object-contain bg-white/10 p-1 rounded-lg" loading="lazy" />
              ) : (
                <div className="flex flex-col text-left">
                  <span className="font-black text-xl tracking-tight text-white block leading-none">Quick Drop</span>
                </div>
              )}
            </a>

            <p className="text-sm leading-relaxed text-slate-400 max-w-sm">
              Quick Drop is the leading on-demand super-app platform connecting passengers, diners, merchants, and cargo owners to drivers and logistics providers.
            </p>

            {/* Social Icons */}
            <div className="flex gap-2.5">
              {socialLinks.map((social, idx) => (
                <a
                  key={idx}
                  href={social.href}
                  className="group p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 transition-all duration-300 border border-slate-800 hover:border-slate-700 shadow-sm flex items-center justify-center"
                  aria-label={social.label}
                >
                  <span className={`${social.colorClass} group-hover:scale-110 transition-transform duration-200 block`}>
                    {social.svg}
                  </span>
                </a>
              ))}
            </div>
          </div>

          {/* Company Links */}
          <div className="lg:col-span-2 text-left space-y-5">
            <h4 className="text-xs font-black uppercase tracking-widest text-slate-200">Company</h4>
            <ul className="space-y-3 text-sm">
              {links.company.map((link) => (
                <li key={link.name}>
                  <a
                    href={link.href}
                    className="group flex items-center gap-1.5 text-slate-400 hover:text-[#ff5100] transition-colors duration-200"
                  >
                    <span className="w-0 h-px bg-[#ff5100] group-hover:w-3 transition-all duration-300" />
                    {link.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Services Links */}
          <div className="lg:col-span-2 text-left space-y-5">
            <h4 className="text-xs font-black uppercase tracking-widest text-slate-200">Services</h4>
            <ul className="space-y-3 text-sm">
              {links.services.map((link) => (
                <li key={link.name}>
                  <a
                    href={link.href}
                    className="group flex items-center gap-1.5 text-slate-400 hover:text-[#1d4ed8] transition-colors duration-200"
                  >
                    <span className="w-0 h-px bg-[#1d4ed8] group-hover:w-3 transition-all duration-300" />
                    {link.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal Links */}
          <div className="lg:col-span-2 text-left space-y-5">
            <h4 className="text-xs font-black uppercase tracking-widest text-slate-200">Legal</h4>
            <ul className="space-y-3 text-sm">
              {links.legal.map((link) => (
                <li key={link.name}>
                  <a
                    href={link.href}
                    className="group flex items-center gap-1.5 text-slate-400 hover:text-[#10b981] transition-colors duration-200"
                  >
                    <span className="w-0 h-px bg-[#10b981] group-hover:w-3 transition-all duration-300" />
                    {link.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div className="lg:col-span-2 text-left space-y-5">
            <h4 className="text-xs font-black uppercase tracking-widest text-slate-200">Contact Us</h4>
            <ul className="space-y-4 text-sm text-slate-400">
              <li className="flex items-start gap-3">
                <MapPin className="w-4 h-4 text-[#ff5100] shrink-0 mt-0.5" />
                <span className="leading-relaxed">{contactAddress}</span>
              </li>
              <li className="flex items-center gap-3">
                <Phone className="w-4 h-4 text-[#10b981] shrink-0" />
                <span>{contactPhone}</span>
              </li>
              <li className="flex items-center gap-3">
                <Mail className="w-4 h-4 text-[#1d4ed8] shrink-0" />
                <span className="break-all">{contactEmail}</span>
              </li>
            </ul>
          </div>

        </div>

        {/* Copyright Bar */}
        <div className="border-t border-slate-900 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-600">
          <p>© {currentYear} Quick Drop Inc. All rights reserved.</p>
          <div className="flex gap-6">
            <a href="/terms?tab=terms" className="hover:text-white transition-colors duration-200">Terms</a>
            <a href="/terms?tab=privacy" className="hover:text-white transition-colors duration-200">Privacy</a>
            <a href="/support" className="hover:text-white transition-colors duration-200">Support</a>
          </div>
        </div>
      </div>
    </footer>
  )
}
