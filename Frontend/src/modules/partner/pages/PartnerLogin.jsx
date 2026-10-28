import { useEffect, useState } from "react"
import { Link, Navigate, useNavigate, useParams } from "react-router-dom"
import { ArrowLeft, Eye, EyeOff, Loader2 } from "lucide-react"
import { PARTNER_TYPES, partnerApi, partnerSession, errorMessage, openSellerDashboard } from "../partnerApi"
import { isSellerApp, SELLER_APP_READY_EVENT, WEB_USE_PASSWORD_MESSAGE } from "@food/utils/sellerApp"
import { clearModuleAuth } from "@food/utils/auth"

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/*
 * Signing in and registering are separate pages:
 *
 *   login     /partner/login/:type -- a registered store. On the website, owner
 *             email + password then an OTP to the phone on file ("email" ->
 *             "emailOtp"), or phone + OTP for a store with no password yet.
 *             The phone path only takes numbers that already have a store.
 *   register  /partner/register/:type -- a new store: phone + OTP, then the
 *             application. Only takes numbers that have no store yet.
 *
 * Inside the partner app the login page keeps its one phone check that sorts
 * both (no purpose is sent), as the app has no separate sign-up screen.
 */
export default function PartnerLogin({ mode = "login" }) {
  const { type } = useParams()
  const navigate = useNavigate()
  const isRegister = mode === "register"
  const [inApp, setInApp] = useState(() => isSellerApp())
  const [phone, setPhone] = useState("")
  const [otp, setOtp] = useState("")
  const [step, setStep] = useState(() => (isRegister || isSellerApp() ? "phone" : "email"))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [devOtp, setDevOtp] = useState("")
  const [cooldown, setCooldown] = useState(0)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [web, setWeb] = useState(null) // { ticket, email, maskedPhone }

  useEffect(() => {
    if (cooldown <= 0) return undefined
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  useEffect(() => {
    const onBridgeReady = () => {
      setInApp(true)
      setStep((s) => (s === "email" ? "phone" : s))
    }
    window.addEventListener(SELLER_APP_READY_EVENT, onBridgeReady)
    return () => window.removeEventListener(SELLER_APP_READY_EVENT, onBridgeReady)
  }, [])

  if (type === "restaurant") {
    return <Navigate to={isRegister ? "/food/restaurant/signup" : "/food/restaurant/login"} replace />
  }
  if (!PARTNER_TYPES[type]) return <Navigate to="/partner" replace />

  const digits = phone.replace(/\D/g, "").slice(-10)
  // What the phone path is for; the backend refuses a number on the wrong page.
  const purpose = isRegister ? "register" : inApp ? undefined : "login"
  const label = PARTNER_TYPES[type].label
  const goTo = (next) => {
    setError("")
    setOtp("")
    setDevOtp("")
    setStep(next)
  }

  // ---------------------------------------------------------- email login ---

  const startWebLogin = async (e) => {
    e?.preventDefault()
    const normalized = email.trim().toLowerCase()
    if (!EMAIL_REGEX.test(normalized)) {
      setError("Enter a valid email address.")
      return
    }
    if (!password) {
      setError("Enter your password.")
      return
    }
    setBusy(true)
    setError("")
    try {
      // A new sign-in: drop any seller session already in this browser, so a
      // sign-in that ends elsewhere never lands in the previous seller's panel.
      clearModuleAuth("restaurant")
      const data = await partnerApi.webLoginRequestOtp(normalized, password, type)
      if (!data?.ticket) throw new Error("Could not start sign-in. Try again.")
      setWeb({ ticket: data.ticket, email: normalized, maskedPhone: data.maskedPhone || "" })
      setPassword("")
      setDevOtp(data?.otp ? String(data.otp) : "")
      setOtp("")
      setStep("emailOtp")
      setCooldown(30)
    } catch (err) {
      setError(errorMessage(err, "Could not sign you in. Try again."))
    } finally {
      setBusy(false)
    }
  }

  const resendWebOtp = async () => {
    if (!web) return goTo("email")
    setBusy(true)
    setError("")
    try {
      const data = await partnerApi.webLoginResendOtp(web.ticket, web.email)
      setDevOtp(data?.otp ? String(data.otp) : "")
      setCooldown(30)
    } catch (err) {
      setError(errorMessage(err, "Could not resend the code."))
    } finally {
      setBusy(false)
    }
  }

  const verifyWebOtp = async (e) => {
    e.preventDefault()
    if (otp.trim().length < 4) {
      setError("Enter the code we sent you.")
      return
    }
    setBusy(true)
    setError("")
    try {
      const data = await partnerApi.webLoginVerifyOtp(web.ticket, web.email, otp.trim(), type)
      if (!data?.session?.accessToken) throw new Error("Could not sign you in. Try again.")
      partnerSession.clear()
      openSellerDashboard(data.session, navigate)
    } catch (err) {
      setError(errorMessage(err, "That code did not work. Try again."))
    } finally {
      setBusy(false)
    }
  }

  // ---------------------------------------------------------- phone login ---

  const sendOtp = async (e) => {
    e?.preventDefault()
    if (digits.length !== 10) {
      setError("Enter your 10-digit mobile number.")
      return
    }
    setBusy(true)
    setError("")
    try {
      clearModuleAuth("restaurant") // see startWebLogin
      const data = await partnerApi.requestOtp(digits, type, purpose)
      setDevOtp(data?.otp ? String(data.otp) : "")
      setStep("otp")
      setCooldown(30)
    } catch (err) {
      setError(errorMessage(err, "Could not send the code. Try again."))
    } finally {
      setBusy(false)
    }
  }

  const verify = async (e) => {
    e.preventDefault()
    if (otp.trim().length < 4) {
      setError("Enter the code we sent you.")
      return
    }
    setBusy(true)
    setError("")
    try {
      const data = await partnerApi.verifyOtp(digits, otp.trim(), type, purpose)
      if (data.state === "other_type") {
        setError(data.message)
        return
      }
      // Approved: signed in, straight into the dashboard. On the website a store
      // with a portal password uses email + password instead; one without a
      // password yet still gets in by phone, so nobody is locked out.
      if (data.state === "approved" && data.session?.accessToken) {
        if (!inApp && data.session.user?.portalPasswordSetAt) {
          goTo("email")
          setError(WEB_USE_PASSWORD_MESSAGE)
          return
        }
        partnerSession.clear()
        openSellerDashboard(data.session, navigate)
        return
      }
      partnerSession.set({
        type,
        phone: digits,
        state: data.state,
        onboardingToken: data.onboardingToken || null,
        application: data.application || null,
        checklist: data.checklist || null,
      })
      navigate(data.state === "new" ? `/partner/apply/${type}` : "/partner/status", { replace: true })
    } catch (err) {
      setError(errorMessage(err, "That code did not work. Try again."))
    } finally {
      setBusy(false)
    }
  }

  // --------------------------------------------------------------- render ---

  const isEmailFlow = step === "email" || step === "emailOtp"
  const inputBox = "flex overflow-hidden rounded-xl border border-slate-300 focus-within:ring-2 focus-within:ring-emerald-500"
  const primaryButton =
    "flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 font-semibold text-white disabled:opacity-60"

  const codeForm = (onSubmit, sentTo, onResend, onChange) => (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="text-sm text-slate-600">
        We sent a code to <span className="font-semibold">{sentTo}</span>.{" "}
        <button type="button" onClick={onChange} className="font-medium text-emerald-700">
          Change
        </button>
      </p>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Code</span>
        <input
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/[^\d]/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          className="h-12 w-full rounded-xl border border-slate-300 px-3 text-center text-xl tracking-[0.4em] outline-none focus:ring-2 focus:ring-emerald-500"
          autoFocus
        />
      </label>
      {devOtp && <p className="text-xs text-slate-400">Test code: {devOtp}</p>}
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <button type="submit" disabled={busy} className={primaryButton}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} Verify
      </button>
      <button
        type="button"
        onClick={onResend}
        disabled={cooldown > 0 || busy}
        className="w-full text-sm text-slate-500 disabled:opacity-60"
      >
        {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
      </button>
    </form>
  )

  return (
    <div className="mx-auto max-w-md space-y-6">
      <Link to="/partner" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> Back
      </Link>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {isRegister ? `Register your ${label.toLowerCase()}` : `${label} partner sign in`}
        </h1>
        <p className="mt-1 text-slate-600">
          {isRegister
            ? "Verify your mobile number to start your application. This number becomes your sign-in."
            : isEmailFlow
              ? "Sign in with your registered email and password. We'll send a code to your registered mobile."
              : inApp
                ? <>Sign in with your mobile number. If it is new, we&rsquo;ll take you through registration.</>
                : "Sign in with your registered mobile number."}
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        {step === "email" && (
          <form onSubmit={startWebLogin} className="space-y-4" noValidate>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Email ID</span>
              <input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); if (error) setError("") }}
                autoComplete="username"
                placeholder="you@gmail.com"
                className="h-12 w-full rounded-xl border border-slate-300 px-3 text-base outline-none focus:ring-2 focus:ring-emerald-500"
                autoFocus
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Password</span>
              <div className={inputBox}>
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); if (error) setError("") }}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  className="h-12 min-w-0 flex-1 px-3 text-base outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="px-3 text-slate-500 hover:text-slate-800"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </label>
            {error && <p className="text-sm text-rose-600">{error}</p>}
            <button type="submit" disabled={busy || !email.trim() || !password} className={primaryButton}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Continue
            </button>
            <p className="text-center text-sm text-slate-600">
              No password yet?{" "}
              <button type="button" onClick={() => goTo("phone")} className="font-medium text-emerald-700">
                Sign in with your mobile number
              </button>
            </p>
          </form>
        )}

        {step === "emailOtp" &&
          codeForm(
            verifyWebOtp,
            web?.maskedPhone ? `your registered mobile ${web.maskedPhone}` : "your registered mobile",
            resendWebOtp,
            () => goTo("email"),
          )}

        {step === "phone" && (
          <form onSubmit={sendOtp} className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Mobile number</span>
              <div className={inputBox}>
                <span className="flex items-center bg-slate-50 px-3 text-sm text-slate-500">+91</span>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/[^\d]/g, "").slice(0, 10))}
                  inputMode="numeric"
                  autoComplete="tel-national"
                  placeholder="98765 43210"
                  className="h-12 w-full px-3 text-base outline-none"
                  autoFocus
                />
              </div>
            </label>
            {error && <p className="text-sm text-rose-600">{error}</p>}
            <button type="submit" disabled={busy} className={primaryButton}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Send code
            </button>
            {!inApp && !isRegister && (
              <p className="text-center text-sm text-slate-600">
                Have a password?{" "}
                <button type="button" onClick={() => goTo("email")} className="font-medium text-emerald-700">
                  Sign in with email and password
                </button>
              </p>
            )}
          </form>
        )}

        {step === "otp" && codeForm(verify, `+91 ${digits}`, sendOtp, () => goTo("phone"))}
      </div>

      {!inApp && (
        <p className="text-center text-sm text-slate-600">
          {isRegister ? "Already registered? " : `New ${label.toLowerCase()}? `}
          <Link
            to={isRegister ? `/partner/login/${type}` : `/partner/register/${type}`}
            className="font-semibold text-emerald-700"
          >
            {isRegister ? "Sign in" : "Register here"}
          </Link>
        </p>
      )}
    </div>
  )
}
