import { useEffect, useRef, useState } from "react"
import { useNavigate, Link } from "react-router-dom"
import { toast } from "react-hot-toast"
import { extractRawPhone } from "../../../../../utils/phone.util"
import { Loader2, AlertCircle, Eye, EyeOff } from "lucide-react"
import { Button } from "@food/components/ui/button"
import { restaurantAPI } from "@food/api"
import { useCompanyName } from "@food/hooks/useCompanyName"
import { motion, AnimatePresence } from "framer-motion"
import loginBg from "@food/assets/loginbanner.png"
import { getRestaurantLogo, loadBusinessSettings, getCachedSettings } from "@food/utils/businessSettings"
import { useSettings } from "../../../../Taxi/shared/context/SettingsContext"
import { isSellerApp, SELLER_APP_READY_EVENT } from "@food/utils/sellerApp"
import { clearModuleAuth } from "@food/utils/auth"

const DEFAULT_COUNTRY_CODE = "+91"
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function RestaurantLogin() {
  const companyName = useCompanyName()
  // How this site writes its own name ("Quick Drops"), set per build; the
  // business-settings name ("QuickDrop") otherwise.
  const brandName = import.meta.env.VITE_BRAND_NAME || companyName
  const navigate = useNavigate()
  const phoneInputRef = useRef(null)
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
  const [formData, setFormData] = useState(() => {
    const saved = sessionStorage.getItem("restaurantLoginPhone")
    return {
      phone: saved ? extractRawPhone(saved) : "",
      countryCode: DEFAULT_COUNTRY_CODE,
    }
  })
  const [error, setError] = useState("")
  const [isSending, setIsSending] = useState(false)
  const [isWebPortal, setIsWebPortal] = useState(() => !isSellerApp())
  // A restaurant without a portal password yet signs in on the web with its
  // mobile number; once an admin sets one, OTP.jsx sends it back to the password.
  const [usePhoneOnWeb, setUsePhoneOnWeb] = useState(false)
  const showPasswordForm = isWebPortal && !usePhoneOnWeb
  const [webForm, setWebForm] = useState({ email: "", password: "" })
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    const onBridgeReady = () => setIsWebPortal(false)
    window.addEventListener(SELLER_APP_READY_EVENT, onBridgeReady)
    return () => window.removeEventListener(SELLER_APP_READY_EVENT, onBridgeReady)
  }, [])

  const handleWebLogin = async (e) => {
    e?.preventDefault?.()
    const email = webForm.email.trim().toLowerCase()
    if (!EMAIL_REGEX.test(email)) {
      setError("Enter a valid email address")
      return
    }
    if (!webForm.password) {
      setError("Password is required")
      return
    }
    try {
      setIsSending(true)
      setError("")
      // A new sign-in is a different seller until proved otherwise: drop the
      // session already in this browser first. Left in place, an attempt that
      // ends without a new session (a new number sent to registration, or a
      // password holder sent back to email login) landed in the previous
      // seller's panel -- every login on a shared browser opened one outlet.
      clearModuleAuth("restaurant")
      const response = await restaurantAPI.webLoginRequestOtp(email, webForm.password)
      const data = response?.data?.data || response?.data || {}
      if (!data.ticket) throw new Error("Could not start login. Please try again.")
      sessionStorage.setItem("restaurantAuthData", JSON.stringify({
        method: "web",
        email,
        ticket: data.ticket,
        maskedPhone: data.maskedPhone || "",
        isSignUp: false,
        module: "restaurant",
      }))
      setWebForm((prev) => ({ ...prev, password: "" }))
      toast.success("OTP sent to your registered mobile number")
      navigate("/food/restaurant/otp")
    } catch (apiErr) {
      setError(apiErr?.response?.data?.message || apiErr?.response?.data?.error || apiErr?.message || "Login failed")
    } finally {
      setIsSending(false)
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

  const validatePhone = (phone) => {
    const digitsOnly = extractRawPhone(phone)
    if (!digitsOnly || digitsOnly.trim() === "") return "Phone number required"
    if (digitsOnly.length !== 10) return "Must be 10 digits"
    if (!["6", "7", "8", "9"].includes(digitsOnly[0])) return "Invalid number"
    return ""
  }

  const handlePhoneChange = (e) => {
    const value = e.target.value.replace(/\D/g, "").slice(0, 10)
    setFormData((prev) => ({ ...prev, phone: value }))
    sessionStorage.setItem("restaurantLoginPhone", value)
    if (error) setError(validatePhone(value))
  }

  const handleSendOTP = async () => {
    const phoneError = validatePhone(formData.phone)
    if (phoneError) {
      setError(phoneError)
      return
    }

    const fullPhone = `${formData.countryCode} ${extractRawPhone(formData.phone)}`.trim()

    try {
      setIsSending(true)
      clearModuleAuth("restaurant") // see handleWebLogin
      await restaurantAPI.sendOTP(fullPhone, "login")
      sessionStorage.setItem("restaurantAuthData", JSON.stringify({
        method: "phone",
        phone: fullPhone,
        isSignUp: false,
        module: "restaurant",
      }))
      navigate("/food/restaurant/otp")
    } catch (apiErr) {
      setError(apiErr?.response?.data?.error || apiErr?.response?.data?.message || "Failed to send OTP")
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className="min-h-[100dvh] lg:h-screen bg-white dark:bg-[#0A0A0B] flex flex-col lg:flex-row font-sans overflow-hidden">
      {/* Branding — a band above the form on mobile, the left half on desktop */}
      <div className="relative h-[40dvh] w-full lg:h-full lg:w-1/2 bg-[#1A1A1A] overflow-hidden flex flex-col items-center justify-center">
        {/* Desktop-only hero image behind the branding */}
        <img
          src={loginBg}
          alt=""
          aria-hidden="true"
          className="hidden lg:block absolute inset-0 h-full w-full object-cover opacity-40"
        />
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
          <div className="w-20 h-20 bg-white rounded-3xl flex items-center justify-center shadow-xl border-4 border-white/25 overflow-hidden p-2">
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
              className="w-full h-full flex items-center justify-center font-black text-2xl text-slate-800"
              style={{ display: resolvedLogo ? 'none' : 'flex' }}
            >
              {(companyName || "QD").substring(0, 2).toUpperCase()}
            </div>
          </div>
          <div className="text-center text-white">
            <h1 className="font-black text-3xl lg:text-4xl tracking-tight leading-none mb-1">
              {brandName} <span className="italic text-white">Store</span>
            </h1>
            <div className="h-0.5 w-10 bg-white/40 mx-auto rounded-full" />
          </div>

          {/* Desktop gets room for a line of context; mobile stays compact. */}
          <p className="hidden lg:block max-w-sm text-center text-sm text-white/70 leading-relaxed">
            Manage your outlet, orders and menu from a single dashboard.
          </p>
        </motion.div>
      </div>

      {/* Bottom Form Section - 60% height */}
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        className="flex-1 lg:w-1/2 lg:flex-none bg-white dark:bg-[#0A0A0B] rounded-t-[2.5rem] lg:rounded-none -mt-12 lg:mt-0 relative z-20 shadow-[0_-20px_40px_rgba(0,0,0,0.05)] lg:shadow-none px-6 lg:px-16 pt-10 lg:pt-0 pb-6 flex flex-col lg:justify-center"
        style={{ marginBottom: keyboardInset ? `${keyboardInset}px` : 0 }}
      >
        <div className="max-w-md mx-auto w-full flex flex-col h-full lg:h-auto">
          <div className="space-y-2 mb-10">
            <h2 className="text-3xl font-black text-[#1A1A1A] dark:text-white tracking-tight">
              Restaurant Portal
            </h2>
            <p className="text-sm font-medium text-gray-500">
              {showPasswordForm
                ? "Sign in with your registered email and password. We'll send an OTP to your registered mobile."
                : "Signin with your registered mobile to manage your outlet."}
            </p>
          </div>

          {showPasswordForm ? (
          <form className="space-y-6" onSubmit={handleWebLogin} noValidate>
            <div className="space-y-2">
              <label htmlFor="restaurant-email" className="text-xs font-bold text-gray-700 uppercase tracking-wider ml-1">
                Email ID
              </label>
              <input
                id="restaurant-email"
                type="email"
                autoComplete="username"
                placeholder="you@gmail.com"
                value={webForm.email}
                onChange={(e) => { setWebForm((prev) => ({ ...prev, email: e.target.value })); if (error) setError("") }}
                className="w-full h-14 bg-[#F8F9FA] dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl outline-none focus:border-[#F38F24] focus:ring-1 focus:ring-[#F38F24] placeholder:text-gray-400 text-base font-semibold px-4 text-[#1A1A1A] dark:text-white transition-all"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="restaurant-password" className="text-xs font-bold text-gray-700 uppercase tracking-wider ml-1">
                Password
              </label>
              <div className="flex items-center bg-[#F8F9FA] dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl focus-within:border-[#F38F24] focus-within:ring-1 focus-within:ring-[#F38F24] transition-all overflow-hidden">
                <input
                  id="restaurant-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={webForm.password}
                  onChange={(e) => { setWebForm((prev) => ({ ...prev, password: e.target.value })); if (error) setError("") }}
                  className="flex-1 min-w-0 h-14 bg-transparent border-0 outline-none ring-0 placeholder:text-gray-400 text-base font-semibold px-4 text-[#1A1A1A] dark:text-white"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="px-4 h-14 text-gray-500 hover:text-gray-700"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  className="flex items-center gap-1.5 text-xs font-bold text-[#0D2A6B] pl-2"
                >
                  <AlertCircle className="h-4 w-4" />
                  <span>{error}</span>
                </motion.div>
              )}
            </AnimatePresence>

            <Button
              type="submit"
              disabled={isSending || !webForm.email.trim() || !webForm.password}
              className="w-full h-14 rounded-xl font-bold text-base transition-all bg-[#1A1A1A] hover:bg-black text-white hover:shadow-lg disabled:opacity-50 disabled:bg-gray-200 disabled:text-gray-400"
            >
              {isSending ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Verifying...</span>
                </div>
              ) : (
                "Continue Securely"
              )}
            </Button>

            <p className="text-xs text-center text-gray-500 font-medium">
              No password yet?{" "}
              <button
                type="button"
                onClick={() => { setError(""); setUsePhoneOnWeb(true) }}
                className="font-bold text-[#1A1A1A] dark:text-white hover:underline"
              >
                Sign in with your mobile number
              </button>
            </p>
            <p className="text-xs text-center text-gray-500 font-medium">
              New restaurant?{" "}
              <Link to="/food/restaurant/signup" className="font-bold text-[#1A1A1A] dark:text-white hover:underline">
                Register with your mobile number
              </Link>
            </p>
          </form>
          ) : (
          <div className="space-y-8">
            <div className="space-y-4">
              <label className="text-xs font-bold text-gray-700 uppercase tracking-wider ml-1">
                Owner Contact Number
              </label>
              
              <div className="flex items-center gap-0 bg-[#F8F9FA] dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl focus-within:border-[#F38F24] focus-within:ring-1 focus-within:ring-[#F38F24] transition-all overflow-hidden group">
                <div className="flex items-center px-4 h-14 bg-transparent text-gray-500 font-semibold text-lg border-r border-gray-200 dark:border-zinc-800">
                  <span>+91</span>
                </div>
                <input
                  ref={phoneInputRef}
                  type="tel"
                  inputMode="numeric"
                  placeholder="00000 00000"
                  value={formData.phone}
                  onChange={handlePhoneChange}
                  className="flex-1 h-14 bg-transparent border-0 outline-none ring-0 placeholder:text-gray-400 text-lg font-semibold tracking-widest px-4 text-[#1A1A1A] dark:text-white"
                />
              </div>

              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    className="flex items-center gap-1.5 text-xs font-bold text-[#0D2A6B] pl-2"
                  >
                    <AlertCircle className="h-4 w-4" />
                    <span>{error}</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <Button
              onClick={handleSendOTP}
              disabled={isSending || formData.phone.length !== 10}
              className="w-full h-14 rounded-xl font-bold text-base transition-all bg-[#1A1A1A] hover:bg-black text-white hover:shadow-lg disabled:opacity-50 disabled:bg-gray-200 disabled:text-gray-400"
            >
              {isSending ? (
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                  <span>Authorizing...</span>
                </div>
              ) : (
                "Continue Securely"
              )}
            </Button>

            {isWebPortal && (
              <p className="text-xs text-center text-gray-500 font-medium">
                Have a password?{" "}
                <button
                  type="button"
                  onClick={() => { setError(""); setUsePhoneOnWeb(false) }}
                  className="font-bold text-[#1A1A1A] dark:text-white hover:underline"
                >
                  Sign in with email and password
                </button>
              </p>
            )}
          </div>
          )}

          <footer className="mt-auto pt-10 text-center">
            <p className="text-xs text-gray-400 font-medium leading-relaxed">
              Secure store login powered by<br />
              <span className="text-[#1A1A1A] font-bold">{brandName} Network</span>
            </p>
            <div className="mt-4 flex justify-center gap-4 text-xs font-bold text-[#1A1A1A]">
              <Link to="/terms?role=restaurant" className="hover:underline">Terms</Link>
              <Link to="/privacy?role=restaurant" className="hover:underline">Privacy Policy</Link>
            </div>
          </footer>
        </div>
      </motion.div>
    </div>
  )
}
