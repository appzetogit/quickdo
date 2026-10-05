import React, { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Play, Pause, Volume2, VolumeX, Maximize, Clock, Activity, Compass, ShoppingBag, Truck, Zap } from 'lucide-react'
import { LANDING_THEME } from '../constants/theme'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

export default function VideoSection() {
  const videoRef = useRef(null)
  const containerRef = useRef(null)
  const headerRef = useRef(null)
  const panelsRef = useRef(null)

  const [isPlaying, setIsPlaying] = useState(false)
  const [isMuted, setIsMuted] = useState(true)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [activeTab, setActiveTab] = useState(0)
  const [showControls, setShowControls] = useState(true)
  const [playbackRate, setPlaybackRate] = useState(1)
  const controlsTimeoutRef = useRef(null)

  const tabs = [
    {
      id: 0, icon: Compass, label: 'Premium Ride Hailing',
      description: 'Book verified professional captains and travel in comfort with live tracking.',
      timePercent: 0, color: LANDING_THEME.blue.primary, accent: LANDING_THEME.blue.accent, bg: LANDING_THEME.blue.bg,
    },
    {
      id: 1, icon: ShoppingBag, label: 'On-Demand Delivery',
      description: 'Craving local delicacies or need fresh groceries? Smart-dispatch delivery at your doorstep.',
      timePercent: 0.33, color: LANDING_THEME.orange.primary, accent: LANDING_THEME.orange.accent, bg: LANDING_THEME.orange.bg,
    },
    {
      id: 2, icon: Truck, label: 'Logistics & Cargo',
      description: 'Move house, send large packages, or manage warehouse supplies with cargo freight.',
      timePercent: 0.66, color: LANDING_THEME.blue.primary, accent: LANDING_THEME.blue.accent, bg: LANDING_THEME.blue.bg,
    }
  ]

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const current = videoRef.current.currentTime
      setCurrentTime(current)
      if (duration > 0) {
        const ratio = current / duration
        if (ratio < 0.33) setActiveTab(0)
        else if (ratio < 0.66) setActiveTab(1)
        else setActiveTab(2)
      }
    }
  }

  const handleLoadedMetadata = () => {
    if (videoRef.current) setDuration(videoRef.current.duration)
  }

  const handleTabClick = (tabIndex) => {
    setActiveTab(tabIndex)
    if (videoRef.current && duration > 0) {
      videoRef.current.currentTime = duration * tabs[tabIndex].timePercent
      videoRef.current.play()
      setIsPlaying(true)
    }
  }

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) videoRef.current.pause()
      else videoRef.current.play().catch(err => console.log('Autoplay blocked:', err))
      setIsPlaying(!isPlaying)
    }
  }

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted
      setIsMuted(!isMuted)
    }
  }

  const handleProgressChange = (e) => {
    if (videoRef.current && duration > 0) {
      const newTime = (parseFloat(e.target.value) / 100) * duration
      videoRef.current.currentTime = newTime
      setCurrentTime(newTime)
    }
  }

  const formatTime = (secs) => {
    if (isNaN(secs)) return '0:00'
    const minutes = Math.floor(secs / 60)
    const seconds = Math.floor(secs % 60)
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`
  }

  const toggleSpeed = () => {
    const nextRate = playbackRate === 1 ? 1.5 : playbackRate === 1.5 ? 2 : 1
    if (videoRef.current) {
      videoRef.current.playbackRate = nextRate
      setPlaybackRate(nextRate)
    }
  }

  const toggleFullscreen = () => {
    if (videoRef.current) {
      if (videoRef.current.requestFullscreen) videoRef.current.requestFullscreen()
      else if (videoRef.current.webkitRequestFullscreen) videoRef.current.webkitRequestFullscreen()
    }
  }

  const handleMouseMove = () => {
    setShowControls(true)
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current)
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) setShowControls(false)
    }, 2500)
  }

  useEffect(() => {
    return () => { if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current) }
  }, [isPlaying])

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false))
    }
    const ctx = gsap.context(() => {
      gsap.from(headerRef.current?.children, {
        y: 30, opacity: 0, duration: 0.8, stagger: 0.1, ease: 'power2.out',
        scrollTrigger: { trigger: headerRef.current, start: 'top 85%', once: true }
      })
      gsap.from(panelsRef.current?.children, {
        y: 40, opacity: 0, duration: 0.9, stagger: 0.15, ease: 'power3.out',
        scrollTrigger: { trigger: panelsRef.current, start: 'top 80%', once: true }
      })
    }, containerRef)
    return () => ctx.revert()
  }, [])

  const currentColor = tabs[activeTab].color

  return (
    <section ref={containerRef} className="relative pt-24 pb-12 bg-slate-950 overflow-hidden text-slate-100" style={{ fontFamily: "'Poppins', sans-serif" }}>
      {/* Background neon elements */}
      <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-[#ff5100]/[0.03] blur-[150px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 translate-x-1/2 translate-y-1/2 w-[600px] h-[600px] rounded-full bg-[#1d4ed8]/[0.02] blur-[150px] pointer-events-none" />

      <div className="max-w-7xl mx-auto px-6 relative z-10">

        {/* Section Header — no pill badge */}
        <div ref={headerRef} className="text-center max-w-3xl mx-auto mb-16 space-y-4">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500 mb-1">Video Demo</p>
          <h2 className="text-3xl sm:text-5xl font-black text-white tracking-tight leading-tight">
            Experience our{' '}
            <span
              className="text-transparent bg-clip-text"
              style={{ backgroundImage: 'linear-gradient(90deg, #ff5100, #e11d48, #1d4ed8, #10b981)' }}
            >
              Super-App in Action
            </span>
          </h2>
          <p className="text-sm sm:text-base text-slate-400 max-w-xl mx-auto leading-relaxed">
            Click through our specialized features to preview how Quick Drop delivers comfort, flavor, and freight.
          </p>
        </div>

        {/* Master Layout */}
        <div ref={panelsRef} className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center max-w-6xl mx-auto">

          {/* Left Panel: Feature Tabs */}
          <div className="lg:col-span-4 space-y-3 order-2 lg:order-1">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3 px-1">
              Select Feature to Preview
            </h3>

            <div className="space-y-3">
              {tabs.map((tab) => {
                const IconComponent = tab.icon
                const isActive = activeTab === tab.id
                const progress = isActive && duration > 0
                  ? Math.min(((currentTime - duration * tab.timePercent) / (duration / 3)) * 100, 100)
                  : 0

                return (
                  <button
                    key={tab.id}
                    onClick={() => handleTabClick(tab.id)}
                    className="w-full text-left p-5 rounded-2xl border transition-all duration-300 relative group flex flex-col gap-3"
                    style={{
                      background: isActive ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.02)',
                      borderColor: isActive ? `${tab.color}50` : 'rgba(255,255,255,0.06)',
                      boxShadow: isActive ? `0 10px 30px ${tab.color}10` : ''
                    }}
                  >
                    {/* Active indicator line */}
                    {isActive && (
                      <motion.div
                        layoutId="activeFeatureIndicator"
                        className="absolute left-0 top-4 bottom-4 w-1 rounded-r-md"
                        style={{ backgroundColor: tab.color }}
                      />
                    )}

                    <div className="flex items-center gap-3">
                      <div
                        className="p-2.5 rounded-xl transition-all duration-300"
                        style={{
                          background: isActive ? `${tab.color}25` : 'rgba(255,255,255,0.04)',
                          color: isActive ? tab.color : '#94a3b8'
                        }}
                      >
                        <IconComponent className="w-5 h-5" />
                      </div>

                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <span className={`text-sm font-bold tracking-wide transition-colors ${isActive ? 'text-white' : 'text-slate-300 group-hover:text-white'}`}>
                            {tab.label}
                          </span>
                          {isActive && (
                            <span className="flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full opacity-75" style={{ backgroundColor: tab.color }} />
                              <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: tab.color }} />
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <p className="text-xs text-slate-400 leading-relaxed font-medium pl-1">{tab.description}</p>

                    {/* Animated progress bar under active tab */}
                    {isActive && (
                      <div className="h-0.5 w-full bg-slate-800 rounded-full overflow-hidden">
                        <motion.div
                          className="h-full rounded-full"
                          style={{ backgroundColor: tab.color, width: `${Math.max(progress, 2)}%` }}
                          transition={{ duration: 0.3 }}
                        />
                      </div>
                    )}
                  </button>
                )
              })}
            </div>

            <div className="p-4 rounded-2xl bg-gradient-to-tr from-slate-900/70 to-slate-900/30 border border-slate-800/40 flex items-center gap-3">
              {/* <div className="p-2 rounded-lg bg-yellow-500/10 text-yellow-500">
                <Zap className="w-4 h-4" />
              </div>
              <p className="text-[11px] text-slate-400 font-medium leading-relaxed">
                Click any feature tab to jump the video stream to that module.
              </p>
            </div> */}
            </div>
          </div>

          {/* Right Panel: Video Player */}
            <div className="lg:col-span-8 order-1 lg:order-2">
              {/* Animated gradient border ring around video */}
              <div
                className="p-[1.5px] rounded-[28px] transition-all duration-700"
                style={{ background: `linear-gradient(135deg, ${currentColor}60, transparent 50%, ${tabs[activeTab].accent}40)` }}
              >
                <div
                  className="relative aspect-video w-full rounded-[26px] overflow-hidden bg-slate-950 shadow-2xl group"
                  onMouseMove={handleMouseMove}
                  onMouseLeave={() => isPlaying && setShowControls(false)}
                >
                  <div className="absolute inset-0 rounded-[26px] border border-white/5 pointer-events-none z-10" />

                  <video
                    ref={videoRef}
                    src="/food/delivery1.mp4"
                    preload="metadata"
                    loop muted={isMuted} playsInline
                    onTimeUpdate={handleTimeUpdate}
                    onLoadedMetadata={handleLoadedMetadata}
                    className="w-full h-full object-cover select-none"
                    onClick={togglePlay}
                  />

                  {/* Top status bar */}
                  <div className="absolute top-4 left-4 right-4 flex justify-between items-center z-20 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-950/80 backdrop-blur-md border border-slate-800 text-[10px] font-bold text-slate-300 uppercase tracking-widest">
                      <Activity className="w-3 h-3 animate-pulse" style={{ color: currentColor }} />
                      Live Preview
                    </div>
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-950/80 backdrop-blur-md border border-slate-800 text-[10px] font-bold text-slate-300">
                      <Clock className="w-3 h-3 text-yellow-500" />
                      {formatTime(currentTime)} / {formatTime(duration)}
                    </div>
                  </div>

                  {/* Central Play/Pause Overlay */}
                  <AnimatePresence>
                    {(!isPlaying || !showControls) && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        className="absolute inset-0 flex items-center justify-center bg-black/30 backdrop-blur-[1px] z-20 pointer-events-none"
                      >
                        <button
                          onClick={(e) => { e.stopPropagation(); togglePlay() }}
                          className="p-5 rounded-full bg-white/90 hover:bg-white text-slate-950 shadow-xl transition-all duration-300 hover:scale-110 pointer-events-auto cursor-pointer"
                          aria-label={isPlaying ? 'Pause' : 'Play'}
                        >
                          {isPlaying ? <Pause className="w-6 h-6 fill-slate-950" /> : <Play className="w-6 h-6 fill-slate-950 translate-x-[1px]" />}
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Bottom Controls */}
                  <div
                    className={`absolute bottom-0 left-0 right-0 p-5 bg-gradient-to-t from-slate-950 via-slate-950/90 to-transparent z-30 transition-all duration-500 ${showControls ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0 pointer-events-none'}`}
                  >
                    <div className="flex items-center gap-3 mb-4">
                      <span className="text-[10px] font-bold text-slate-400 w-8 text-right">{formatTime(currentTime)}</span>
                      <input
                        type="range" min="0" max="100"
                        value={duration ? (currentTime / duration) * 100 : 0}
                        onChange={handleProgressChange}
                        className="flex-1 h-1.5 rounded-lg appearance-none cursor-pointer bg-slate-800"
                        style={{
                          background: `linear-gradient(to right, ${currentColor} 0%, ${currentColor} ${duration ? (currentTime / duration) * 100 : 0}%, #1e293b ${duration ? (currentTime / duration) * 100 : 0}%, #1e293b 100%)`
                        }}
                      />
                      <span className="text-[10px] font-bold text-slate-400 w-8">{formatTime(duration)}</span>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <button onClick={togglePlay} className="p-2 rounded-lg hover:bg-white/10 text-white transition-colors" aria-label={isPlaying ? 'Pause' : 'Play'}>
                          {isPlaying ? <Pause className="w-4 h-4 fill-white" /> : <Play className="w-4 h-4 fill-white" />}
                        </button>
                        <button onClick={toggleMute} className="p-2 rounded-lg hover:bg-white/10 text-white transition-colors flex items-center gap-1.5" aria-label={isMuted ? 'Unmute' : 'Mute'}>
                          {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{isMuted ? 'Muted' : 'Sound'}</span>
                        </button>
                      </div>
                      <div className="hidden sm:flex items-center gap-1 text-slate-400 text-xs font-medium">
                        <span className="font-bold" style={{ color: currentColor }}>{tabs[activeTab].label}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={toggleSpeed} className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-[10px] font-black text-slate-300 hover:text-white hover:border-slate-700 transition-colors">
                          {playbackRate}x
                        </button>
                        <button onClick={toggleFullscreen} className="p-2 rounded-lg hover:bg-white/10 text-white transition-colors" aria-label="Fullscreen">
                          <Maximize className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
    </section>
  )
}
