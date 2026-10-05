import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Minus } from 'lucide-react'

const defaultFaqs = [
  {
    question: 'What services are supported by Quick Drop?',
    answer: 'Quick Drop is an all-in-one super-app supporting Ride Hailing (Taxi & Cab Sharing), Food & Dining Delivery, secure Parcel Courier Services, pre-scheduled Airport Transfers, Hourly Vehicle Rentals, and commercial Cargo/Logistics.'
  },
  {
    question: 'How do I register as a driver partner?',
    answer: 'You can sign up directly by clicking the "Register as Driver" CTA on this page or visiting the "/taxi/signup" portal. You will need to upload your valid driver license, vehicle registry credentials, and complete a background verification checklist.'
  },
  {
    question: 'How do restaurant partners get paid?',
    answer: 'Restaurant orders are managed through our advanced Restaurant Dashboard. Payments are calculated daily and paid directly into your verified bank account or digital wallet.'
  },
  {
    question: 'Is in-app payment secure?',
    answer: 'Yes. Quick Drop utilizes secure SSL encryption and integrated payment gateways to secure credit cards, digital wallets, UPI, and bank transfers.'
  },
  {
    question: 'Can I schedule airport transfers in advance?',
    answer: 'Absolutely. The Airport Transfer module allows you to pre-schedule rides hours or days in advance. Simply select the transfer option, specify your flight details, and a driver will be dispatched to match your schedule.'
  }
]

export default function FAQ({ settings }) {
  const [openIdx, setOpenIdx] = useState(null)
  const faqs = settings?.faqs && settings.faqs.length > 0 ? settings.faqs : defaultFaqs

  const toggleFaq = (idx) => setOpenIdx(openIdx === idx ? null : idx)

  return (
    <section id="faq" className="py-20 overflow-hidden relative bg-white" style={{ fontFamily: "'Poppins', sans-serif" }}>
      {/* Dot grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.035] pointer-events-none"
        style={{ backgroundImage: 'radial-gradient(rgba(15,23,42,0.2) 1px, transparent 1px)', backgroundSize: '28px 28px' }}
      />

      {/* Subtle glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] rounded-full bg-[#ff5100]/[0.015] blur-[120px] pointer-events-none" />

      <div className="max-w-4xl mx-auto px-6 relative z-10">

        {/* Header — editorial style */}
        <div className="text-left mb-16 space-y-4 border-b border-slate-200 pb-10">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
            FAQ
          </p>
          <h2 className="text-3xl sm:text-5xl font-black text-slate-900 tracking-tight leading-tight max-w-xl">
            Have Questions?<br />
            <span className="text-slate-400">We Have Answers.</span>
          </h2>
          <p className="text-sm sm:text-base text-slate-500 max-w-lg leading-relaxed">
            Quick answers to common questions on our super-app services, rider accounts, and partner registrations.
          </p>
        </div>

        {/* FAQ Accordion — numbered editorial style */}
        <div className="space-y-0 text-left divide-y divide-slate-100">
          {faqs.map((faq, idx) => {
            const isOpen = openIdx === idx
            const num = String(idx + 1).padStart(2, '0')
            return (
              <div key={idx} className="group">
                <button
                  onClick={() => toggleFaq(idx)}
                  className="w-full flex items-start gap-6 py-7 text-left focus:outline-none"
                >
                  {/* Number label */}
                  <span
                    className="text-sm font-black tabular-nums shrink-0 mt-0.5 transition-colors duration-300 w-8"
                    style={{ color: isOpen ? '#ff5100' : '#cbd5e1' }}
                  >
                    {num}
                  </span>

                  {/* Question */}
                  <span className={`flex-1 font-bold text-base sm:text-lg leading-snug pr-4 transition-colors duration-300 ${isOpen ? 'text-slate-900' : 'text-slate-700 group-hover:text-slate-900'}`}>
                    {faq.question}
                  </span>

                  {/* Toggle Icon */}
                  <div
                    className="p-2 rounded-xl shrink-0 transition-all duration-300 border mt-0.5"
                    style={{
                      background: isOpen ? 'linear-gradient(135deg, #ff5100, #e11d48)' : 'transparent',
                      borderColor: isOpen ? 'transparent' : '#e2e8f0',
                      color: isOpen ? 'white' : '#64748b',
                      transform: isOpen ? 'scale(1.05)' : 'scale(1)',
                      boxShadow: isOpen ? '0 4px 16px rgba(255,81,0,0.25)' : ''
                    }}
                  >
                    {isOpen ? <Minus className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                  </div>
                </button>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                    >
                      <div className="pl-14 pr-12 pb-7 text-slate-500 text-sm sm:text-base leading-relaxed">
                        {/* Colored left accent */}
                        <div className="relative pl-5 border-l-2 border-[#ff5100]/30">
                          {faq.answer}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )
          })}
        </div>

        {/* Bottom CTA */}
        <div className="mt-16 pt-10 border-t border-slate-100 text-center">
          <p className="text-slate-500 text-sm mb-4">Still have questions? Our support team is available 24/7.</p>
          <a
            href="/support"
            className="inline-flex items-center gap-2 px-8 py-3 rounded-full font-bold text-sm text-white k9-btn-glow-pulse"
          >
            Contact Support →
          </a>
        </div>

      </div>
    </section>
  )
}
