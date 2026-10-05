import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Loader2, AlertCircle, User, Phone } from "lucide-react"
import { Button } from "@food/components/ui/button"
import { restaurantAPI } from "@food/api"
import { useCompanyName } from "@food/hooks/useCompanyName"
import { motion, AnimatePresence } from "framer-motion"
import { getRestaurantLogo, loadBusinessSettings, getCachedSettings } from "@food/utils/businessSettings"
import { useSettings } from "../../../../Taxi/shared/context/SettingsContext"

const DEFAULT_COUNTRY_CODE = "+91"

export default function RestaurantSignup() {
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

  const [formData, setFormData] = useState({
    phone: "",
    countryCode: "+91",
    name: "",
  })
  const [errors, setErrors] = useState({
    phone: "",
    name: "",
  })
  const [isLoading, setIsLoading] = useState(false)
  const [apiError, setApiError] = useState("")
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
    if (!phone || phone.trim() === "") return "Phone number required"
    const digitsOnly = phone.replace(/\D/g, "")
    if (digitsOnly.length !== 10) return "Must be 10 digits"
    if (!["6", "7", "8", "9"].includes(digitsOnly[0])) return "Invalid number"
    return ""
  }

  const validateName = (name) => {
    if (!name.trim()) return "Restaurant name is required"
    if (name.trim().length < 2) return "Must be at least 2 characters"
    if (name.trim().length > 50) return "Must be less than 50 characters"
    return ""
  }

  const handlePhoneChange = (e) => {
    const value = e.target.value.replace(/\D/g, "").slice(0, 10)
    setFormData((prev) => ({ ...prev, phone: value }))
    if (errors.phone) setErrors((prev) => ({ ...prev, phone: validatePhone(value) }))
  }

  const handleNameChange = (e) => {
    const value = e.target.value
    setFormData((prev) => ({ ...prev, name: value }))
    if (errors.name) setErrors((prev) => ({ ...prev, name: validateName(value) }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setIsLoading(true)
    setApiError("")

    // Validate
    let hasErrors = false
    const newErrors = { phone: "", name: "" }

    const phoneError = validatePhone(formData.phone)
    newErrors.phone = phoneError
    if (phoneError) hasErrors = true

    const nameError = validateName(formData.name)
    newErrors.name = nameError
    if (nameError) hasErrors = true

    setErrors(newErrors)

    if (hasErrors) {
      setIsLoading(false)
      return
    }

    const fullPhone = `${formData.countryCode} ${formData.phone}`.trim()

    try {
      await restaurantAPI.sendOTP(fullPhone, "register")
      const authData = {
        method: "phone",
        phone: fullPhone,
        name: formData.name,
        isSignUp: true,
        module: "restaurant",
      }
      sessionStorage.setItem("restaurantAuthData", JSON.stringify(authData))
      navigate("/food/restaurant/otp")
    } catch (error) {
      setApiError(error?.response?.data?.message || error?.response?.data?.error || "Failed to send OTP.")
    } finally {
      setIsLoading(false)
    }
  }

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
              Register Your Restaurant
            </h2>
            <p className="text-sm font-medium text-gray-500">
              Enter your details to get started.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-4">
              <label className="text-xs font-bold text-gray-700 uppercase tracking-wider ml-1">
                Restaurant Name
              </label>
              <div className="flex items-center gap-0 bg-[#F8F9FA] dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl focus-within:border-[#F38F24] focus-within:ring-1 focus-within:ring-[#F38F24] transition-all overflow-hidden group">
                <div className="flex items-center px-4 h-14 bg-transparent text-gray-400">
                  <User size={20} className="group-focus-within:text-[#F38F24] transition-colors" />
                </div>
                <input
                  type="text"
                  name="name"
                  placeholder="Enter restaurant name"
                  value={formData.name}
                  onChange={handleNameChange}
                  className="flex-1 h-14 bg-transparent border-0 outline-none ring-0 placeholder:text-gray-400 text-base font-semibold px-2 text-[#1A1A1A] dark:text-white"
                />
              </div>
              <AnimatePresence>
                {errors.name && (
                  <motion.div
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    className="flex items-center gap-1.5 text-xs font-bold text-red-500 pl-2"
                  >
                    <AlertCircle className="h-4 w-4" />
                    <span>{errors.name}</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="space-y-4">
              <label className="text-xs font-bold text-gray-700 uppercase tracking-wider ml-1">
                Owner Contact Number
              </label>
              <div className="flex items-center gap-0 bg-[#F8F9FA] dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl focus-within:border-[#F38F24] focus-within:ring-1 focus-within:ring-[#F38F24] transition-all overflow-hidden group">
                <div className="flex items-center px-4 h-14 bg-transparent text-gray-500 font-semibold text-lg border-r border-gray-200 dark:border-zinc-800">
                  <span>+91</span>
                </div>
                <input
                  type="tel"
                  maxLength={10}
                  inputMode="numeric"
                  placeholder="00000 00000"
                  value={formData.phone}
                  onChange={handlePhoneChange}
                  className="flex-1 h-14 bg-transparent border-0 outline-none ring-0 placeholder:text-gray-400 text-lg font-semibold tracking-widest px-4 text-[#1A1A1A] dark:text-white"
                />
              </div>

              <AnimatePresence>
                {(errors.phone || apiError) && (
                  <motion.div
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    className="flex items-center gap-1.5 text-xs font-bold text-red-500 pl-2"
                  >
                    <AlertCircle className="h-4 w-4" />
                    <span>{errors.phone || apiError}</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <Button
              type="submit"
              disabled={isLoading || formData.phone.length !== 10 || formData.name.length < 2}
              className="w-full h-14 rounded-xl font-bold text-base transition-all bg-[#1A1A1A] hover:bg-black text-white hover:shadow-lg disabled:opacity-50 disabled:bg-gray-200 disabled:text-gray-400 mt-4"
            >
              {isLoading ? (
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                  <span>Sending OTP...</span>
                </div>
              ) : (
                "Send OTP"
              )}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <span className="text-sm font-medium text-gray-500">Already have an account? </span>
            <button
              type="button"
              onClick={() => navigate("/food/restaurant/login")}
              className="text-sm font-bold text-[#1A1A1A] hover:text-[#F38F24] transition-colors"
            >
              Login
            </button>
          </div>

          <footer className="mt-auto pt-8 text-center">
            <p className="text-xs text-gray-400 font-medium leading-relaxed">
              Secure partner signup powered by<br />
              <span className="text-[#1A1A1A] font-bold">{companyName} Network</span>
            </p>
          </footer>
        </div>
      </motion.div>
    </div>
  )
}
