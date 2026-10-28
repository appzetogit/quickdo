import { useState, useEffect } from "react"
import { useNavigate, Link, useSearchParams } from "react-router-dom"
import { Phone, User, AlertCircle, Loader2, Truck, ArrowLeft } from "lucide-react"
import { Button } from "@food/components/ui/button"
import { deliveryAPI } from "@food/api"
import { clearModuleAuth } from "@food/utils/auth"
import { useCompanyName } from "@food/hooks/useCompanyName"
import { motion, AnimatePresence } from "framer-motion"
import { getDeliveryPartnerLogo, loadBusinessSettings, getCachedSettings } from "@food/utils/businessSettings"
import { useSettings } from "../../../Taxi/shared/context/SettingsContext"

const countryCodes = [
  { code: "+91", country: "IN", flag: "🇮🇳" },
]

export default function DeliverySignup() {
  const companyName = useCompanyName()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
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

  // Redirect to home if already authenticated
  useEffect(() => {
    const isAuthenticated = localStorage.getItem("delivery_authenticated") === "true"
    if (isAuthenticated) {
      navigate("/food/delivery", { replace: true })
    }
  }, [navigate])

  // Pre-fill form from sessionStorage if data exists (e.g., when coming back from OTP)
  useEffect(() => {
    const stored = sessionStorage.getItem("deliveryAuthData")
    if (stored) {
      try {
        const data = JSON.parse(stored)
        if (data.phone) {
          // Extract digits after +91
          const phoneDigits = data.phone.replace("+91", "").trim()
          setFormData(prev => ({
            ...prev,
            phone: phoneDigits,
            name: data.name || prev.name
          }))
        }
      } catch (err) {
        debugError("Error parsing stored auth data:", err)
      }
    }
  }, [])

  const validatePhone = (phone) => {
    if (!phone.trim()) {
      return "Phone number is required"
    }
    const cleanPhone = phone.replace(/[\s\-\(\)]/g, "")
    const phoneRegex = /^\d{10}$/
    if (!phoneRegex.test(cleanPhone)) {
      return "Phone number must be exactly 10 digits"
    }
    return ""
  }

  const validateName = (name) => {
    if (!name.trim()) {
      return "Name is required"
    }
    if (name.trim().length < 2) {
      return "Name must be at least 2 characters"
    }
    if (name.trim().length > 50) {
      return "Name must be less than 50 characters"
    }
    const nameRegex = /^[a-zA-Z\s'-]+$/
    if (!nameRegex.test(name.trim())) {
      return "Name can only contain letters, spaces, hyphens, and apostrophes"
    }
    return ""
  }

  const handleChange = (e) => {
    let { name, value } = e.target

    // Only allow numbers for phone field and limit to 10 digits
    if (name === "phone") {
      value = value.replace(/\D/g, "").slice(0, 10)
    }

    setFormData({
      ...formData,
      [name]: value,
    })

    // Real-time validation
    if (name === "phone") {
      setErrors({ ...errors, phone: validatePhone(value) })
    } else if (name === "name") {
      setErrors({ ...errors, name: validateName(value) })
    }
  }

  const handleCountryCodeChange = (value) => {
    setFormData({
      ...formData,
      countryCode: value,
    })
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

    try {
      // Backend: delivery partner must register first (details + documents), then login with OTP.
      // Save name + phone for Step1 (details) and go to registration form.
      const signupDetails = {
        name: formData.name.trim(),
        phone: formData.phone.trim(),
        countryCode: formData.countryCode || "+91",
        ref: String(searchParams.get("ref") || "").trim() || undefined,
      }
      sessionStorage.setItem("deliverySignupDetails", JSON.stringify(signupDetails))
      clearModuleAuth("delivery")

      navigate("/food/delivery/signup/details")
    } catch (error) {
      const message =
        error?.response?.data?.message ||
        error?.response?.data?.error ||
        "Failed to send OTP. Please try again."
      setApiError(message)
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
              Create Your Account
            </h2>
            <p className="text-sm font-medium text-gray-500">
              Enter your details to start your delivery journey.
            </p>
          </div>

          <div className="space-y-6 flex-1">
            <AnimatePresence>
              {apiError && (
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  className="flex items-center gap-1.5 text-xs font-bold text-red-500 bg-red-50 py-3 px-4 rounded-xl border border-red-100"
                >
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{apiError}</span>
                </motion.div>
              )}
            </AnimatePresence>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-4">
                <label className="text-xs font-bold text-gray-700 uppercase tracking-wider ml-1">
                  Full Name
                </label>
                <div className={`flex items-center gap-0 bg-[#F8F9FA] dark:bg-zinc-900 border ${errors.name ? 'border-red-500' : 'border-gray-200 dark:border-zinc-800'} rounded-xl focus-within:border-[#F38F24] focus-within:ring-1 focus-within:ring-[#F38F24] transition-all overflow-hidden group h-14`}>
                  <div className="flex items-center px-4 bg-transparent text-gray-400">
                    <User size={20} className="group-focus-within:text-[#F38F24] transition-colors" />
                  </div>
                  <input
                    id="name"
                    name="name"
                    type="text"
                    placeholder="Enter your full name"
                    value={formData.name}
                    onChange={handleChange}
                    className="flex-1 bg-transparent border-0 outline-none ring-0 placeholder:text-gray-400 text-base font-semibold px-2 text-[#1A1A1A] dark:text-white h-full"
                    required
                  />
                </div>
                {errors.name && (
                  <p className="text-xs font-bold text-red-500 ml-1">{errors.name}</p>
                )}
              </div>

              <div className="space-y-4">
                <label className="text-xs font-bold text-gray-700 uppercase tracking-wider ml-1">
                  Mobile Number
                </label>
                <div className={`flex items-center gap-0 bg-[#F8F9FA] dark:bg-zinc-900 border ${errors.phone ? 'border-red-500' : 'border-gray-200 dark:border-zinc-800'} rounded-xl focus-within:border-[#F38F24] focus-within:ring-1 focus-within:ring-[#F38F24] transition-all overflow-hidden h-14`}>
                  <div className="px-5 border-r border-gray-200 dark:border-zinc-800 bg-transparent text-[#1A1A1A] dark:text-white font-black text-lg h-full flex items-center">
                    +91
                  </div>
                  <input
                    id="phone"
                    name="phone"
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    placeholder="Enter 10-digit number"
                    value={formData.phone}
                    onChange={handleChange}
                    className="flex-1 bg-transparent border-0 outline-none ring-0 placeholder:text-gray-400 text-lg font-black tracking-widest px-5 text-[#1A1A1A] dark:text-white h-full"
                    required
                  />
                </div>
                {errors.phone && (
                  <p className="text-xs font-bold text-red-500 ml-1">{errors.phone}</p>
                )}
              </div>

              <Button
                type="submit"
                disabled={isLoading}
                className="w-full h-14 mt-4 rounded-xl font-bold text-base transition-all bg-[#1A1A1A] hover:bg-black text-white hover:shadow-lg disabled:opacity-50 disabled:bg-gray-200 disabled:text-gray-400"
              >
                {isLoading ? (
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                    <span>Creating...</span>
                  </div>
                ) : (
                  "Continue to Details"
                )}
              </Button>
            </form>
          </div>

          <div className="mt-6 pt-4 border-t border-gray-100 flex flex-col items-center gap-4">
            <button
              onClick={() => navigate("/food/delivery/login")}
              className="flex items-center gap-2 text-sm font-bold text-[#1A1A1A] hover:text-[#F38F24] transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to login
            </button>
            <p className="text-xs text-gray-400 font-medium text-center leading-relaxed">
              By continuing you agree to the<br />
              <Link to="/food/delivery/terms" className="text-[#1A1A1A] font-bold">Terms and Conditions</Link>
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  )
}


