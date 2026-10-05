import { useState, useEffect, useRef } from "react"
import { useNavigate, Link } from "react-router-dom"
import { RefreshCw, AlertCircle, ShieldCheck } from "lucide-react"
import { Button } from "@food/components/ui/button"
import { restaurantAPI } from "@food/api"
import {
  setAuthData as setRestaurantAuthData,
  setRestaurantPendingPhone,
} from "@food/utils/auth"
import { checkOnboardingStatus, isRestaurantOnboardingComplete } from "@food/utils/onboardingUtils"
import { useCompanyName } from "@food/hooks/useCompanyName"
import { motion, AnimatePresence } from "framer-motion"
import loginBg from "@food/assets/loginbanner.png"
import { formatDisplayPhone } from "../../../../../utils/phone.util"
import { getRestaurantLogo, loadBusinessSettings, getCachedSettings } from "@food/utils/businessSettings"
import { useSettings } from "../../../../Taxi/shared/context/SettingsContext"

export default function RestaurantOTP() {
  const companyName = useCompanyName()
  const navigate = useNavigate()
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

  const [otp, setOtp] = useState(["", "", "", ""])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [resendTimer, setResendTimer] = useState(0)
  const [authData, setAuthData] = useState(null)
  const [contactInfo, setContactInfo] = useState("") 
  const [focusedIndex, setFocusedIndex] = useState(null)
  const [keyboardOffset, setKeyboardOffset] = useState(0)
  const [pendingMessage, setPendingMessage] = useState("")
  const [isRejected, setIsRejected] = useState(false)
  const [rejectionReason, setRejectionReason] = useState("")
  const inputRefs = useRef([])
  const hasSubmittedRef = useRef(false)
  const otpSectionRef = useRef(null)

  useEffect(() => {
    const stored = sessionStorage.getItem("restaurantAuthData")
    if (stored) {
      const data = JSON.parse(stored)
      setAuthData(data)
      if (data.method === "email" && data.email) {
        setContactInfo(data.email)
      } else if (data.phone) {
        const phoneMatch = data.phone?.match(/(\+\d+)\s*(.+)/)
        setContactInfo(phoneMatch ? `${phoneMatch[1]} ${phoneMatch[2].replace(/\D/g, "")}` : (data.phone || ""))
      }
    } else {
      navigate("/food/restaurant/login")
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
    if (otp.every(d => d !== "") && otp.join("").length === 4 && !hasSubmittedRef.current) {
      handleVerify(otp.join(""))
    }
  }, [otp])

  useEffect(() => {
    if (inputRefs.current[0]) inputRefs.current[0].focus()
  }, [])

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

  const handleChange = (index, value) => {
    if (value && !/^\d$/.test(value)) return
    const newOtp = [...otp]
    newOtp[index] = value
    setOtp(newOtp)
    setError("")

    if (value && index < 3) {
      inputRefs.current[index + 1]?.focus()
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
    digits.forEach((digit, i) => { if (i < 4) newOtp[i] = digit })
    setOtp(newOtp)
    if (digits.length === 4) {
      inputRefs.current[3]?.focus()
    } else {
      inputRefs.current[digits.length]?.focus()
    }
  }

  const handleVerify = async (otpValue = null) => {
    const code = otpValue || otp.join("")
    /*
     * One verification per code, whichever path asks for it.
     *
     * The ref was never set to true anywhere, so this guard could not block
     * anything, and the auto-submit effect below was additionally exempted by
     * `&& !otpValue` -- which is the path it actually fires through. A verified
     * OTP is deleted server-side, being single-use, so the first request
     * succeeded and every repeat came back 401 "OTP not found". The logs show
     * three calls for one login: a 200 from the OTP screen, then two 401s
     * referred from the page it had already navigated to.
     */
    if (hasSubmittedRef.current) return
    if (code.length !== 4) {
      setError("Please enter the complete 4-digit code")
      hasSubmittedRef.current = false
      return
    }

    hasSubmittedRef.current = true
    setIsLoading(true)
    setError("")

    try {
      if (!authData) throw new Error("Session expired.")
      const phone = authData.method === "phone" ? authData.phone : null
      const email = authData.method === "email" ? authData.email : null
      const purpose = authData.isSignUp ? "register" : "login"

      const response = await restaurantAPI.verifyOTP(phone, code, purpose, null, email)
      const data = response?.data?.data || response?.data
      const needsRegistration = data?.needsRegistration === true
      const normalizedPhone = data?.phone || phone

      if (data?.pendingApproval === true) {
        setIsLoading(false)
        setPendingMessage(data.message)
        setIsRejected(data.isRejected || false)
        setRejectionReason(data.rejectionReason || "")
        if (data.isRejected) {
          setRestaurantPendingPhone(data.phone || phone)
          if (data.restaurant) {
            try {
              sessionStorage.setItem("rejectedRestaurantData", JSON.stringify(data.restaurant))
            } catch (e) {
              console.error("Error storing rejectedRestaurantData:", e)
            }
          }
        }
        return
      }

      if (needsRegistration) {
        setRestaurantPendingPhone(normalizedPhone)
        sessionStorage.removeItem("restaurantAuthData")
        sessionStorage.removeItem("restaurantLoginPhone")
        navigate("/food/restaurant/onboarding", { replace: true })
        return
      }

      const accessToken = data?.accessToken
      const refreshToken = data?.refreshToken ?? null
      const restaurant = data?.user ?? data?.restaurant

      if (accessToken && restaurant) {
        setRestaurantAuthData("restaurant", accessToken, restaurant, refreshToken)
        window.dispatchEvent(new Event("restaurantAuthChanged"))
        sessionStorage.removeItem("restaurantAuthData")
        sessionStorage.removeItem("restaurantLoginPhone")

        setTimeout(async () => {
          if (authData?.isSignUp) {
            navigate("/food/restaurant/onboarding", { replace: true })
          } else {
            try {
              if (!isRestaurantOnboardingComplete(restaurant)) {
                const incompleteStep = await checkOnboardingStatus()
                if (incompleteStep) {
                  navigate(`/food/restaurant/onboarding?step=${incompleteStep}`, { replace: true })
                  return
                }
              }
              navigate("/food/restaurant", { replace: true })
            } catch (err) { navigate("/food/restaurant", { replace: true }) }
          }
        }, 500)
      }
    } catch (err) {
      const message = err?.response?.data?.message || err?.response?.data?.error || err?.message || "Invalid OTP."
      if (/pending approval/i.test(message)) {
        const pendingPhone = authData?.phone || authData?.email || contactInfo
        if (pendingPhone) setRestaurantPendingPhone(pendingPhone)
        sessionStorage.removeItem("restaurantAuthData")
        sessionStorage.removeItem("restaurantLoginPhone")
        navigate("/food/restaurant/pending-verification", {
          replace: true, state: { phone: pendingPhone || "" },
        })
        return
      }
      setError(message)
      setOtp(["", "", "", ""])
      hasSubmittedRef.current = false
      inputRefs.current[0]?.focus()
    } finally { setIsLoading(false) }
  }

  const handleResend = async () => {
    if (resendTimer > 0) return
    setIsLoading(true)
    setError("")
    try {
      if (!authData) throw new Error("Session expired.")
      const purpose = authData.isSignUp ? "register" : "login"
      const phone = authData.method === "phone" ? authData.phone : null
      const email = authData.method === "email" ? authData.email : null
      await restaurantAPI.sendOTP(phone, purpose, email)
      setResendTimer(60)
    } catch (err) { setError("Failed to resend OTP.") }
    setIsLoading(false)
    // A resend issues a new code, so the one-submission-per-code guard has to
    // reopen -- otherwise the first attempt latches it and the fresh code can
    // never be submitted.
    hasSubmittedRef.current = false
    setOtp(["", "", "", ""])
    inputRefs.current[0]?.focus()
  }

  if (!authData) return null

  return (
    <div className="min-h-[100dvh] lg:h-screen bg-white dark:bg-[#0A0A0B] flex flex-col lg:flex-row font-sans overflow-hidden">
      {/* Top / Left Branding Section */}
      <div className="relative h-[35dvh] lg:h-full w-full lg:w-1/2 bg-[#1A1A1A] overflow-hidden flex flex-col items-center justify-center pb-8 lg:pb-0">
        {/* Desktop-only hero image behind the branding */}
        <img
          src={loginBg}
          alt=""
          aria-hidden="true"
          className="hidden lg:block absolute inset-0 h-full w-full object-cover opacity-40"
        />
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
          <div className="w-16 h-16 lg:w-20 lg:h-20 bg-white rounded-2xl lg:rounded-3xl flex items-center justify-center border border-white/25 shadow-lg mb-2 overflow-hidden p-1.5 lg:p-2">
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
              className="w-full h-full flex items-center justify-center font-black text-xl lg:text-2xl text-slate-800"
              style={{ display: resolvedLogo ? 'none' : 'flex' }}
            >
              {(companyName || "QD").substring(0, 2).toUpperCase()}
            </div>
          </div>
          <div className="space-y-1">
            <h1 className="text-white font-black text-3xl lg:text-4xl tracking-tight leading-none italic">
              SECURITY CHECK
            </h1>
            <p className="text-white/70 text-xs lg:text-sm font-bold uppercase tracking-[0.2em]">
              Sent to {contactInfo}
            </p>
          </div>
          <p className="hidden lg:block max-w-sm text-center text-sm text-white/70 leading-relaxed mt-2">
            Enter the verification code sent to your registered contact to securely access your restaurant dashboard.
          </p>
        </motion.div>
      </div>

      {/* Bottom / Right Content Section */}
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        className="flex-1 lg:w-1/2 lg:flex-none bg-white dark:bg-[#0A0A0B] rounded-t-[2.5rem] lg:rounded-none -mt-10 lg:mt-0 relative z-20 shadow-[0_-20px_40px_rgba(0,0,0,0.05)] lg:shadow-none px-6 lg:px-16 pt-12 lg:pt-0 pb-6 flex flex-col lg:justify-center overflow-y-auto"
        style={{ marginBottom: keyboardOffset > 0 ? `${keyboardOffset}px` : 0 }}
      >
        <div className="max-w-md mx-auto w-full flex flex-col h-full lg:h-auto">
          {/* Desktop-only header */}
          <div className="hidden lg:block space-y-2 mb-8">
            <h2 className="text-3xl font-black text-[#1A1A1A] dark:text-white tracking-tight">
              Verify Security Code
            </h2>
            <p className="text-sm font-medium text-gray-500">
              Enter the 4-digit code sent to{" "}
              <span className="text-[#1A1A1A] dark:text-zinc-200 font-semibold">{contactInfo}</span>
            </p>
          </div>

          <AnimatePresence mode="wait">
            {!pendingMessage ? (
              <motion.div
                key="input-view"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-10"
              >
                <div ref={otpSectionRef} className="flex justify-center gap-4">
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
                        onPaste={handlePaste}
                        onFocus={() => setFocusedIndex(index)}
                        onBlur={() => setFocusedIndex(null)}
                        disabled={isLoading}
                        className={`w-16 h-16 text-center text-3xl font-black bg-[#F8F9FA] dark:bg-zinc-900 border rounded-xl text-[#1A1A1A] dark:text-white transition-all outline-none shadow-sm ${
                          focusedIndex === index ? "border-[#F38F24] ring-1 ring-[#F38F24] shadow-[#F38F24]/10" : "border-gray-200"
                        }`}
                      />
                      {digit && (
                        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-[#F38F24] rounded-full" />
                      )}
                    </motion.div>
                  ))}
                </div>

                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center justify-center gap-2 text-xs font-bold text-red-500 bg-red-50 py-4 px-4 rounded-xl border border-red-100"
                  >
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{error}</span>
                  </motion.div>
                )}

                <div className="space-y-6 pt-4">
                  <Button
                    onClick={() => handleVerify()}
                    disabled={isLoading || otp.some(d => !d)}
                    className="w-full h-14 bg-[#1A1A1A] hover:bg-black text-white font-bold text-base rounded-xl transition-all hover:shadow-lg disabled:opacity-50 disabled:bg-gray-200 disabled:text-gray-400"
                  >
                    {isLoading ? (
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                        <span>Validating...</span>
                      </div>
                    ) : (
                      "Unlock Portal"
                    )}
                  </Button>

                  <div className="flex justify-center flex-col items-center gap-4">
                    {resendTimer > 0 ? (
                      <p className="text-sm font-medium text-gray-400">
                        Request new code in <span className="text-[#F38F24] font-semibold">{resendTimer}s</span>
                      </p>
                    ) : (
                      <button
                        type="button"
                        onClick={handleResend}
                        disabled={isLoading}
                        className="text-sm font-semibold text-[#F38F24] hover:text-[#d97716] transition-colors"
                      >
                        Resend OTP
                      </button>
                    )}

                    <Button
                      onClick={() => navigate("/food/restaurant/login")}
                      variant="ghost"
                      className="text-gray-400 font-medium text-xs hover:bg-transparent hover:text-[#1A1A1A]"
                    >
                      Change Account
                    </Button>
                  </div>
                </div>
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
                     {isRejected ? "Registration Denied" : "Pending Approval"}
                  </h3>
                  <p className="text-sm font-medium text-gray-500 dark:text-zinc-400 leading-relaxed">
                     {pendingMessage}
                  </p>
                </div>

                {isRejected && rejectionReason && (
                   <div className="bg-red-50 dark:bg-red-900/10 p-5 rounded-2xl border border-red-100 dark:border-red-900/10">
                      <p className="text-xs font-bold text-red-500 uppercase tracking-wider mb-1">Feedback</p>
                      <p className="text-sm text-red-700 dark:text-red-400 font-medium">"{rejectionReason}"</p>
                   </div>
                )}

                <div className="pt-6 flex flex-col gap-4">
                   {isRejected && (
                      <Button
                        onClick={() => {
                          try {
                            const rawData = sessionStorage.getItem("rejectedRestaurantData")
                            if (rawData) {
                              const r = JSON.parse(rawData)
                              const mapped = {
                                step1: {
                                  restaurantName: r.restaurantName || "",
                                  pureVegRestaurant: typeof r.pureVegRestaurant === 'boolean' ? r.pureVegRestaurant : null,
                                  ownerName: r.ownerName || "",
                                  ownerEmail: r.ownerEmail || "",
                                  ownerPhone: formatDisplayPhone(r.ownerPhone || contactInfo || ""),
                                  primaryContactNumber: formatDisplayPhone(r.primaryContactNumber || ""),
                                  zoneId: r.zoneId || "",
                                  location: {
                                    formattedAddress: r.location?.formattedAddress || r.location?.address || "",
                                    addressLine1: r.location?.addressLine1 || r.addressLine1 || "",
                                    addressLine2: r.location?.addressLine2 || r.addressLine2 || "",
                                    area: r.location?.area || r.area || "",
                                    city: r.location?.city || r.city || "",
                                    state: r.location?.state || r.state || "",
                                    pincode: r.location?.pincode || r.pincode || "",
                                    landmark: r.location?.landmark || r.landmark || "",
                                    latitude: r.location?.latitude || (r.location?.coordinates ? r.location.coordinates[1] : ""),
                                    longitude: r.location?.longitude || (r.location?.coordinates ? r.location.coordinates[0] : "")
                                  }
                                },
                                step2: {
                                  menuImages: r.menuImages || [],
                                  profileImage: r.profileImage || null,
                                  cuisines: r.cuisines || [],
                                  estimatedDeliveryTime: r.estimatedDeliveryTime || "",
                                  openingTime: r.openingTime || "",
                                  closingTime: r.closingTime || "",
                                  openDays: r.openDays || []
                                },
                                step3: {
                                  panNumber: r.panNumber || "",
                                  nameOnPan: r.nameOnPan || "",
                                  panImage: r.panImage || null,
                                  gstRegistered: typeof r.gstRegistered === 'boolean' ? r.gstRegistered : false,
                                  gstNumber: r.gstNumber || "",
                                  gstLegalName: r.gstLegalName || "",
                                  gstAddress: r.gstAddress || "",
                                  gstImage: r.gstImage || null,
                                  fssaiNumber: r.fssaiNumber || "",
                                  fssaiExpiry: r.fssaiExpiry ? String(r.fssaiExpiry).split("T")[0] : "",
                                  fssaiImage: r.fssaiImage || null,
                                  accountNumber: r.accountNumber || "",
                                  confirmAccountNumber: r.accountNumber || "",
                                  ifscCode: r.ifscCode || "",
                                  accountHolderName: r.accountHolderName || "",
                                  accountType: r.accountType || ""
                                },
                                currentStep: 1,
                                timestamp: Date.now()
                              }
                              localStorage.setItem("restaurant_onboarding_data", JSON.stringify(mapped))
                            }
                          } catch (e) {
                            console.error("Error setting onboarding local storage:", e)
                          }
                          navigate("/food/restaurant/onboarding", { replace: true, state: { phone: contactInfo || authData?.phone || authData?.email || "", isRejected: true, rejectionReason } })
                        }}
                        className="w-full h-14 rounded-xl font-bold bg-red-600 hover:bg-red-700 text-white shadow-lg"
                      >
                        RE-APPLY NOW
                      </Button>
                   )}
                   <button 
                    onClick={() => navigate("/food/restaurant/login")} 
                    className="text-xs font-bold text-gray-500 uppercase tracking-widest hover:text-[#1A1A1A] transition-all"
                   >
                    BACK TO LOGIN
                   </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <footer className="mt-auto pt-10 text-center">
            <p className="text-xs text-gray-400 font-medium leading-relaxed">
              Partner Security Network &bull; <span className="text-[#1A1A1A] dark:text-zinc-300 font-bold">{companyName.toUpperCase()}</span>
            </p>
            <div className="mt-4 flex justify-center gap-4 text-xs font-bold text-[#1A1A1A] dark:text-zinc-300">
              <Link to="/terms?role=restaurant" className="hover:underline">Terms</Link>
              <Link to="/privacy?role=restaurant" className="hover:underline">Privacy Policy</Link>
            </div>
          </footer>
        </div>
      </motion.div>
    </div>
  )
}
