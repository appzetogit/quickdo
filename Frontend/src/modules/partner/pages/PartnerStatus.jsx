import { useEffect, useState } from "react"
import { Link, Navigate, useNavigate } from "react-router-dom"
import { CheckCircle2, CircleAlert, Clock, Loader2, Smartphone, XCircle } from "lucide-react"
import { PARTNER_APP_URL, PARTNER_TYPES, partnerApi, partnerSession, errorMessage } from "../partnerApi"

export default function PartnerStatus() {
  const navigate = useNavigate()
  const [session, setSession] = useState(() => partnerSession.get())
  const [loading, setLoading] = useState(Boolean(session?.onboardingToken))
  const [error, setError] = useState("")

  // Re-read on arrival, so a decision made since sign-in shows without logging in again.
  useEffect(() => {
    if (!session?.onboardingToken) return
    let cancelled = false
    partnerApi
      .getApplication(session.onboardingToken)
      .then((data) => {
        if (cancelled) return
        const next = { ...session, state: data.state, application: data.application, checklist: data.checklist }
        partnerSession.set(next)
        setSession(next)
      })
      .catch((e) => !cancelled && setError(errorMessage(e, "")))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!session) return <Navigate to="/partner" replace />
  const label = PARTNER_TYPES[session.type]?.label || "Store"
  const app = session.application
  const missing = session.checklist?.missing || []

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking your application
      </div>
    )
  }

  const signOut = () => {
    partnerSession.clear()
    navigate("/partner")
  }

  return (
    <div className="mx-auto max-w-xl space-y-5">
      {error && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{error}</p>}

      {session.state === "approved" && (
        <section className="rounded-2xl border border-emerald-200 bg-white p-6 shadow-sm">
          <CheckCircle2 className="h-10 w-10 text-emerald-600" />
          <h1 className="mt-3 text-2xl font-bold">{app?.restaurantName || label} is live</h1>
          <p className="mt-1 text-slate-600">
            Your {label.toLowerCase()} is approved. Take orders, manage stock and see payouts on the dashboard here, or in
            the Quick Drop Partner app — sign in with +91 {session.phone}.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              to={`/partner/login/${session.type}`}
              className="inline-flex h-12 items-center gap-2 rounded-xl bg-emerald-600 px-5 font-semibold text-white hover:bg-emerald-700"
            >
              Sign in to your dashboard
            </Link>
            <a
              href={PARTNER_APP_URL}
              className="inline-flex h-12 items-center gap-2 rounded-xl border border-slate-300 px-5 font-semibold text-slate-800"
            >
              <Smartphone className="h-5 w-5" /> Get the Partner app
            </a>
          </div>
        </section>
      )}

      {session.state === "pending" && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <Clock className="h-10 w-10 text-amber-500" />
          <h1 className="mt-3 text-2xl font-bold">Application under review</h1>
          <p className="mt-1 text-slate-600">
            We&rsquo;re checking the documents for <span className="font-semibold">{app?.restaurantName}</span>. This usually
            takes 1–2 working days. You&rsquo;ll get a notification when it&rsquo;s decided.
          </p>
          {missing.length > 0 ? (
            <div className="mt-4 rounded-xl bg-rose-50 p-4">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-rose-800">
                <CircleAlert className="h-4 w-4" /> Still needed before approval
              </p>
              <ul className="mt-2 list-disc pl-5 text-sm text-rose-800">
                {missing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              Everything required has been provided.
            </p>
          )}
          <Link
            to={`/partner/apply/${session.type}`}
            className="mt-5 inline-flex h-11 items-center rounded-xl border border-slate-300 px-4 text-sm font-semibold"
          >
            {missing.length > 0 ? "Add missing details" : "Review or update details"}
          </Link>
        </section>
      )}

      {session.state === "rejected" && (
        <section className="rounded-2xl border border-rose-200 bg-white p-6 shadow-sm">
          <XCircle className="h-10 w-10 text-rose-600" />
          <h1 className="mt-3 text-2xl font-bold">Application not approved</h1>
          <p className="mt-1 text-slate-600">Fix the following and resubmit — you don&rsquo;t need to start again.</p>
          <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-900">
            {app?.rejectionReason || "No reason was given. Contact support for details."}
          </p>
          <Link
            to={`/partner/apply/${session.type}`}
            className="mt-5 inline-flex h-12 items-center rounded-xl bg-slate-900 px-5 font-semibold text-white"
          >
            Fix and resubmit
          </Link>
        </section>
      )}

      <button type="button" onClick={signOut} className="text-sm text-slate-500 hover:text-slate-800">
        Sign out
      </button>
    </div>
  )
}
