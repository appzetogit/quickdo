import { useNavigate } from "react-router-dom"
import {
  ArrowRight,
  BarChart3,
  Check,
  MapPin,
  Pill,
  ShieldCheck,
  ShoppingBasket,
  Star,
  Truck,
  Users,
  UtensilsCrossed,
  Zap,
} from "lucide-react"
import { PARTNER_TYPES } from "../partnerApi"

/*
 * Photos from Unsplash's CDN (free to use under the Unsplash licence), sized
 * down on their side so the page only pulls what it shows.
 */
const photo = (id, w = 480) => `https://images.unsplash.com/photo-${id}?w=${w}&q=70&auto=format&fit=crop`

const OPTIONS = [
  {
    type: "restaurant",
    icon: UtensilsCrossed,
    image: photo("1512621776951-a57141f2eefd"),
    imageAlt: "A bowl of fresh food",
    points: ["Online orders", "Menu management", "Reach more customers"],
    theme: {
      card: "from-orange-50/80",
      iconBg: "bg-orange-100 text-orange-600",
      tick: "bg-orange-500",
      button: "bg-orange-500 hover:bg-orange-600 focus-visible:ring-orange-300",
    },
  },
  {
    type: "store",
    icon: ShoppingBasket,
    image: photo("1542838132-92c53300491e"),
    imageAlt: "Fresh produce on store shelves",
    points: ["List your products", "Manage inventory", "On-demand delivery"],
    theme: {
      card: "from-blue-50/80",
      iconBg: "bg-blue-100 text-blue-600",
      tick: "bg-blue-600",
      button: "bg-blue-600 hover:bg-blue-700 focus-visible:ring-blue-300",
    },
  },
  {
    type: "medical",
    icon: Pill,
    image: photo("1584308666744-24d5c474f2ae"),
    imageAlt: "Strips of medicine",
    points: ["Prescription orders", "Wide reach", "Trusted & secure"],
    theme: {
      card: "from-emerald-50/80",
      iconBg: "bg-emerald-100 text-emerald-600",
      tick: "bg-emerald-600",
      button: "bg-emerald-600 hover:bg-emerald-700 focus-visible:ring-emerald-300",
    },
  },
]

const HIGHLIGHTS = [
  { icon: BarChart3, label: "More customers", tint: "bg-emerald-100 text-emerald-600" },
  { icon: Zap, label: "Fast onboarding", tint: "bg-blue-100 text-blue-600" },
  { icon: ShieldCheck, label: "Safe & secure", tint: "bg-violet-100 text-violet-600" },
]

const TRUST = [
  { icon: Truck, label: "Reliable delivery" },
  { icon: Users, label: "Growing customer base" },
  { icon: Star, label: "Built for local businesses" },
]

function PartnerCard({ option, onStart }) {
  const { type, icon: Icon, image, imageAlt, points, theme } = option
  const info = PARTNER_TYPES[type]
  return (
    <article
      className={`relative flex flex-col overflow-hidden rounded-3xl border border-slate-200/80 bg-gradient-to-b ${theme.card} to-white p-6 shadow-[0_10px_30px_-12px_rgba(15,23,42,0.18)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-14px_rgba(15,23,42,0.25)]`}
    >
      <img
        src={image}
        alt={imageAlt}
        className="pointer-events-none absolute right-5 top-5 h-24 w-28 rounded-2xl object-cover shadow-md ring-4 ring-white xl:h-28 xl:w-32"
      />
      <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${theme.iconBg}`}>
        <Icon className="h-7 w-7" strokeWidth={2.2} />
      </span>
      <h2 className="mt-12 text-xl font-bold tracking-tight text-slate-900 xl:text-2xl">{info.label}</h2>
      <p className="mt-2 min-h-[3rem] text-sm leading-6 text-slate-600 xl:text-[15px]">{info.blurb}</p>
      <hr className="my-5 border-slate-200" />
      <ul className="mb-7 space-y-3">
        {points.map((point) => (
          <li key={point} className="flex items-center gap-3 text-sm text-slate-700 xl:text-[15px]">
            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white ${theme.tick}`}>
              <Check className="h-3.5 w-3.5" strokeWidth={3} />
            </span>
            {point}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => onStart(type)}
        className={`mt-auto flex h-13 min-h-[3.25rem] w-full items-center justify-center gap-2 rounded-2xl text-lg font-semibold text-white shadow-sm transition focus:outline-none focus-visible:ring-4 ${theme.button}`}
      >
        Get Started <ArrowRight className="h-5 w-5" />
      </button>
    </article>
  )
}

export default function ChoosePartner() {
  const navigate = useNavigate()

  const open = (type) => {
    // Restaurants already have a complete sign-in and onboarding of their own.
    if (type === "restaurant") navigate("/food/restaurant/login")
    else navigate(`/partner/login/${type}`)
  }

  return (
    <div className="relative">
      <div className="grid gap-10 xl:grid-cols-[minmax(0,340px)_1fr] xl:gap-10">
        {/* ---- hero ---- */}
        <section className="flex flex-col">
          <span className="inline-flex w-fit items-center gap-2 rounded-full bg-emerald-100/70 px-4 py-2 text-sm font-medium text-emerald-700">
            <Zap className="h-4 w-4" /> Grow your business with Quick Drop
          </span>
          <h1 className="mt-6 text-5xl font-extrabold leading-[1.05] tracking-tight text-slate-900 md:text-6xl">
            Sell on
            <span className="block text-emerald-600">Quick Drop</span>
          </h1>
          <p className="mt-5 max-w-md text-lg leading-7 text-slate-600">
            Sign in or register your business. New numbers go straight to registration.
          </p>
          <ul className="mt-8 grid grid-cols-3 gap-4">
            {HIGHLIGHTS.map(({ icon: Icon, label, tint }) => (
              <li key={label} className="flex flex-col gap-3">
                <span className={`flex h-14 w-14 items-center justify-center rounded-2xl ${tint}`}>
                  <Icon className="h-6 w-6" />
                </span>
                <span className="text-[15px] font-semibold leading-5 text-slate-700">{label}</span>
              </li>
            ))}
          </ul>
          <div className="relative mt-10 hidden xl:block">
            <img
              src={photo("1556740758-90de374c12ad", 700)}
              alt="A shop owner serving a customer at the counter"
              className="h-52 w-full rounded-3xl object-cover shadow-lg"
            />
            <span className="absolute -top-5 left-6 flex h-12 w-12 items-center justify-center rounded-full bg-white text-emerald-600 shadow-lg ring-4 ring-emerald-50">
              <MapPin className="h-6 w-6" fill="currentColor" stroke="white" />
            </span>
          </div>
        </section>

        {/* ---- partner types ---- */}
        <section id="choose" className="grid content-start gap-5 md:grid-cols-3">
          {OPTIONS.map((option) => (
            <PartnerCard key={option.type} option={option} onStart={open} />
          ))}
        </section>
      </div>

      {/* ---- trust strip ---- */}
      <section className="mt-14 border-t border-slate-200/70 pt-10 text-center">
        <span className="mx-auto block h-1 w-12 rounded-full bg-emerald-500" />
        <p className="mt-4 text-xs font-bold uppercase tracking-[0.25em] text-slate-500">Trusted by businesses nationwide</p>
        <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-12 gap-y-4">
          {TRUST.map(({ icon: Icon, label }) => (
            <li key={label} className="flex items-center gap-3 text-[15px] font-medium text-slate-700">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                <Icon className="h-5 w-5" />
              </span>
              {label}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
