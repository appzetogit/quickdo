import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
    User, 
    Car, 
    FileText, 
    Bell, 
    History, 
    CreditCard, 
    UserPlus, 
    ShieldCheck, 
    HelpCircle, 
    LogOut, 
    ArrowRight, 
    Star, 
    Route, 
    ChevronRight,
    CheckCircle2,
    Wallet,
    Info,
    Gift,
    Shield,
    Languages,
    BadgePercent,
    Check
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import DriverBottomNav from '../../shared/components/DriverBottomNav';
import { clearDriverAuthState, getCurrentDriver, updateDriverProfile } from '../services/registrationService';

const unwrapDriver = (response) => response?.data?.data || response?.data || response || null;
const ROUTE_BOOKING_STORAGE_KEY = 'driver_route_booking_preferences';

const readRouteBookingPreferences = () => {
    try {
        const raw = localStorage.getItem(ROUTE_BOOKING_STORAGE_KEY);
        return raw ? JSON.parse(raw) : { enabled: false, coordinates: null, label: '' };
    } catch {
        return { enabled: false, coordinates: null, label: '' };
    }
};

const writeRouteBookingPreferences = (nextValue) => {
    localStorage.setItem(ROUTE_BOOKING_STORAGE_KEY, JSON.stringify(nextValue));
    return nextValue;
};

const formatRouteBookingLabel = (coordinates) => {
    if (!Array.isArray(coordinates) || coordinates.length !== 2) {
        return 'Receive requests from your selected area';
    }

    const [lng, lat] = coordinates;
    if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
        return 'Receive requests from your selected area';
    }

    return `Selected area ${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}`;
};

const normalizeRouteBookingPreferences = (routeBooking = null) => {
    const coordinates = Array.isArray(routeBooking?.coordinates) && routeBooking.coordinates.length === 2
        ? routeBooking.coordinates
        : null;

    return {
        enabled: Boolean(routeBooking?.enabled && coordinates),
        coordinates,
        label: String(routeBooking?.label || (coordinates ? formatRouteBookingLabel(coordinates) : '')).trim(),
        updatedAt: routeBooking?.updatedAt || null,
    };
};

const DriverProfile = () => {
    const navigate = useNavigate();
    const [routeBookingPreferences, setRouteBookingPreferences] = useState(() => readRouteBookingPreferences());
    const [isLogoutOpen, setIsLogoutOpen] = useState(false);
    const [driver, setDriver] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [routeBookingBusy, setRouteBookingBusy] = useState(false);
    const role = localStorage.getItem('role') || 'driver';
    const isOwner = role === 'owner';
    const routePrefix = isOwner ? '/taxi/owner' : '/taxi/driver';

    useEffect(() => {
        let active = true;

        const loadDriver = async () => {
            setIsLoading(true);
            setError('');

            try {
                const response = await getCurrentDriver();
                if (!active) return;
                const nextDriver = unwrapDriver(response);
                setDriver(nextDriver);
                const nextRouteBooking = normalizeRouteBookingPreferences(nextDriver?.routeBooking);
                setRouteBookingPreferences(writeRouteBookingPreferences(nextRouteBooking));
            } catch (err) {
                if (!active) return;
                setError(err?.message || 'Unable to load driver profile');
            } finally {
                if (active) {
                    setIsLoading(false);
                }
            }
        };

        loadDriver();

        return () => {
            active = false;
        };
    }, []);

    const handleLogout = () => {
        clearDriverAuthState();
        setIsLogoutOpen(false);
        navigate(`${routePrefix}/login`, { replace: true });
    };

    // Dynamic Section Data with Project-mapped Paths
    const driverName = useMemo(() => {
        if (!driver?.name) return 'Driver';
        return String(driver.name);
    }, [driver?.name]);

    const driverPhone = useMemo(() => driver?.phone || 'N/A', [driver?.phone]);
    const driverEmail = useMemo(() => driver?.email || 'N/A', [driver?.email]);
    const driverVehicle = useMemo(() => {
        const parts = [driver?.registerFor, driver?.vehicleType].filter(Boolean);
        return parts.length > 0 ? parts.join(' - ') : 'N/A';
    }, [driver?.registerFor, driver?.vehicleType]);
    const driverLocation = useMemo(() => driver?.city || 'N/A', [driver?.city]);
    const driverNumber = useMemo(() => driver?.vehicleNumber || 'N/A', [driver?.vehicleNumber]);
    const driverColor = useMemo(() => driver?.vehicleColor || 'N/A', [driver?.vehicleColor]);
    const driverRating = useMemo(() => Number(driver?.rating || 0), [driver?.rating]);
    const routeBookingSubtitle = useMemo(() => {
        if (!routeBookingPreferences.enabled) {
            return 'Receive requests from your live location';
        }

        return routeBookingPreferences.label || formatRouteBookingLabel(routeBookingPreferences.coordinates);
    }, [routeBookingPreferences.coordinates, routeBookingPreferences.enabled, routeBookingPreferences.label]);

    const hasProfileImage = Boolean(driver?.profileImage);

    const handleRouteBookingToggle = async () => {
        if (routeBookingBusy) {
            return;
        }

        if (routeBookingPreferences.enabled) {
            setRouteBookingBusy(true);
            setError('');
            try {
                const response = await updateDriverProfile({
                    routeBooking: {
                        enabled: false,
                    },
                });
                const nextRouteBooking = normalizeRouteBookingPreferences(
                    unwrapDriver(response)?.routeBooking || { enabled: false },
                );
                setRouteBookingPreferences(writeRouteBookingPreferences(nextRouteBooking));
            } catch (err) {
                setError(err?.response?.data?.message || err?.message || 'Could not update route booking.');
            } finally {
                setRouteBookingBusy(false);
            }
            return;
        }

        if (!navigator.geolocation) {
            setError('Location is not available on this device.');
            return;
        }

        setRouteBookingBusy(true);
        setError('');

        navigator.geolocation.getCurrentPosition(
            async (position) => {
                const nextCoordinates = [position.coords.longitude, position.coords.latitude];
                const nextLabel = formatRouteBookingLabel(nextCoordinates);

                try {
                    const response = await updateDriverProfile({
                        routeBooking: {
                            enabled: true,
                            coordinates: nextCoordinates,
                            label: nextLabel,
                        },
                    });
                    const nextRouteBooking = normalizeRouteBookingPreferences(
                        unwrapDriver(response)?.routeBooking || {
                            enabled: true,
                            coordinates: nextCoordinates,
                            label: nextLabel,
                        },
                    );
                    setRouteBookingPreferences(writeRouteBookingPreferences(nextRouteBooking));
                } catch (err) {
                    setError(err?.response?.data?.message || err?.message || 'Could not update route booking.');
                } finally {
                    setRouteBookingBusy(false);
                }
            },
            () => {
                setRouteBookingBusy(false);
                setError('Please allow location permission to enable route booking.');
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
        );
    };

    const sections = [
        ...(isOwner ? [{
            title: 'Fleet Management',
            items: [
                { id: 'fleet', label: 'Manage Fleet', icon: <Car size={20} />, path: `${routePrefix}/vehicle-fleet` },
                { id: 'drivers', label: 'Manage Drivers', icon: <UserPlus size={20} />, path: `${routePrefix}/manage-drivers` },
            ]
        }] : []),
                {
                    title: 'Your Account',
                    items: [
                { id: 'personal', label: 'Personal Information', sub: driverPhone, icon: <User size={20} />, path: `${routePrefix}/edit-profile` },
                { id: 'wallet', label: 'Wallet', icon: <Wallet size={20} />, path: `${routePrefix}/wallet` },
                ...(!isOwner ? [
                    { id: 'vehicle', label: 'My Vehicle', icon: <Car size={20} />, path: `${routePrefix}/vehicle-fleet` },
                ] : []),
                { id: 'docs', label: 'Documents', icon: <FileText size={20} />, path: `${routePrefix}/documents` },
                { id: 'history', label: 'Ride History', icon: <History size={20} />, path: `${routePrefix}/history` },
                { id: 'notifications', label: 'Notifications', icon: <Bell size={20} />, path: `${routePrefix}/notifications` },
            ]
        },
        {
            title: 'Benefits',
            items: [
                { id: 'refer', label: 'Refer & Earn', icon: <Gift size={20} />, path: `${routePrefix}/referral` },
                { id: 'incentives', label: 'Incentives', icon: <BadgePercent size={20} />, path: `${routePrefix}/incentives` },
                { id: 'sos', label: 'Emergency SOS', icon: <Shield size={20} />, path: `${routePrefix}/security` },
            ]
        },
        {
            title: 'Preferences',
            items: [
                { id: 'languages', label: 'App Language', icon: <Languages size={20} />, path: `${routePrefix}/lang-select`, state: { allowAuthenticated: true } },
                { id: 'routeBooking', label: 'My Route Booking', sub: routeBookingSubtitle, icon: <Route size={20} />, type: 'toggle' },
            ]
        },
        {
            title: 'Danger Zone',
            items: [
                { id: 'deleteAccount', label: 'Delete Account', icon: <LogOut size={20} />, path: `${routePrefix}/delete-account` },
            ]
        }
    ];

    return (
        <div className="min-h-screen bg-white font-sans select-none overflow-x-hidden pb-32">
            {/* Header - Compact & Aligned */}
            <header className="px-5 pt-4 pb-4 border-b border-slate-50 sticky top-0 bg-white z-[60]">
                <div className="flex items-center justify-between mb-4">
                    <div className="w-8" />
                    <button onClick={() => navigate(`${routePrefix}/help-support`)} className="flex items-center gap-1.5 text-[#88B04B] font-bold text-[13px] tracking-wide">
                        <Info size={18} />
                        Help & Support
                    </button>
                </div>

                <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                        <h2 className="text-[22px] font-bold text-slate-900 leading-tight">
                            {isLoading ? 'Loading...' : driverName}
                        </h2>
                        <div className="flex items-center gap-1.5 text-sky-500">
                            <Star size={14} fill="currentColor" />
                            <span className="text-[14px] font-bold">{driverRating.toFixed(1)} Rating</span>
                        </div>
                    </div>
                    {/* Integrated Profile Image */}
                    <div className="relative">
                        <div className={`w-16 h-16 rounded-2xl flex items-center justify-center shadow-lg relative overflow-hidden group ${
                            hasProfileImage ? 'bg-slate-900' : 'bg-slate-100 border border-slate-200'
                        }`}>
                             {hasProfileImage ? (
                                <img
                                    src={driver?.profileImage}
                                    alt={driverName}
                                    className="w-full h-full object-cover"
                                />
                             ) : (
                                <User size={30} className="text-slate-500" strokeWidth={1.8} />
                             )}
                        </div>
                        {hasProfileImage ? (
                            <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-emerald-500 rounded-lg border-2 border-white flex items-center justify-center shadow-sm">
                                 <Check size={12} className="text-white" strokeWidth={4} />
                            </div>
                        ) : null}
                    </div>
                </div>
                <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 border border-slate-100">
                    {error ? (
                        <p className="text-[11px] font-medium text-rose-500">{error}</p>
                    ) : (
                        <div className="grid grid-cols-2 gap-3 text-left">
                            <div>
                                <p className="text-[10px] font-medium text-slate-400">Phone</p>
                                <p className="text-[12px] font-bold text-slate-900">{driverPhone}</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-medium text-slate-400">Email</p>
                                <p className="text-[12px] font-bold text-slate-900 break-all">{driverEmail}</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-medium text-slate-400">Vehicle Type</p>
                                <p className="text-[12px] font-bold text-slate-900">{driverVehicle}</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-medium text-slate-400">City</p>
                                <p className="text-[12px] font-bold text-slate-900">{driverLocation}</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-medium text-slate-400">Vehicle No.</p>
                                <p className="text-[12px] font-bold text-slate-900">{driverNumber}</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-medium text-slate-400">Color</p>
                                <p className="text-[12px] font-bold text-slate-900">{driverColor}</p>
                            </div>
                        </div>
                    )}
                </div>
            </header>

            {/* List Menu */}
            <main className="space-y-1">
                {sections.map((section, sIdx) => (
                    <div key={sIdx} className="pt-5">
                        <h3 className="px-6 text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-3">{section.title}</h3>
                        <div className="space-y-0">
                            {section.items.map((item) => (
                                <motion.div 
                                    key={item.id}
                                    whileTap={item.type !== 'toggle' ? { backgroundColor: '#F8F9FA' } : {}}
                                    onClick={() => item.path && navigate(item.path, item.state ? { state: item.state } : undefined)}
                                    className="flex items-center justify-between px-6 py-4 group cursor-pointer border-b border-slate-50/50"
                                >
                                    <div className="flex items-center gap-5">
                                        <div className="text-slate-400 group-hover:text-slate-900 transition-colors">
                                            {item.icon}
                                        </div>
                                        <div>
                                            <h4 className="text-[15px] font-medium text-slate-800 tracking-tight">{item.label}</h4>
                                            {item.sub && <p className="text-[11px] text-slate-400 font-medium">{item.sub}</p>}
                                        </div>
                                    </div>
                                    {item.type === 'toggle' ? (
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); handleRouteBookingToggle(); }}
                                            disabled={routeBookingBusy}
                                            className={`w-10 h-5.5 rounded-full relative transition-colors duration-300 ${routeBookingPreferences.enabled ? 'bg-slate-900' : 'bg-slate-200'} ${routeBookingBusy ? 'opacity-70' : ''}`}
                                        >
                                            <motion.div 
                                                animate={{ x: routeBookingPreferences.enabled ? 20 : 2 }}
                                                className="absolute top-1 w-3.5 h-3.5 rounded-full bg-white shadow-sm"
                                            />
                                        </button>
                                    ) : (
                                        <ChevronRight size={16} className="text-slate-200" />
                                    )}
                                </motion.div>
                            ))}
                        </div>
                    </div>
                ))}
            </main>

            {/* Sign Out Section */}
            <div className="px-6 py-10">
                <button 
                    onClick={() => setIsLogoutOpen(true)}
                    className="flex items-center gap-3 text-rose-500 font-bold text-[13px] active:translate-x-1 transition-transform"
                >
                    <LogOut size={16} strokeWidth={2.5} />
                    Logout from Account
                </button>
            </div>

            <DriverBottomNav />

            <AnimatePresence>
                {isLogoutOpen && (
                    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/45 px-5 backdrop-blur-sm">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.96, y: 12 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.96, y: 12 }}
                            className="w-full max-w-xs rounded-[28px] bg-white p-6 shadow-2xl border border-slate-100"
                        >
                            <div className="space-y-2 text-center">
                                <h3 className="text-[18px] font-bold text-slate-900 tracking-tight">Logout</h3>
                                <p className="text-[13px] font-medium text-slate-500">
                                    Are you sure you want to logout?
                                </p>
                            </div>

                            <div className="mt-6 grid grid-cols-2 gap-3">
                                <button
                                    onClick={() => setIsLogoutOpen(false)}
                                    className="h-12 rounded-2xl border border-slate-200 text-slate-700 font-bold text-[13px]"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleLogout}
                                    className="h-12 rounded-2xl bg-rose-500 text-white font-bold text-[13px]"
                                >
                                    Logout
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default DriverProfile;
