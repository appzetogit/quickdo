import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, MapPin, Clock, Users, ChevronRight, Star } from 'lucide-react';

const INIT_SEATS = [
  { id:1, label:'A1', status:'booked'    },
  { id:2, label:'A2', status:'available' },
  { id:3, label:'B1', status:'available' },
  { id:4, label:'B2', status:'booked'    },
  { id:5, label:'C1', status:'available' },
  { id:6, label:'C2', status:'available' },
  { id:7, label:'D1', status:'available' },
  { id:8, label:'D2', status:'booked'    },
];

const SharedTaxiSeats = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { route, date } = location.state || {};
  if (!route) { navigate('/cab/shared'); return null; }

  const [seats, setSeats] = useState(
    Array.isArray(route.seats) ? route.seats.map(s => ({ ...s })) : INIT_SEATS.map(s => ({ ...s }))
  );

  const toggle = (id) => setSeats(prev =>
    prev.map(s => s.id === id && s.status !== 'booked'
      ? { ...s, status: s.status === 'selected' ? 'available' : 'selected' }
      : s
    )
  );

  const selected = seats.filter(s => s.status === 'selected');
  const total = selected.length * route.price;

  const rows = [[seats[0],seats[1]],[seats[2],seats[3]],[seats[4],seats[5]],[seats[6],seats[7]]];

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#F8FAFC_0%,#F3F4F6_38%,#EEF2F7_100%)] max-w-lg mx-auto font-sans pb-28 relative overflow-hidden">
      <div className="absolute -top-16 right-[-40px] h-44 w-44 rounded-full bg-emerald-100/60 blur-3xl pointer-events-none" />

      {/* Header */}
      <motion.header initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
        className="bg-white/90 backdrop-blur-md px-5 pt-10 pb-4 sticky top-0 z-20 border-b border-white/80 shadow-[0_4px_20px_rgba(15,23,42,0.05)]">
        <div className="flex items-center gap-3">
          <motion.button whileTap={{ scale: 0.9 }} onClick={() => navigate(-1)}
            className="w-9 h-9 rounded-[12px] border border-white/80 bg-white/90 flex items-center justify-center shadow-[0_4px_12px_rgba(15,23,42,0.07)] shrink-0">
            <ArrowLeft size={18} className="text-slate-900" strokeWidth={2.5} />
          </motion.button>
          <div className="flex-1 min-w-0">
            <p className="text-[9px] font-black uppercase tracking-[0.26em] text-slate-400">Select Seats · {date}</p>
            <h1 className="text-[18px] font-black tracking-tight text-slate-900 leading-tight truncate">{route.from} → {route.to}</h1>
          </div>
        </div>
      </motion.header>

      <div className="px-5 pt-4 space-y-4">

        {/* Route summary card */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          className="rounded-[18px] border border-white/80 bg-white/90 shadow-[0_4px_14px_rgba(15,23,42,0.05)] px-4 py-3 flex items-center justify-between gap-3">
          <div className="space-y-1 flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
              <span className="text-[11px] font-black text-slate-700 truncate">{route.from}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-primary-orange/50 shrink-0" />
              <span className="text-[11px] font-black text-slate-700 truncate">{route.to}</span>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0 text-[10px] font-bold text-slate-400">
            <div className="flex items-center gap-1"><Clock size={10} strokeWidth={2} />{route.departure}</div>
            <div className="flex items-center gap-1"><Users size={10} strokeWidth={2} />{route.duration}</div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.18em]">Per seat</p>
            <p className="text-[18px] font-black text-slate-900 leading-tight">₹{route.price}</p>
          </div>
        </motion.div>

        {/* Driver info */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="rounded-[18px] border border-white/80 bg-white/90 shadow-[0_4px_14px_rgba(15,23,42,0.05)] px-4 py-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-[12px] bg-slate-100 overflow-hidden shrink-0">
            <img src={`https://ui-avatars.com/api/?name=${route.driver?.replace(' ','+')}&background=f1f5f9&color=0f172a`}
              className="w-full h-full object-cover" alt="Driver" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-black text-slate-900 leading-tight">{route.driver}</p>
            <p className="text-[10px] font-bold text-slate-400">{route.vehicle}</p>
          </div>
          <div className="flex items-center gap-1 bg-yellow-50 border border-yellow-100 rounded-full px-2 py-0.5 shrink-0">
            <Star size={9} className="text-yellow-500 fill-yellow-500" />
            <span className="text-[10px] font-black text-slate-800">{route.rating}</span>
          </div>
        </motion.div>

        {/* Seat map */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="rounded-[20px] border border-white/80 bg-white/90 shadow-[0_4px_14px_rgba(15,23,42,0.05)] px-5 py-4 space-y-4">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Choose Your Seat</p>

          {/* Driver row */}
          <div className="flex items-center justify-between pb-3 border-b border-dashed border-slate-100">
            <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest">Front</span>
            <div className="w-9 h-9 bg-slate-100 rounded-[10px] flex items-center justify-center text-base">🧑‍✈️</div>
          </div>

          {/* Seats */}
          <div className="space-y-2.5">
            {rows.map((row, ri) => (
              <div key={ri} className="flex items-center justify-center gap-2">
                {row.slice(0,2).map(seat => (
                  <motion.button key={seat.id} whileTap={seat.status !== 'booked' ? { scale: 0.9 } : {}}
                    onClick={() => toggle(seat.id)}
                    className={`w-14 h-14 rounded-[14px] border-2 flex flex-col items-center justify-center gap-0.5 transition-all ${
                      seat.status === 'booked'    ? 'bg-red-50 border-red-200 cursor-not-allowed opacity-60' :
                      seat.status === 'selected'  ? 'bg-slate-900 border-slate-900 shadow-[0_4px_12px_rgba(15,23,42,0.2)]' :
                                                    'bg-white border-slate-200 hover:border-emerald-300'
                    }`}>
                    <span className="text-base leading-none">
                      {seat.status === 'booked' ? '🔴' : seat.status === 'selected' ? '✓' : '💺'}
                    </span>
                    <span className={`text-[9px] font-black leading-none ${seat.status === 'selected' ? 'text-white' : 'text-slate-400'}`}>
                      {seat.label}
                    </span>
                  </motion.button>
                ))}
                <div className="w-5" />
                {row.slice(2,4).map(seat => seat ? (
                  <motion.button key={seat.id} whileTap={seat.status !== 'booked' ? { scale: 0.9 } : {}}
                    onClick={() => toggle(seat.id)}
                    className={`w-14 h-14 rounded-[14px] border-2 flex flex-col items-center justify-center gap-0.5 transition-all ${
                      seat.status === 'booked'    ? 'bg-red-50 border-red-200 cursor-not-allowed opacity-60' :
                      seat.status === 'selected'  ? 'bg-slate-900 border-slate-900 shadow-[0_4px_12px_rgba(15,23,42,0.2)]' :
                                                    'bg-white border-slate-200 hover:border-emerald-300'
                    }`}>
                    <span className="text-base leading-none">
                      {seat.status === 'booked' ? '🔴' : seat.status === 'selected' ? '✓' : '💺'}
                    </span>
                    <span className={`text-[9px] font-black leading-none ${seat.status === 'selected' ? 'text-white' : 'text-slate-400'}`}>
                      {seat.label}
                    </span>
                  </motion.button>
                ) : <div key="empty" className="w-14 h-14 invisible" />)}
              </div>
            ))}
          </div>

          {/* Legend */}
          <div className="flex justify-center gap-4 pt-2 border-t border-slate-50">
            {[['bg-white border-slate-200','Available'],['bg-slate-900 border-slate-900','Selected'],['bg-red-50 border-red-200','Booked']].map(([cls,lbl]) => (
              <div key={lbl} className="flex items-center gap-1.5">
                <div className={`w-3 h-3 rounded border-2 ${cls}`} />
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">{lbl}</span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Sticky CTA */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-lg px-5 pb-6 pt-3 bg-gradient-to-t from-[#EEF2F7] via-[#F3F4F6]/95 to-transparent pointer-events-none z-30">
        <AnimatePresence>
          {selected.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}
              className="pointer-events-auto mb-2 flex items-center justify-between rounded-[16px] border border-white/80 bg-white/90 shadow-[0_4px_14px_rgba(15,23,42,0.08)] px-4 py-3">
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                  {selected.length} seat{selected.length > 1 ? 's' : ''} · {selected.map(s=>s.label).join(', ')}
                </p>
                <p className="text-[18px] font-black text-slate-900 leading-tight">₹{total}</p>
              </div>
              <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 border border-emerald-100 px-2 py-1 rounded-full">
                {selected.length}x ₹{route.price}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
        <motion.button whileTap={{ scale: 0.98 }} disabled={selected.length === 0}
          onClick={() => navigate('/cab/shared/confirm', { state: { route, date, seats: selected, total } })}
          className={`pointer-events-auto w-full py-4 rounded-[18px] text-[15px] font-black text-white shadow-[0_8px_24px_rgba(15,23,42,0.18)] flex items-center justify-center gap-2 transition-all ${
            selected.length > 0 ? 'bg-slate-900' : 'bg-slate-300'
          }`}>
          Continue to Booking <ChevronRight size={17} strokeWidth={3} className="opacity-50" />
        </motion.button>
      </div>
    </div>
  );
};

export default SharedTaxiSeats;
