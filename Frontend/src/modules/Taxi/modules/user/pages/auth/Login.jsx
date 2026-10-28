import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import AuthLayout from '../../components/AuthLayout';
import { Phone } from 'lucide-react';
import { getLocalUserToken, userAuthService } from '../../services/authService';
import { useSettings } from '../../../../shared/context/SettingsContext';

const Login = () => {
  const location = useLocation();
  const { settings } = useSettings();
  const [phoneNumber, setPhoneNumber] = useState(() => String(location.state?.phone || '').replace(/\D/g, '').slice(-10));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(() => String(location.state?.error || ''));
  const [errors, setErrors] = useState({});
  const navigate = useNavigate();
  const appName = settings.general?.app_name || 'App';
  const userHomeRoute = useMemo(
    () => (location.pathname.startsWith('/taxi/user') ? '/taxi/user' : '/user'),
    [location.pathname],
  );

  const isValidPhone = phoneNumber.length === 10 && /^\d+$/.test(phoneNumber);

  useEffect(() => {
    const token = getLocalUserToken();
    if (!token) {
      return;
    }

    navigate(userHomeRoute, { replace: true });
  }, [navigate, userHomeRoute]);

  const handleLogin = async (e) => {
    e.preventDefault();

    const nextErrors = {};
    if (!phoneNumber.trim()) {
      nextErrors.phone = 'Mobile number is required';
    } else if (!/^\d{10}$/.test(phoneNumber.trim())) {
      nextErrors.phone = 'Enter valid 10-digit number';
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setErrors({});
    setLoading(true);
    setError('');

    try {
      await userAuthService.startOtp(phoneNumber);
      setLoading(false);
      navigate('/taxi/user/verify-otp', {
        state: {
          phone: phoneNumber,
        },
      });
    } catch (err) {
      setError(err?.message || 'Unable to send OTP. Please try again.');
      setLoading(false);
    }
  };

  return (
    <AuthLayout 
      title="Welcome back" 
      subtitle={`Enter your mobile number to continue with ${appName} Taxi.`}
    >
      <form onSubmit={handleLogin} className="space-y-8">
        <div className="space-y-4">
          <label htmlFor="phone" className="text-xs font-bold text-gray-700 uppercase tracking-wider">
            Mobile Number
          </label>
          <div className="relative group flex flex-col transition-all">
            <div className={`relative flex items-center border rounded-xl bg-[#F8F9FA] transition-all ${errors.phone ? 'border-rose-500 bg-rose-50/20' : 'border-gray-200 focus-within:border-[#F38F24] focus-within:ring-1 focus-within:ring-[#F38F24]'}`}>
              <div className="absolute left-4 flex items-center pointer-events-none text-gray-500">
                 <span className="font-semibold">+91</span>
              </div>
              <input
                type="tel"
                id="phone"
                maxLength={10}
                className="w-full pl-16 pr-12 py-4 bg-transparent rounded-xl text-[#1A1A1A] outline-none transition-all placeholder:text-gray-400 font-semibold text-lg"
                placeholder="00000 00000"
                value={phoneNumber}
                onChange={(e) => {
                  setPhoneNumber(e.target.value.replace(/\D/g, ''));
                  if (errors.phone) setErrors((prev) => ({ ...prev, phone: '' }));
                }}
              />
              <Phone size={20} className={`absolute right-4 ${errors.phone ? 'text-rose-500' : 'text-gray-400 group-focus-within:text-[#F38F24] transition-colors'}`} />
            </div>
            {errors.phone && <p className="ml-1 mt-1.5 text-[11px] font-bold text-rose-600">{errors.phone}</p>}
          </div>
        </div>

        <motion.button 
          whileHover={{ scale: 1.01, y: -2 }}
          whileTap={{ scale: 0.98 }}
          disabled={loading}
          className={`w-full py-4 rounded-xl text-base font-bold transition-all flex items-center justify-center gap-2 ${
            !loading
            ? 'bg-[#1A1A1A] text-white hover:bg-black hover:shadow-lg' 
            : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          }`}
        >
          {loading ? (
            <div className="flex items-center gap-3">
              <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
              <span>Sending...</span>
            </div>
          ) : (
            <span>Continue</span>
          )}
        </motion.button>

        {error && (
          <motion.p 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-xs font-semibold text-red-500 text-center bg-red-50 py-3 rounded-lg border border-red-100"
          >
            {error}
          </motion.p>
        )}

        <div className="relative py-2 mt-4">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200"></div>
          </div>
          <div className="relative flex justify-center text-xs uppercase tracking-wider font-bold">
            <span className="bg-white px-4 text-gray-400">Or continue with</span>
          </div>
        </div>

        <div className="space-y-4">
          <button 
            type="button" 
            className="w-full py-3.5 rounded-xl border border-gray-200 flex items-center justify-center gap-3 hover:bg-gray-50 transition-all text-sm font-semibold text-gray-700 bg-white"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" />
            <span>Google</span>
          </button>
        </div>

        <p className="text-xs text-gray-400 font-medium text-center leading-relaxed mt-8">
           By continuing, you agree to our 
           <Link to="/terms" className="text-[#1A1A1A] hover:text-[#F38F24] transition-colors mx-1 font-semibold">Terms</Link> & 
           <Link to="/privacy" className="text-[#1A1A1A] hover:text-[#F38F24] transition-colors mx-1 font-semibold">Privacy Policy</Link>
        </p>
      </form>
    </AuthLayout>
  );
};

export default Login;
