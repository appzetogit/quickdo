import { lazy, Suspense, useEffect } from "react"
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom"
import { CircleHelp, Loader2, Package } from "lucide-react"

const ChoosePartner = lazy(() => import("./pages/ChoosePartner"))
const PartnerLogin = lazy(() => import("./pages/PartnerLogin"))
const PartnerApply = lazy(() => import("./pages/PartnerApply"))
const PartnerStatus = lazy(() => import("./pages/PartnerStatus"))

const FONT_HREF = "https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap"

/**
 * /partner -- one door for everyone who sells on Quick Drop.
 *
 *   /partner                 choose Restaurant, Store or Medical store
 *   /partner/login/:type     phone and OTP (restaurants go to their own login)
 *   /partner/apply/:type     the application, new or being fixed
 *   /partner/status          waiting for review, rejected, or approved
 */
export default function PartnerApp() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const onChooser = pathname.replace(/\/+$/, "") === "/partner"

  // Poppins, loaded once for these pages only.
  useEffect(() => {
    if (document.querySelector(`link[href="${FONT_HREF}"]`)) return
    const link = document.createElement("link")
    link.rel = "stylesheet"
    link.href = FONT_HREF
    document.head.appendChild(link)
  }, [])

  const signIn = () => {
    if (onChooser) document.getElementById("choose")?.scrollIntoView({ behavior: "smooth", block: "start" })
    else navigate("/partner")
  }

  return (
    <div
      className="relative min-h-screen overflow-x-hidden bg-[#F6FBF9] text-slate-900"
      style={{ fontFamily: "'Poppins', ui-sans-serif, system-ui, sans-serif" }}
    >
      {/* soft background shapes, as in the brand artwork */}
      <div aria-hidden className="pointer-events-none absolute -right-40 top-24 h-96 w-96 rounded-full bg-emerald-100/50 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -left-32 bottom-0 h-80 w-80 rounded-full bg-emerald-100/40 blur-3xl" />

      <header className="relative border-b border-slate-200/70 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between gap-4 px-4">
          <Link to="/partner" className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-sm">
              <Package className="h-5 w-5" />
            </span>
            <span className="whitespace-nowrap text-lg font-bold tracking-tight sm:text-xl">
              Quick Drop <span className="font-semibold text-emerald-600">Partner</span>
            </span>
          </Link>
          <nav className="flex items-center gap-3 md:gap-5">
            <Link to="/" className="hidden text-sm text-slate-500 hover:text-slate-800 md:inline">
              quickdropsindia.com
            </Link>
            <Link
              to="/support"
              className="hidden items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 sm:inline-flex"
            >
              <CircleHelp className="h-4 w-4 text-emerald-600" /> Need help?
            </Link>
            <button
              type="button"
              onClick={signIn}
              className="whitespace-nowrap rounded-full bg-emerald-600 px-4 py-2.5 text-sm sm:px-6 font-semibold text-white shadow-sm hover:bg-emerald-700 focus:outline-none focus-visible:ring-4 focus-visible:ring-emerald-200"
            >
              Sign In
            </button>
          </nav>
        </div>
      </header>

      <main className="relative mx-auto max-w-7xl px-4 py-10 md:py-14">
        <Suspense
          fallback={
            <div className="flex items-center gap-2 text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading
            </div>
          }
        >
          <Routes>
            <Route index element={<ChoosePartner />} />
            <Route path="login/:type" element={<PartnerLogin />} />
            <Route path="apply/:type" element={<PartnerApply />} />
            <Route path="status" element={<PartnerStatus />} />
            <Route path="*" element={<Navigate to="/partner" replace />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  )
}
