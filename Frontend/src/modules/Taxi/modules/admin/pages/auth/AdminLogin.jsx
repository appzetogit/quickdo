import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Mail, Lock, ArrowRight, Loader2, AlertCircle, KeyRound, CheckCircle2, ArrowLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { adminService } from '../../services/adminService';
import { useSettings } from '../../../../shared/context/SettingsContext';
import { setUnifiedAdminSession } from '../../services/adminSession';

const AdminLogin = () => {
  const { settings } = useSettings();
  const [view, setView] = useState('login'); // 'login' | 'forgot-email' | 'verify-otp' | 'reset-password'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const navigate = useNavigate();

  const appLogo = settings.general?.logo || settings.customization?.logo;
  const appName = settings.general?.app_name || 'App';
  const brandAccent = settings.customization?.admin_theme_color || '#F97316';

  const resetMessages = () => {
    setError('');
    setSuccess('');
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    resetMessages();

    try {
      const response = await adminService.login({ email, password });
      setUnifiedAdminSession({
        token: response?.data?.token || '',
        user: response?.data?.admin || {},
        refreshToken: response?.data?.refreshToken || null,
      });
      setTimeout(() => navigate('/taxi/admin/dashboard'), 300);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Unable to complete admin login.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    resetMessages();
    try {
      await adminService.forgotPassword(email);
      setSuccess('OTP has been sent to your email.');
      setView('verify-otp');
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    resetMessages();
    try {
      await adminService.verifyResetOtp({ email, otp });
      setView('reset-password');
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setIsLoading(true);
    resetMessages();
    try {
      await adminService.resetPassword({ email, otp, password: newPassword });
      setSuccess('Password changed successfully. Please login.');
      setView('login');
      setPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const renderLoginForm = () => (
    <form onSubmit={handleLogin} className="space-y-2.5 md:space-y-4">
      <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-left">
        <p className="text-[11px] font-black uppercase tracking-[1.5px] text-emerald-700">Database-backed Access</p>
        <p className="mt-1 text-[12px] sm:text-[13px] font-semibold leading-relaxed text-emerald-900">
          Sign in with your superadmin or subadmin email and password. Admin accounts are loaded from the database.
        </p>
      </div>

      <div className="space-y-3">
        <div className="relative group">
          <div className="absolute left-5 sm:left-6 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-primary transition-all">
            <Mail size={20} strokeWidth={2} />
          </div>
          <input
            type="email"
            placeholder="Official Email Address"
            required
            disabled={isLoading}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            className="w-full pl-14 sm:pl-16 pr-5 sm:pr-6 py-3 md:py-4 bg-gray-50 border-2 border-transparent focus:border-primary/20 focus:bg-white rounded-3xl text-[15px] md:text-[16px] transition-all font-semibold placeholder:text-gray-300 outline-none"
          />
        </div>
        <div className="relative group">
          <div className="absolute left-5 sm:left-6 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-primary transition-all">
            <Lock size={20} strokeWidth={2} />
          </div>
          <input
            type="password"
            placeholder="Security Access Token"
            required
            disabled={isLoading}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="w-full pl-14 sm:pl-16 pr-5 sm:pr-6 py-3 md:py-4 bg-gray-50 border-2 border-transparent focus:border-primary/20 focus:bg-white rounded-3xl text-[15px] md:text-[16px] transition-all font-semibold placeholder:text-gray-300 outline-none"
          />
        </div>
      </div>

      <div className="flex items-center justify-end px-2 mb-1 md:mb-2">
        <button
          type="button"
          onClick={() => { setView('forgot-email'); resetMessages(); }}
          className="text-[12px] sm:text-[13px] font-black text-primary hover:text-primary/80 transition-colors uppercase tracking-wider"
        >
          Forgot Password?
        </button>
      </div>

      <button
        type="submit"
        disabled={isLoading}
        className={`w-full ${isLoading ? 'bg-primary/80' : 'bg-primary'} py-3 md:py-4 rounded-[24px] text-white font-black text-[16px] md:text-[18px] shadow-2xl shadow-primary/30 hover:translate-y-[-2px] hover:shadow-primary/40 active:translate-y-[1px] transition-all flex items-center justify-center gap-3 mt-1 md:mt-3`}
      >
        {isLoading ? (
          <Loader2 className="animate-spin" size={22} />
        ) : (
          <>
            Initialize Login <ArrowRight size={20} />
          </>
        )}
      </button>
    </form>
  );

  const renderForgotEmailForm = () => (
    <form onSubmit={handleForgotPassword} className="space-y-4">
      <div className="text-left mb-2">
        <h3 className="text-lg font-bold text-gray-800">Forgot Password</h3>
        <p className="text-sm text-gray-500">Enter your registered email to receive an OTP.</p>
      </div>
      <div className="relative group">
        <div className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-primary">
          <Mail size={20} />
        </div>
        <input
          type="email"
          placeholder="Enter Registered Email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full pl-14 pr-6 py-4 bg-gray-50 border-2 border-transparent focus:border-primary/20 focus:bg-white rounded-3xl text-[16px] transition-all font-semibold outline-none"
        />
      </div>
      <div className="flex flex-col gap-3">
        <button
          type="submit"
          disabled={isLoading}
          className="w-full bg-primary py-4 rounded-[24px] text-white font-black text-[16px] shadow-xl hover:translate-y-[-2px] transition-all flex items-center justify-center gap-2"
        >
          {isLoading ? <Loader2 className="animate-spin" size={22} /> : <>Send OTP <ArrowRight size={20} /></>}
        </button>
        <button
          type="button"
          onClick={() => setView('login')}
          className="flex items-center justify-center gap-2 text-sm font-bold text-gray-400 hover:text-gray-600 transition-colors"
        >
          <ArrowLeft size={16} /> Back to Login
        </button>
      </div>
    </form>
  );

  const renderVerifyOtpForm = () => (
    <form onSubmit={handleVerifyOtp} className="space-y-4">
      <div className="text-left mb-2">
        <h3 className="text-lg font-bold text-gray-800">Verify OTP</h3>
        <p className="text-sm text-gray-500">We've sent a 6-digit code to {email}</p>
      </div>
      <div className="relative group">
        <div className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-primary">
          <KeyRound size={20} />
        </div>
        <input
          type="text"
          placeholder="Enter OTP"
          required
          maxLength={6}
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
          className={`w-full pl-14 pr-6 py-4 bg-gray-50 border-2 border-transparent focus:border-primary/20 focus:bg-white rounded-3xl text-center text-2xl ${otp ? 'tracking-[10px]' : 'tracking-normal'} transition-all font-bold outline-none`}
        />
      </div>
      <button
        type="submit"
        disabled={isLoading}
        className="w-full bg-primary py-4 rounded-[24px] text-white font-black text-[16px] shadow-xl hover:translate-y-[-2px] transition-all flex items-center justify-center gap-2"
      >
        {isLoading ? <Loader2 className="animate-spin" size={22} /> : <>Verify OTP <ArrowRight size={20} /></>}
      </button>
      <div className="flex justify-between items-center px-2">
        <button type="button" onClick={() => setView('forgot-email')} className="text-xs font-bold text-gray-400 hover:text-primary transition-colors">Change Email</button>
        <button type="button" onClick={handleForgotPassword} className="text-xs font-bold text-primary hover:underline">Resend OTP</button>
      </div>
    </form>
  );

  const renderResetPasswordForm = () => (
    <form onSubmit={handleResetPassword} className="space-y-4">
      <div className="text-left mb-2">
        <h3 className="text-lg font-bold text-gray-800">New Password</h3>
        <p className="text-sm text-gray-500">Set a strong security token for your account.</p>
      </div>
      <div className="space-y-3">
        <div className="relative group">
          <div className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-primary">
            <Lock size={20} />
          </div>
          <input
            type="password"
            placeholder="New Password"
            required
            minLength={5}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full pl-14 pr-6 py-4 bg-gray-50 border-2 border-transparent focus:border-primary/20 focus:bg-white rounded-3xl text-[16px] font-semibold outline-none"
          />
        </div>
        <div className="relative group">
          <div className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-primary">
            <Lock size={20} />
          </div>
          <input
            type="password"
            placeholder="Confirm New Password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full pl-14 pr-6 py-4 bg-gray-50 border-2 border-transparent focus:border-primary/20 focus:bg-white rounded-3xl text-[16px] font-semibold outline-none"
          />
        </div>
      </div>
      <button
        type="submit"
        disabled={isLoading}
        className="w-full bg-primary py-4 rounded-[24px] text-white font-black text-[16px] shadow-xl hover:translate-y-[-2px] transition-all flex items-center justify-center gap-2"
      >
        {isLoading ? <Loader2 className="animate-spin" size={22} /> : <>Reset Password <CheckCircle2 size={20} /></>}
      </button>
    </form>
  );

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex items-center justify-center px-3 py-2 sm:py-3 md:py-4 font-sans overflow-hidden relative">
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full blur-[120px] animate-pulse" style={{ backgroundColor: `${brandAccent}1A` }} />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/10 rounded-full blur-[120px] animate-pulse delay-700" />

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-[390px] md:max-w-[420px] bg-white rounded-[32px] md:rounded-[48px] shadow-[0_40px_100px_rgba(0,0,0,0.08)] border border-gray-100 px-4 py-3 sm:px-5 sm:py-4 md:px-14 md:py-8 relative z-10 overflow-hidden"
      >
        {isLoading && (
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: '100%' }}
            className="absolute top-0 left-0 h-1.5 bg-primary z-20"
          />
        )}

        <div className="flex flex-col items-center mb-3 md:mb-6 text-center">
          {appLogo ? (
            <img
              src={appLogo}
              alt={`${appName} Logo`}
              className="w-36 sm:w-44 md:w-56 h-auto mb-2 md:mb-4 object-contain drop-shadow-2xl cursor-pointer hover:scale-105 transition-transform"
              onClick={() => navigate('/taxi')}
            />
          ) : (
            <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center text-white mb-4 shadow-xl">
              <ShieldCheck size={32} />
            </div>
          )}
          <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 rounded-full border border-gray-100">
            <ShieldCheck size={16} className="text-primary" />
            <span className="text-gray-500 font-bold text-[11px] uppercase tracking-[2px]">{appName} Access Terminal</span>
          </div>
          <p className="mt-3 max-w-xs text-center text-[12px] font-semibold leading-relaxed text-slate-400">
            Dynamic admin login for superadmin and scoped subadmin accounts.
          </p>
        </div>

        <AnimatePresence mode="wait">
          {error && (
            <motion.div
              key="error"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mb-3 p-3 bg-red-50 border border-red-100 rounded-2xl flex items-start gap-3 text-red-600"
            >
              <AlertCircle size={20} className="shrink-0 mt-0.5" />
              <p className="text-[13px] font-bold leading-relaxed">{error}</p>
            </motion.div>
          )}
          {success && (
            <motion.div
              key="success"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mb-3 p-3 bg-emerald-50 border border-emerald-100 rounded-2xl flex items-start gap-3 text-emerald-600"
            >
              <CheckCircle2 size={20} className="shrink-0 mt-0.5" />
              <p className="text-[13px] font-bold leading-relaxed">{success}</p>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            {view === 'login' && renderLoginForm()}
            {view === 'forgot-email' && renderForgotEmailForm()}
            {view === 'verify-otp' && renderVerifyOtpForm()}
            {view === 'reset-password' && renderResetPasswordForm()}
          </motion.div>
        </AnimatePresence>
      </motion.div>
    </div>
  );
};

export default AdminLogin;
