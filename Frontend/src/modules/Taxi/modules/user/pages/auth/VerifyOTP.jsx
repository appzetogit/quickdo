import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import AuthLayout from '../../components/AuthLayout';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import { userAuthService } from '../../services/authService';

const unwrap = (response) => response?.data?.data || response?.data || response;
const PENDING_SIGNUP_PHONE_KEY = 'pendingUserSignupPhone';
const PENDING_OTP_PHONE_KEY = 'pendingUserOtpPhone';
const PENDING_SIGNUP_REFERRAL_CODE_KEY = 'pendingUserSignupReferralCode';
const RESEND_OTP_COOLDOWN_SECONDS = 60;
const syncPushTokens = () => {
  window.__flushNativeFcmToken?.().catch?.(() => {});
  window.__registerBrowserFcmToken?.({ interactive: true }).catch?.(() => {});
};
const getCachedLoginPushToken = () => {
  try {
    const native = JSON.parse(localStorage.getItem('lastNativeFcmRegistration') || 'null');
    if (native?.token) {
      return { token: String(native.token), platform: String(native.platform || 'mobile') };
    }
  } catch {}

  try {
    const browser = JSON.parse(localStorage.getItem('lastBrowserFcmRegistration') || 'null');
    if (browser?.token) {
      return { token: String(browser.token), platform: 'web' };
    }
  } catch {}

  return { token: null, platform: null };
};
const maskPhone = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '').slice(-10);
  if (digits.length !== 10) {
    return '';
  }

  return `${digits.slice(0, 2)}XXXXXX${digits.slice(-2)}`;
};

const VerifyOTP = () => {
  const location = useLocation();
  const phone = String(
    location.state?.phone ||
    sessionStorage.getItem(PENDING_OTP_PHONE_KEY) ||
    sessionStorage.getItem(PENDING_SIGNUP_PHONE_KEY) ||
    '',
  ).replace(/\D/g, '').slice(-10);
  const referralCode = String(
    location.state?.referralCode ||
    sessionStorage.getItem(PENDING_SIGNUP_REFERRAL_CODE_KEY) ||
    '',
  ).trim().toUpperCase();
  const [otp, setOtp] = useState(['', '', '', '']);
  const [timer, setTimer] = useState(RESEND_OTP_COOLDOWN_SECONDS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [success, setSuccess] = useState(false);
  const [appName, setAppName] = useState('App');
  const inputs = useRef([]);

  const navigate = useNavigate();
  const maskedPhone = maskPhone(phone);

  useEffect(() => {
    const title = document.title;
    if (title && title !== 'App') {
      setAppName(title);
    }
  }, []);

  useEffect(() => {
    if (!phone) {
      navigate('/taxi/user/signup', { replace: true });
      return;
    }

    sessionStorage.setItem(PENDING_OTP_PHONE_KEY, phone);
    sessionStorage.setItem(PENDING_SIGNUP_PHONE_KEY, phone);
    if (referralCode) {
      sessionStorage.setItem(PENDING_SIGNUP_REFERRAL_CODE_KEY, referralCode);
    }
  }, [navigate, phone, referralCode]);

  useEffect(() => {
    let interval = null;
    if (timer > 0) {
      interval = setInterval(() => setTimer((prev) => prev - 1), 1000);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [timer]);

  const handleChange = (index, value) => {
    if (isNaN(value)) return;
    const newOtp = [...otp];
    newOtp[index] = value.substring(value.length - 1);
    setOtp(newOtp);

    if (value && index < 3) {
      inputs.current[index + 1]?.focus();
    }

    setError(false);
    setErrorMessage('');
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      inputs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const data = e.clipboardData.getData('text').slice(0, 4);
    if (!/^\d+$/.test(data)) return;

    const newOtp = [...otp];
    data.split('').forEach((char, i) => {
      newOtp[i] = char;
      if (inputs.current[i]) inputs.current[i].value = char;
    });
    setOtp(newOtp);
    if (data.length === 4) inputs.current[3]?.focus();
  };

  const handleVerify = async () => {
    const fullOtp = otp.join('');
    if (fullOtp.length < 4) return;

    setLoading(true);
    setError(false);
    setErrorMessage('');

    try {
      const { token: pushToken, platform } = getCachedLoginPushToken();
      const response = await userAuthService.verifyOtp(phone, fullOtp, pushToken, platform);
      const payload = unwrap(response);

      setSuccess(true);

      if (payload.exists) {
        localStorage.setItem('token', payload.token || '');
        localStorage.setItem('userToken', payload.token || '');
        localStorage.setItem('role', 'user');
        localStorage.setItem('userInfo', JSON.stringify(payload.user || {}));
        syncPushTokens();
        sessionStorage.removeItem(PENDING_OTP_PHONE_KEY);
        sessionStorage.removeItem(PENDING_SIGNUP_PHONE_KEY);
        sessionStorage.removeItem(PENDING_SIGNUP_REFERRAL_CODE_KEY);
        setTimeout(() => navigate('/taxi/user', { replace: true }), 1200);
        return;
      }

      sessionStorage.setItem(PENDING_OTP_PHONE_KEY, String(phone || ''));
      sessionStorage.setItem(PENDING_SIGNUP_PHONE_KEY, String(phone || ''));
      if (referralCode) {
        sessionStorage.setItem(PENDING_SIGNUP_REFERRAL_CODE_KEY, referralCode);
      }
      setTimeout(() => navigate('/taxi/user/signup', { state: { phone, otpVerified: true, referralCode } }), 1200);
    } catch (err) {
      setError(true);
      setErrorMessage(err?.message || 'The OTP you entered is incorrect. Please try again.');
      setOtp(['', '', '', '']);
      inputs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (timer > 0 || loading) return;

    setLoading(true);
    setError(false);
    setErrorMessage('');

    try {
      await userAuthService.startOtp(phone);
      setOtp(['', '', '', '']);
      setTimer(RESEND_OTP_COOLDOWN_SECONDS);
      inputs.current[0]?.focus();
    } catch (err) {
      setError(true);
      setErrorMessage(err?.message || 'Unable to resend OTP. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const isFilled = otp.every((digit) => digit !== '');

  return (
    <AuthLayout
      title=""
      subtitle=""
    >
      <div className="mb-8">
        <div className="flex flex-col gap-6">
          <button
            onClick={() => navigate(-1)}
            className="w-10 h-10 flex items-center justify-center rounded-xl bg-[#F8F9FA] border border-gray-200 hover:bg-gray-100 transition-colors"
          >
            <ArrowLeft size={20} className="text-[#1A1A1A]" />
          </button>
          
          <div className="text-left">
            <h1 className="text-3xl font-black text-[#1A1A1A] tracking-tight mb-2">
              Security Code
            </h1>
            <p className="text-gray-500 text-sm">
              Enter the 4-digit code sent to <span className="text-[#1A1A1A] font-bold">+91 {maskedPhone || phone}</span>
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-8">
        <div className="flex justify-between gap-3">
          {otp.map((digit, index) => (
            <motion.input
              key={index}
              ref={(el) => {
                inputs.current[index] = el;
              }}
              type="tel"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete={index === 0 ? 'one-time-code' : 'off'}
              maxLength={1}
              value={digit}
              onChange={(e) => handleChange(index, e.target.value)}
              onKeyDown={(e) => handleKeyDown(index, e)}
              onPaste={handlePaste}
              animate={error ? { x: [0, -10, 10, -10, 10, 0] } : {}}
              transition={{ duration: 0.4 }}
              className={`w-full aspect-square text-center text-2xl font-bold bg-[#F8F9FA] rounded-xl outline-none transition-all text-[#1A1A1A] border 
                ${error ? 'border-red-500 text-red-500 ring-1 ring-red-500' : 'border-gray-200 focus:border-[#F38F24] focus:ring-1 focus:ring-[#F38F24]'}
              `}
              placeholder="-"
            />
          ))}
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">Didn't receive it?</span>
          {timer > 0 ? (
            <span className="text-sm font-medium text-gray-400">
              Resend in {timer}s
            </span>
          ) : (
            <button
              onClick={handleResend}
              className="text-sm font-semibold text-[#F38F24] hover:text-[#d97716] transition-colors"
            >
              Resend Code
            </button>
          )}
        </div>

        <AnimatePresence>
          {error && (
            <motion.p
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="text-red-500 text-left font-semibold text-xs bg-red-50 py-3 px-4 rounded-lg border border-red-100"
            >
              {errorMessage || 'The OTP you entered is incorrect. Please try again.'}
            </motion.p>
          )}
        </AnimatePresence>

        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={handleVerify}
          disabled={!isFilled || loading || success}
          className={`w-full py-4 rounded-xl text-base font-bold transition-all flex items-center justify-center gap-2 ${
            isFilled && !loading && !success
              ? 'bg-[#1A1A1A] text-white hover:bg-black hover:shadow-lg'
              : success
                ? 'bg-[#89C741] text-white shadow-lg'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          }`}
        >
          {loading ? (
            <div className="flex items-center gap-3">
              <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
              <span>Verifying...</span>
            </div>
          ) : success ? (
            <div className="flex items-center gap-2">
              <CheckCircle2 size={20} />
              <span>Verified</span>
            </div>
          ) : (
            <span>Verify & Proceed</span>
          )}
        </motion.button>
      </div>
    </AuthLayout>
  );
};

export default VerifyOTP;
