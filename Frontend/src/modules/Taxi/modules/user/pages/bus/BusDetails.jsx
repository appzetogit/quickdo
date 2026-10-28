import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, User, Phone, Mail, ChevronRight, Check, Loader2, QrCode } from 'lucide-react';
import userBusService from '../../services/busService';
import { userAuthService } from '../../services/authService';

const getRoutePrefix = (pathname = '') => (pathname.startsWith('/taxi/user') ? '/taxi/user' : '');

const loadRazorpayScript = () =>
  new Promise((resolve) => {
    if (window.Razorpay) {
      resolve(true);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });

const formatTravelDate = (dateStr) => {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  } catch (err) {
    return dateStr;
  }
};

const BusDetails = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const routePrefix = useMemo(() => getRoutePrefix(location.pathname), [location.pathname]);
  const state = location.state || {};
  const { bus, fromCity, toCity, date, selectedSeats, totalFare } = state;
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('Male');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [errors, setErrors] = useState({});
  const [isPaying, setIsPaying] = useState(false);
  const [travellerMode, setTravellerMode] = useState('self');
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileData, setProfileData] = useState(null);
  const [showMockQr, setShowMockQr] = useState(false);
  const [mockQrOrder, setMockQrOrder] = useState(null);

  const unwrapPayload = (response) => response?.data?.data || response?.data || response || {};

  useEffect(() => {
    let active = true;

    const storedProfile = (() => {
      try {
        return JSON.parse(localStorage.getItem('userInfo') || '{}');
      } catch {
        return {};
      }
    })();

    const applyProfile = (profile = {}) => {
      if (!active) {
        return;
      }

      const nextProfile = {
        name: String(profile?.name || '').trim(),
        email: String(profile?.email || '').trim(),
        phone: String(profile?.phone || '').trim(),
      };

      setProfileData(nextProfile);

      if (travellerMode === 'self') {
        setName(nextProfile.name || '');
        setEmail(nextProfile.email || '');
        setPhone(nextProfile.phone || '');
      }
    };

    applyProfile(storedProfile);

    const loadProfile = async () => {
      try {
        const response = await userAuthService.getCurrentUser();
        const user = response?.data?.user || {};
        const normalizedUser = {
          name: user.name || storedProfile?.name || '',
          email: user.email || storedProfile?.email || '',
          phone: user.phone || storedProfile?.phone || '',
        };

        localStorage.setItem('userInfo', JSON.stringify({
          ...storedProfile,
          ...user,
        }));
        applyProfile(normalizedUser);
      } catch {
        applyProfile(storedProfile);
      } finally {
        if (active) {
          setProfileLoading(false);
        }
      }
    };

    loadProfile();

    return () => {
      active = false;
    };
  }, [travellerMode]);

  const applySelfProfile = () => {
    setTravellerMode('self');
    setName(profileData?.name || '');
    setEmail(profileData?.email || '');
    setPhone(profileData?.phone || '');
    setError('');
    setErrors({});
  };

  const switchToSomeoneElse = () => {
    setTravellerMode('other');
    setName('');
    setAge('');
    setGender('Male');
    setPhone('');
    setEmail('');
    setError('');
    setErrors({});
  };

  if (!bus || !selectedSeats?.length) {
    navigate(`${routePrefix}/bus`, { replace: true });
    return null;
  }

  const handleVerifyMockPayment = async () => {
    if (!mockQrOrder) return;
    setError('');
    setIsPaying(true);
    setShowMockQr(false);

    try {
      const verifyResponse = await userBusService.verifyBookingPayment({
        razorpay_order_id: mockQrOrder.orderId,
        razorpay_payment_id: `pay_mock_${Date.now().toString(36)}`,
        razorpay_signature: 'mock_signature_bypass',
      });
      const booking = unwrapPayload(verifyResponse);
      navigate(`${routePrefix}/bus/confirm`, {
        replace: true,
        state: {
          booking,
          fromCity,
          toCity,
        },
      });
    } catch (err) {
      const serverError = err.response?.data?.error || err.response?.data?.message || err.message;
      setError(serverError || 'Mock payment verification failed');
      setIsPaying(false);
    }
  };

  const handleContinue = async () => {
    if (isPaying) return;

    const nextErrors = {};
    if (!name.trim()) nextErrors.name = 'Full name is required';
    if (!age || Number(age) <= 0) nextErrors.age = 'Age is required';
    if (!phone.trim()) nextErrors.phone = 'Mobile number is required';
    else if (!/^\d{10}$/.test(phone.trim())) nextErrors.phone = 'Enter valid 10-digit number';
    if (!email.trim()) nextErrors.email = 'Email address is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) nextErrors.email = 'Enter valid email address';

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      const firstErrorField = Object.keys(nextErrors)[0];
      const element = document.getElementById(`field-${firstErrorField}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }

    setErrors({});
    setError('');
    setIsPaying(true);

    try {
      const passenger = { name, age, gender, phone, email };
      const orderResponse = await userBusService.createBookingOrder({
        busServiceId: bus.busServiceId,
        scheduleId: bus.scheduleId,
        travelDate: date,
        seatIds: selectedSeats.map((seat) => seat.id),
        passenger,
      });
      const order = unwrapPayload(orderResponse);

      if (!order.keyId || !order.orderId) {
        throw new Error('Unable to start bus payment');
      }

      // Check if this is a Mock Order returned by the backend auth-error fallback
      if (order.orderId.startsWith('mock_order_')) {
        setMockQrOrder(order);
        setShowMockQr(true);
        return;
      }

      const scriptLoaded = await loadRazorpayScript();
      if (!scriptLoaded) {
        throw new Error('Razorpay SDK failed to load');
      }

      const rzp = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency || 'INR',
        name: bus.operator || 'Bus Booking',
        description: `${fromCity} to ${toCity}`,
        order_id: order.orderId,
        prefill: {
          name,
          email,
          contact: phone,
        },
        modal: {
          ondismiss: () => {
            setIsPaying(false);
          },
        },
        theme: {
          color: '#C2410C',
        },
        handler: async (response) => {
          try {
            const verifyResponse = await userBusService.verifyBookingPayment(response);
            const booking = unwrapPayload(verifyResponse);
            navigate(`${routePrefix}/bus/confirm`, {
              replace: true,
              state: {
                booking,
                fromCity,
                toCity,
                date,
              },
            });
          } catch (verifyError) {
            const serverError = verifyError.response?.data?.error || verifyError.response?.data?.message || verifyError.message;
            setError(serverError || 'Payment verification failed');
            setIsPaying(false);
          }
        },
      });

      rzp.on('payment.failed', (event) => {
        const message = event?.error?.description || event?.error?.reason || 'Payment failed';
        setError(message);
        setIsPaying(false);
      });

      rzp.open();
    } catch (err) {
      const serverError = err.response?.data?.error || err.response?.data?.message || err.message;
      setError(serverError || 'Unable to continue with payment');
      setIsPaying(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 max-w-lg mx-auto font-sans pb-60">
      <div className="bg-white px-5 pt-10 pb-4 sticky top-0 z-20 border-b border-slate-100 shadow-sm">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="w-9 h-9 rounded-xl border border-slate-200 bg-white flex items-center justify-center shadow-sm active:scale-95 transition-all"
          >
            <ArrowLeft size={18} className="text-slate-900" />
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-slate-900 truncate">Passenger Details</h1>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">
              {selectedSeats.length} Seat(s) • {fromCity} to {toCity}
            </p>
          </div>
        </div>
      </div>

      <div className="px-5 pt-6 space-y-6">
        {/* Unified Booking Card (Ticket + Form attached) */}
        <div className="bg-white rounded-[32px] overflow-hidden border border-slate-100 shadow-[0_8px_30px_rgba(15,23,42,0.03)]">
          
          {/* Top Section: Ticket Card (Spacious, Luxury Dark Blue Gradient) */}
          <div className="relative bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-white p-6 overflow-hidden">
            {/* Subtle Bus Graphic Watermark */}
            <div className="absolute right-0 top-0 opacity-[0.03] transform translate-x-4 -translate-y-2 pointer-events-none">
              <svg className="w-56 h-56 text-white" viewBox="0 0 100 100" fill="currentColor">
                <path d="M10,35 L10,18 C10,15 15,10 25,10 L85,10 C92,10 95,14 95,18 L95,35 C95,38 92,40 88,40 L85,40 C85,37 82,35 79,35 C76,35 73,37 73,40 L37,40 C37,37 34,35 31,35 C28,35 25,37 25,40 L17,40 C13,40 10,38 10,35 Z" />
              </svg>
            </div>

            {/* Operator info and badge */}
            <div className="flex justify-between items-start gap-4 relative z-10">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center rounded-full bg-primary-orange/20 border border-primary-orange/30 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-primary-orange">
                    Premium Coach
                  </span>
                  <span className="text-[10px] font-bold text-slate-400">
                    {bus.type}
                  </span>
                </div>
                <h3 className="text-xl font-black leading-tight text-white tracking-tight mt-1.5">{bus.operator}</h3>
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  {formatTravelDate(date)} • {bus.departure}
                </p>
              </div>

              {/* Seats Info Box */}
              <div className="text-right space-y-1 bg-white/5 border border-white/10 rounded-2xl p-2.5 min-w-[95px] backdrop-blur-sm">
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Seats</p>
                <p className="text-sm font-black text-primary-orange">
                  {selectedSeats.map((seat) => seat.label || seat.id).join(', ')}
                </p>
                <p className="text-[8px] font-bold text-slate-300 uppercase tracking-wider">
                  {selectedSeats.map((seat) => String(seat.variant || 'seater').toUpperCase()).join(', ')}
                </p>
              </div>
            </div>

            {/* Route path graphic */}
            <div className="mt-6 flex justify-between items-center text-xs font-bold text-slate-300 relative z-10">
              <div className="space-y-0.5">
                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Origin</p>
                <p className="text-sm font-black text-slate-100">{fromCity}</p>
              </div>
              <div className="flex items-center gap-2 flex-1 px-4">
                <div className="h-0.5 flex-1 bg-slate-700/60" />
                <div className="w-1.5 h-1.5 rounded-full bg-primary-orange animate-pulse" />
                <div className="h-0.5 flex-1 bg-slate-700/60" />
              </div>
              <div className="space-y-0.5 text-right">
                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Destination</p>
                <p className="text-sm font-black text-slate-100">{toCity}</p>
              </div>
            </div>
          </div>

          {/* Tear Line Separator (Connects ticket to form visually) */}
          <div className="relative bg-white h-4 flex items-center">
            <div className="w-full border-t border-dashed border-slate-200" />
            <div className="absolute -left-3 w-6 h-6 rounded-full bg-slate-50 border border-slate-100 shadow-inner" />
            <div className="absolute -right-3 w-6 h-6 rounded-full bg-slate-50 border border-slate-100 shadow-inner" />
          </div>

          {/* Bottom Section: Primary Passenger Form directly inside the unified container */}
          <div className="p-6 space-y-6 bg-white">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900 tracking-tight">Primary Passenger</h3>
                <p className="mt-1 text-xs font-semibold text-slate-500">Choose who is travelling, then confirm the details below.</p>
              </div>
              {profileLoading ? (
                <div className="flex items-center gap-2 rounded-full bg-slate-50 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
                  <Loader2 size={12} className="animate-spin" /> Loading
                </div>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={applySelfProfile}
                className={`rounded-2xl border px-4 py-3 text-left transition-all ${
                  travellerMode === 'self'
                    ? 'border-slate-900 bg-slate-900 text-white shadow-lg'
                    : 'border-slate-200 bg-slate-50 text-slate-700'
                }`}
              >
                <p className="text-[10px] font-black uppercase tracking-[0.18em]">Self</p>
                <p className={`mt-1 text-sm font-black ${travellerMode === 'self' ? 'text-white' : 'text-slate-900'}`}>
                  Use my profile
                </p>
                <p className={`mt-1 text-[11px] font-semibold ${travellerMode === 'self' ? 'text-white/70' : 'text-slate-500'}`}>
                  Name, phone, and email auto-fill from your account.
                </p>
              </button>
              <button
                type="button"
                onClick={switchToSomeoneElse}
                className={`rounded-2xl border px-4 py-3 text-left transition-all ${
                  travellerMode === 'other'
                    ? 'border-slate-900 bg-slate-900 text-white shadow-lg'
                    : 'border-slate-200 bg-slate-50 text-slate-700'
                }`}
              >
                <p className="text-[10px] font-black uppercase tracking-[0.18em]">Other</p>
                <p className={`mt-1 text-sm font-black ${travellerMode === 'other' ? 'text-white' : 'text-slate-900'}`}>
                  Book for someone else
                </p>
                <p className={`mt-1 text-[11px] font-semibold ${travellerMode === 'other' ? 'text-white/70' : 'text-slate-500'}`}>
                  Enter passenger details manually.
                </p>
              </button>
            </div>

            {travellerMode === 'self' && profileData ? (
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-[12px] font-bold text-emerald-700">
                {profileData.email
                  ? `Using ${profileData.email} for the ticket confirmation.`
                  : 'Profile phone and name are filled. Add an email if you want the e-ticket mailed too.'}
              </div>
            ) : null}

            <div className="space-y-4">
              <div className="space-y-1.5" id="field-name">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Full Name</label>
                <div className={`flex min-w-0 items-center gap-3 bg-slate-50 border rounded-2xl px-4 py-3 transition-all ${errors.name ? 'border-rose-500 bg-rose-50/20' : 'border-slate-100'}`}>
                  <User size={16} className={`shrink-0 ${errors.name ? 'text-rose-500' : 'text-slate-400'}`} />
                  <input
                    type="text"
                    placeholder="Enter full name"
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value);
                      if (errors.name) setErrors((prev) => ({ ...prev, name: '' }));
                    }}
                    className="min-w-0 flex-1 bg-transparent text-sm font-bold text-slate-900 focus:outline-none placeholder:text-slate-300"
                  />
                </div>
                {errors.name && <p className="ml-1 text-[11px] font-bold text-rose-600">{errors.name}</p>}
              </div>

              <div className="flex gap-4">
                <div className="flex-1 space-y-1.5" id="field-age">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Age</label>
                  <input
                    type="number"
                    placeholder="Age"
                    value={age}
                    onChange={(event) => {
                      setAge(event.target.value);
                      if (errors.age) setErrors((prev) => ({ ...prev, age: '' }));
                    }}
                    className={`w-full bg-slate-50 border rounded-2xl px-4 py-3 text-sm font-bold text-slate-900 focus:outline-none placeholder:text-slate-300 transition-all ${errors.age ? 'border-rose-500 bg-rose-50/20' : 'border-slate-100'}`}
                  />
                  {errors.age && <p className="ml-1 text-[11px] font-bold text-rose-600">{errors.age}</p>}
                </div>
                <div className="flex-[2] space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Gender</label>
                  <div className="flex bg-slate-50 border border-slate-100 rounded-2xl p-1">
                    {['Male', 'Female', 'Other'].map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setGender(item)}
                        className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${gender === item ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 space-y-6">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-bold text-slate-900">Contact Info</h3>
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 px-2 py-1 rounded-full">For e-ticket</span>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5" id="field-phone">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Mobile Number</label>
              <div className={`flex min-w-0 items-center gap-3 bg-slate-50 border rounded-2xl px-4 py-3 transition-all ${errors.phone ? 'border-rose-500 bg-rose-50/20' : 'border-slate-100'}`}>
                <Phone size={16} className={`shrink-0 ${errors.phone ? 'text-rose-500' : 'text-slate-400'}`} />
                <input
                  type="tel"
                  placeholder="Mobile number"
                  value={phone}
                  onChange={(event) => {
                    setPhone(event.target.value);
                    if (errors.phone) setErrors((prev) => ({ ...prev, phone: '' }));
                  }}
                  className="min-w-0 flex-1 bg-transparent text-sm font-bold text-slate-900 focus:outline-none placeholder:text-slate-300"
                />
              </div>
              {errors.phone && <p className="ml-1 text-[11px] font-bold text-rose-600">{errors.phone}</p>}
            </div>

            <div className="space-y-1.5" id="field-email">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Email ID</label>
              <div className={`flex min-w-0 items-center gap-3 bg-slate-50 border rounded-2xl px-4 py-3 transition-all ${errors.email ? 'border-rose-500 bg-rose-50/20' : 'border-slate-100'}`}>
                <Mail size={16} className={`shrink-0 ${errors.email ? 'text-rose-500' : 'text-slate-400'}`} />
                <input
                  type="email"
                  placeholder="Email address"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    if (errors.email) setErrors((prev) => ({ ...prev, email: '' }));
                  }}
                  className="min-w-0 flex-1 bg-transparent text-sm font-bold text-slate-900 focus:outline-none placeholder:text-slate-300"
                />
              </div>
              {errors.email && <p className="ml-1 text-[11px] font-bold text-rose-600">{errors.email}</p>}
            </div>
          </div>

          {error && (
            <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-600">
              {error}
            </div>
          )}
        </div>
      </div>

      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-lg px-5 pb-8 pt-4 bg-white border-t border-slate-100 z-30">
        <div className="flex items-center justify-between mb-4 px-1">
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Payable Amount</p>
            <p className="text-2xl font-bold text-slate-900">₹{Number(totalFare || 0)}</p>
          </div>
          <div className="flex items-center gap-1.5 bg-emerald-50 px-3 py-1 rounded-full">
            <Check size={12} className="text-emerald-600" strokeWidth={3} />
            <p className="text-[10px] font-bold text-emerald-700">Taxes included</p>
          </div>
        </div>

        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={handleContinue}
          disabled={isPaying}
          className="w-full bg-slate-900 text-white py-4 rounded-2xl text-base font-bold flex items-center justify-center gap-2 shadow-lg disabled:opacity-70 transition-all"
        >
          {isPaying ? <Loader2 size={20} className="animate-spin" /> : 'Pay Now'}
          {!isPaying && <ChevronRight size={18} />}
        </motion.button>
      </div>

      {/* Mock UPI QR Code Modal */}
      {showMockQr && mockQrOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-sm rounded-[32px] bg-white p-6 shadow-2xl border border-slate-100 space-y-6 text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-orange-50 flex items-center justify-center text-orange-600">
              <QrCode size={24} />
            </div>
            
            <div className="space-y-1">
              <h3 className="text-xl font-extrabold text-slate-900 tracking-tight">Scan & Pay (Test Mode)</h3>
              <p className="text-xs font-semibold text-slate-500">Scan this UPI QR code to complete booking</p>
            </div>

            {/* UPI QR Code Image */}
            <div className="mx-auto w-48 h-48 bg-slate-50 border border-slate-100 rounded-2xl flex items-center justify-center overflow-hidden p-2">
              <img 
                src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(`upi://pay?pa=test@upi&pn=QuickDrop&am=${mockQrOrder.amount / 100}&tn=BusBooking_${mockQrOrder.orderId}`)}`}
                alt="UPI Payment QR Code" 
                className="w-full h-full object-contain"
              />
            </div>

            {/* Amount details */}
            <div className="bg-slate-50 rounded-2xl p-4 space-y-1">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Payable Amount</p>
              <p className="text-2xl font-black text-slate-900">₹{mockQrOrder.amount / 100}</p>
            </div>

            <p className="text-[11px] font-semibold text-slate-500 leading-relaxed px-2">
              This is a development fallback payment mode. Click below to simulate success.
            </p>

            <div className="space-y-2 pt-2">
              <a
                href={`upi://pay?pa=test@upi&pn=QuickDrop&am=${mockQrOrder.amount / 100}&tn=BusBooking_${mockQrOrder.orderId}`}
                className="w-full py-3.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-sm font-bold shadow-md transition-all flex items-center justify-center gap-2"
              >
                Pay via UPI App Directly
              </a>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText('test@upi');
                  alert('UPI ID copied to clipboard: test@upi');
                }}
                className="w-full py-3.5 rounded-xl border border-slate-350 bg-white text-slate-800 text-sm font-bold shadow-sm hover:bg-slate-50 transition-all flex items-center justify-center gap-2"
              >
                Copy UPI ID (test@upi)
              </button>
              <button
                type="button"
                onClick={handleVerifyMockPayment}
                className="w-full py-3.5 rounded-xl bg-slate-900 hover:bg-black text-white text-sm font-bold shadow-md transition-all animate-pulse"
              >
                Confirm Payment Success
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowMockQr(false);
                  setIsPaying(false);
                }}
                className="w-full py-3.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-bold transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BusDetails;
