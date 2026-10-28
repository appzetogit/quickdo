import { useCallback, useEffect, useMemo, useState } from "react"
import { Loader2, RefreshCw, ChevronDown } from "lucide-react"
import { platformPnlAPI } from "@food/api"
import { SERVICE_PROVIDER_ENABLED } from "@/config/features"

/**
 * Master > Report Management > Platform Earnings.
 *
 * What the platform kept, across Food, Quick & Medical, Taxi and Services, from
 * each service's own record of how every order, ride or bill was split
 * (core/finance/platformPnl.service.js). GST is shown beside income, not in it.
 */

const IST_OFFSET = 5.5 * 3600 * 1000
const todayIst = () => new Date(Date.now() + IST_OFFSET).toISOString().slice(0, 10)
const shift = (day, days) => {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
const monthStart = (day) => `${day.slice(0, 8)}01`

const PRESETS = [
  { key: "7", label: "Last 7 days", range: () => ({ from: shift(todayIst(), -6), to: todayIst() }) },
  { key: "30", label: "Last 30 days", range: () => ({ from: shift(todayIst(), -29), to: todayIst() }) },
  { key: "month", label: "This month", range: () => ({ from: monthStart(todayIst()), to: todayIst() }) },
  {
    key: "lastMonth",
    label: "Last month",
    range: () => {
      const end = shift(monthStart(todayIst()), -1)
      return { from: monthStart(end), to: end }
    },
  },
]

const SERVICE_COLOR = {
  food: "bg-orange-500",
  quick: "bg-emerald-600",
  taxi: "bg-amber-400",
  services: "bg-sky-600",
}

const rupees = (n, { sign = false } = {}) => {
  const v = Number(n || 0)
  const s = `₹${Math.abs(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
  if (v < 0) return `−${s}`
  return sign && v > 0 ? `+${s}` : s
}
const niceDay = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
const errorText = (err, fallback) => err?.response?.data?.message || fallback

function Figure({ label, value, hint, strong }) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${strong ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white"}`}>
      <p className={`text-xs font-medium ${strong ? "text-neutral-300" : "text-neutral-500"}`}>{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      {hint && <p className={`mt-0.5 text-xs ${strong ? "text-neutral-400" : "text-neutral-500"}`}>{hint}</p>}
    </div>
  )
}

/** Daily amount kept, one bar per day; below the line on a day the platform lost money. */
function DailyChart({ daily, services }) {
  const W = 720
  const H = 200
  const padL = 56
  const padB = 24
  const padT = 8
  const values = daily.map((d) => d.total)
  const max = Math.max(0, ...values)
  const min = Math.min(0, ...values)
  const span = max - min || 1
  const plotH = H - padB - padT
  const y = (v) => padT + ((max - v) / span) * plotH
  const bw = (W - padL) / Math.max(1, daily.length)
  const ticks = [max, (max + min) / 2, min].filter((v, i, a) => a.indexOf(v) === i)
  const labelEvery = Math.max(1, Math.ceil(daily.length / 8))

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-52 w-full min-w-[560px]" role="img" aria-label="Amount kept per day">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke="#e5e5e5" strokeDasharray={t === 0 ? "" : "3 3"} />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="#737373">
              {rupees(Math.round(t))}
            </text>
          </g>
        ))}
        <line x1={padL} x2={W} y1={y(0)} y2={y(0)} stroke="#a3a3a3" />
        {daily.map((d, i) => {
          const top = y(Math.max(0, d.total))
          const h = Math.max(d.total === 0 ? 0 : 1, Math.abs(y(d.total) - y(0)))
          const breakdown = services
            .filter((s) => d.byService?.[s.key])
            .map((s) => `${s.label}: ${rupees(d.byService[s.key])}`)
            .join(", ")
          return (
            <g key={d.date}>
              <rect
                x={padL + i * bw + bw * 0.15}
                y={d.total >= 0 ? top : y(0)}
                width={bw * 0.7}
                height={h}
                rx="2"
                fill={d.total >= 0 ? "#171717" : "#dc2626"}
              >
                <title>{`${niceDay(d.date)}: ${rupees(d.total)}${breakdown ? ` (${breakdown})` : ""}`}</title>
              </rect>
              {i % labelEvery === 0 && (
                <text x={padL + i * bw + bw / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="#737373">
                  {niceDay(d.date)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export default function PlatformEarnings() {
  const [preset, setPreset] = useState("30")
  const [range, setRange] = useState(PRESETS[1].range())
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [open, setOpen] = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await platformPnlAPI.get(range)
      setData(res?.data?.data || null)
    } catch (err) {
      setError(errorText(err, "Could not load platform earnings."))
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => {
    load()
  }, [load])

  // Services is only listed where the module is switched on, or where it has earned something.
  const services = useMemo(
    () => (data?.services || []).filter((s) => s.key !== "services" || SERVICE_PROVIDER_ENABLED || s.count > 0),
    [data],
  )
  const totals = data?.totals

  return (
    <div className="min-h-full bg-neutral-100 p-4 lg:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-neutral-900">Platform earnings</h1>
            <p className="mt-1 text-sm text-neutral-600">What the platform kept from every order, ride and booking, after paying partners.</p>
          </div>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 overflow-x-auto rounded-xl border border-neutral-200 bg-white p-1">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => {
                  setPreset(p.key)
                  setRange(p.range())
                }}
                className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${preset === p.key ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-sm">
            <label className="sr-only" htmlFor="pnl-from">From</label>
            <input
              id="pnl-from"
              type="date"
              value={range.from}
              max={range.to}
              onChange={(e) => {
                setPreset("")
                setRange((r) => ({ ...r, from: e.target.value }))
              }}
              className="rounded-lg border border-neutral-300 bg-white px-2 py-1.5"
            />
            <span className="text-neutral-500">to</span>
            <label className="sr-only" htmlFor="pnl-to">To</label>
            <input
              id="pnl-to"
              type="date"
              value={range.to}
              min={range.from}
              max={todayIst()}
              onChange={(e) => {
                setPreset("")
                setRange((r) => ({ ...r, to: e.target.value }))
              }}
              className="rounded-lg border border-neutral-300 bg-white px-2 py-1.5"
            />
          </div>
        </div>

        {error ? (
          <div className="rounded-xl border border-neutral-200 bg-white px-6 py-14 text-center">
            <p className="text-sm font-medium text-red-700">{error}</p>
            <button type="button" onClick={load} className="mt-3 text-sm font-medium text-neutral-900 underline">Try again</button>
          </div>
        ) : !data ? (
          <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-neutral-400" /></div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Figure strong label="Platform kept" value={rupees(totals.net)} hint={`${niceDay(data.range.from)} – ${niceDay(data.range.to)}`} />
              <Figure label="Customers paid" value={rupees(totals.gross)} hint="Completed orders, rides and bookings" />
              <Figure label="Paid to partners" value={rupees(totals.partners)} hint="Restaurants, stores, riders, drivers, vendors" />
              <Figure label="GST collected" value={rupees(totals.gst)} hint="Owed to the government, not income" />
            </div>

            <section className="rounded-xl border border-neutral-200 bg-white p-5">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold text-neutral-900">Kept per day</h2>
                <p className="text-xs text-neutral-500">Hover a bar for each service&rsquo;s share. Red is a day the platform lost money.</p>
              </div>
              <DailyChart daily={data.daily} services={services} />
            </section>

            <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wider text-neutral-500">
                      <th className="px-5 py-3 font-medium">Service</th>
                      <th className="px-3 py-3 text-right font-medium">Completed</th>
                      <th className="px-3 py-3 text-right font-medium">Customers paid</th>
                      <th className="px-3 py-3 text-right font-medium">To partners</th>
                      <th className="px-3 py-3 text-right font-medium">GST</th>
                      <th className="px-5 py-3 text-right font-medium">Platform kept</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {services.map((s) => {
                      const isOpen = open[s.key]
                      return (
                        <FragmentRows
                          key={s.key}
                          s={s}
                          isOpen={isOpen}
                          toggle={() => setOpen((o) => ({ ...o, [s.key]: !o[s.key] }))}
                          share={totals.net ? s.net / totals.net : 0}
                        />
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-neutral-300 bg-neutral-50 font-semibold text-neutral-900">
                      <td className="px-5 py-3">Total</td>
                      <td className="px-3 py-3" />
                      <td className="px-3 py-3 text-right tabular-nums">{rupees(totals.gross)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{rupees(totals.partners)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{rupees(totals.gst)}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{rupees(totals.net)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>

            <div className="space-y-1 text-xs text-neutral-500">
              <p>Food and Quick count delivered orders by the day they were placed; Taxi counts rides by the day they finished; Services counts bills by the day they were paid. Dates are India time.</p>
              <p>Not included yet: seller and worker subscription fees, and wallet top-ups. Taxi&rsquo;s service tax is inside the fare and isn&rsquo;t recorded separately, so its GST shows as —.</p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function FragmentRows({ s, isOpen, toggle, share }) {
  return (
    <>
      <tr className="hover:bg-neutral-50">
        <td className="px-5 py-3">
          <button type="button" onClick={toggle} aria-expanded={isOpen} className="flex items-center gap-2 font-medium text-neutral-900">
            <span className={`h-2.5 w-2.5 rounded-sm ${SERVICE_COLOR[s.key] || "bg-neutral-400"}`} aria-hidden="true" />
            {s.label}
            <ChevronDown className={`h-4 w-4 text-neutral-400 transition-transform ${isOpen ? "rotate-180" : ""}`} />
          </button>
        </td>
        <td className="px-3 py-3 text-right tabular-nums text-neutral-700">{s.count.toLocaleString("en-IN")} {s.unit}</td>
        <td className="px-3 py-3 text-right tabular-nums text-neutral-700">{rupees(s.gross)}</td>
        <td className="px-3 py-3 text-right tabular-nums text-neutral-700">{rupees(s.partners)}</td>
        <td className="px-3 py-3 text-right tabular-nums text-neutral-700">{s.gst === null ? "—" : rupees(s.gst)}</td>
        <td className="px-5 py-3 text-right">
          <span className={`font-semibold tabular-nums ${s.net < 0 ? "text-red-700" : "text-neutral-900"}`}>{rupees(s.net)}</span>
          {share > 0 && s.net > 0 && <span className="ml-2 text-xs text-neutral-500 tabular-nums">{Math.round(share * 100)}%</span>}
        </td>
      </tr>
      {isOpen && (
        <tr className="bg-neutral-50/60">
          <td colSpan={6} className="px-5 pb-4 pt-1">
            <dl className="ml-5 max-w-md divide-y divide-neutral-200 text-sm">
              {s.lines.map((l) => (
                <div key={l.key} className="flex items-center justify-between gap-4 py-1.5">
                  <dt className="text-neutral-600">{l.label}</dt>
                  <dd className={`tabular-nums ${l.amount < 0 ? "text-red-700" : "text-neutral-900"}`}>{rupees(l.amount, { sign: true })}</dd>
                </div>
              ))}
              <div className="flex items-center justify-between gap-4 py-1.5 font-semibold">
                <dt className="text-neutral-900">Platform kept</dt>
                <dd className="tabular-nums text-neutral-900">{rupees(s.net)}</dd>
              </div>
            </dl>
          </td>
        </tr>
      )}
    </>
  )
}
