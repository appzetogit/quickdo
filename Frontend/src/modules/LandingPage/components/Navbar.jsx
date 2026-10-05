import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Menu, X } from 'lucide-react'
import k9Logo from '../assets/k9-logo.png'
import { useSettings } from '../../Taxi/shared/context/SettingsContext'

export default function Navbar({ settings }) {
  const [isScrolled, setIsScrolled] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const { activeLogo } = useSettings()
  const appLogo = activeLogo || settings?.general?.logo || settings?.customization?.logo || '';
  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 40)
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const navLinks = [
    { name: 'Services', href: '#services' },
    { name: 'Why Quick Drop', href: '#why-us' },
    { name: 'Partner With Us', href: '#partners' },
    { name: 'FAQs', href: '#faq' },
  ]

  const handleSmoothScroll = (e, targetId) => {
    e.preventDefault()
    setIsMobileMenuOpen(false)
    const el = document.querySelector(targetId)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <>
      <motion.header
        initial={{ y: -80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className={`fixed top-0 left-0 right-0 z-[100] transition-all duration-400 ${isScrolled
            ? 'bg-white/80 backdrop-blur-xl shadow-[0_4px_24px_rgba(0,0,0,0.03)] border-b border-slate-200/40 text-slate-900'
            : 'bg-transparent text-slate-800'
          }`}
        style={{ fontFamily: "'Poppins', sans-serif" }}
      >
        <div className="w-full px-6 sm:px-12 lg:px-16">
          <div className="flex items-center justify-between h-20">
            {/* Logo */}
            <a href="#" className="flex items-center gap-3 group">
              {appLogo ? (
                <img src={appLogo} alt="Quick Drop" className="h-10 w-auto object-contain" />
              ) : (
                <span className="font-black text-xl tracking-tight text-slate-900">
                  Quick Drop
                </span>
              )}
            </a>

            {/* Desktop nav */}
            <nav className="hidden lg:flex items-center gap-8">
              {navLinks.map((link) => (
                <a
                  key={link.name}
                  href={link.href}
                  onClick={(e) => handleSmoothScroll(e, link.href)}
                  className="text-sm font-semibold text-slate-600 hover:text-slate-900 transition-colors duration-200 relative group"
                >
                  {link.name}
                  <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-gradient-to-r from-[#ff6d00] to-[#2563eb] group-hover:w-full transition-all duration-300 rounded-full" />
                </a>
              ))}
            </nav>

            {/* Mobile toggle */}
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="lg:hidden p-2 rounded-xl text-slate-800 hover:bg-slate-100 transition-colors ml-auto"
            >
              {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </motion.header>

      {/* Global CSS Style tag injection */}
      <style dangerouslySetInnerHTML={{
        __html: `
        @keyframes k9-glow-pulse {
          0%, 100% {
            transform: scale(1);
            box-shadow: 0 4px 14px rgba(255, 81, 0, 0.2);
          }
          50% {
            transform: scale(1.03);
            box-shadow: 0 6px 20px rgba(29, 78, 216, 0.4);
          }
        }
        .k9-btn-glow-pulse {
          background: linear-gradient(135deg, #ff5100, #e11d48, #1d4ed8);
          background-size: 200% 200%;
          animation: k9-glow-pulse 3s infinite ease-in-out;
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .k9-btn-glow-pulse:hover {
          background-position: right center;
          transform: translateY(-2px) scale(1.05);
          box-shadow: 0 8px 25px rgba(225, 29, 72, 0.45);
        }
      `}} />

      {/* Mobile drawer */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setIsMobileMenuOpen(false)}
              className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-[98] lg:hidden"
            />
            <motion.div
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 250 }}
              className="fixed right-0 top-0 bottom-0 w-80 z-[100] p-8 flex flex-col lg:hidden shadow-2xl border-l border-slate-100"
              style={{ background: '#ffffff', fontFamily: "'Poppins', sans-serif" }}
            >
              <div className="flex items-center justify-between mb-10">
                {settings?.logo_url ? (
                  <img src={settings.logo_url} alt="Quick Drop" className="h-10 w-auto object-contain" />
                ) : (
                  <span className="font-black text-xl text-slate-900">Quick <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#ff5100] via-[#e11d48] via-[#1d4ed8] to-[#10b981]">Drop</span></span>
                )}
                <button onClick={() => setIsMobileMenuOpen(false)} className="p-2 rounded-xl text-slate-800 hover:bg-slate-100">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex flex-col gap-6 flex-1 text-left">
                {navLinks.map((link) => (
                  <a key={link.name} href={link.href} onClick={(e) => handleSmoothScroll(e, link.href)}
                    className="text-lg font-bold text-slate-700 hover:text-slate-900 transition-colors">
                    {link.name}
                  </a>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
