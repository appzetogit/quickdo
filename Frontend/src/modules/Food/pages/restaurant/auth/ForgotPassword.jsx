import { useState, useRef, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { Mail, ArrowLeft, Lock, Eye, EyeOff, AlertCircle } from "lucide-react"
import { Button } from "@food/components/ui/button"
import { restaurantAPI } from "@food/api"
import { useCompanyName } from "@food/hooks/useCompanyName"
import { motion, AnimatePresence } from "framer-motion"
import { getRestaurantLogo, loadBusinessSettings, getCachedSettings } from "@food/utils/businessSettings"
import { useSettings } from "../../../../Taxi/shared/context/SettingsContext"

export default function RestaurantForgotPassword() {
  const navigate = useNavigate()
  const companyName = useCompanyName()
  const { activeLogo, settings: appSettings } = useSettings() || {}
  const [businessLogo, setBusinessLogo] = useState(() => {
    try {
      return getRestaurantLogo() || getCachedSettings()?.logo?.url || null;
    } catch (e) {
      return null;
    }
  })

  useEffect(() => {
    loadBusinessSettings().then((s) => {
      const logo = getRestaurantLogo() || s?.restaurantLogo?.url || s?.logo?.url;
      if (logo) setBusinessLogo(logo);
    }).catch(() => {});
  }, []);

  const resolvedLogo = activeLogo ||
    appSettings?.customization?.logos?.food_restaurant ||
    appSettings?.customization?.logos?.food ||
    appSettings?.customization?.logos?.landing ||
    appSettings?.customization?.logos?.admin ||
    appSettings?.general?.logo ||
    businessLogo;
  const [step, setStep] = useState(1) // 1: email, 2: OTP, 3: new password
  const [email, setEmail] = useState("")
  const [otp, setOtp] = useState(["", "", "", "", "", ""])
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [resendTimer, setResendTimer] = useState(0)
  const inputRefs = useRef(Array(6).fill(null).map(() => null))

  const handleEmailSubmit = async (e) => {
    e.preventDefault()
    setError("")
    
    if (!email.trim()) {
      setError("Email is required")
      return
    }

    setIsLoading(true)
    try {
      await restaurantAPI.sendOTP(null, "reset-password", email)
      setStep(2)
      setResendTimer(60)
      const timer = setInterval(() => {
        setResendTimer((prev) => {
          if (prev <= 1) {
            clearInterval(timer)
            return 0
          }
          return prev - 1
        })
      }, 1000)
    } catch (err) {
      const message =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err?.message ||
        "Failed to send OTP. Please try again."
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }

  const handleOtpChange = (index, value) => {
    if (!/^\d*$/.test(value)) return
    
    const newOtp = [...otp]
    newOtp[index] = value.slice(-1)
    setOtp(newOtp)

    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus()
    }
  }

  const handleOtpKeyDown = (index, e) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
  }

  const handleOtpPaste = (e) => {
    e.preventDefault()
    const pastedData = e.clipboardData.getData("text")
    const digits = pastedData.replace(/\D/g, "").slice(0, 6).split("")
    const newOtp = [...otp]
    digits.forEach((digit, i) => {
      if (i < 6) {
        newOtp[i] = digit
      }
    })
    setOtp(newOtp)
    if (digits.length === 6) {
      inputRefs.current[5]?.focus()
    } else {
      inputRefs.current[digits.length]?.focus()
    }
  }

  const handleOtpSubmit = async (e) => {
    e.preventDefault()
    setError("")
    
    const otpCode = otp.join("")
    if (otpCode.length !== 6) {
      setError("Please enter the complete OTP")
      return
    }

    setIsLoading(true)
    try {
      await restaurantAPI.verifyOTP(null, otpCode, "reset-password", null, email)
      setStep(3)
    } catch (err) {
      const message =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err?.message ||
        "Invalid OTP. Please try again."
      setError(message)
      setOtp(["", "", "", "", "", ""])
      inputRefs.current[0]?.focus()
    } finally {
      setIsLoading(false)
    }
  }

  const handleResendOtp = async () => {
    if (resendTimer > 0) return
    
    setIsLoading(true)
    setError("")
    try {
      await restaurantAPI.sendOTP(null, "reset-password", email)
      setResendTimer(60)
      const timer = setInterval(() => {
        setResendTimer((prev) => {
          if (prev <= 1) {
            clearInterval(timer)
            return 0
          }
          return prev - 1
        })
      }, 1000)
    } catch (err) {
      const message =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err?.message ||
        "Failed to resend OTP. Please try again."
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }

  const handlePasswordSubmit = async (e) => {
    e.preventDefault()
    setError("")
    
    if (!newPassword || !confirmPassword) {
      setError("Please fill in all fields")
      return
    }

    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters long")
      return
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match")
      return
    }

    setIsLoading(true)
    try {
      const response = await restaurantAPI.resetPassword(email, otp.join(""), newPassword)

      const data = response?.data || {}
      if (!data.success) {
        throw new Error(data.message || "Failed to reset password")
      }

      navigate("/restaurant/login", {
        state: { message: "Password reset successfully. Please login with your new password." },
      })
    } catch (err) {
      const message =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err?.message ||
        "Failed to reset password. Please try again."
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }

  const [keyboardInset, setKeyboardInset] = useState(0)

  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return undefined

    const updateKeyboardInset = () => {
      const viewport = window.visualViewport
      const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
      setKeyboardInset(inset > 0 ? inset : 0)
    }

    updateKeyboardInset()
    window.visualViewport.addEventListener("resize", updateKeyboardInset)
    window.visualViewport.addEventListener("scroll", updateKeyboardInset)

    return () => {
      window.visualViewport.removeEventListener("resize", updateKeyboardInset)
      window.visualViewport.removeEventListener("scroll", updateKeyboardInset)
    }
  }, [])

  return (
    <div className="min-h-[100dvh] bg-white dark:bg-[#0A0A0B] flex flex-col font-sans overflow-hidden">
      {/* Top Branding Section - 35% height */}
      <div className="relative h-[35dvh] w-full bg-[#1A1A1A] overflow-hidden flex flex-col items-center justify-center">
        {/* Subtle Decorative Elements */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[#F38F24]/5 rounded-full blur-[80px] translate-x-1/3 -translate-y-1/3"></div>
            <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-white/5 rounded-full blur-[60px] -translate-x-1/3 translate-y-1/3"></div>
        </div>

        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="relative z-10 flex flex-col items-center gap-4"
        >
          <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center shadow-xl border-2 border-white/25 overflow-hidden p-1.5">
            {resolvedLogo ? (
              <img
                src={resolvedLogo}
                alt={`${companyName} logo`}
                className="w-full h-full object-contain"
                onError={(e) => {
                  e.target.style.display = 'none';
                  if (e.target.nextElementSibling) {
                    e.target.nextElementSibling.style.display = 'flex';
                  }
                }}
              />
            ) : null}
            <div
              className="w-full h-full flex items-center justify-center font-black text-xl text-slate-800"
              style={{ display: resolvedLogo ? 'none' : 'flex' }}
            >
              {(companyName || "QD").substring(0, 2).toUpperCase()}
            </div>
          </div>
          <div className="text-center text-white">
            <h1 className="font-black text-2xl tracking-tight leading-none mb-1">
              {companyName.toUpperCase()}<span className="opacity-60 italic">PARTNER</span>
            </h1>
            <div className="h-0.5 w-8 bg-white/40 mx-auto rounded-full" />
          </div>
        </motion.div>
      </div>

      {/* Bottom Form Section - 65% height */}
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        className="flex-1 bg-white dark:bg-[#0A0A0B] rounded-t-[2.5rem] -mt-8 relative z-20 shadow-[0_-20px_40px_rgba(0,0,0,0.05)] px-6 pt-8 pb-6 flex flex-col"
        style={{ marginBottom: keyboardInset ? `${keyboardInset}px` : 0 }}
      >
        <div className="max-w-md mx-auto w-full flex flex-col h-full">
          <div className="space-y-2 mb-6">
            <h2 className="text-2xl font-black text-[#1A1A1A] dark:text-white tracking-tight">
              {step === 1 && "Forgot Password"}
              {step === 2 && "Verify OTP"}
              {step === 3 && "Reset Password"}
            </h2>
            <p className="text-sm font-medium text-gray-500">
              {step === 1 && "Enter your email to receive a verification code"}
              {step === 2 && "Enter the 6-digit code sent to your email"}
              {step === 3 && "Enter your new password"}
            </p>
          </div>

          <div className="space-y-6">
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  className="flex items-center gap-1.5 text-xs font-bold text-red-500 bg-red-50 py-3 px-4 rounded-xl border border-red-100"
                >
                  <AlertCircle className="h-4 w-4" />
                  <span>{error}</span>
                </motion.div>
              )}
            </AnimatePresence>

            {step === 1 && (
              <form onSubmit={handleEmailSubmit} className="space-y-6">
                <div className="space-y-4">
                  <label className="text-xs font-bold text-gray-700 uppercase tracking-wider ml-1">
                    Email Address
                  </label>
                  <div className="flex items-center gap-0 bg-[#F8F9FA] dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl focus-within:border-[#F38F24] focus-within:ring-1 focus-within:ring-[#F38F24] transition-all overflow-hidden group">
                    <div className="flex items-center px-4 h-14 bg-transparent text-gray-400">
                      <Mail size={20} className="group-focus-within:text-[#F38F24] transition-colors" />
                    </div>
                    <input
                      id="email"
                      type="email"
                      placeholder="restaurant@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={isLoading}
                      autoComplete="email"
                      required
                      className="flex-1 h-14 bg-transparent border-0 outline-none ring-0 placeholder:text-gray-400 text-base font-semibold px-2 text-[#1A1A1A] dark:text-white"
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={isLoading || !email}
                  className="w-full h-14 rounded-xl font-bold text-base transition-all bg-[#1A1A1A] hover:bg-black text-white hover:shadow-lg disabled:opacity-50 disabled:bg-gray-200 disabled:text-gray-400"
                >
                  {isLoading ? (
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                      <span>Sending...</span>
                    </div>
                  ) : (
                    "Send Verification Code"
                  )}
                </Button>
              </form>
            )}

            {step === 2 && (
              <form onSubmit={handleOtpSubmit} className="space-y-6">
                <div className="space-y-4">
                  <label className="text-xs font-bold text-gray-700 uppercase tracking-wider ml-1 block text-center">
                    Enter Verification Code
                  </label>
                  <div className="flex justify-center gap-2">
                    {otp.map((digit, index) => (
                      <input
                        key={index}
                        ref={(el) => {
                          if (inputRefs.current) {
                            inputRefs.current[index] = el
                          }
                        }}
                        type="text"
                        inputMode="numeric"
                        maxLength={1}
                        value={digit}
                        onChange={(e) => handleOtpChange(index, e.target.value)}
                        onKeyDown={(e) => handleOtpKeyDown(index, e)}
                        onPaste={index === 0 ? handleOtpPaste : undefined}
                        className="h-14 w-12 text-center text-2xl font-black bg-[#F8F9FA] dark:bg-zinc-900 border border-gray-200 rounded-xl text-[#1A1A1A] focus:border-[#F38F24] focus:ring-1 focus:ring-[#F38F24] transition-all outline-none"
                        disabled={isLoading}
                      />
                    ))}
                  </div>
                  <p className="text-sm text-gray-500 text-center">
                    Code sent to <span className="font-bold text-[#1A1A1A]">{email}</span>
                  </p>
                </div>

                <div className="flex items-center justify-between px-2">
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="text-sm font-bold text-[#1A1A1A] hover:text-[#F38F24] transition-colors"
                    disabled={isLoading}
                  >
                    Change email
                  </button>
                  <button
                    type="button"
                    onClick={handleResendOtp}
                    disabled={resendTimer > 0 || isLoading}
                    className="text-sm font-bold text-[#F38F24] disabled:text-gray-400 transition-colors"
                  >
                    {resendTimer > 0 ? `Resend in ${resendTimer}s` : "Resend code"}
                  </button>
                </div>

                <Button
                  type="submit"
                  disabled={isLoading || otp.join("").length !== 6}
                  className="w-full h-14 rounded-xl font-bold text-base transition-all bg-[#1A1A1A] hover:bg-black text-white hover:shadow-lg disabled:opacity-50 disabled:bg-gray-200 disabled:text-gray-400"
                >
                  {isLoading ? (
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                      <span>Verifying...</span>
                    </div>
                  ) : (
                    "Verify Code"
                  )}
                </Button>
              </form>
            )}

            {step === 3 && (
              <form onSubmit={handlePasswordSubmit} className="space-y-6">
                <div className="space-y-4">
                  <label className="text-xs font-bold text-gray-700 uppercase tracking-wider ml-1">
                    New Password
                  </label>
                  <div className="flex items-center gap-0 bg-[#F8F9FA] dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl focus-within:border-[#F38F24] focus-within:ring-1 focus-within:ring-[#F38F24] transition-all overflow-hidden group">
                    <div className="flex items-center px-4 h-14 bg-transparent text-gray-400">
                      <Lock size={20} className="group-focus-within:text-[#F38F24] transition-colors" />
                    </div>
                    <input
                      type={showPassword ? "text" : "password"}
                      placeholder="Enter new password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      disabled={isLoading}
                      required
                      className="flex-1 h-14 bg-transparent border-0 outline-none ring-0 placeholder:text-gray-400 text-base font-semibold px-2 text-[#1A1A1A] dark:text-white"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="px-4 h-14 flex items-center text-gray-400 hover:text-gray-600 transition-colors"
                      disabled={isLoading}
                    >
                      {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  <label className="text-xs font-bold text-gray-700 uppercase tracking-wider ml-1">
                    Confirm Password
                  </label>
                  <div className="flex items-center gap-0 bg-[#F8F9FA] dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl focus-within:border-[#F38F24] focus-within:ring-1 focus-within:ring-[#F38F24] transition-all overflow-hidden group">
                    <div className="flex items-center px-4 h-14 bg-transparent text-gray-400">
                      <Lock size={20} className="group-focus-within:text-[#F38F24] transition-colors" />
                    </div>
                    <input
                      type={showConfirmPassword ? "text" : "password"}
                      placeholder="Confirm new password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      disabled={isLoading}
                      required
                      className="flex-1 h-14 bg-transparent border-0 outline-none ring-0 placeholder:text-gray-400 text-base font-semibold px-2 text-[#1A1A1A] dark:text-white"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="px-4 h-14 flex items-center text-gray-400 hover:text-gray-600 transition-colors"
                      disabled={isLoading}
                    >
                      {showConfirmPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                    </button>
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={isLoading || !newPassword || !confirmPassword}
                  className="w-full h-14 rounded-xl font-bold text-base transition-all bg-[#1A1A1A] hover:bg-black text-white hover:shadow-lg disabled:opacity-50 disabled:bg-gray-200 disabled:text-gray-400"
                >
                  {isLoading ? (
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                      <span>Resetting...</span>
                    </div>
                  ) : (
                    "Reset Password"
                  )}
                </Button>
              </form>
            )}
          </div>

          <div className="mt-8 pt-6 border-t border-gray-100 flex justify-center">
            <button
              onClick={() => navigate("/food/restaurant/login")}
              className="flex items-center gap-2 text-sm font-bold text-[#1A1A1A] hover:text-[#F38F24] transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to login
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

