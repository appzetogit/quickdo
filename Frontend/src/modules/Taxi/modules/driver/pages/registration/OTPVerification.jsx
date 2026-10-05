import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, CheckCircle2, ShieldCheck, ChevronRight, MessageSquare } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
    getStoredDriverRegistrationSession,
    clearDriverRegistrationSession,
    persistDriverAuthSession,
    saveDriverRegistrationSession,
    sendDriverLoginOtp,
    sendDriverOtp,
    verifyDriverLoginOtp,
    verifyDriverOtp,
} from '../../services/registrationService';

const unwrap = (response) => response?.data?.data || response?.data || response;
const normalizeDriverRole = (role) => {
    const normalized = String(role || 'driver').toLowerCase();
    if (normalized === 'owner') return 'owner';
    if (normalized === 'service_center' || normalized === 'service-center' || normalized === 'servicecenter') {
        return 'service_center';
    }
    if (normalized === 'service_center_staff' || normalized === 'service-center-staff' || normalized === 'servicecenterstaff') {
        return 'service_center_staff';
    }
    if (normalized === 'bus_driver' || normalized === 'bus-driver' || normalized === 'busdriver') {
        return 'bus_driver';
    }
    return 'driver';
};

const isDriverApproved = (driver) => {
    if (!driver) {
        return false;
    }

    const approval = String(driver?.approve ?? '').toLowerCase();
    const status = String(driver?.status || '').toLowerCase();

    return (
        driver?.approve === true ||
        driver?.approve === 1 ||
        ['true', '1', 'yes', 'approved'].includes(approval) ||
        ['approved', 'active', 'verified'].includes(status)
    );
};

const getPostLoginRoute = (role, driver, routePrefix) => {
    const normalizedRole = normalizeDriverRole(role);

    if (normalizedRole === 'service_center' || normalizedRole === 'service_center_staff') {
        return '/taxi/driver/service-center';
    }

    if (normalizedRole === 'bus_driver') {
        return '/taxi/driver/bus-home';
    }

    if (normalizedRole === 'owner' || normalizedRole === 'driver') {
        return isDriverApproved(driver)
            ? normalizedRole === 'owner'
                ? '/taxi/owner/home'
                : '/taxi/driver/home'
            : `${routePrefix}/registration-status`;
    }

    return '/taxi/driver/home';
};

const syncPushTokens = () => {
    window.__flushNativeFcmToken?.().catch?.(() => {});
    window.__registerBrowserFcmToken?.({ interactive: true }).catch?.(() => {});
};

const OTPVerification = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [otp, setOtp] = useState(['', '', '', '']);
    const inputs = useRef([]);
    const otpCardRef = useRef(null);
    const [timer, setTimer] = useState(30);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const session = {
        ...getStoredDriverRegistrationSession(),
        ...(location.state || {}),
    };
    const routePrefix = location.pathname.startsWith('/taxi/owner') ? '/taxi/owner' : '/taxi/driver';

    const phone = String(session.phone || '').replace(/\D/g, '').slice(-10);
    const role = session.role || 'driver';
    const registrationId = session.registrationId || '';
    const debugOtp = session.debugOtp || '';
    const isLoginFlow = Boolean(session.loginMode);

    useEffect(() => {
        if (!phone) {
            navigate(isLoginFlow ? `${routePrefix}/login` : `${routePrefix}/reg-phone`, { replace: true });
            return undefined;
        }

        const interval = setInterval(() => {
            setTimer(prev => (prev > 0 ? prev - 1 : 0));
        }, 1000);
        return () => clearInterval(interval);
    }, [isLoginFlow, navigate, phone, routePrefix]);

    useEffect(() => {
        const scrollOtpIntoView = () => {
            otpCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        };

        const focusTimer = window.setTimeout(() => {
            inputs.current[0]?.focus();
            scrollOtpIntoView();
        }, 180);

        const viewport = window.visualViewport;
        viewport?.addEventListener('resize', scrollOtpIntoView);

        return () => {
            window.clearTimeout(focusTimer);
            viewport?.removeEventListener('resize', scrollOtpIntoView);
        };
    }, []);

    const handleChange = (index, value) => {
        if (!/^\d*$/.test(value)) return;
        const newOtp = [...otp];
        newOtp[index] = value.slice(-1);
        setOtp(newOtp);

        if (value && index < 3) {
            inputs.current[index + 1].focus();
        }
    };

    const handleKeyDown = (index, e) => {
        if (e.key === 'Backspace' && !otp[index] && index > 0) {
            inputs.current[index - 1].focus();
        }
    };

    const handleVerify = async () => {
        if (otp.join('').length !== 4) {
            setError('Please enter a valid 4-digit OTP');
            return;
        }

        setLoading(true);
        setError('');

        try {
            if (isLoginFlow) {
                const response = await verifyDriverLoginOtp({
                    phone,
                    otp: otp.join(''),
                    role,
                });
                const payload = unwrap(response);

                const token = payload?.token;
                if (token) {
                    const normalizedRole = normalizeDriverRole(role);
                    persistDriverAuthSession({ token, role: normalizedRole });
                    syncPushTokens();
                }

                clearDriverRegistrationSession();
                const normalizedRole = normalizeDriverRole(role);
                const nextPath = getPostLoginRoute(normalizedRole, payload?.driver, routePrefix);
                navigate(nextPath, { 
                    replace: true, 
                    state: { 
                        role: normalizedRole,
                        token: payload?.token,
                        driver: payload?.driver
                    } 
                });
                return;
            }

            const response = await verifyDriverOtp({
                registrationId,
                phone,
                otp: otp.join(''),
            });
            const payload = unwrap(response);

            const nextState = saveDriverRegistrationSession({
                ...session,
                otpVerified: true,
                otpSession: payload?.session || null,
            });

            navigate(`${routePrefix}/step-personal`, { state: nextState });
        } catch (err) {
            setError(err?.message || 'Invalid OTP. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const handleResend = async () => {
        if (timer > 0) return;
        setLoading(true);
        setError('');
        try {
            if (isLoginFlow) {
                const response = await sendDriverLoginOtp({ phone, role });
                saveDriverRegistrationSession({
                    ...session,
                    phone,
                    role,
                    loginMode: true,
                    debugOtp: response?.data?.session?.debugOtp || response?.session?.debugOtp || '',
                });
            } else {
                const response = await sendDriverOtp({ phone, role });
                const sessionData = response?.data?.session || response?.session || {};
                saveDriverRegistrationSession({
                    ...session,
                    phone,
                    role,
                    registrationId: sessionData.registrationId || '',
                    debugOtp: sessionData.debugOtp || '',
                    loginMode: false,
                });
            }
            setOtp(['', '', '', '']);
            inputs.current[0]?.focus();
            setTimer(30);
            setError('OTP Resent Successfully');
        } catch (err) {
            setError(err?.message || 'Failed to resend OTP');
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
            className="min-h-[100dvh] relative bg-[#FAFAFA] select-none overflow-x-hidden font-sans flex flex-col"
        >
            <main className="relative z-10 mx-auto max-w-sm w-full px-6 pt-12 pb-24 flex flex-col min-h-[100dvh]">
                <motion.header 
                    variants={containerVariants}
                    initial="hidden"
                    animate="visible"
                    className="space-y-8 mb-8"
                >
                    <div className="flex items-center justify-between">
                        <motion.button
                            variants={itemVariants}
                            whileTap={{ scale: 0.9 }}
                            onClick={() =>
                                navigate(isLoginFlow ? `${routePrefix}/login` : `${routePrefix}/reg-phone`, {
                                    state: session,
                                })
                            }
                            className="flex h-11 w-11 items-center justify-center rounded-full bg-white border border-slate-100 text-[#1A1A1A] shadow-sm transition-all hover:bg-slate-50"
                        >
                            <ArrowLeft size={18} strokeWidth={2.5} />
                        </motion.button>
                        
                        <div className="bg-slate-100/80 px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest text-slate-500">
                            Security Check
                        </div>
                    </div>

                    <motion.section 
                        variants={itemVariants}
                        className="space-y-4"
                    >
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#1A1A1A] text-white shadow-sm">
                                <ShieldCheck size={18} strokeWidth={2.5} />
                            </div>
                            <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-400">
                                Dynamic Verification
                            </span>
                        </div>
                        <div>
                            <h1 className="font-sans text-[42px] font-black leading-tight tracking-tight text-[#1A1A1A]">
                                Verify <span className="text-[#F38F24]">Phone</span>
                            </h1>
                            <p className="text-[14px] leading-relaxed text-slate-500 font-medium max-w-[28ch] mt-2">
                                Enter the 4-digit code sent to<br/>
                                <span className="whitespace-nowrap text-[#1A1A1A] font-bold border-b border-slate-300 pb-0.5 mt-1 inline-block">+91 {phone}</span>
                            </p>
                        </div>
                    </motion.section>
                </motion.header>

                <motion.section
                    variants={containerVariants}
                    initial="hidden"
                    animate="visible"
                    ref={otpCardRef}
                    className="bg-white p-8 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.03)] border border-slate-50 relative z-20 space-y-8 mt-4"
                    style={{ scrollMarginTop: '24vh' }}
                >
                    <div className="flex justify-between gap-3">
                        {otp.map((digit, index) => (
                            <input
                                key={index}
                                ref={el => inputs.current[index] = el}
                                type="tel"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                autoComplete="off"
                                name={`driver-otp-${index}`}
                                maxLength={1}
                                value={digit}
                                onChange={e => handleChange(index, e.target.value)}
                                onKeyDown={e => handleKeyDown(index, e)}
                                onFocus={() => otpCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                                className={`h-[4.5rem] w-full rounded-[1.25rem] border-2 text-center text-3xl font-black transition-all outline-none ${
                                    digit 
                                        ? 'border-[#1A1A1A] bg-white text-[#1A1A1A] shadow-sm' 
                                        : 'border-slate-100 bg-slate-50 text-[#1A1A1A] focus:border-[#F38F24] focus:bg-white focus:ring-4 focus:ring-[#F38F24]/10'
                                }`}
                            />
                        ))}
                    </div>

                    <div className="space-y-6">
                        <AnimatePresence>
                            {error && (
                                <motion.div 
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={{ opacity: 0, height: 0 }}
                                    className={`rounded-xl border px-4 py-3 text-[12px] font-medium flex items-center gap-3 ${
                                        error.includes('Successfully') 
                                            ? 'border-emerald-100 bg-emerald-50 text-emerald-600'
                                            : 'border-red-100 bg-red-50 text-red-600'
                                    }`}
                                >
                                    <div className={`w-1.5 h-1.5 rounded-full animate-pulse shrink-0 ${error.includes('Successfully') ? 'bg-emerald-500' : 'bg-red-500'}`} />
                                    {error}
                                </motion.div>
                            )}
                        </AnimatePresence>

                        <div className="flex flex-col items-center gap-2">
                            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                                Didn't receive the code?
                            </p>
                            <button
                                onClick={handleResend}
                                disabled={timer > 0 || loading}
                                className={`flex items-center gap-2 text-[13px] font-bold uppercase tracking-widest transition-all ${
                                    timer > 0 
                                        ? 'text-slate-300' 
                                        : 'text-[#1A1A1A] hover:text-[#F38F24]'
                                }`}
                            >
                                <MessageSquare size={14} strokeWidth={2.5} className={timer > 0 ? 'opacity-40' : 'opacity-100'} />
                                {timer > 0 ? `Wait ${timer}s` : 'Resend Now'}
                            </button>
                        </div>
                    </div>
                </motion.section>

                <div className="fixed bottom-0 left-0 right-0 p-6 bg-white/80 backdrop-blur-xl border-t border-slate-50 z-50">
                    <div className="mx-auto max-w-sm">
                        <motion.button
                            whileHover={{ scale: 1.01 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={handleVerify}
                            disabled={loading || otp.join('').length !== 4}
                            className={`group flex h-14 w-full items-center justify-center gap-3 rounded-full text-[14px] font-black transition-all relative overflow-hidden ${
                                otp.join('').length === 4
                                    ? 'bg-[#1A1A1A] text-white shadow-[0_4px_14px_rgba(26,26,26,0.15)] active:bg-black'
                                    : 'bg-slate-100 text-slate-400'
                            }`}
                        >
                            {loading ? (
                                <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                <>
                                    <span className="relative z-10 uppercase tracking-[0.15em]">Verify & Continue</span>
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

export default OTPVerification;
