import React, { useMemo, useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import AuthLayout from '../../components/AuthLayout';
import { User, Mail, Camera, Smartphone, ImagePlus, LifeBuoy } from 'lucide-react';
import { clearLocalUserSession, userAuthService } from '../../services/authService';
import { useSettings } from '../../../../shared/context/SettingsContext';

const fieldShellClassName =
  'rounded-xl border border-gray-200 bg-[#F8F9FA] px-4 py-4 transition-all flex items-center gap-3 focus-within:border-[#F38F24] focus-within:ring-1 focus-within:ring-[#F38F24]';

const fieldInputClassName =
  'w-full bg-transparent border-none text-[16px] font-semibold text-[#1A1A1A] placeholder:text-gray-400 focus:outline-none';

const PENDING_SIGNUP_PHONE_KEY = 'pendingUserSignupPhone';
const PENDING_SIGNUP_REFERRAL_CODE_KEY = 'pendingUserSignupReferralCode';
const syncPushTokens = () => {
  window.__flushNativeFcmToken?.().catch?.(() => {});
  window.__registerBrowserFcmToken?.({ interactive: true }).catch?.(() => {});
};

const Signup = () => {
  const location = useLocation();
  const { settings } = useSettings();
  const referralCodeFromQuery = new URLSearchParams(location.search).get('ref') || '';
  const preservedPhone = typeof window !== 'undefined' ? sessionStorage.getItem(PENDING_SIGNUP_PHONE_KEY) || '' : '';
  const preservedReferralCode = typeof window !== 'undefined'
    ? sessionStorage.getItem(PENDING_SIGNUP_REFERRAL_CODE_KEY) || ''
    : '';
  const initialPhone = String(location.state?.phone || preservedPhone || '').replace(/\D/g, '').slice(-10);
  const [formData, setFormData] = useState({
    phone: initialPhone,
    name: '',
    email: '',
    gender: 'prefer-not-to-say',
    profileImage: '',
    referralCode: String(location.state?.referralCode || referralCodeFromQuery || preservedReferralCode || '').trim().toUpperCase(),
  });
  const [loading, setLoading] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [error, setError] = useState('');
  const [errors, setErrors] = useState({});
  const [otpSending, setOtpSending] = useState(false);
  const navigate = useNavigate();
  const appName = settings.general?.app_name || 'App';
  const isValidPhone = /^\d{10}$/.test(formData.phone);
  const hasVerifiedSignupContext = Boolean(location.state?.otpVerified) || Boolean(preservedPhone);
  const [step, setStep] = useState(() => (hasVerifiedSignupContext ? 'profile' : 'phone'));

  useEffect(() => {
    if (step === 'profile' && isValidPhone) {
      sessionStorage.setItem(PENDING_SIGNUP_PHONE_KEY, formData.phone);
    }
  }, [formData.phone, isValidPhone, step]);

  useEffect(() => {
    const normalizedReferralCode = String(formData.referralCode || '').trim().toUpperCase();

    if (normalizedReferralCode) {
      sessionStorage.setItem(PENDING_SIGNUP_REFERRAL_CODE_KEY, normalizedReferralCode);
    } else {
      sessionStorage.removeItem(PENDING_SIGNUP_REFERRAL_CODE_KEY);
    }
  }, [formData.referralCode]);

  useEffect(() => {
    if (location.state?.otpVerified) {
      setStep('profile');
    }
  }, [location.state?.otpVerified]);

  const avatarPreviewUrl = useMemo(() => {
    return formData.profileImage || '';
  }, [formData.profileImage]);

  const readFileAsDataUrl = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Failed to read image'));
      reader.readAsDataURL(file);
    });

  const handlePhotoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setPhotoError('');
    setPhotoUploading(true);

    try {
      const dataUrl = await readFileAsDataUrl(file);
      if (!String(dataUrl || '').startsWith('data:image/')) {
        throw new Error('Please choose an image file');
      }
      const uploadPayload = await userAuthService.uploadProfileImage(dataUrl);
      const secureUrl = uploadPayload?.data?.secureUrl || '';

      if (!secureUrl) {
        throw new Error('Upload failed');
      }

      setFormData((prev) => ({ ...prev, profileImage: secureUrl }));
    } catch (err) {
      setPhotoError(err?.message || 'Photo upload failed');
      setFormData((prev) => ({ ...prev, profileImage: '' }));
    } finally {
      setPhotoUploading(false);
      e.target.value = '';
    }
  };

  const handleStartSignup = async (e) => {
    e.preventDefault();

    const nextErrors = {};
    if (!formData.phone.trim()) {
      nextErrors.phone = 'Mobile number is required';
    } else if (!/^\d{10}$/.test(formData.phone.trim())) {
      nextErrors.phone = 'Enter valid 10-digit number';
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setErrors({});
    setOtpSending(true);
    setError('');

    try {
      clearLocalUserSession();
      await userAuthService.startOtp(formData.phone);

      navigate('/taxi/user/verify-otp', {
        state: {
          phone: formData.phone,
          referralCode: formData.referralCode,
        },
      });
    } catch (err) {
      setError(err?.message || 'Unable to send OTP. Please try again.');
    } finally {
      setOtpSending(false);
    }
  };

  const handleSignup = async (e, overrides = {}) => {
    e.preventDefault();

    const nextErrors = {};
    if (!formData.name.trim()) {
      nextErrors.name = 'Full name is required';
    }
    if (formData.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
      nextErrors.email = 'Enter a valid email address';
    }

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
    setLoading(true);
    setError('');

    try {
      const response = await userAuthService.signup({
        name: formData.name,
        phone: formData.phone,
        email: formData.email,
        gender: formData.gender,
        profileImage: overrides.profileImage ?? formData.profileImage,
        referralCode: formData.referralCode,
      });
      const payload = response?.data || {};

      localStorage.setItem('token', payload.token || '');
      localStorage.setItem('userToken', payload.token || '');
      localStorage.setItem('role', 'user');
      localStorage.setItem('userInfo', JSON.stringify(payload.user || {}));
      syncPushTokens();
      sessionStorage.removeItem(PENDING_SIGNUP_PHONE_KEY);
      sessionStorage.removeItem(PENDING_SIGNUP_REFERRAL_CODE_KEY);
      navigate('/taxi/user', { replace: true });
    } catch (err) {
      const message = err?.message || 'Signup failed. Please try again.';

      if (message === 'OTP session not found' || message === 'Verify OTP before signup' || message === 'OTP session expired') {
        sessionStorage.removeItem(PENDING_SIGNUP_PHONE_KEY);
        setStep('phone');
        setError('Your verification session expired. Please request a fresh OTP to continue.');
        return;
      }

      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleGenderChange = (gender) => {
    setFormData({ ...formData, gender });
  };

  const handleSkipForNow = async () => {
    if (loading || photoUploading) {
      return;
    }

    // Bypass normal validation by forcing default name & email
    const fakeEvent = {
      preventDefault() {},
    };

    setFormData((prev) => ({
      ...prev,
      name: prev.name.trim() || 'Passenger',
      profileImage: '',
    }));

    setPhotoError('');
    await handleSignup(fakeEvent, { profileImage: '' });
  };

  return (
    <AuthLayout
      title={step === 'profile' ? 'Complete your profile' : 'Create your account'}
      subtitle={
        step === 'profile'
          ? `Just a few details to get started with ${appName}`
          : `Start with your mobile number and we will verify it before creating your ${appName} account.`
      }
    >
      {step === 'phone' ? (
        <form onSubmit={handleStartSignup} className="space-y-6">
          <div className="space-y-2" id="field-phone-step">
            <label className="text-xs font-bold text-gray-700 uppercase tracking-wider ml-1">Mobile Number *</label>
            <div className={`${fieldShellClassName} ${errors.phone ? 'border-rose-500 bg-rose-50/20' : ''}`}>
              <Smartphone size={20} className={errors.phone ? 'text-rose-500' : 'text-gray-400 group-focus-within:text-[#F38F24] transition-colors'} />
              <span className="text-[16px] font-bold text-[#1A1A1A] border-r border-gray-200 pr-3">+91</span>
              <input
                type="tel"
                maxLength={10}
                placeholder="00000 00000"
                className={fieldInputClassName}
                value={formData.phone}
                onChange={(e) => {
                  setFormData((prev) => ({ ...prev, phone: e.target.value.replace(/\D/g, '') }));
                  if (errors.phone) setErrors((prev) => ({ ...prev, phone: '' }));
                }}
              />
            </div>
            {errors.phone && <p className="ml-1 text-[11px] font-bold text-rose-600">{errors.phone}</p>}
            <p className="ml-1 text-sm text-gray-500">We'll send a 4-digit OTP to this number.</p>
          </div>

          {error && (
            <p className="text-sm font-bold text-red-500 text-center bg-red-50 py-3 rounded-lg border border-red-100">{error}</p>
          )}

          <motion.button
            whileTap={{ scale: 0.98 }}
            type="submit"
            disabled={otpSending}
            className={`w-full py-4 rounded-xl text-base font-bold transition-all flex items-center justify-center gap-3 ${
              !otpSending
                ? 'bg-[#1A1A1A] text-white hover:bg-black hover:shadow-lg'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            {otpSending ? (
              <div className="flex items-center gap-3">
                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                <span>Sending OTP...</span>
              </div>
            ) : (
              <span>Continue</span>
            )}
          </motion.button>

          <div className="space-y-3 text-center mt-6">
            <p className="text-sm font-medium text-gray-500">
              Already have an account?{' '}
              <Link
                to="/taxi/user/login"
                state={{ phone: formData.phone }}
                className="font-bold text-[#1A1A1A] hover:text-[#F38F24] transition-colors"
              >
                Login
              </Link>
            </p>
            <p className="text-[12px] text-gray-400 font-medium leading-relaxed px-2">
              By continuing, you agree to our
              <Link to="/terms" className="ml-1 text-[#1A1A1A] hover:text-[#F38F24] transition-colors font-semibold">
                Terms
              </Link>
              {' '}and
              <Link to="/privacy" className="ml-1 text-[#1A1A1A] hover:text-[#F38F24] transition-colors font-semibold">
                Privacy Policy
              </Link>
            </p>
          </div>
        </form>
      ) : (
      <form onSubmit={handleSignup} className="space-y-8">
        {/* Avatar Placeholder */}
        <div className="flex flex-col items-center">
            <div className="relative group active:scale-95 transition-all">
                <div className="w-24 h-24 rounded-full bg-[#F8F9FA] border border-gray-200 flex items-center justify-center overflow-hidden shadow-sm">
                    {avatarPreviewUrl ? (
                      <img src={avatarPreviewUrl} alt="Profile" className="w-full h-full object-cover" />
                    ) : (
                      <User size={40} className="text-gray-300" />
                    )}
                </div>
                <div className="absolute bottom-1 right-1 w-8 h-8 bg-[#1A1A1A] rounded-full border-2 border-white flex items-center justify-center text-white shadow-md">
                    <Camera size={14} />
                </div>
            </div>
            <p className="mt-3 text-[10px] font-bold uppercase tracking-widest text-gray-500">Profile Photo (Optional)</p>
            <p className="mt-2 text-xs font-medium text-gray-500">You can add one now or skip it and update later.</p>
            <div className="mt-4 grid w-full max-w-[280px] grid-cols-2 gap-3">
              <label className={`relative flex h-12 items-center justify-center gap-2 rounded-xl border text-xs font-bold transition-all ${
                photoUploading
                  ? 'cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400'
                  : 'cursor-pointer border-gray-200 bg-white text-gray-700 hover:bg-gray-50 active:scale-[0.99]'
              }`}>
                <ImagePlus size={16} />
                Gallery
                <input
                  type="file"
                  accept="image/*"
                  disabled={photoUploading}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  aria-label="Upload profile photo from gallery"
                  onChange={handlePhotoChange}
                />
              </label>
              <label className={`relative flex h-12 items-center justify-center gap-2 rounded-xl border text-xs font-bold transition-all ${
                photoUploading
                  ? 'cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400'
                  : 'cursor-pointer border-[#1A1A1A] bg-[#1A1A1A] text-white hover:bg-black active:scale-[0.99]'
              }`}>
                <Camera size={16} />
                Camera
                <input
                  type="file"
                  accept="image/*"
                  capture="user"
                  disabled={photoUploading}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  aria-label="Capture profile photo"
                  onChange={handlePhotoChange}
                />
              </label>
            </div>
            {photoUploading && <p className="text-[11px] font-bold text-gray-500 mt-2">Uploading...</p>}
            {photoError && <p className="text-[11px] font-bold text-red-500 mt-2 bg-red-50 px-3 py-1 rounded-full">{photoError}</p>}
        </div>

        <div className="space-y-5">
          <div className="space-y-2">
            <label className="ml-1 text-xs font-bold uppercase tracking-wider text-gray-700">Mobile Number *</label>
            <div className={fieldShellClassName}>
              <Smartphone size={20} className="text-gray-400" />
              <span className="text-[16px] font-bold text-gray-500 border-r border-gray-200 pr-3">+91</span>
              <input
                type="tel"
                maxLength={10}
                placeholder="Enter 10-digit number"
                className={`${fieldInputClassName} text-gray-500`}
                value={formData.phone}
                readOnly
                aria-readonly="true"
                required
              />
            </div>
            <p className="ml-1 text-xs font-medium text-gray-400">Verified number. You can't edit it here.</p>
          </div>

          <div className="space-y-2" id="field-name">
            <label className="ml-1 text-xs font-bold uppercase tracking-wider text-gray-700">Full Name *</label>
            <div className={`${fieldShellClassName} ${errors.name ? 'border-rose-500 bg-rose-50/20' : ''}`}>
              <User size={20} className={errors.name ? 'text-rose-500' : 'text-gray-400 group-focus-within:text-[#F38F24] transition-colors'} />
              <input 
                type="text" 
                placeholder="Enter your name"
                className={fieldInputClassName}
                value={formData.name}
                onChange={(e) => {
                  setFormData({ ...formData, name: e.target.value });
                  if (errors.name) setErrors((prev) => ({ ...prev, name: '' }));
                }}
                required
              />
            </div>
            {errors.name && <p className="ml-1 text-[11px] font-bold text-rose-600">{errors.name}</p>}
          </div>

          <div className="space-y-2" id="field-email">
            <label className="ml-1 text-xs font-bold uppercase tracking-wider text-gray-700">Email Address (Optional)</label>
            <div className={`${fieldShellClassName} ${errors.email ? 'border-rose-500 bg-rose-50/20' : ''}`}>
              <Mail size={20} className={errors.email ? 'text-rose-500' : 'text-gray-400 group-focus-within:text-[#F38F24] transition-colors'} />
              <input 
                type="email" 
                placeholder="Enter email address"
                className={fieldInputClassName}
                value={formData.email}
                onChange={(e) => {
                  setFormData({ ...formData, email: e.target.value });
                  if (errors.email) setErrors((prev) => ({ ...prev, email: '' }));
                }}
              />
            </div>
            {errors.email && <p className="ml-1 text-[11px] font-bold text-rose-600">{errors.email}</p>}
          </div>

          <div className="space-y-2">
            <label className="ml-1 text-xs font-bold uppercase tracking-wider text-gray-700">Referral Code (Optional)</label>
            <div className={fieldShellClassName}>
              <User size={20} className="text-gray-400 group-focus-within:text-[#F38F24] transition-colors" />
              <input
                type="text"
                placeholder="Enter referral code"
                className={fieldInputClassName}
                value={formData.referralCode}
                onChange={(e) => setFormData((current) => ({
                  ...current,
                  referralCode: e.target.value.trim().toUpperCase(),
                }))}
              />
            </div>
            <p className="ml-1 text-xs font-medium text-gray-400">If someone shared a referral link, the code should already be filled in.</p>
          </div>

          <div className="space-y-3">
             <label className="ml-1 text-xs font-bold uppercase tracking-wider text-gray-700">Gender</label>
             <div className="flex flex-wrap gap-2 md:gap-3">
                {['Male', 'Female', 'Other'].map((g) => (
                    <button
                        key={g}
                        type="button"
                        onClick={() => handleGenderChange(g.toLowerCase())}
                        className={`flex-1 min-w-[80px] py-3.5 rounded-xl text-[13px] font-bold border transition-all ${
                            formData.gender === g.toLowerCase() 
                            ? 'border-[#1A1A1A] bg-[#1A1A1A] text-white shadow-md' 
                            : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                        }`}
                    >
                        {g}
                    </button>
                ))}
             </div>
          </div>

          {error && (
            <p className="text-sm font-bold text-red-500 text-center bg-red-50 py-3 rounded-lg border border-red-100">{error}</p>
          )}
        </div>

        <div className="space-y-3 pt-4">
          <motion.button 
            whileTap={{ scale: 0.98 }}
            type="submit"
            disabled={loading || photoUploading}
            className={`w-full py-4 rounded-xl text-base font-bold transition-all flex items-center justify-center gap-2 ${
              !loading && !photoUploading
              ? 'bg-[#1A1A1A] text-white hover:bg-black hover:shadow-lg' 
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            {loading ? (
              <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
            ) : (
              <span>Create Account</span>
            )}
          </motion.button>

          <button
            type="button"
            onClick={handleSkipForNow}
            className="w-full rounded-xl border border-gray-200 bg-white py-3.5 text-sm font-bold text-gray-600 transition-colors hover:border-[#1A1A1A] hover:text-[#1A1A1A]"
          >
            Skip For Now
          </button>

          <button
            type="button"
            onClick={() => navigate('/taxi/user/support')}
            className="w-full rounded-xl border border-gray-200 bg-[#F8F9FA] py-3.5 text-sm font-bold text-gray-700 transition-colors hover:border-gray-300 hover:text-[#1A1A1A] flex items-center justify-center gap-2"
          >
            <LifeBuoy size={16} />
            Need Help?
          </button>
        </div>

        <div className="space-y-3 text-center mt-6">
          <p className="text-sm font-medium text-gray-500">
            Already have an account?{' '}
            <Link
              to="/taxi/user/login"
              state={{ phone: formData.phone }}
              className="font-bold text-[#1A1A1A] hover:text-[#F38F24] transition-colors"
            >
              Login
            </Link>
          </p>
          <p className="text-[12px] text-gray-400 font-medium leading-relaxed px-2">
            By creating an account, you agree to our
            <Link to="/terms" className="ml-1 text-[#1A1A1A] hover:text-[#F38F24] transition-colors font-semibold">
              Terms
            </Link>
            {' '}and
            <Link to="/privacy" className="ml-1 text-[#1A1A1A] hover:text-[#F38F24] transition-colors font-semibold">
              Privacy Policy
            </Link>
          </p>
        </div>
      </form>
      )}
    </AuthLayout>
  );
};

export default Signup;
