import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, Loader2, Timer, RefreshCw, AlertCircle, ShieldCheck, User } from "lucide-react"
import { Input } from "@food/components/ui/input"
import { Button } from "@food/components/ui/button"
import { deliveryAPI } from "@food/api"
import { setAuthData as storeAuthData } from "@food/utils/auth"
import { useCompanyName } from "@food/hooks/useCompanyName"
import { motion, AnimatePresence } from "framer-motion"
import { getDeliveryPartnerLogo, loadBusinessSettings, getCachedSettings } from "@food/utils/businessSettings"
import { useSettings } from "../../../Taxi/shared/context/SettingsContext"

export default function DeliveryOTP() {
  const companyName = useCompanyName()
  const navigate = useNavigate()
  const { activeLogo, settings: appSettings } = useSettings() || {}
  const [businessLogo, setBusinessLogo] = useState(() => {
    try {
      return getDeliveryPartnerLogo() || getCachedSettings()?.logo?.url || null;
    } catch (e) {
      return null;
    }
  })

  useEffect(() => {
    loadBusinessSettings().then((s) => {
      const logo = getDeliveryPartnerLogo() || s?.deliveryPartnerLogo?.url || s?.logo?.url;
      if (logo) setBusinessLogo(logo);
    }).catch(() => {});
  }, []);

  const resolvedLogo = activeLogo ||
    appSettings?.customization?.logos?.food_delivery_partner ||
    appSettings?.customization?.logos?.delivery_partner ||
    appSettings?.customization?.logos?.food ||
    appSettings?.customization?.logos?.landing ||
    appSettings?.customization?.logos?.admin ||
    appSettings?.general?.logo ||
    businessLogo;

  const [otp, setOtp] = useState(["", "", "", ""])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [resendTimer, setResendTimer] = useState(0)
  const [authData, setAuthData] = useState(null)
  const [showNameInput, setShowNameInput] = useState(false)
  const [name, setName] = useState("")
  const [nameError, setNameError] = useState("")
  const [verifiedOtp, setVerifiedOtp] = useState("")
  const [pendingMessage, setPendingMessage] = useState("")
  const [isRejected, setIsRejected] = useState(false)
  const [rejectionReason, setRejectionReason] = useState("")
  const [deviceToken, setDeviceToken] = useState(null)
  const [activePlatform, setActivePlatform] = useState("web")
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [keyboardOffset, setKeyboardOffset] = useState(0)
  const inputRefs = useRef([])

  useEffect(() => {
    const stored = sessionStorage.getItem("deliveryAuthData")
    if (stored) {
      setAuthData(JSON.parse(stored))
    } else {
      const token = localStorage.getItem("delivery_accessToken")
      const authenticated = localStorage.getItem("delivery_authenticated") === "true"
      if (token && authenticated) {
        try {
          const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
          if (payload.exp > Math.floor(Date.now() / 1000)) {
            navigate("/food/delivery", { replace: true })
            return
          }
        } catch (e) { }
      }
      navigate("/food/delivery/login", { replace: true })
      return
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
    if (typeof window === "undefined") return
    const viewport = window.visualViewport
    if (!viewport) return
    const updateKeyboardState = () => {
      const keyboardHeight = Math.max(0, window.innerHeight - viewport.height)
      setKeyboardOffset(keyboardHeight > 120 ? keyboardHeight : 0)
    }
    updateKeyboardState()
    viewport.addEventListener("resize", updateKeyboardState)
    viewport.addEventListener("scroll", updateKeyboardState)
    return () => {
      viewport.removeEventListener("resize", updateKeyboardState)
      viewport.removeEventListener("scroll", updateKeyboardState)
    }
  }, [])

  useEffect(() => {
    if (inputRefs.current[0] && otp.every(digit => digit === "")) {
      setTimeout(() => inputRefs.current[0]?.focus(), 100)
    }
  }, [otp])

  const handleChange = (index, value) => {
    if (value && !/^\d$/.test(value)) return
    const newOtp = [...otp]
    newOtp[index] = value
    setOtp(newOtp)
    setError("")
    if (value && index < 3) inputRefs.current[index + 1]?.focus()
    if (!showNameInput && newOtp.every((digit) => digit !== "") && newOtp.length === 4) {
      handleVerify(newOtp.join(""))
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
    const digits = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 4).split("")
    const newOtp = [...otp]
    digits.forEach((digit, i) => { if (i < 4) newOtp[i] = digit })
    setOtp(newOtp)
    if (!showNameInput && digits.length === 4) handleVerify(newOtp.join(""))
    else inputRefs.current[digits.length]?.focus()
  }

  const handleVerify = async (otpValue = null) => {
    if (showNameInput) return
    const code = otpValue || otp.join("")
    if (code.length !== 4) return
    setIsLoading(true)
    setError("")
    try {
      const phone = authData?.phone
      const purpose = authData?.purpose || "login"
      let fcmToken = null;
      let platform = "web";
      try {
        if (typeof window !== "undefined") {
          if (window.flutter_inappwebview) {
            platform = "mobile";
            const hN = ["getFcmToken", "getFCMToken", "getPushToken", "getFirebaseToken"];
            for (const n of hN) {
              try {
                const t = await window.flutter_inappwebview.callHandler(n, { module: "delivery" });
                const normalized = typeof t === "string" ? t.trim() : String(t?.token || t?.fcmToken || "").trim();
                if (normalized.length > 20) { fcmToken = normalized; break; }
              } catch (e) { }
            }
          } else {
            fcmToken = localStorage.getItem("fcm_web_registered_token_delivery") || null;
          }
        }
      } catch (e) { }
      setDeviceToken(fcmToken);
      setActivePlatform(platform);

      const response = await deliveryAPI.verifyOTP(phone, code, purpose, null, fcmToken, platform)
      const data = response?.data?.data || response?.data || {}
      if (data.pendingApproval === true) {
        if (data.isRejected) {
          sessionStorage.setItem("deliveryNeedsRegistration", "true")
          const partner = data.deliveryPartner || {}
          sessionStorage.setItem("deliverySignupDetails", JSON.stringify({
            name: partner.name || "",
            phone: partner.phone || authData?.phone?.replace(/\D/g, "").slice(-10) || "",
            countryCode: partner.countryCode || "+91",
            email: partner.email || "",
            address: partner.address || "",
            city: partner.city || "",
            state: partner.state || "",
            vehicleType: partner.vehicleType || "bike",
            vehicleName: partner.vehicleName || "",
            vehicleNumber: partner.vehicleNumber || "",
            drivingLicenseNumber: partner.drivingLicenseNumber || "",
            panNumber: partner.panNumber || "",
            aadharNumber: partner.aadharNumber || ""
          }))
          sessionStorage.setItem("deliverySignupDocs", JSON.stringify({
            profilePhoto: partner.profilePhoto || null,
            aadharPhoto: partner.aadharPhoto || null,
            panPhoto: partner.panPhoto || null,
            drivingLicensePhoto: partner.drivingLicensePhoto || null
          }))
        }
        setIsLoading(false); setPendingMessage(data.message); setIsRejected(data.isRejected || false); setRejectionReason(data.rejectionReason || "");
        return
      }
      if (data.needsRegistration === true) {
        sessionStorage.removeItem("deliveryAuthData")
        sessionStorage.setItem("deliveryNeedsRegistration", "true")
        sessionStorage.setItem("deliverySignupDetails", JSON.stringify({ name: "", phone: phone.replace(/\D/g, "").slice(-10), countryCode: "+91" }))
        setIsLoading(false); navigate("/food/delivery/signup/details", { replace: true });
        return
      }
      const { accessToken, refreshToken, user } = data
      if (accessToken && user) {
        storeAuthData("delivery", accessToken, user, refreshToken)
        window.dispatchEvent(new Event("deliveryAuthChanged"))
        setTimeout(() => navigate("/food/delivery", { replace: true }), 500)
      }
    } catch (err) { setError(err?.response?.data?.message || "Invalid OTP."); setIsLoading(false); }
  }

  const handleSubmitName = async () => {
    if (!name.trim()) { setNameError("Name required"); return; }
    setIsLoading(true); setError(""); try {
      const response = await deliveryAPI.verifyOTP(authData?.phone, verifiedOtp, authData?.purpose || "login", name.trim(), deviceToken, activePlatform)
      const { accessToken, refreshToken, user } = response?.data?.data || response?.data || {}
      if (accessToken && user) {
        storeAuthData("delivery", accessToken, user, refreshToken)
        window.dispatchEvent(new Event("deliveryAuthChanged"))
        navigate("/food/delivery", { replace: true })
      }
    } catch (err) { setError("Failed to complete setup."); } finally { setIsLoading(false); }
  }

  const handleResend = async () => {
    if (resendTimer > 0) return
    setIsLoading(true); setError("")
    try { await deliveryAPI.sendOTP(authData?.phone, authData?.purpose || "login"); setResendTimer(60); }
    catch (err) { setError("Resend failed."); } finally { setIsLoading(false); }
    setOtp(["", "", "", ""]); setShowNameInput(false); setName(""); setVerifiedOtp("")
  }

  if (!authData) return null

  return (
    <div className="min-h-[100dvh] bg-white dark:bg-[#0A0A0B] flex flex-col font-sans overflow-hidden">
      {/* Top Branding Section - 35% height */}
      <div className="relative h-[35dvh] w-full bg-[#1A1A1A] overflow-hidden flex flex-col items-center justify-center text-white pb-8">
        {/* Subtle Decorative Elements */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[#F38F24]/5 rounded-full blur-[80px] translate-x-1/3 -translate-y-1/3"></div>
          <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-white/5 rounded-full blur-[60px] -translate-x-1/3 translate-y-1/3"></div>
        </div>

        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.6 }}
          className="relative z-10 flex flex-col items-center gap-4 px-6 text-center"
        >
          <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center border-2 border-white/25 shadow-xl mb-2 overflow-hidden p-1.5">
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
          <div className="space-y-1 text-center">
            <h1 className="font-black text-2xl tracking-tight uppercase leading-none mb-1">
              {isRejected ? "DENIED" : pendingMessage ? "PENDING" : showNameInput ? "PARTNER SETUP" : "PARTNER VERIFY"}
            </h1>
            <p className="text-white/70 text-xs font-bold uppercase tracking-wider">
              {pendingMessage ? "Verification Required" : showNameInput ? "Complete your profile" : `Sent to ${authData?.phone}`}
            </p>
          </div>
        </motion.div>
      </div>

      {/* Bottom Content Section - 65% height */}
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        className="flex-1 bg-white dark:bg-[#0A0A0B] rounded-t-[2.5rem] -mt-8 relative z-20 shadow-[0_-20px_40px_rgba(0,0,0,0.05)] px-6 pt-12 pb-6 flex flex-col"
        style={{ marginBottom: keyboardOffset > 0 ? `${keyboardOffset}px` : 0 }}
      >
        <div className="max-w-md mx-auto w-full flex flex-col h-full">
          <AnimatePresence mode="wait">
            {!pendingMessage ? (
              <motion.div
                key="input-view"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-8"
              >
                {!showNameInput ? (
                  <div className="space-y-10">
                    <div className="flex justify-center gap-4">
                      {otp.map((digit, index) => (
                        <div key={index} className="relative">
                          <input
                            ref={(el) => (inputRefs.current[index] = el)}
                            type="text" inputMode="numeric" maxLength={1} value={digit}
                            onChange={(e) => handleChange(index, e.target.value)}
                            onKeyDown={(e) => handleKeyDown(index, e)}
                            onPaste={handlePaste}
                            onFocus={() => setFocusedIndex(index)}
                            onBlur={() => setFocusedIndex(null)}
                            disabled={isLoading}
                            className={`w-14 h-16 sm:w-16 sm:h-20 text-center text-3xl font-black bg-[#F8F9FA] dark:bg-zinc-900 border-2 rounded-2xl text-[#1A1A1A] dark:text-white transition-all outline-none shadow-sm ${focusedIndex === index ? "border-[#F38F24] ring-2 ring-[#F38F24]/20" : "border-gray-200 dark:border-zinc-800"
                              }`}
                          />
                          {digit && (
                            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-[#F38F24] rounded-full" />
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="space-y-6 pt-4 text-center">
                      {resendTimer > 0 ? (
                        <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">
                          Re-pulse in <span className="text-[#F38F24]">{resendTimer}s</span>
                        </p>
                      ) : (
                        <button
                          type="button"
                          onClick={handleResend}
                          disabled={isLoading}
                          className="text-xs font-black text-[#F38F24] uppercase tracking-[0.2em] px-6 py-2 rounded-full bg-[#F38F24]/10 hover:bg-[#F38F24]/20 transition-colors"
                        >
                          Resend Pin
                        </button>
                      )}

                      <Button
                        onClick={() => navigate("/food/delivery/login")}
                        variant="ghost"
                        className="text-zinc-400 dark:text-zinc-600 font-bold text-[10px] uppercase tracking-widest hover:bg-transparent hover:text-zinc-900"
                      >
                        Abort Shift
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-8">
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-gray-700 uppercase tracking-wider ml-1">
                          Official Full Name
                        </label>
                        <div className="bg-[#F8F9FA] dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl focus-within:border-[#F38F24] focus-within:ring-1 focus-within:ring-[#F38F24] transition-all overflow-hidden">
                          <Input
                            type="text" value={name} onChange={(e) => { setName(e.target.value); setNameError(""); }}
                            placeholder="e.g. Aman Kuril"
                            className="h-14 bg-transparent border-0 ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 text-lg font-bold placeholder:text-gray-400 px-4"
                          />
                        </div>
                      </div>
                      {nameError && <p className="text-xs font-bold text-red-500 pl-2">{nameError}</p>}
                    </div>

                    <Button
                      onClick={handleSubmitName}
                      disabled={isLoading || name.trim().length < 2}
                      className="w-full h-14 bg-[#1A1A1A] hover:bg-black text-white font-bold text-base rounded-xl transition-all hover:shadow-lg disabled:opacity-50 disabled:bg-gray-200 disabled:text-gray-400"
                    >
                      {isLoading ? (
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                          <span>Initializing...</span>
                        </div>
                      ) : (
                        "Start Riding"
                      )}
                    </Button>
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="pending-view"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center space-y-8"
              >
                <div className={`w-20 h-20 mx-auto rounded-3xl flex items-center justify-center shadow-xl transform rotate-12 ${isRejected ? "bg-red-50 text-red-600 border border-red-100" : "bg-[#F8F9FA] dark:bg-zinc-900 text-[#1A1A1A] border border-gray-200 dark:border-zinc-800"}`}>
                  {isRejected ? <AlertCircle size={40} className="-rotate-12" /> : <ShieldCheck size={40} className="-rotate-12" />}
                </div>

                <div className="space-y-3">
                  <h3 className={`text-2xl font-black tracking-tight ${isRejected ? "text-red-600" : "text-[#1A1A1A]"}`}>
                    {isRejected ? "Onboarding Denied" : "Pending Approval"}
                  </h3>
                  <p className="text-sm font-medium text-gray-500 dark:text-zinc-400 leading-relaxed">
                    {pendingMessage}
                  </p>
                </div>

                {isRejected && rejectionReason && (
                  <div className="bg-red-50 dark:bg-red-900/10 p-5 rounded-2xl border border-red-100 dark:border-red-900/10">
                    <p className="text-xs font-bold text-red-500 uppercase tracking-wider mb-1">Fleet Feedback</p>
                    <p className="text-sm text-red-700 dark:text-red-400 font-medium">"{rejectionReason}"</p>
                  </div>
                )}

                <div className="pt-6 flex flex-col gap-4">
                  {isRejected && (
                    <Button
                      onClick={() => navigate("/food/delivery/signup/details", { state: { isRejected: true, rejectionReason } })}
                      className="w-full h-14 rounded-xl font-bold bg-red-600 hover:bg-red-700 text-white shadow-lg"
                    >
                      RE-APPLY NOW
                    </Button>
                  )}
                  <button
                    onClick={() => navigate("/food/delivery/login")}
                    className="text-xs font-bold text-gray-500 uppercase tracking-widest hover:text-[#1A1A1A] transition-all"
                  >
                    BACK TO BASE
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-6 flex items-center justify-center gap-2 text-xs font-bold text-red-500 bg-red-50 py-3 px-4 rounded-xl border border-red-100"
            >
              <AlertCircle size={14} />
              <span>{error}</span>
            </motion.div>
          )}

          <footer className="mt-auto pt-10 text-center pb-2">
            <p className="text-xs text-gray-400 font-medium leading-relaxed">
              Delivery Network &bull; {companyName}
            </p>
          </footer>
        </div>
      </motion.div>
    </div>
  )
}

