import { useEffect, useState } from "react"
import { Link, Navigate, useNavigate, useParams } from "react-router-dom"
import { ArrowLeft, Loader2 } from "lucide-react"
import { PARTNER_TYPES, partnerApi, partnerSession, errorMessage, openSellerDashboard } from "../partnerApi"

export default function PartnerLogin() {
  const { type } = useParams()
  const navigate = useNavigate()
  const [phone, setPhone] = useState("")
  const [otp, setOtp] = useState("")
  const [step, setStep] = useState("phone")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [devOtp, setDevOtp] = useState("")
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return undefined
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  if (type === "restaurant") return <Navigate to="/food/restaurant/login" replace />
  if (!PARTNER_TYPES[type]) return <Navigate to="/partner" replace />

  const digits = phone.replace(/\D/g, "").slice(-10)

  const sendOtp = async (e) => {
    e?.preventDefault()
    if (digits.length !== 10) {
      setError("Enter your 10-digit mobile number.")
      return
    }
    setBusy(true)
    setError("")
    try {
      const data = await partnerApi.requestOtp(digits, type)
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
      const data = await partnerApi.verifyOtp(digits, otp.trim(), type)
      if (data.state === "other_type") {
        setError(data.message)
        return
      }
      // Approved: signed in, straight into the dashboard.
      if (data.state === "approved" && data.session?.accessToken) {
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

  return (
    <div className="mx-auto max-w-md space-y-6">
      <Link to="/partner" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> Back
      </Link>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{PARTNER_TYPES[type].label} partner</h1>
        <p className="mt-1 text-slate-600">
          Sign in with your mobile number. If it is new, we&rsquo;ll take you through registration.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        {step === "phone" ? (
          <form onSubmit={sendOtp} className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Mobile number</span>
              <div className="flex overflow-hidden rounded-xl border border-slate-300 focus-within:ring-2 focus-within:ring-emerald-500">
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
            <button
              type="submit"
              disabled={busy}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 font-semibold text-white disabled:opacity-60"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Send code
            </button>
          </form>
        ) : (
          <form onSubmit={verify} className="space-y-4">
            <p className="text-sm text-slate-600">
              We sent a code to <span className="font-semibold">+91 {digits}</span>.{" "}
              <button type="button" onClick={() => setStep("phone")} className="font-medium text-emerald-700">
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
            <button
              type="submit"
              disabled={busy}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 font-semibold text-white disabled:opacity-60"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Verify
            </button>
            <button
              type="button"
              onClick={sendOtp}
              disabled={cooldown > 0 || busy}
              className="w-full text-sm text-slate-500 disabled:opacity-60"
            >
              {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
