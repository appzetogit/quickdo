import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, MapPin, Clock, Users, ChevronRight, Star, Zap, Shield } from 'lucide-react';

const DAYS = 7;
const getDates = () => {
  const dates = [];
  const now = new Date();
  for (let i = 0; i < DAYS; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    dates.push(d);
  }
  return dates;
};

const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const ROUTES = {
  '2026-04-05': [
    { id:'T1', from:'Indore (Vijay Nagar)', to:'Bhopal (MP Nagar)', departure:'07:30 AM', duration:'3h 15m', price:249, seats:5, vehicle:'Toyota Innova', driver:'Rahul Patel', rating:'4.9' },
    { id:'T2', from:'Indore (Rajwada)', to:'Ujjain (Mahakal)', departure:'09:00 AM', duration:'1h 10m', price:119, seats:3, vehicle:'Maruti Ertiga', driver:'Kishan Sharma', rating:'4.7' },
    { id:'T3', from:'Indore (Palasia)', to:'Dewas', departure:'11:30 AM', duration:'45m', price:79, seats:6, vehicle:'Swift Dzire', driver:'Amit Verma', rating:'4.8' },
  ],
  '2026-04-06': [
    { id:'T4', from:'Indore (Vijay Nagar)', to:'Bhopal (MP Nagar)', departure:'08:00 AM', duration:'3h 15m', price:249, seats:4, vehicle:'Toyota Innova', driver:'Sunil Patel', rating:'4.6' },
    { id:'T5', from:'Indore (Rajwada)', to:'Omkareshwar', departure:'06:00 AM', duration:'2h 30m', price:199, seats:2, vehicle:'Maruti Ertiga', driver:'Ravi Sharma', rating:'4.9' },
  ],
  '2026-04-07': [
    { id:'T6', from:'Indore (Palasia)', to:'Ujjain (Mahakal)', departure:'07:00 AM', duration:'1h 10m', price:119, seats:7, vehicle:'Swift Dzire', driver:'Deepak Joshi', rating:'4.8' },
  ],
};

const fmtKey = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

const SharedTaxi = () => {
  const navigate = useNavigate();
  const dates = getDates();
  const [selectedDate, setSelectedDate] = useState(dates[1]); // default tomorrow

  const key = fmtKey(selectedDate);
  const routes = ROUTES[key] || [];

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#F8FAFC_0%,#F3F4F6_38%,#EEF2F7_100%)] max-w-lg mx-auto font-sans pb-12 relative overflow-hidden">
      <div className="absolute -top-16 right-[-40px] h-44 w-44 rounded-full bg-emerald-100/60 blur-3xl pointer-events-none" />

      {/* Header */}
      <motion.header initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
        className="bg-white/90 backdrop-blur-md px-5 pt-10 pb-4 sticky top-0 z-20 border-b border-white/80 shadow-[0_4px_20px_rgba(15,23,42,0.05)]">
        <div className="flex items-center gap-3 mb-4">
          <motion.button whileTap={{ scale: 0.9 }} onClick={() => navigate(-1)}
            className="w-9 h-9 rounded-[12px] border border-white/80 bg-white/90 flex items-center justify-center shadow-[0_4px_12px_rgba(15,23,42,0.07)] shrink-0">
            <ArrowLeft size={18} className="text-slate-900" strokeWidth={2.5} />
          </motion.button>
          <div className="flex-1 min-w-0">
            <p className="text-[9px] font-black uppercase tracking-[0.26em] text-slate-400">Shared Taxi</p>
            <h1 className="text-[19px] font-black tracking-tight text-slate-900 leading-tight">Select a Route</h1>
          </div>
          <div className="flex items-center gap-1 bg-emerald-50 border border-emerald-100 rounded-full px-2.5 py-1 shrink-0">
            <Zap size={10} className="text-emerald-500" strokeWidth={2.5} />
            <span className="text-[10px] font-black text-emerald-600">50% cheaper</span>
          </div>
        </div>

        {/* Date strip */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
          {dates.map((d) => {
            const isActive = fmtKey(d) === fmtKey(selectedDate);
            return (
              <motion.button key={d.toISOString()} whileTap={{ scale: 0.95 }}
                onClick={() => setSelectedDate(d)}
                className={`shrink-0 flex flex-col items-center px-3 py-2 rounded-[14px] border transition-all min-w-[52px] ${
                  isActive
                    ? 'bg-slate-900 border-slate-900 shadow-[0_4px_12px_rgba(15,23,42,0.18)]'
                    : 'bg-white/80 border-white/80 shadow-[0_2px_6px_rgba(15,23,42,0.05)]'
                }`}>
                <span className={`text-[9px] font-black uppercase tracking-wider ${isActive ? 'text-slate-400' : 'text-slate-400'}`}>
                  {DAY_NAMES[d.getDay()]}
                </span>
                <span className={`text-[18px] font-black leading-tight ${isActive ? 'text-white' : 'text-slate-900'}`}>
                  {d.getDate()}
                </span>
                <span className={`text-[9px] font-bold ${isActive ? 'text-slate-400' : 'text-slate-400'}`}>
                  {MONTH_NAMES[d.getMonth()]}
                </span>
              </motion.button>
            );
          })}
        </div>
      </motion.header>

      <div className="px-5 pt-4 space-y-3">
        <AnimatePresence mode="wait">
          {routes.length === 0 ? (
            <motion.div key="empty" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="w-14 h-14 rounded-[18px] bg-white/90 border border-white/80 shadow-[0_4px_14px_rgba(15,23,42,0.05)] flex items-center justify-center">
                <Clock size={24} className="text-slate-300" strokeWidth={1.5} />
              </div>
              <p className="text-[14px] font-black text-slate-700">No routes available</p>
              <p className="text-[12px] font-bold text-slate-400">
                for {DAY_NAMES[selectedDate.getDay()]}, {selectedDate.getDate()} {MONTH_NAMES[selectedDate.getMonth()]} {selectedDate.getFullYear()}
              </p>
              <p className="text-[11px] font-bold text-slate-400">Try selecting a different date</p>
            </motion.div>
          ) : (
            <motion.div key={key} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="space-y-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.26em] text-slate-400">{routes.length} routes found</p>
                <h2 className="mt-0.5 text-[15px] font-black text-slate-900">
                  {DAY_NAMES[selectedDate.getDay()]}, {selectedDate.getDate()} {MONTH_NAMES[selectedDate.getMonth()]}
                </h2>
              </div>
              {routes.map((r, i) => (
                <motion.button key={r.id} type="button"
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => navigate('/cab/shared/seats', { state: { route: r, date: fmtKey(selectedDate) } })}
                  className="w-full rounded-[20px] border border-white/80 bg-white/90 shadow-[0_4px_14px_rgba(15,23,42,0.06)] overflow-hidden text-left">

                  {/* Route header */}
                  <div className="px-4 pt-4 pb-3 flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                        <span className="text-[13px] font-black text-slate-900 leading-tight truncate">{r.from}</span>
                      </div>
                      <div className="ml-1 w-px h-3 border-l border-dashed border-slate-200" />
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-primary-orange/50 shrink-0" />
                        <span className="text-[13px] font-black text-slate-900 leading-tight truncate">{r.to}</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">Per seat</p>
                      <p className="text-[22px] font-black text-slate-900 leading-tight tracking-tighter">₹{r.price}</p>
                    </div>
                  </div>

                  {/* Meta row */}
                  <div className="px-4 pb-4 flex items-center justify-between border-t border-slate-50 pt-3">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1 text-[10px] font-black text-slate-500">
                        <Clock size={10} strokeWidth={2.5} />{r.departure}
                      </div>
                      <div className="w-1 h-1 bg-slate-200 rounded-full" />
                      <span className="text-[10px] font-bold text-slate-400">{r.duration}</span>
                      <div className="w-1 h-1 bg-slate-200 rounded-full" />
                      <div className={`flex items-center gap-1 text-[10px] font-black ${r.seats <= 2 ? 'text-red-500' : 'text-emerald-600'}`}>
                        <Users size={10} strokeWidth={2.5} />{r.seats} left
                      </div>
                    </div>
                    <div className="flex items-center gap-1 bg-yellow-50 border border-yellow-100 rounded-full px-2 py-0.5">
                      <Star size={9} className="text-yellow-500 fill-yellow-500" />
                      <span className="text-[10px] font-black text-slate-700">{r.rating}</span>
                    </div>
                  </div>
                </motion.button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Safety note */}
        <div className="flex items-center gap-3 rounded-[16px] border border-white/80 bg-white/90 px-4 py-3 shadow-[0_2px_8px_rgba(15,23,42,0.04)] mt-2">
          <div className="w-7 h-7 rounded-[9px] bg-slate-50 flex items-center justify-center shrink-0">
            <Shield size={13} className="text-slate-400" strokeWidth={2} />
          </div>
          <p className="text-[11px] font-bold text-slate-400">All rides GPS-tracked. Driver & co-passengers are identity verified.</p>
        </div>
      </div>
    </div>
  );
};

export default SharedTaxi;
