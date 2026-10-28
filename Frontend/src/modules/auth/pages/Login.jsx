import React, { useEffect, useLayoutEffect, useState, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Routes, Route, Navigate, Link, useNavigate, useLocation } from "react-router-dom"
import { Phone, Lock, ArrowRight, ArrowLeft, ShieldCheck, Loader2, UtensilsCrossed, Car, ShoppingBag, Building2 } from "lucide-react"
import { toast } from "sonner"
import apiClient, { authAPI } from "@food/api"
import { setUnifiedAuthData, isUnifiedAuthenticated } from "@food/utils/auth"
import { useSettings } from "../../Taxi/shared/context/SettingsContext"

// Fallback only -- the logo an admin uploads in business settings wins. The
// file path is unchanged because the asset itself still lives there; note that
// renaming the file would not change the artwork inside it.
const FALLBACK_LOGO = "/k9-logo.png"
const COMPANY_NAME = "Quick Drop"

export default function UnifiedOTPFastLogin({ viewType = "auth" }) {
  const RESEND_COOLDOWN_SECONDS = 60
  const VERIFY_REQUEST_TIMEOUT_MS = 20000
  const FCM_FETCH_TIMEOUT_MS = 12000
  const [phoneNumber, setPhoneNumber] = useState("")
  const [otp, setOtp] = useState("")
  const [step, setStep] = useState(1) // 1: Phone, 2: OTP, 3: Name
  const [loading, setLoading] = useState(false)
  const [otpSent, setOtpSent] = useState(false)
  const [resendTimer, setResendTimer] = useState(0)
  const [name, setName] = useState("")
  const [pendingAuthData, setPendingAuthData] = useState(null)
  const navigate = useNavigate()
  const location = useLocation()
  const submitting = useRef(false)
  const { activeLogo } = useSettings()

  const getWebFcmTokenForLogin = async () => {
    if (typeof window === "undefined" || typeof navigator === "undefined") {
      throw new Error("Browser environment not available for FCM token generation")
    }
    if (!("serviceWorker" in navigator) || typeof Notification === "undefined") {
      throw new Error("This browser does not support push notifications")
    }

    const firebaseConfig = {
      apiKey: String(import.meta.env.VITE_FIREBASE_API_KEY || "").trim(),
      authDomain: String(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "").trim(),
      projectId: String(import.meta.env.VITE_FIREBASE_PROJECT_ID || "").trim(),
      storageBucket: String(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "").trim(),
      messagingSenderId: String(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "").trim(),
      appId: String(import.meta.env.VITE_FIREBASE_APP_ID || "").trim(),
    }
    const vapidKey = String(import.meta.env.VITE_FIREBASE_VAPID_KEY || "").trim()

    if (!Object.values(firebaseConfig).every(Boolean) || !vapidKey) {
      throw new Error("Firebase web push config missing in Frontend/.env")
    }

    if (Notification.permission === "denied") {
      throw new Error("Notification permission is blocked. Enable notifications and try again.")
    }
    if (Notification.permission !== "granted") {
      const permission = await Notification.requestPermission()
      if (permission !== "granted") {
        throw new Error("Notification permission is required for login")
      }
    }

    const [{ getApps, initializeApp }, { getMessaging, getToken, isSupported }] = await Promise.all([
      import("firebase/app"),
      import("firebase/messaging"),
    ])

    const supported = await isSupported().catch(() => false)
    if (!supported) {
      throw new Error("Firebase messaging is not supported in this browser")
    }

    const app = getApps()[0] || initializeApp(firebaseConfig)
    const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js")
    const messaging = getMessaging(app)
    const token = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: registration,
    })

    const normalizedToken = String(token || "").trim()
    if (!normalizedToken || normalizedToken.length < 20) {
      throw new Error("Failed to generate FCM token")
    }

    localStorage.setItem("fcm_web_registered_token_user", normalizedToken)
    return normalizedToken
  }

  // Check if already logged in on mount - commented out so the Sign In screen always shows for testing
  // useEffect(() => {
  //   if (isUnifiedAuthenticated() && viewType === "auth") {
  //     const from = location.state?.from?.pathname === "/" ? "/food/user" : (location.state?.from?.pathname || "/food/user");
  //     navigate(from, { replace: true })
  //   }
  // }, [viewType, navigate, location])

  useEffect(() => {
    document.title = "Login | Quick Drop"
  }, [])

  const normalizedPhone = () => {
    const digits = String(phoneNumber).replace(/\D/g, "").slice(-15)
    return digits.length >= 8 ? digits : ""
  }

  const withTimeout = async (promise, timeoutMs, label) => {
    let timeoutId
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`${label} timed out. Please try again.`))
      }, timeoutMs)
    })
    try {
      return await Promise.race([promise, timeoutPromise])
    } finally {
      clearTimeout(timeoutId)
    }
  }

  const waitForFlutterBridge = async (timeoutMs = 6000) => {
    if (typeof window === "undefined") return false
    if (window.flutter_inappwebview && typeof window.flutter_inappwebview.callHandler === "function") {
      return true
    }

    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 120))
      if (window.flutter_inappwebview && typeof window.flutter_inappwebview.callHandler === "function") {
        return true
      }
    }
    return false
  }

  const normalizeBridgeToken = (value) => {
    if (typeof value === "string") return value.trim()
    if (value && typeof value === "object") {
      const candidates = [value.token, value.fcmToken, value.data?.token, value.data?.fcmToken]
      for (const candidate of candidates) {
        const normalized = String(candidate || "").trim()
        if (normalized.length > 20) return normalized
      }
    }
    return String(value || "").trim()
  }

  const handleSendOTP = async (e) => {
    e.preventDefault()
    const phone = normalizedPhone()
    if (phone.length < 8) {
      toast.error("Please enter a valid phone number (at least 8 digits)")
      return
    }
    if (submitting.current) return
    submitting.current = true
    setLoading(true)
    try {
      const otpSendResponse = await authAPI.sendUnifiedOTP(phoneNumber)
      console.log("[Auth] OTP send response:", otpSendResponse?.data || otpSendResponse)
      setOtpSent(true)
      setOtp("")
      setStep(2)
      setResendTimer(RESEND_COOLDOWN_SECONDS)
      toast.success("OTP sent! Check your phone.")
    } catch (err) {
      console.log("[Auth] OTP send error:", err?.response?.data || err)
      const msg = err?.response?.data?.message || err?.message || "Failed to send OTP."
      toast.error(msg)
    } finally {
      setLoading(false)
      submitting.current = false
    }
  }

  const handleResendOTP = async () => {
    const phone = normalizedPhone()
    if (phone.length < 8) {
      toast.error("Please enter a valid phone number (at least 8 digits)")
      return
    }
    if (resendTimer > 0 || submitting.current) return
    submitting.current = true
    setLoading(true)
    try {
      const otpResendResponse = await authAPI.sendUnifiedOTP(phoneNumber)
      console.log("[Auth] OTP resend response:", otpResendResponse?.data || otpResendResponse)
      setOtp("")
      setOtpSent(true)
      setResendTimer(RESEND_COOLDOWN_SECONDS)
      toast.success("OTP resent successfully.")
    } catch (err) {
      console.log("[Auth] OTP resend error:", err?.response?.data || err)
      const msg = err?.response?.data?.message || err?.message || "Failed to resend OTP."
      toast.error(msg)
    } finally {
      setLoading(false)
      submitting.current = false
    }
  }

  const handleEditNumber = () => {
    setStep(1)
    setOtp("")
    setName("")
    setPendingAuthData(null)
    setResendTimer(0)
  }

  const handleVerifyOTP = async (e) => {
    e.preventDefault()
    const phone = normalizedPhone()
    const otpDigits = String(otp).replace(/\D/g, "").slice(0, 4)
    if (otpDigits.length !== 4) {
      toast.error("Please enter the 4-digit OTP")
      return
    }
    if (submitting.current) return
    submitting.current = true
    setLoading(true)
    try {
      let fcmToken = ""
      let platform = "web"
      if (typeof window !== "undefined" && window.flutter_inappwebview) {
        platform = "mobile"
        await waitForFlutterBridge()
        const handlerNames = ["getFcmToken", "getFCMToken", "getPushToken", "getFirebaseToken"]
        for (const handlerName of handlerNames) {
          try {
            const t = await window.flutter_inappwebview.callHandler(handlerName, { module: "user" })
            const normalized = normalizeBridgeToken(t)
            if (normalized.length > 20) {
              fcmToken = normalized
              break
            }
          } catch (_) {}
        }
        if (!fcmToken) {
          throw new Error("Unable to fetch mobile FCM token from app bridge")
        }
      } else {
        fcmToken = await withTimeout(
          getWebFcmTokenForLogin(),
          FCM_FETCH_TIMEOUT_MS,
          "FCM token fetch",
        )
      }

      console.log("[Auth] FCM token for login:", {
        platform,
        length: fcmToken.length,
        preview: `${fcmToken.slice(0, 12)}...`,
      })

      const response = await withTimeout(
        authAPI.verifyUnifiedOTP(phoneNumber, otpDigits, null, null, fcmToken, platform),
        VERIFY_REQUEST_TIMEOUT_MS,
        "OTP verification request",
      )
      console.log("[Auth] OTP verify response:", response?.data || response)
      const data = response?.data?.data || response?.data || {}

      if (!data.accessToken || !data.user) {
        throw new Error("Invalid response from server")
      }

      const hasName =
        data.user?.name &&
        String(data.user.name).trim().length > 0 &&
        String(data.user.name).toLowerCase() !== "null"
      const needsName = data.isNewUser === true || data.needsNamePrompt === true || !hasName

      if (needsName) {
        setPendingAuthData({ ...data, fcmToken, platform })
        setName("")
        setStep(3)
        toast.success("OTP verified. Complete your profile to continue.")
        return
      }

      setUnifiedAuthData(data)
      try {
        await authAPI.saveLoginFcmToken(fcmToken, platform)
      } catch (fcmSaveError) {
        console.warn("[Auth] FCM save route failed after login:", fcmSaveError?.message || fcmSaveError)
      }
      toast.success("Authentication successful!")
      const from = location.state?.from?.pathname === "/" ? "/food/user" : (location.state?.from?.pathname || "/food/user");
      navigate(from, { replace: true })
    } catch (err) {
      const status = err?.response?.status
      let msg = err?.response?.data?.message || err?.response?.data?.error || err?.message || "Invalid OTP. Please try again."
      if (status === 401) {
        if (/deactivat(ed|e)/i.test(String(msg))) {
          msg = "Your account is deactivated. Please contact support."
        } else {
          msg = "Invalid or expired code, or account not active."
        }
      }
      console.log("[Auth] OTP verify error:", err?.response?.data || err)
      toast.error(msg)
    } finally {
      setLoading(false)
      submitting.current = false
    }
  }

  const handleCompleteProfile = async (e) => {
    e.preventDefault()
    const trimmedName = String(name || "").trim()
    if (trimmedName.length < 2) {
      toast.error("Please enter your full name")
      return
    }
    if (!pendingAuthData?.accessToken || !pendingAuthData?.user) {
      toast.error("Session expired. Please verify OTP again.")
      setStep(1)
      setOtp("")
      setPendingAuthData(null)
      return
    }

    if (submitting.current) return
    submitting.current = true
    setLoading(true)
    try {
      await apiClient.patch(
        "/food/user/profile",
        { name: trimmedName },
        {
          headers: {
            Authorization: `Bearer ${pendingAuthData.accessToken}`,
          },
        },
      )

      const nextData = {
        ...pendingAuthData,
        user: {
          ...pendingAuthData.user,
          name: trimmedName,
        },
      }

      setUnifiedAuthData(nextData)
      toast.success("Profile completed successfully!")
      const from = location.state?.from?.pathname === "/" ? "/food/user" : (location.state?.from?.pathname || "/food/user");
      navigate(from, { replace: true })
    } catch (err) {
      const msg =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err?.message ||
        "Failed to save your name."
      toast.error(msg)
    } finally {
      setLoading(false)
      submitting.current = false
    }
  }

  useEffect(() => {
    if (step !== 2 || resendTimer <= 0) return
    const intervalId = setInterval(() => {
      setResendTimer((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)
    return () => clearInterval(intervalId)
  }, [step, resendTimer])

  const formatResendTimer = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
  }

  return (
    <div
      className="min-h-screen flex flex-col md:flex-row overflow-hidden font-sans bg-[#F8F9FA] dark:bg-[#1A1A1A]"
    >
      {/* Premium Branding Panel (Hidden on mobile) */}
      <motion.div
        layout
        className="hidden md:flex flex-col justify-between w-[45%] lg:w-[50%] bg-[#1A1A1A] p-12 text-white relative overflow-hidden shadow-[20px_0_40px_rgba(0,0,0,0.1)] z-10"
      >
        {/* Subtle orange accent glow */}
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
          <div className="absolute -top-[20%] -left-[10%] w-[70%] h-[70%] bg-[#F38F24]/5 rounded-full blur-[120px]" />
          <div className="absolute top-[60%] right-[10%] w-[50%] h-[50%] bg-white/5 rounded-full blur-[100px]" />
        </div>

        <div className="relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="flex items-center gap-4 mb-16"
          >
            <div className="w-12 h-12 flex items-center justify-center bg-white rounded-xl shadow-lg overflow-hidden">
              <img src={activeLogo || FALLBACK_LOGO} alt={COMPANY_NAME} className="w-full h-full object-cover" />
            </div>
            <h1 className="text-3xl font-black tracking-tight">{COMPANY_NAME}</h1>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="space-y-6 max-w-md"
          >
            <h2 className="text-5xl font-bold tracking-tight leading-[1.1]">
              The unified <br />
              <span className="text-[#F38F24]">ecosystem</span> <br />
              for everything.
            </h2>
            <p className="text-gray-400 text-lg leading-relaxed">
              Food delivery, ride-hailing, and more. Experience seamless services crafted with enterprise-grade reliability and premium design.
            </p>
          </motion.div>
        </div>

        <div className="relative z-10 flex gap-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">
          <span>Food</span>
          <span className="text-[#F38F24]">•</span>
          <span>Rides</span>
          <span className="text-gray-700">•</span>
          <span>Logistics</span>
        </div>
      </motion.div>

      {/* Main Content Area */}
      <div className="flex-1 w-full flex flex-col lg:flex-row relative z-20 bg-[#F8F9FA] overflow-hidden h-[100dvh] lg:h-auto font-sans">
        
        {/* Back Button */}
        <div className="absolute top-6 left-6 z-50">
          <Link to="/food/user" className="w-10 h-10 flex items-center justify-center bg-white/80 backdrop-blur-md rounded-full shadow-sm border border-gray-200 text-[#1A1A1A] hover:bg-white active:scale-95 transition-all">
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </div>
        
        {/* Abstract Background Elements (Mobile Only) */}
        <div className="lg:hidden absolute top-0 left-0 w-56 h-56 pointer-events-none z-0 opacity-70">
          <svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
            <path d="M-20 120 L120 -20" stroke="#1A1A1A" strokeWidth="1" />
            <path d="M-40 80 Q 60 10 120 40" stroke="#F38F24" strokeWidth="0.5" fill="none" />
            <rect x="70" y="20" width="36" height="36" rx="8" stroke="#F38F24" strokeWidth="0.5" transform="rotate(45 88 38)" />
          </svg>
        </div>

        <div className="lg:hidden absolute bottom-0 right-0 w-64 h-64 pointer-events-none z-0 opacity-70">
          <svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full translate-y-8 translate-x-8">
            <path d="M60 200 Q 60 100 200 100" stroke="#1A1A1A" strokeWidth="1" fill="none" />
            <path d="M100 250 L250 100" stroke="#F38F24" strokeWidth="0.5" />
            <rect x="130" y="120" width="28" height="28" rx="6" stroke="#F38F24" strokeWidth="0.5" transform="rotate(45 144 134)" />
          </svg>
        </div>

        {/* Mobile Header / Form Area */}
        <div className="flex-1 w-full relative z-20 flex flex-col items-center justify-center py-4 lg:justify-center">
          <div className="w-full max-w-[420px] px-6 w-full flex flex-col items-center">
            
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="w-full flex flex-col items-center"
            >
              {/* Brand logo */}
              <img 
                src={activeLogo || FALLBACK_LOGO} 
                alt={COMPANY_NAME} 
                className="w-[84px] h-[84px] rounded-full object-cover shadow-lg mb-6" 
              />

              <div className="text-center mb-8">
                <h2 className="text-[32px] leading-tight font-black text-[#1A1A1A] tracking-tight mb-2">
                  Welcome to {COMPANY_NAME}
                </h2>
                <p className="text-[#1A1A1A] text-[15px] font-medium max-w-[28ch] mx-auto">
                  Enter your phone number to<br />access the unified ecosystem.
                </p>
              </div>

              <form
                onSubmit={
                  step === 1
                    ? handleSendOTP
                    : step === 2
                      ? handleVerifyOTP
                      : handleCompleteProfile
                }
                className="w-full flex flex-col space-y-6"
              >
                <div className="w-full">
                  {step === 1 ? (
                    <div className="w-full">
                      <div className="relative w-full h-[60px] rounded-full border-[1.5px] border-[#F38F24] shadow-[inset_0_4px_16px_rgba(0,0,0,0.06)] bg-gradient-to-b from-white to-gray-200/80 flex items-center px-6 overflow-hidden">
                        <span className="text-[20px] font-medium text-[#1A1A1A] shrink-0">+91</span>
                        <div className="w-[1px] h-[26px] bg-gray-400 mx-3 opacity-50 shrink-0"></div>
                        <input
                          type="tel"
                          required
                          autoFocus
                          value={phoneNumber}
                          onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, "").slice(0, 10))}
                          maxLength={10}
                          className="flex-1 min-w-0 h-full bg-transparent text-[20px] font-medium text-[#1A1A1A] outline-none placeholder:text-gray-500 tracking-wider"
                          placeholder="9999999999"
                        />
                      </div>
                    </div>
                  ) : step === 2 ? (
                    <div className="space-y-5">
                      <div className="flex items-center justify-between p-3 bg-white rounded-full border border-gray-200 shadow-sm px-5">
                        <div>
                          <p className="text-[11px] text-gray-500 font-bold uppercase tracking-wider mb-0.5">Code sent to</p>
                          <p className="text-[15px] font-black text-slate-900 tracking-wide">+91 {phoneNumber}</p>
                        </div>
                        <button 
                          type="button" 
                          onClick={handleEditNumber} 
                          className="px-4 py-1.5 hover:bg-gray-100 rounded-full text-[13px] font-bold text-slate-900 transition-colors"
                        >
                          Edit
                        </button>
                      </div>

                      <div className="space-y-4">
                         <div className="flex justify-between gap-3">
                           {[0, 1, 2, 3].map((index) => (
                             <input
                               key={index}
                               id={`otp-${index}`}
                               type="tel"
                               inputMode="numeric"
                               required
                               autoFocus={index === 0}
                               value={otp[index] || ""}
                               onChange={(e) => {
                                 const val = e.target.value.replace(/\D/g, "").slice(-1);
                                 if (!val) return;
                                 const newOtp = otp.split("");
                                 newOtp[index] = val;
                                 const combined = newOtp.join("").slice(0, 4);
                                 setOtp(combined);
                                 if (index < 3 && val) document.getElementById(`otp-${index + 1}`)?.focus();
                               }}
                               onKeyDown={(e) => {
                                 if (e.key === "Backspace" && !otp[index] && index > 0) {
                                   document.getElementById(`otp-${index - 1}`)?.focus();
                                 }
                               }}
                               className="w-full aspect-square text-center text-[28px] font-black bg-white border border-gray-200 focus:border-[#F38F24] rounded-2xl outline-none transition-all text-slate-900 shadow-sm"
                               placeholder="-"
                             />
                           ))}
                         </div>
                      </div>
                      
                      <div className="flex items-center justify-between mt-4 px-2">
                        <span className="text-[14px] font-medium text-gray-600">Didn't receive it?</span>
                        {resendTimer > 0 ? (
                          <span className="text-[14px] font-bold text-gray-400">
                            Resend in {formatResendTimer(resendTimer)}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={handleResendOTP}
                            className="text-[14px] font-bold text-[#F38F24] hover:text-[#d97716] transition-colors"
                          >
                            Resend Code
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-5">
                      <div className="flex items-center justify-between p-3 bg-white rounded-full border border-gray-200 shadow-sm px-5">
                        <div>
                          <p className="text-[11px] text-gray-500 font-bold uppercase tracking-wider mb-0.5">New account</p>
                          <p className="text-[15px] font-black text-slate-900 tracking-wide">+91 {phoneNumber}</p>
                        </div>
                        <button
                          type="button"
                          onClick={handleEditNumber}
                          className="px-4 py-1.5 hover:bg-gray-100 rounded-full text-[13px] font-bold text-slate-900 transition-colors"
                        >
                          Edit
                        </button>
                      </div>

                      <div className="relative w-full h-[60px] rounded-full border-[1.5px] border-[#F38F24] shadow-[inset_0_4px_16px_rgba(0,0,0,0.06)] bg-gradient-to-b from-white to-gray-200/80 flex items-center px-6 overflow-hidden">
                        <input
                          type="text"
                          required
                          autoFocus
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          className="flex-1 min-w-0 h-full bg-transparent text-[20px] font-medium text-[#1A1A1A] outline-none placeholder:text-gray-500"
                          placeholder="Enter your full name"
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-6 pt-2 flex flex-col items-center">
                  <p className="text-center text-[13px] text-gray-800 mb-5 px-4 font-medium leading-relaxed max-w-[30ch]">
                    By continuing, you agree to our{" "}
                    <Link to="/terms" className="font-bold text-slate-900 hover:underline">Terms</Link>
                    {" "}and{" "}
                    <Link to="/privacy" className="font-bold text-slate-900 hover:underline">Privacy Policy</Link>.
                  </p>

                  <button
                    type="submit"
                    disabled={
                      loading ||
                      (step === 1 && String(phoneNumber).length < 10) ||
                      (step === 2 && otp.length !== 4) ||
                      (step === 3 && String(name).trim().length < 2)
                    }
                    className={`w-full h-[60px] rounded-full font-semibold text-[17px] transition-all flex items-center justify-center gap-3 ${
                      loading ||
                      (step === 1 && String(phoneNumber).length < 10) ||
                      (step === 2 && otp.length !== 4) ||
                      (step === 3 && String(name).trim().length < 2)
                        ? "bg-[#E5E7EB] text-[#6B7280] cursor-not-allowed shadow-inner"
                        : "bg-[#1A1A1A] text-white shadow-lg active:scale-[0.98]"
                    }`}
                  >
                    {loading ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <>
                        {step === 1 ? "Continue securely" : step === 2 ? "Verify & Login" : "Complete Profile"}
                        <ArrowRight className={`w-5 h-5 ${
                          loading ||
                          (step === 1 && String(phoneNumber).length < 10) ||
                          (step === 2 && otp.length !== 4) ||
                          (step === 3 && String(name).trim().length < 2)
                            ? 'text-[#9CA3AF]'
                            : 'text-[#F38F24]'
                        }`} />
                      </>
                    )}
                  </button>
                  
                  <div className="mt-6 mb-2 flex flex-col items-center justify-center gap-3">
                    <div className="flex items-center gap-2 text-[12px] font-medium text-gray-700">
                      <ShieldCheck className="w-4 h-4" />
                      <span className="tracking-wide">SECURELY ENCRYPTED</span>
                    </div>
                    
                    <div className="flex items-center text-[14px] font-medium text-gray-800">
                      <Link to="/support" className="hover:text-black transition-colors">Help & Support</Link>
                    </div>
                  </div>
                </div>
              </form>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  )
}

function cn(...classes) {
  return classes.filter(Boolean).join(" ")
}
