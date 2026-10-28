import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, MapPin, Clock, Users, CheckCircle2, CreditCard, Banknote, Smartphone, ChevronRight } from 'lucide-react';

const PAYMENT_METHODS = [
  { id: 'upi',  label: 'UPI',  sub: 'PhonePe, GPay, Paytm', icon: Smartphone },
  { id: 'card', label: 'Card', sub: 'Debit / Credit card',   icon: CreditCard },
  { id: 'cash', label: 'Cash', sub: 'Pay to driver',         icon: Banknote   },
];

const SharedTaxiConfirm = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { route, date, seats, total } = location.state || {};
  if (!route) { navigate('/cab/shared'); return null; }

  const [method, setMethod] = useState('upi');
  const [paying, setPaying] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const bookingId = `SHR-${Math.random().toString(36).slice(2,8).toUpperCase()}`;

  const handlePay = () => {
    setPaying(true);
    setTimeout(() => { setPaying(false); setConfirmed(true); }, 1800);
  };

  if (confirmed) {
    return (
      <div className="min-h-screen bg-[linear-gradient(180deg,#F8FAFC_0%,#F3F4F6_38%,#EEF2F7_100%)] max-w-lg mx-auto font-sans flex flex-col items-center justify-center px-5 gap-5">
        <div className="absolute -top-16 right-[-40px] h-44 w-44 rounded-full bg-emerald-100/60 blur-3xl pointer-events-none" />
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 300 }}
          className="w-16 h-16 bg-emerald-500 rounded-full flex items-center justify-center shadow-[0_8px_24px_rgba(16,185,129,0.25)]">
          <CheckCircle2 size={30} className="text-white" strokeWidth={2.5} />
        </motion.div>
        <div className="text-center">
          <p className="text-[9px] font-black uppercase tracking-[0.26em] text-slate-400">Booking Confirmed</p>
          <h1 className="text-[22px] font-black text-slate-900 tracking-tight mt-0.5">You're booked!</h1>
          <p className="text-[12px] font-bold text-slate-400 mt-1">ID: <span className="text-slate-700 font-black">{bookingId}</span></p>
        </div>
        <div className="w-full rounded-[20px] border border-white/80 bg-white/90 shadow-[0_4px_14px_rgba(15,23,42,0.06)] px-5 py-4 space-y-2.5">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
            <span className="text-[12px] font-black text-slate-800 truncate">{route.from}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-primary-orange/50 shrink-0" />
            <span className="text-[12px] font-black text-slate-800 truncate">{route.to}</span>
          </div>
          <div className="border-t border-slate-50 pt-2.5 flex justify-between items-center">
            <div>
              <p className="text-[10px] font-bold text-slate-400">{date} · {route.departure}</p>
              <p className="text-[10px] font-bold text-slate-400">Seats: {seats?.map(s=>s.label).join(', ')}</p>
            </div>
            <p className="text-[20px] font-black text-slate-900">₹{total}</p>
          </div>
        </div>
        <motion.button onClick={() => navigate('/taxi/user')}
          className="pointer-events-auto w-full bg-slate-900 py-4 rounded-[18px] text-[15px] font-black text-white shadow-lg flex items-center justify-center gap-2 transition-all active:scale-95">
          <Home size={16} strokeWidth={2.5} /> Go to Home Dashboard
        </motion.button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#F8FAFC_0%,#F3F4F6_38%,#EEF2F7_100%)] max-w-lg mx-auto font-sans pb-28 relative overflow-hidden">
      <div className="absolute -top-16 right-[-40px] h-44 w-44 rounded-full bg-emerald-100/60 blur-3xl pointer-events-none" />

      <motion.header initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
        className="bg-white/90 backdrop-blur-md px-5 pt-10 pb-4 sticky top-0 z-20 border-b border-white/80 shadow-[0_4px_20px_rgba(15,23,42,0.05)]">
        <div className="flex items-center gap-3">
          <motion.button whileTap={{ scale: 0.9 }} onClick={() => navigate(-1)}
            className="w-9 h-9 rounded-[12px] border border-white/80 bg-white/90 flex items-center justify-center shadow-[0_4px_12px_rgba(15,23,42,0.07)] shrink-0">
            <ArrowLeft size={18} className="text-slate-900" strokeWidth={2.5} />
          </motion.button>
          <div className="flex-1 min-w-0">
            <p className="text-[9px] font-black uppercase tracking-[0.26em] text-slate-400">Confirm Booking</p>
            <h1 className="text-[18px] font-black tracking-tight text-slate-900 leading-tight">Review & Pay</h1>
          </div>
        </div>
      </motion.header>

      <div className="px-5 pt-4 space-y-3">

        {/* Trip summary */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          className="rounded-[20px] border border-white/80 bg-white/90 shadow-[0_4px_14px_rgba(15,23,42,0.05)] px-4 py-4 space-y-3">
          <p className="text-[9px] font-black uppercase tracking-[0.22em] text-slate-400">Trip Details</p>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
              <span className="text-[13px] font-black text-slate-900 truncate">{route.from}</span>
            </div>
            <div className="ml-0.5 w-px h-3 border-l border-dashed border-slate-200" />
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-primary-orange/50 shrink-0" />
              <span className="text-[13px] font-black text-slate-900 truncate">{route.to}</span>
            </div>
          </div>
          <div className="flex items-center gap-3 text-[10px] font-bold text-slate-400 border-t border-slate-50 pt-2.5">
            <div className="flex items-center gap-1"><Clock size={10} strokeWidth={2} />{date} · {route.departure}</div>
            <div className="w-1 h-1 bg-slate-200 rounded-full" />
            <div className="flex items-center gap-1"><Users size={10} strokeWidth={2} />{seats?.length} seat{seats?.length > 1 ? 's' : ''}: {seats?.map(s=>s.label).join(', ')}</div>
          </div>
        </motion.div>

        {/* Fare breakdown */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="rounded-[20px] border border-white/80 bg-white/90 shadow-[0_4px_14px_rgba(15,23,42,0.05)] px-4 py-4 space-y-2">
          <p className="text-[9px] font-black uppercase tracking-[0.22em] text-slate-400">Fare Breakdown</p>
          <div className="flex justify-between text-[12px] font-bold text-slate-500">
            <span>₹{route.price} × {seats?.length} seat{seats?.length > 1 ? 's' : ''}</span>
            <span className="font-black text-slate-900">₹{total}</span>
          </div>
          <div className="flex justify-between text-[12px] font-bold text-slate-500">
            <span>Platform fee</span><span>₹0</span>
          </div>
          <div className="border-t border-slate-50 pt-2 flex justify-between">
            <span className="text-[14px] font-black text-slate-900">Total</span>
            <span className="text-[18px] font-black text-slate-900">₹{total}</span>
          </div>
        </motion.div>

        {/* Payment method */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="rounded-[20px] border border-white/80 bg-white/90 shadow-[0_4px_14px_rgba(15,23,42,0.05)] px-4 py-4 space-y-2.5">
          <p className="text-[9px] font-black uppercase tracking-[0.22em] text-slate-400">Payment Method</p>
          <div className="grid grid-cols-3 gap-2">
            {PAYMENT_METHODS.map(({ id, label, sub, icon: Icon }) => (
              <motion.button key={id} whileTap={{ scale: 0.96 }} onClick={() => setMethod(id)}
                className={`flex flex-col items-center gap-1.5 py-3 rounded-[14px] border transition-all ${
                  method === id ? 'border-primary-orange/20 bg-primary-orange/5 shadow-[0_3px_10px_rgba(249,115,22,0.12)]' : 'border-slate-100 bg-slate-50'
                }`}>
                <Icon size={16} className={method === id ? 'text-primary-orange/50' : 'text-slate-400'} strokeWidth={2} />
                <span className={`text-[10px] font-black ${method === id ? 'text-slate-900' : 'text-slate-400'}`}>{label}</span>
              </motion.button>
            ))}
          </div>
        </motion.div>
      </div>

      {/* CTA */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-lg px-5 pb-6 pt-3 bg-gradient-to-t from-[#EEF2F7] via-[#F3F4F6]/95 to-transparent pointer-events-none z-30">
        <motion.button whileTap={{ scale: 0.98 }} onClick={handlePay} disabled={paying}
          className="pointer-events-auto w-full bg-slate-900 py-4 rounded-[18px] text-[15px] font-black text-white shadow-[0_8px_24px_rgba(15,23,42,0.18)] flex items-center justify-center gap-2">
          {paying
            ? <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            : <><CreditCard size={16} strokeWidth={2.5} /> Confirm & Pay ₹{total}</>}
        </motion.button>
      </div>
    </div>
  );
};

export default SharedTaxiConfirm;
