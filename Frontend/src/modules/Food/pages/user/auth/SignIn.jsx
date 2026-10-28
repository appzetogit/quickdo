import { useState, useEffect, useRef } from "react"
import { useNavigate, Link, useSearchParams } from "react-router-dom"
import { AlertCircle, Loader2 } from "lucide-react"
import AnimatedPage from "@food/components/user/AnimatedPage"
import { Button } from "@food/components/ui/button"
import { Input } from "@food/components/ui/input"
import { authAPI } from "@food/api"
import { useCompanyName } from "@food/hooks/useCompanyName"
import { motion } from "framer-motion"
import { getDynamicLogo, loadBusinessSettings, getCachedSettings } from "@food/utils/businessSettings"
import { useSettings } from "../../../../Taxi/shared/context/SettingsContext"

export default function SignIn() {
  const navigate = useNavigate()
  const companyName = useCompanyName()
  const [searchParams] = useSearchParams()
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

  const [formData, setFormData] = useState({
    phone: "",
    countryCode: "+91", // required; default +91 for India
  })

  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const submittingRef = useRef(false)

  useEffect(() => {
    const stored = sessionStorage.getItem("userAuthData")
    if (!stored) return

    try {
      const data = JSON.parse(stored)
      const fullPhone = String(data.phone || "").trim()
      const phoneDigits = fullPhone.replace(/^\+91\s*/, "").replace(/\D/g, "").slice(0, 10)

      setFormData((prev) => ({
        ...prev,
        phone: phoneDigits || prev.phone,
      }))
    } catch (err) {
      debugError("Error parsing stored auth data:", err)
    }
  }, [])

  const validatePhone = (phone) => {
    if (!phone.trim()) return "Phone number is required"
    const cleanPhone = phone.replace(/\D/g, "")
    if (!/^\d{10}$/.test(cleanPhone)) return "Phone number must be exactly 10 digits"
    return ""
  }

  const handleChange = (e) => {
    const { name } = e.target
    let { value } = e.target

    if (name === "phone") {
      value = value.replace(/\D/g, "").slice(0, 10)
      setError(validatePhone(value))
    }

    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const phoneError = validatePhone(formData.phone)
    setError(phoneError)
    if (phoneError) return
    if (submittingRef.current) return
    submittingRef.current = true
    setIsLoading(true)
    setError("")

    try {
      const countryCode = formData.countryCode?.trim() || "+91"
      const phoneDigits = String(formData.phone ?? "").replace(/\D/g, "").slice(0, 10)
      if (phoneDigits.length !== 10) {
        setError("Phone number must be exactly 10 digits")
        setIsLoading(false)
        submittingRef.current = false
        return
      }
      const fullPhone = `${countryCode} ${phoneDigits}`
      const response = await authAPI.sendOTP(fullPhone, "login", null)
      const responseData = response?.data?.data || response?.data || {}

      const ref = String(searchParams.get("ref") || "").trim()
      const authData = {
        method: "phone",
        phone: fullPhone,
        email: null,
        name: null,
        referralCode: ref || null,
        isSignUp: false,
        expectedNewUser: responseData?.isExistingUser === false || responseData?.needsNamePrompt === true,
        module: "user",
      }

      sessionStorage.setItem("userAuthData", JSON.stringify(authData))
      navigate("/food/user/auth/otp")
    } catch (apiError) {
      const message =
        apiError?.response?.data?.message ||
        apiError?.response?.data?.error ||
        "Failed to send OTP. Please try again."
      setError(message)
    } finally {
      setIsLoading(false)
      submittingRef.current = false
    }
  }

  return (
    <AnimatedPage className="min-h-[100dvh] bg-white dark:bg-[#0A0A0B] flex flex-col font-sans overflow-hidden">
      {/* Top Branding Section - 40% height */}
      <div className="relative h-[40dvh] w-full bg-gradient-to-br from-[#07143A] via-[#0D2A6B] to-[#133A8A] overflow-hidden flex flex-col items-center justify-center">
        {/* Subtle Decorative Elements (No Blur) */}
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-0 right-0 w-64 h-64 border-word border-white/20 rounded-full -mr-20 -mt-20" />
          <div className="absolute bottom-0 left-0 w-48 h-48 border border-white/10 rounded-full -ml-16 -mb-16" />
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
          <div className="text-center">
            <h1 className="text-white font-black text-4xl tracking-tighter leading-none mb-1 italic">
              {companyName.toUpperCase()}
            </h1>
            <div className="h-0.5 w-12 bg-[#A7E300] mx-auto rounded-full" />
          </div>
        </motion.div>
      </div>

      {/* Bottom Form Section - 60% height, slightly overlapping */}
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        className="flex-1 bg-white dark:bg-[#0A0A0B] rounded-t-[40px] -mt-10 relative z-20 shadow-[0_-20px_40px_rgba(0,0,0,0.05)] px-6 pt-10 pb-6 flex flex-col"
      >
        <div className="max-w-md mx-auto w-full flex flex-col h-full">
          <div className="space-y-2 mb-10">
            <h2 className="text-2xl font-black text-zinc-900 dark:text-white tracking-tight">
              Get Started
            </h2>
            <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
              Enter your mobile number to continue.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-8">
            <div className="space-y-4">
              <div className="relative group transition-all duration-300">
                <div className="flex items-center gap-0 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl focus-within:border-[#0D2A6B]/50 focus-within:ring-4 focus-within:ring-[#0D2A6B]/5 transition-all overflow-hidden">
                  <div className="flex items-center px-4 h-16 bg-zinc-50 dark:bg-zinc-800/50 text-zinc-900 dark:text-white font-black text-lg border-r border-zinc-200 dark:border-zinc-800">
                    <span>+91</span>
                  </div>
                  <Input
                    id="phone"
                    name="phone"
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    placeholder="Mobile Number"
                    value={formData.phone}
                    onChange={handleChange}
                    className="flex-1 h-16 text-lg bg-transparent text-zinc-900 dark:text-white border-0 outline-none ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 font-black placeholder:text-zinc-300 dark:placeholder:text-zinc-700 tracking-widest px-5"
                  />
                </div>
              </div>

              {error && (
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex items-center gap-1.5 text-xs font-bold text-[#0D2A6B] pl-2"
                >
                  <AlertCircle className="h-3.5 w-3.5" />
                  <span>{error}</span>
                </motion.div>
              )}
            </div>

            <Button
              type="submit"
              disabled={isLoading || formData.phone.length !== 10}
              className="w-full h-16 bg-[#0D2A6B] hover:bg-[#07143A] text-white font-black text-base uppercase tracking-widest rounded-2xl transition-all duration-300 shadow-[0_12px_24px_rgba(13,42,107,0.3)] hover:shadow-[0_16px_32px_rgba(13,42,107,0.4)] active:scale-[0.98] disabled:opacity-50 disabled:grayscale"
            >
              {isLoading ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>Verifying...</span>
                </div>
              ) : (
                "Continue"
              )}
            </Button>
          </form>

          <footer className="mt-auto pt-10 text-center">
            <p className="text-[10px] text-zinc-400 dark:text-zinc-600 font-medium tracking-wide uppercase">
              By joining, you agree to our<br />
              <span className="text-[#0D2A6B] font-black">Terms of Service</span> & <span className="text-[#0D2A6B] font-black">Privacy Policy</span>
            </p>
          </footer>
        </div>
      </motion.div>
    </AnimatedPage>
  )
}

