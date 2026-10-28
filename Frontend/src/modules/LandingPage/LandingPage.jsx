import React, { useEffect, useState, lazy, Suspense } from 'react'
import Lenis from 'lenis'
import Navbar from './components/Navbar'
import Hero from './components/Hero'
import api from '../Taxi/shared/api/axiosInstance'

const Ecosystem = lazy(() => import('./components/Ecosystem'))
const Services = lazy(() => import('./components/Services'))
const WhyUs = lazy(() => import('./components/WhyUs'))
const Showcase = lazy(() => import('./components/Showcase'))
const VideoSection = lazy(() => import('./components/VideoSection'))
const Partners = lazy(() => import('./components/Partners'))
const FAQ = lazy(() => import('./components/FAQ'))
const Footer = lazy(() => import('./components/Footer'))

export default function LandingPage() {
  const [landingSettings, setLandingSettings] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Dynamic SEO Title & Meta tags for better discoverability
    document.title = "Quick Drop - All-in-One Super-App for Rides, Food & Logistics"

    // Find or create meta description tag
    let metaDesc = document.querySelector('meta[name="description"]')
    if (!metaDesc) {
      metaDesc = document.createElement('meta')
      metaDesc.name = 'description'
      document.head.appendChild(metaDesc)
    }
    metaDesc.setAttribute('content', 'Quick Drop is the ultimate multi-service super-app for Ride Hailing (Taxi & Shares), Food & Dining Delivery, secure Courier Parcels, Airport Transfers, Hourly rentals, and Logistics cargo.')

    // Fetch dynamic landing settings
    const fetchLandingSettings = async () => {
      try {
        const res = await api.get('/common/landing-page/settings')
        if (res?.success && res?.data) {
          setLandingSettings(res.data)
        }
      } catch (err) {
        console.error('Error loading landing page settings:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchLandingSettings()

    // Smooth scrolling using Lenis (desktop only to prevent heavy execution on mobile)
    let lenis = null
    let rafId = null

    if (window.innerWidth >= 768) {
      lenis = new Lenis({
        duration: 1.4,
        easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        smoothWheel: true,
        wheelMultiplier: 1.0,
        touchMultiplier: 1.5,
      })

      const raf = (time) => {
        lenis?.raf(time)
        rafId = requestAnimationFrame(raf)
      }

      rafId = requestAnimationFrame(raf)
    }

    return () => {
      if (lenis) lenis.destroy()
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [])

  return (
    <div className="min-h-screen bg-white text-gray-900 antialiased overflow-x-clip" style={{ fontFamily: "'Poppins', system-ui, sans-serif", WebkitFontSmoothing: 'antialiased' }}>
      {/* Navigation Header */}
      <Navbar settings={landingSettings} />

      {/* Overlapping Hero & Ecosystem Container */}
      <div className="relative">
        {/* Hero Section - Base Stacking Panel */}
        <div className="sticky top-0 z-10 bg-[#FAFBFC] w-full h-screen overflow-hidden">
          <Hero settings={landingSettings} />
        </div>

        {/* Unified Services Selector Ecosystem - Slides over Hero with a nice shadow */}
        <div className="relative z-20 bg-white shadow-[0_-20px_50px_rgba(0,0,0,0.06)]">
          <Suspense fallback={null}>
            <Ecosystem settings={landingSettings} />
          </Suspense>
        </div>
      </div>

      {/* Key Super-App Services */}
      <div className="relative z-20 bg-slate-50">
        <Suspense fallback={null}>
          <Services settings={landingSettings} />
        </Suspense>
      </div>

      {/* Platform Value Propositions & Count Stats */}
      <div className="relative z-20 bg-white">
        <Suspense fallback={null}>
          <WhyUs settings={landingSettings} />
        </Suspense>
      </div>

      {/* Premium Fleet Showcase - Dark theme managed internally */}
      <div className="relative z-20">
        <Suspense fallback={null}>
          <Showcase settings={landingSettings} />
        </Suspense>
      </div>

      {/* Dynamic Video Section */}
      <div className="relative z-20 bg-slate-950 text-white">
        <Suspense fallback={null}>
          <VideoSection settings={landingSettings} />
        </Suspense>
      </div>

      {/* Driver and Merchant Partners Portals */}
      <div className="relative z-20 bg-slate-950">
        <Suspense fallback={null}>
          <Partners settings={landingSettings} />
        </Suspense>
      </div>

      {/* Frequently Asked Questions */}
      <div className="relative z-20 bg-slate-50">
        <Suspense fallback={null}>
          <FAQ settings={landingSettings} />
        </Suspense>
      </div>

      {/* SEO Optimized Footer Links */}
      <div className="relative z-20 bg-slate-950 text-white">
        <Suspense fallback={null}>
          <Footer settings={landingSettings} />
        </Suspense>
      </div>
    </div>
  )
}
