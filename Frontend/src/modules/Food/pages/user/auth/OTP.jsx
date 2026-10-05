import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { Loader2, AlertCircle } from "lucide-react"
import AnimatedPage from "@food/components/user/AnimatedPage"
import { Input } from "@food/components/ui/input"
import { Button } from "@food/components/ui/button"
import apiClient, { authAPI } from "@food/api"
import { setAuthData as setUserAuthData } from "@food/utils/auth"
import { useCompanyName } from "@food/hooks/useCompanyName"
import { motion, AnimatePresence } from "framer-motion"
import { getDynamicLogo, loadBusinessSettings, getCachedSettings } from "@food/utils/businessSettings"
import { useSettings } from "../../../../Taxi/shared/context/SettingsContext"

export default function OTP() {
  const navigate = useNavigate()
  const companyName = useCompanyName()
  const { activeLogo, settings: appSettings } = useSettings() || {}
  const [businessLogo, setBusinessLogo] = useState(() => {
    try {
      return getDynamicLogo() || getCachedSettings()?.logo?.url || null;
    } catch (e) {
      return null;
    }
  })

  useEffect(() => {
    loadBusinessSettings().then((s) => {
      const logo = getDynamicLogo() || s?.logo?.url;
      if (logo) setBusinessLogo(logo);
    }).catch(() => {});
  }, []);

  const resolvedLogo = activeLogo ||
    appSettings?.customization?.logos?.food ||
    appSettings?.customization?.logos?.landing ||
    appSettings?.customization?.logos?.admin ||
    appSettings?.general?.logo ||
    businessLogo;

  const [otp, setOtp] = useState(["", "", "", ""]) // exactly 4 digits
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)
  const [resendTimer, setResendTimer] = useState(0)
  const [authData, setAuthData] = useState(null)
  const [showNameInput, setShowNameInput] = useState(false)
  const [name, setName] = useState("")
  const [nameError, setNameError] = useState("")
  const [verifiedData, setVerifiedData] = useState(null)
  const [contactInfo, setContactInfo] = useState("")
  const [contactType, setContactType] = useState("phone")
  const [deviceToken, setDeviceToken] = useState(null)
  const [activePlatform, setActivePlatform] = useState("web")
  const inputRefs = useRef([])
  const submittingRef = useRef(false)

  useEffect(() => {
    // Redirect to home if already authenticated
    const isAuthenticated = localStorage.getItem("user_authenticated") === "true"
    if (isAuthenticated) {
      navigate("/food/user", { replace: true })
      return
    }

    // Get auth data from sessionStorage
    const stored = sessionStorage.getItem("userAuthData")
    if (!stored) {
      navigate("/food/user/auth/login", { replace: true })
      return
    }
    const data = JSON.parse(stored)
    setAuthData(data)

    if (data.method === "email" && data.email) {
      setContactType("email")
      setContactInfo(data.email)
    } else if (data.phone) {
      setContactType("phone")
      const phoneMatch = data.phone?.match(/(\+\d+)\s*(.+)/)
      if (phoneMatch) {
        setContactInfo(`${phoneMatch[1]}-${phoneMatch[2].replace(/\D/g, "")}`)
      } else {
        setContactInfo(data.phone || "")
      }
    }

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

    return () => clearInterval(timer)
  }, [navigate])

  useEffect(() => {
    if (inputRefs.current[0] && !showNameInput) {
      inputRefs.current[0].focus()
    }
  }, [showNameInput])

  const handleChange = (index, value) => {
    if (value && !/^\d$/.test(value)) return
    const newOtp = [...otp]
    newOtp[index] = value
    setOtp(newOtp)
    setError("")

    if (value && index < 3) {
      inputRefs.current[index + 1]?.focus()
    }

    if (!showNameInput && newOtp.slice(0, 4).every((digit) => digit !== "")) {
      handleVerify(newOtp.slice(0, 4).join(""))
    }
  }

  const handleKeyDown = (index, e) => {
    if (e.key === "Backspace") {
      if (otp[index]) {
        const newOtp = [...otp]
        newOtp[index] = ""
        setOtp(newOtp)
      } else if (index > 0) {
        inputRefs.current[index - 1]?.focus()
        const newOtp = [...otp]
        newOtp[index - 1] = ""
        setOtp(newOtp)
      }
    }
  }

  const handlePaste = (e) => {
    e.preventDefault()
    const pastedData = e.clipboardData.getData("text")
    const digits = pastedData.replace(/\D/g, "").slice(0, 4).split("")
    const newOtp = [...otp]
    digits.forEach((digit, i) => {
      if (i < 4) newOtp[i] = digit
    })
    setOtp(newOtp)
    if (!showNameInput && digits.length === 4) {
      handleVerify(newOtp.slice(0, 4).join(""))
    } else {
      inputRefs.current[Math.min(digits.length, 3)]?.focus()
    }
  }

  const handleVerify = async (otpValue = null) => {
    if (showNameInput) return
    if (submittingRef.current) return

    const code = (otpValue || otp.join("")).replace(/\D/g, "")
    const code4 = code.slice(0, 4)
    if (code4.length !== 4) {
      setError("OTP must be exactly 4 digits")
      return
    }

    submittingRef.current = true
    setIsLoading(true)
    setError("")

    try {
      const phone = authData?.method === "phone" ? authData.phone : null
      const email = authData?.method === "email" ? authData.email : null
      const purpose = authData?.isSignUp ? "register" : "login"
      const providedName = authData?.isSignUp ? authData?.name || null : null
      const referralCode = authData?.referralCode || null

      let fcmToken = null;
      let platform = "web";
      try {
        if (typeof window !== "undefined") {
          if (window.flutter_inappwebview) {
            platform = "mobile";
            const handlerNames = ["getFcmToken", "getFCMToken", "getPushToken", "getFirebaseToken"];
            for (const handlerName of handlerNames) {
              try {
                const response = await window.flutter_inappwebview.callHandler(handlerName, { module: "user" });
                const token =
                  typeof response === "string"
                    ? response
                    : response?.token ||
                      response?.fcmToken ||
                      response?.data?.token ||
                      response?.data?.fcmToken ||
                      "";
                const normalizedToken = String(token).trim();
                if (normalizedToken.length > 20) {
                  fcmToken = normalizedToken;
                  break;
                }
              } catch (e) {}
            }
          } else {
            fcmToken = localStorage.getItem("fcm_web_registered_token_user") || null;
          }
        }
      } catch (e) {
        console.warn("Failed to get FCM token during login", e);
      }

      setDeviceToken(fcmToken);
      setActivePlatform(platform);

      const response = await authAPI.verifyOTP(
        phone, code4, purpose, providedName, email, "user", null, referralCode, fcmToken, platform
      )
      const data = response?.data?.data || response?.data || {}
      const accessToken = data.accessToken
      const refreshToken = data.refreshToken ?? null
      const user = data.user

      if (!accessToken || !user || !refreshToken) {
        throw new Error("Invalid response from server")
      }

      const hasName = user.name && String(user.name).trim().length > 0 && String(user.name).toLowerCase() !== "null";
      const needsName =
        authData?.expectedNewUser === true ||
        data.isNewUser === true ||
        data.needsNamePrompt === true ||
        !hasName;

      if (needsName) {
        setVerifiedData(data)
        setShowNameInput(true)
        setIsLoading(false)
        submittingRef.current = false
        return
      }

      sessionStorage.removeItem("userAuthData")
      setUserAuthData("user", accessToken, user, refreshToken)
      window.dispatchEvent(new Event("userAuthChanged"))
      setSuccess(true)
      setTimeout(() => navigate("/food/user"), 600)
    } catch (err) {
      const status = err?.response?.status
      let message = err?.response?.data?.message || err?.response?.data?.error || err?.message || "Verification failed."
      if (status === 401) message = "Invalid or expired code."
      setError(message)
    } finally {
      setIsLoading(false)
      submittingRef.current = false
    }
  }

  const handleSubmitName = async () => {
    const trimmedName = name.trim()
    if (!trimmedName || trimmedName.length < 2) {
      setNameError("Please enter a valid name")
      return
    }

    setIsLoading(true)
    setError("")
    setNameError("")

    try {
      const { accessToken, refreshToken, user } = verifiedData

      // Update name via profile API
      try {
        await apiClient.patch("/food/user/profile", 
          { name: trimmedName },
          { headers: { Authorization: `Bearer ${accessToken}` } }
        )
      } catch (e) {
        console.error("Failed to update name on backend, but proceeding with login", e)
      }

      sessionStorage.removeItem("userAuthData")
      setUserAuthData("user", accessToken, { ...user, name: trimmedName }, refreshToken)
      window.dispatchEvent(new Event("userAuthChanged"))
      setSuccess(true)
      setTimeout(() => navigate("/food/user"), 600)
    } catch (err) {
      setError("Failed to complete registration. Please try again.")
    } finally {
      setIsLoading(false)
    }
  }

  const handleResend = async () => {
    if (resendTimer > 0 || isLoading) return
    setIsLoading(true)
    setError("")
    try {
      const phone = authData?.method === "phone" ? authData.phone : null
      const email = authData?.method === "email" ? authData.email : null
      const purpose = authData?.isSignUp ? "register" : "login"
      await authAPI.sendOTP(phone, purpose, email)
      setResendTimer(60)
    } catch (err) {
      setError("Failed to resend OTP.")
    } finally {
      setIsLoading(false)
    }
    setOtp(["", "", "", ""])
  }

  if (!authData) return null

  return (
    <AnimatedPage className="min-h-[100dvh] bg-white dark:bg-[#0A0A0B] flex flex-col font-sans overflow-hidden">
      {/* Top Branding Section - 35% height */}
      <div className="relative h-[35dvh] w-full bg-gradient-to-br from-[#07143A] via-[#0D2A6B] to-[#133A8A] overflow-hidden flex flex-col items-center justify-center">
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-0 left-0 w-64 h-64 border border-white/20 rounded-full -ml-20 -mt-20" />
          <div className="absolute bottom-10 right-0 w-32 h-32 border border-white/10 rounded-full -mr-16" />
        </div>

        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.6 }}
          className="relative z-10 flex flex-col items-center gap-4 px-6 text-center"
        >
          <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center border border-white/25 shadow-lg mb-2 overflow-hidden p-1.5">
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
          <div className="space-y-1">
            <h1 className="text-white font-black text-3xl tracking-tight italic">
              {showNameInput ? "ONE LAST STEP" : "VERIFICATION"}
            </h1>
            <p className="text-white/70 text-xs font-bold uppercase tracking-[0.2em]">
              {showNameInput ? "Tell us your name" : `Sent to ${contactInfo}`}
            </p>
          </div>
        </motion.div>
      </div>

      {/* Bottom Content Section - 65% height */}
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        className="flex-1 bg-white dark:bg-[#0A0A0B] rounded-t-[40px] -mt-10 relative z-20 shadow-[0_-20px_40px_rgba(0,0,0,0.05)] px-6 pt-12 pb-6 flex flex-col"
      >
        <div className="max-w-md mx-auto w-full flex flex-col h-full">
          <AnimatePresence mode="wait">
            {!showNameInput ? (
              <motion.div
                key="otp-view"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-10"
              >
                <div className="flex justify-center gap-4">
                  {otp.map((digit, index) => (
                    <motion.div
                      key={index}
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ delay: 0.1 * index }}
                      className="relative"
                    >
                      <input
                        ref={(el) => (inputRefs.current[index] = el)}
                        type="text"
                        inputMode="numeric"
                        maxLength={1}
                        value={digit}
                        onChange={(e) => handleChange(index, e.target.value)}
                        onKeyDown={(e) => handleKeyDown(index, e)}
                        onPaste={index === 0 ? handlePaste : undefined}
                        disabled={isLoading}
                        className="w-16 h-20 text-center text-3xl font-black bg-zinc-100 dark:bg-zinc-900 border-2 border-transparent focus:border-[#0D2A6B] rounded-2xl text-zinc-900 dark:text-white transition-all outline-none shadow-sm"
                      />
                      {digit && (
                        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-[#0D2A6B] rounded-full" />
                      )}
                    </motion.div>
                  ))}
                </div>

                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center justify-center gap-2 text-xs font-bold text-[#0D2A6B] bg-[#0D2A6B]/5 py-4 px-4 rounded-2xl border border-[#0D2A6B]/10"
                  >
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{error}</span>
                  </motion.div>
                )}

                <div className="text-center space-y-6">
                  {resendTimer > 0 ? (
                    <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">
                      Resend code in <span className="text-zinc-900 dark:text-white">{resendTimer}s</span>
                    </p>
                  ) : (
                    <button
                      type="button"
                      onClick={handleResend}
                      disabled={isLoading}
                      className="text-xs font-black text-[#0D2A6B] uppercase tracking-[0.2em] px-6 py-2 rounded-full bg-[#0D2A6B]/5 hover:bg-[#0D2A6B]/10 transition-colors"
                    >
                      Resend Now
                    </button>
                  )}

                  <Button
                    onClick={() => navigate("/food/user/auth/login")}
                    variant="ghost"
                    className="text-zinc-400 dark:text-zinc-600 font-bold text-[10px] uppercase tracking-widest hover:bg-transparent hover:text-zinc-900"
                  >
                    Edit Phone Number
                  </Button>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="name-view"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-8"
              >
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.3em] ml-1">
                      Full Name
                    </label>
                    <div className="bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl focus-within:border-[#0D2A6B]/50 focus-within:ring-4 focus-within:ring-[#0D2A6B]/5 transition-all overflow-hidden">
                      <Input
                        type="text"
                        value={name}
                        onChange={(e) => {
                          setName(e.target.value)
                          if (nameError) setNameError("")
                        }}
                        disabled={isLoading}
                        placeholder="e.g. Aman Kuril"
                        className="h-16 bg-transparent border-0 ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 text-xl font-black placeholder:text-zinc-300 dark:placeholder:text-zinc-700 px-6"
                      />
                    </div>
                  </div>
                  {nameError && (
                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-xs font-bold text-[#0D2A6B] pl-2"
                    >
                      {nameError}
                    </motion.p>
                  )}
                </div>

                <Button
                  onClick={handleSubmitName}
                  disabled={isLoading || name.trim().length < 2}
                  className="w-full h-16 bg-[#0D2A6B] hover:bg-[#07143A] text-white font-black text-base uppercase tracking-widest rounded-2xl transition-all duration-300 shadow-[0_12px_24px_rgba(13,42,107,0.3)] active:scale-[0.98]"
                >
                  {isLoading ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span>Saving Profile...</span>
                    </div>
                  ) : (
                    "Complete Setup"
                  )}
                </Button>
              </motion.div>
            )}
          </AnimatePresence>

          <footer className="mt-auto pt-10 text-center">
            <p className="text-[9px] text-zinc-300 dark:text-zinc-700 font-black uppercase tracking-[0.4em]">
              Quick Drop Secure Network
            </p>
          </footer>
        </div>
      </motion.div>
    </AnimatedPage>
  )
}
