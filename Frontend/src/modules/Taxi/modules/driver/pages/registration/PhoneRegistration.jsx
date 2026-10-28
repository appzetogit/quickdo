import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Phone, ChevronRight, ShieldCheck, Briefcase, UserRound, Sparkles, Building2, CheckCircle2 } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
    clearDriverRegistrationSession,
    getStoredDriverRegistrationSession,
    saveDriverRegistrationSession,
    sendDriverLoginOtp,
    sendDriverOtp,
} from '../../services/registrationService';

import { useSettings } from '../../../../shared/context/SettingsContext';
import loginBg from '../../../../assets/images/driver-login-bg.png';

const PhoneRegistration = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { settings, activeLogo } = useSettings();
    const storedSession = getStoredDriverRegistrationSession();
    const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
    const sharedReferralCode = String(
        searchParams.get('ref') ||
        searchParams.get('referral') ||
        searchParams.get('code') ||
        storedSession.referralCode ||
        '',
    ).trim().toUpperCase();
    const [phone, setPhone] = useState(() => String(location.state?.phone || storedSession.phone || '').replace(/\D/g, '').slice(-10));
    const [role, setRole] = useState(() => {
        const normalizePortalRole = (value) => {
            const normalized = String(value || '').toLowerCase();
            if (normalized === 'owner') return 'owner';
            if (normalized === 'bus_driver' || normalized === 'bus-driver' || normalized === 'busdriver') return 'bus_driver';
            if (normalized === 'service_center' || normalized === 'service-center' || normalized === 'servicecenter') return 'service_center';
            if (normalized === 'service_center_staff' || normalized === 'service-center-staff' || normalized === 'servicecenterstaff') return 'service_center_staff';
            return 'driver';
        };

        const stateRole = String(location.state?.role || '').toLowerCase();
        if (stateRole) return normalizePortalRole(stateRole);

        if (sharedReferralCode && location.pathname.startsWith('/taxi/driver')) {
            return 'driver';
        }

        const savedRole = String(storedSession.role || '').toLowerCase();
        return normalizePortalRole(savedRole);
    });
    const [agreed, setAgreed] = useState(true);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const phoneCardRef = useRef(null);
    const phoneInputRef = useRef(null);
    const routePrefix = location.pathname.startsWith('/taxi/owner') ? '/taxi/owner' : '/taxi/driver';
    const isLoginPage = location.pathname === `${routePrefix}/login` || location.pathname === `${routePrefix}/login/`;
    const appName = settings.general?.app_name || 'App';

    const roleOptions = isLoginPage
        ? [
            { id: 'driver', label: 'Driver', Icon: UserRound },
            { id: 'owner', label: 'Owner', Icon: Briefcase },
            { id: 'bus_driver', label: 'Bus', Icon: ShieldCheck },
            { id: 'service_center', label: 'Center', Icon: Building2 },
            { id: 'service_center_staff', label: 'Staff', Icon: UserRound },
        ]
        : [
            { id: 'driver', label: 'Driver', Icon: UserRound },
            { id: 'owner', label: 'Owner', Icon: Briefcase },
        ];

    const modeConfig = useMemo(() => {
        const isOwner = role === 'owner';
        const isBusDriver = role === 'bus_driver';
        const isServiceCenter = role === 'service_center';
        const isServiceCenterStaff = role === 'service_center_staff';

        return {
            badge: isOwner ? 'Enterprise' : isBusDriver ? 'Transit' : isServiceCenter ? 'Operations' : isServiceCenterStaff ? 'Team' : 'Captain',
            title: isLoginPage
                ? `${isOwner ? 'Owner' : isBusDriver ? 'Bus Driver' : isServiceCenter ? 'Service Center' : isServiceCenterStaff ? 'Service Staff' : 'Driver'} Login`
                : `Join ${appName}`,
            subtitle: isLoginPage
                ? `Enter your number to access account.`
                : `Start your journey as a ${isOwner ? 'owner' : isBusDriver ? 'captain' : isServiceCenter ? 'operator' : isServiceCenterStaff ? 'staff' : 'driver'}.`,
            highlight: isOwner ? 'Manage fleet, payouts & drivers.' : isBusDriver ? 'Manage your coach, schedules and seat desk.' : isServiceCenter ? 'Manage your center profile, staff and rental vehicle catalog.' : isServiceCenterStaff ? 'Handle assigned bookings and work queues for your center.' : 'Go online, get trips & earn daily.',
            accentColor: isOwner ? '#1C2833' : isBusDriver ? '#0f3d3e' : isServiceCenter ? '#14342b' : isServiceCenterStaff ? '#1e3a5f' : '#4F46E5',
            Icon: isOwner ? Briefcase : isBusDriver ? ShieldCheck : isServiceCenter ? Building2 : isServiceCenterStaff ? ShieldCheck : UserRound,
        };
    }, [appName, isLoginPage, role]);

    useEffect(() => {
        saveDriverRegistrationSession({
            ...storedSession,
            role,
            phone,
            loginMode: isLoginPage,
            referralCode: sharedReferralCode,
        });
    }, [isLoginPage, role, phone, sharedReferralCode]);

    useEffect(() => {
        const scrollPhoneIntoView = () => {
            phoneCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        };

        const focusTimer = window.setTimeout(() => {
            scrollPhoneIntoView();
            phoneInputRef.current?.focus();
        }, 180);

        const viewport = window.visualViewport;
        viewport?.addEventListener('resize', scrollPhoneIntoView);

        return () => {
            window.clearTimeout(focusTimer);
            viewport?.removeEventListener('resize', scrollPhoneIntoView);
        };
    }, []);

    const handleSendOTP = async () => {
        if (phone.length !== 10) {
            setError('Please enter a valid 10-digit mobile number');
            return;
        }

        if (!agreed) {
            setError('Please accept the terms before continuing');
            return;
        }

        setLoading(true);
        setError('');

        try {
            clearDriverRegistrationSession();
            const response = isLoginPage
                ? await sendDriverLoginOtp({ phone, role })
                : await sendDriverOtp({ phone, role });
            const sessionData = response?.data?.session || response?.session || {};
            const nextState = saveDriverRegistrationSession({
                phone,
                role,
                registrationId: sessionData.registrationId || '',
                debugOtp: sessionData.debugOtp || '',
                loginMode: isLoginPage,
                referralCode: sharedReferralCode,
            });

            navigate(`${routePrefix}/otp-verify`, {
                state: nextState,
            });
        } catch (err) {
            const backendMessage = String(
                err?.message ||
                err?.error ||
                err?.data?.error ||
                err?.data?.message ||
                '',
            ).trim();
            if (backendMessage) {
                setError(backendMessage);
            } else {
                setError('Unable to send OTP right now');
            }
        } finally {
            setLoading(false);
        }
    };

    const containerVariants = {
        hidden: { opacity: 0, y: 20 },
        visible: {
            opacity: 1,
            y: 0,
            transition: {
                duration: 0.6,
                ease: [0.22, 1, 0.36, 1],
                staggerChildren: 0.1
            }
        }
    };

    const itemVariants = {
        hidden: { opacity: 0, y: 10 },
        visible: { opacity: 1, y: 0 }
    };

    return (
        <div
            className="min-h-[100dvh] relative bg-slate-50 select-none overflow-x-hidden font-sans"
        >
            <div className="fixed inset-0 z-0 bg-slate-50">
                <div className="absolute top-0 inset-x-0 h-64 bg-gradient-to-b from-white via-white/80 to-transparent pointer-events-none" />
                <div className="absolute -top-24 -right-24 w-96 h-96 bg-[#F38F24]/5 rounded-full blur-[80px] pointer-events-none" />
            </div>

            <main className="relative z-10 mx-auto max-w-sm px-6 pt-8 pb-20 flex flex-col min-h-[100dvh] justify-center">
                <motion.header
                    variants={containerVariants}
                    initial="hidden"
                    animate="visible"
                    className="space-y-4 mb-6 flex flex-col items-center text-center"
                >
                    <div className="flex flex-col items-center gap-3">
                        {activeLogo || settings.general?.logo || settings.customization?.logo ? (
                            <div className="w-14 h-14 bg-white rounded-[1.25rem] flex items-center justify-center shadow-sm border border-slate-100 overflow-hidden">
                                <img
                                    src={activeLogo || settings.general?.logo || settings.customization?.logo}
                                    alt={appName}
                                    className="w-full h-full object-cover scale-110"
                                />
                            </div>
                        ) : (
                            <div className="rounded-xl bg-[#1A1A1A] px-4 py-2 text-sm font-black tracking-tight text-white shadow-sm">
                                {appName}
                            </div>
                        )}
                    </div>

                    <motion.section
                        variants={itemVariants}
                        className="space-y-2 flex flex-col items-center"
                    >
                        <div className="flex items-center gap-2.5">
                            <div
                                className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#F38F24]/10 text-[#F38F24] shadow-sm border border-[#F38F24]/20"
                            >
                                <modeConfig.Icon size={16} strokeWidth={2.5} />
                            </div>
                            <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#F38F24]">
                                {modeConfig.badge}
                            </span>
                        </div>
                        <h1 className="font-sans text-[32px] font-black leading-tight tracking-tight text-slate-900 mt-1">
                            {modeConfig.title.split(' ')[0]} <span className="text-[#F38F24]">{modeConfig.title.split(' ').slice(1).join(' ')}</span>
                        </h1>
                        <p className="text-[13px] leading-relaxed text-slate-500 font-medium max-w-[28ch]">
                            {modeConfig.subtitle}
                        </p>
                    </motion.section>
                </motion.header>

                <motion.div
                    variants={containerVariants}
                    initial="hidden"
                    animate="visible"
                    className="space-y-5 relative z-20"
                >
                    <motion.div
                        variants={itemVariants}
                        className="flex items-center gap-1.5 mb-6 bg-[#F38F24]/5 p-1.5 rounded-[1rem] overflow-x-auto scroll-smooth w-full border border-[#F38F24]/10 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']"
                    >
                        {roleOptions.map((option) => {
                            const active = role === option.id;
                            return (
                                <motion.button
                                    key={option.id}
                                    layout
                                    whileTap={{ scale: 0.97 }}
                                    onClick={() => setRole(option.id)}
                                    className={`flex-1 min-w-max flex items-center justify-center gap-2 py-2 px-3 rounded-xl transition-all whitespace-nowrap ${active
                                        ? 'bg-white text-[#F38F24] shadow-sm border border-[#F38F24]/20'
                                        : 'text-slate-500 hover:text-slate-700'
                                        }`}
                                >
                                    <option.Icon size={14} strokeWidth={active ? 2.5 : 2} className={active ? 'text-[#F38F24]' : ''} />
                                    <span className="text-[11px] font-bold uppercase tracking-wide">{option.label}</span>
                                </motion.button>
                            );
                        })}
                    </motion.div>

                    <motion.section
                        variants={itemVariants}
                        ref={phoneCardRef}
                        className="w-full relative bg-white p-5 rounded-[1.5rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100"
                        style={{ scrollMarginTop: '20vh' }}
                    >
                        <div className="space-y-6 w-full">
                            <div className="space-y-3">
                                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest ml-1">
                                    Mobile Number
                                </label>
                                <div className={`flex items-center gap-0 bg-slate-50 border ${error ? 'border-red-300 ring-4 ring-red-50' : 'border-slate-200'} rounded-[1rem] focus-within:border-[#F38F24] focus-within:bg-white focus-within:ring-4 focus-within:ring-[#F38F24]/10 transition-all overflow-hidden h-14`}>
                                    <div className="px-4 border-r border-slate-200 bg-transparent text-slate-900 font-bold text-lg h-full flex items-center">
                                        +91
                                    </div>
                                    <input
                                        ref={phoneInputRef}
                                        type="tel"
                                        inputMode="numeric"
                                        pattern="[0-9]*"
                                        autoFocus
                                        maxLength={10}
                                        value={phone}
                                        onChange={(e) => {
                                            const val = e.target.value.replace(/\D/g, '');
                                            setPhone(val);
                                            if (error) setError('');
                                        }}
                                        onFocus={() => phoneCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                                        placeholder="00000 00000"
                                        className="flex-1 bg-transparent border-0 outline-none ring-0 placeholder:text-slate-300 text-lg font-bold tracking-widest px-4 text-slate-900 h-full w-full"
                                    />
                                </div>
                            </div>

                            <div className="flex gap-2.5 px-1 items-start mt-1">
                                <div className="relative flex items-center shrink-0 mt-0.5">
                                    <input
                                        type="checkbox"
                                        id="terms"
                                        checked={agreed}
                                        onChange={() => setAgreed(!agreed)}
                                        className="peer h-[16px] w-[16px] cursor-pointer appearance-none rounded-[4px] border-[1.5px] border-slate-300 bg-white transition-all checked:bg-[#F38F24] checked:border-[#F38F24]"
                                    />
                                    <CheckCircle2 className="pointer-events-none absolute inset-0 m-auto h-3 w-3 text-white opacity-0 transition-opacity peer-checked:opacity-100" strokeWidth={3} />
                                </div>
                                <label htmlFor="terms" className="text-[11px] font-medium text-slate-500 leading-relaxed cursor-pointer select-none">
                                    I agree to the{' '}
                                    <button
                                        type="button"
                                        onClick={() => {
                                            saveDriverRegistrationSession({
                                                ...storedSession,
                                                role,
                                            });
                                            navigate('/terms', { state: { role, returnTo: location.pathname } });
                                        }}
                                        className="text-[#F38F24] font-bold hover:text-accent-orange"
                                    >
                                        Terms
                                    </button>
                                    {' '}and{' '}
                                    <button
                                        type="button"
                                        onClick={() => {
                                            saveDriverRegistrationSession({
                                                ...storedSession,
                                                role,
                                            });
                                            navigate('/privacy', { state: { role, returnTo: location.pathname } });
                                        }}
                                        className="text-[#F38F24] font-bold hover:text-accent-orange"
                                    >
                                        Privacy Policy
                                    </button>.
                                </label>
                            </div>

                            <AnimatePresence>
                                {error && (
                                    <motion.div
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: 'auto' }}
                                        exit={{ opacity: 0, height: 0 }}
                                        className="rounded-xl bg-red-50 border border-red-100 px-4 py-2.5 text-[11px] font-medium text-red-600 flex items-center gap-2"
                                    >
                                        <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shrink-0" />
                                        {error}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </motion.section>

                    <motion.div variants={itemVariants} className="space-y-4 pt-2">
                        <div className="flex items-center justify-center gap-2 py-1 w-full flex-wrap mx-auto px-2 text-slate-500 text-center">
                            <Sparkles size={12} className="text-[#F38F24] shrink-0" />
                            <span className="text-[9px] font-bold tracking-widest uppercase text-slate-400 leading-tight">{modeConfig.highlight}</span>
                        </div>

                        <motion.button
                            variants={itemVariants}
                            whileHover={{ y: -1 }}
                            onClick={() => navigate(isLoginPage ? `${routePrefix}/reg-phone` : `${routePrefix}/login`)}
                            className="w-full text-[12px] font-medium text-slate-500 transition-all pb-4"
                        >
                            {isLoginPage ? (
                                <>Don't have an account? <span className="text-[#F38F24] font-bold hover:text-accent-orange">Join Now</span></>
                            ) : (
                                <>Already a captain? <span className="text-[#F38F24] font-bold hover:text-accent-orange">Sign in</span></>
                            )}
                        </motion.button>
                    </motion.div>
                </motion.div>

                <div className="fixed bottom-0 left-0 right-0 p-4 bg-white/90 backdrop-blur-xl border-t border-slate-100 z-50">
                    <div className="mx-auto max-w-sm">
                        <motion.button
                            whileHover={{ scale: 1.01 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={handleSendOTP}
                            disabled={loading || !agreed || phone.length !== 10}
                            className={`group flex h-12 w-full items-center justify-center gap-2 rounded-[0.85rem] text-[14px] font-bold transition-all relative overflow-hidden ${agreed && phone.length === 10
                                ? 'bg-[#1A1A1A] text-white shadow-[0_4px_14px_rgba(26,26,26,0.15)] active:bg-black'
                                : 'bg-slate-100 text-slate-400'
                                }`}
                        >
                            {loading ? (
                                <div className="h-5 w-5 border-[2.5px] border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                <>
                                    <span className="relative z-10 uppercase tracking-[0.1em]">Send OTP Code</span>
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

export default PhoneRegistration;
