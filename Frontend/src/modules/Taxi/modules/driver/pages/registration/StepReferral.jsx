import React, { useEffect, useState } from 'react';
import { ArrowLeft, Gift, ChevronRight, Tag, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';
import { useNavigate, useLocation } from 'react-router-dom';
import {
    getStoredDriverRegistrationSession,
    saveDriverReferral,
    saveDriverRegistrationSession,
} from '../../services/registrationService';

const StepReferral = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const session = {
        ...getStoredDriverRegistrationSession(),
        ...(location.state || {}),
    };
    const [referral, setReferral] = useState(session.referralCode || '');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        saveDriverRegistrationSession({
            ...session,
            referralCode: referral,
        });
    }, [referral]);

    const handleNext = async (skip = false) => {
        setLoading(true);
        setError('');

        try {
            const response = await saveDriverReferral({
                registrationId: session.registrationId,
                phone: session.phone,
                referralCode: skip ? '' : referral,
            });

            const nextState = saveDriverRegistrationSession({
                ...session,
                referralCode: skip ? '' : referral,
                referralSession: response?.data?.session || null,
            });

            navigate('/taxi/driver/step-vehicle', { state: nextState });
        } catch (err) {
            setError(err?.message || 'Unable to save referral code');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div 
            className="min-h-screen bg-[linear-gradient(180deg,#f6efe4_0%,#fcfaf6_28%,#ffffff_100%)] px-5 pb-32 pt-8 select-none overflow-x-hidden"
            style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}
        >
            <main className="mx-auto max-w-sm space-y-6">
                <header className="space-y-6">
                    <div className="flex items-center justify-between">
                         <motion.button
                            whileTap={{ scale: 0.9 }}
                            onClick={() => navigate('/taxi/driver/step-personal', { state: session })}
                            className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white border border-slate-100 text-slate-900 shadow-sm transition-all"
                        >
                            <ArrowLeft size={18} strokeWidth={2.5} />
                        </motion.button>
                        <div className="rounded-full bg-slate-900/5 px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.15em] text-slate-500 border border-slate-900/5">
                            Step 2 of 4
                        </div>
                    </div>

                    <section className="space-y-3">
                        <div className="flex items-center gap-3">
                             <div className="flex h-11 w-11 items-center justify-center rounded-[1.25rem] bg-slate-900 text-white shadow-xl shadow-slate-900/10">
                                <Gift size={22} strokeWidth={2.5} />
                            </div>
                            <span className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400 opacity-60">
                                Rewards Program
                            </span>
                        </div>
                        <h1 className="font-['Outfit'] text-[48px] font-black leading-[1] tracking-[-0.04em] text-slate-900">
                            Got a <span className="text-slate-400">Code?</span>
                        </h1>
                        <p className="text-[15px] leading-relaxed text-slate-500 font-bold opacity-80 max-w-[28ch]">
                            Enter a referral code to unlock exclusive joining bonuses and rewards.
                        </p>
                    </section>
                </header>

                {error && (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700 shadow-[0_10px_30px_rgba(244,63,94,0.08)]">
                        {error}
                    </div>
                )}

                <section className="space-y-5 rounded-[2.5rem] border border-slate-100 bg-white p-6 shadow-[0_10px_40px_rgba(0,0,0,0.04)]">
                    <div className="space-y-1 px-1">
                        <h2 className="text-lg font-black tracking-tight text-slate-900">Referral Details</h2>
                        <p className="text-[12px] font-black text-slate-400 uppercase tracking-widest opacity-60">Optional Bonus</p>
                    </div>

                    <div className="space-y-4">
                        <div className="group rounded-[1.8rem] border-2 transition-all p-4 border-slate-50 bg-slate-50 focus-within:border-slate-900/10 focus-within:bg-white focus-within:shadow-xl focus-within:shadow-slate-900/5">
                            <div className="flex items-center gap-4">
                                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-sm group-focus-within:bg-slate-900 group-focus-within:text-white transition-all">
                                    <Tag size={20} strokeWidth={2.5} />
                                </div>
                                <div className="min-w-0 flex-1 space-y-0.5 overflow-hidden">
                                    <label className="block text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 opacity-70">Referral Code</label>
                                    <input
                                        value={referral}
                                        onChange={(e) => setReferral(e.target.value.toUpperCase())}
                                        placeholder="ZETO-BONUS-9080"
                                        className="w-full border-none bg-transparent p-0 text-lg font-black text-slate-900 focus:outline-none focus:ring-0 placeholder:text-slate-200 tracking-wider uppercase"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="rounded-[1.8rem] border-2 border-slate-900/5 bg-slate-900/5 p-5 relative overflow-hidden group">
                            <div className="relative z-10 flex items-start gap-4">
                                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-slate-900 shadow-sm">
                                    <Sparkles size={20} strokeWidth={2.5} />
                                </div>
                                <div className="min-w-0 flex-1 space-y-1">
                                    <span className="block text-[12px] font-black text-slate-900 uppercase tracking-widest">Joining Reward</span>
                                    <p className="text-[13px] text-slate-600 font-bold leading-relaxed opacity-80">
                                        Unlock <span className="text-slate-900 font-black">₹500 Bonus</span> after you complete your first 10 rides successfully.
                                    </p>
                                </div>
                            </div>
                            <div className="absolute -right-4 -bottom-4 opacity-[0.03] group-hover:scale-110 transition-transform duration-700">
                                <Gift size={100} />
                            </div>
                        </div>
                    </div>
                </section>

                <button 
                    onClick={() => handleNext(true)}
                    disabled={loading}
                    className="w-full text-[12px] font-black text-slate-400 hover:text-slate-900 transition-colors py-4 uppercase tracking-[0.2em] opacity-60 hover:opacity-100"
                >
                    Skip referral program
                </button>

                <div className="fixed bottom-0 left-0 right-0 p-8 bg-gradient-to-t from-slate-50 via-slate-50 to-transparent">
                    <div className="mx-auto max-w-sm">
                        <motion.button
                            whileHover={{ scale: 1.02, y: -2 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => handleNext(false)}
                            disabled={loading || !referral}
                            className={`group flex h-16 w-full items-center justify-center gap-3 rounded-[1.8rem] text-[15px] font-black tracking-tight transition-all relative overflow-hidden ${
                                referral
                                    ? 'bg-slate-900 text-white shadow-[0_20px_40px_rgba(0,0,0,0.2)] active:bg-black'
                                    : 'pointer-events-none bg-slate-200 text-slate-400 shadow-none'
                            }`}
                        >
                            {loading ? (
                                <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                <>
                                    <span className="relative z-10 uppercase tracking-widest">Apply & Continue</span>
                                    <ChevronRight size={18} strokeWidth={3} className="relative z-10 group-hover:translate-x-1 transition-transform" />
                                </>
                            )}
                        </motion.button>
                    </div>
                </div>
            </main>
        </div>
    );
};

export default StepReferral;

