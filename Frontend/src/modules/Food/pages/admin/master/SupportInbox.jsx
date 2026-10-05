import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { Loader2, Search, X, MessageSquare, Phone, RefreshCw } from "lucide-react"
import { supportInboxAPI } from "@food/api"

/**
 * Master > Help & Support: every ticket on the platform in one inbox.
 *
 * Tickets stay in their own service (core/support/supportInbox.service.js); a
 * reply here goes through that service, so its own screen and app show it too.
 */

const STATUSES = [
  { key: "open", label: "Open", tone: "bg-amber-50 text-amber-800 ring-amber-200" },
  { key: "in_progress", label: "In progress", tone: "bg-sky-50 text-sky-800 ring-sky-200" },
  { key: "resolved", label: "Resolved", tone: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
]
const STATUS = Object.fromEntries(STATUSES.map((s) => [s.key, s]))

const SERVICES = [
  { key: "", label: "All services" },
  { key: "food", label: "Food" },
  { key: "quickCommerce", label: "Quick & Medical" },
  { key: "taxi", label: "Taxi" },
]

const WHO = {
  customer: "Customer",
  restaurant: "Restaurant",
  store: "Store",
  rider: "Rider",
  user: "Customer",
  driver: "Driver",
  owner: "Fleet owner",
}

const errorText = (err, fallback) => err?.response?.data?.message || fallback
const payload = (res) => res?.data?.data

const when = (value) => {
  if (!value) return ""
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ""
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins} min ago`
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
}

function StatusPill({ status }) {
  const s = STATUS[status] || { label: status || "Unknown", tone: "bg-neutral-100 text-neutral-700 ring-neutral-200" }
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${s.tone}`}>{s.label}</span>
}

function TicketPanel({ ticketRef, onClose, onSaved }) {
  const [ticket, setTicket] = useState(null)
  const [reply, setReply] = useState("")
  const [status, setStatus] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let live = true
    setTicket(null)
    setReply("")
    setError("")
    supportInboxAPI
      .get(ticketRef.source, ticketRef.id)
      .then((res) => {
        if (!live) return
        const t = payload(res)
        setTicket(t)
        setStatus(t?.status || "open")
      })
      .catch((err) => live && setError(errorText(err, "Could not open this ticket.")))
    return () => {
      live = false
    }
  }, [ticketRef.source, ticketRef.id])

  const save = async (e) => {
    e.preventDefault()
    setError("")
    const body = {}
    if (reply.trim()) body.reply = reply.trim()
    if (status && status !== ticket.status) body.status = status
    if (!Object.keys(body).length) return setError("Write a reply or pick a different status.")
    setSaving(true)
    try {
      const res = await supportInboxAPI.update(ticket.source, ticket.id, body)
      setTicket(payload(res))
      setReply("")
      toast.success(body.reply ? "Reply sent" : "Status updated")
      onSaved()
    } catch (err) {
      setError(errorText(err, "Could not save. Please try again."))
    } finally {
      setSaving(false)
    }
  }

  const isTaxi = ticket?.source === "taxi"

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-neutral-900/40" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-xl flex-col bg-white shadow-xl">
        <header className="flex items-start justify-between gap-3 border-b border-neutral-200 px-6 py-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">
              {ticket ? `${ticket.sourceLabel} · #${ticket.code}` : "Ticket"}
            </p>
            <h2 className="mt-0.5 text-lg font-semibold text-neutral-900 [text-wrap:balance]">{ticket?.subject || "Loading…"}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-neutral-900" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </header>

        {!ticket ? (
          <div className="flex flex-1 items-center justify-center p-6">
            {error ? <p className="text-sm text-red-700">{error}</p> : <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />}
          </div>
        ) : (
          <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div>
                  <dt className="text-xs text-neutral-500">Raised by</dt>
                  <dd className="font-medium text-neutral-900">
                    {ticket.requesterName || "Unknown"}
                    <span className="ml-1 font-normal text-neutral-500">· {WHO[ticket.requesterType] || ticket.requesterType}</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-neutral-500">Phone</dt>
                  <dd className="font-medium text-neutral-900">
                    {ticket.requesterPhone ? (
                      <a href={`tel:${ticket.requesterPhone}`} className="inline-flex items-center gap-1 hover:underline">
                        <Phone className="h-3.5 w-3.5" />
                        {ticket.requesterPhone}
                      </a>
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-neutral-500">Status</dt>
                  <dd className="mt-0.5"><StatusPill status={ticket.status} /></dd>
                </div>
                <div>
                  <dt className="text-xs text-neutral-500">Raised</dt>
                  <dd className="text-neutral-900">{when(ticket.createdAt)}</dd>
                </div>
                {ticket.category && (
                  <div>
                    <dt className="text-xs text-neutral-500">Category</dt>
                    <dd className="capitalize text-neutral-900">{ticket.category}</dd>
                  </div>
                )}
                {ticket.orderRef && (
                  <div>
                    <dt className="text-xs text-neutral-500">Order</dt>
                    <dd className="truncate font-mono text-xs text-neutral-900">{ticket.orderRef}</dd>
                  </div>
                )}
              </dl>

              {isTaxi ? (
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Conversation</h3>
                  <ol className="space-y-2">
                    {ticket.messages.map((m, i) => (
                      <li
                        key={i}
                        className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${m.from === "admin" ? "ml-auto bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-900"}`}
                      >
                        <p className="whitespace-pre-wrap">{m.message}</p>
                        <p className={`mt-1 text-[11px] ${m.from === "admin" ? "text-neutral-300" : "text-neutral-500"}`}>
                          {m.name || (m.from === "admin" ? "Admin" : "Customer")} · {when(m.at)}
                        </p>
                      </li>
                    ))}
                  </ol>
                </section>
              ) : (
                <>
                  <section className="space-y-1.5">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Their message</h3>
                    <p className="whitespace-pre-wrap rounded-xl bg-neutral-100 px-3 py-2 text-sm text-neutral-900">
                      {ticket.description || "No details given."}
                    </p>
                  </section>
                  {ticket.reply && (
                    <section className="space-y-1.5">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Your last reply</h3>
                      <p className="whitespace-pre-wrap rounded-xl border border-neutral-200 px-3 py-2 text-sm text-neutral-900">{ticket.reply}</p>
                    </section>
                  )}
                </>
              )}

              <section className="space-y-2">
                <label htmlFor="inbox-reply" className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                  {isTaxi ? "Reply" : ticket.reply ? "New reply (replaces the last one)" : "Reply"}
                </label>
                <textarea
                  id="inbox-reply"
                  rows={4}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  maxLength={4000}
                  placeholder="They'll see this in their app."
                  className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900"
                />
              </section>

              <section className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Status</p>
                <div role="radiogroup" aria-label="Status" className="inline-flex rounded-lg bg-neutral-100 p-0.5 text-sm">
                  {STATUSES.map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      role="radio"
                      aria-checked={status === s.key}
                      onClick={() => setStatus(s.key)}
                      className={`rounded-md px-3 py-1.5 font-medium ${status === s.key ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-600 hover:text-neutral-900"}`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </section>
            </div>

            <footer className="border-t border-neutral-200 px-6 py-3">
              {error && <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100">
                  Close
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {reply.trim() ? "Send reply" : "Update status"}
                </button>
              </div>
            </footer>
          </form>
        )}
      </aside>
    </div>
  )
}

export default function SupportInbox() {
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState(null)
  const [sources, setSources] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [status, setStatus] = useState("open")
  const [service, setService] = useState("")
  const [source, setSource] = useState("")
  const [q, setQ] = useState("")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState(null)
  const limit = 25

  // Search waits for a pause in typing rather than firing on every key.
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(q.trim())
      setPage(1)
    }, 350)
    return () => clearTimeout(t)
  }, [q])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError("")
    try {
      const [listRes, statsRes] = await Promise.all([
        supportInboxAPI.list({ status, service, source, q: query, page, limit }),
        supportInboxAPI.stats(),
      ])
      const list = payload(listRes) || {}
      setRows(list.items || [])
      setTotal(list.total || 0)
      setSources(list.sources || [])
      setCounts(payload(statsRes)?.counts || null)
    } catch (err) {
      setLoadError(errorText(err, "Could not load tickets."))
    } finally {
      setLoading(false)
    }
  }, [status, service, source, query, page])

  useEffect(() => {
    load()
  }, [load])

  const sourceOptions = useMemo(
    () => sources.filter((s) => !service || s.service === service),
    [sources, service],
  )
  const pages = Math.max(1, Math.ceil(total / limit))
  const allCount = counts ? counts.open + counts.in_progress + counts.resolved : null

  const tabs = [...STATUSES.map((s) => ({ key: s.key, label: s.label, count: counts?.[s.key] })), { key: "", label: "All", count: allCount }]

  return (
    <div className="min-h-full bg-neutral-100 p-4 lg:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-neutral-900">Help &amp; Support</h1>
            <p className="mt-1 text-sm text-neutral-600">
              Tickets from customers, restaurants, stores, riders and drivers in Food, Quick, Medical and Taxi.
            </p>
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

        <div className="flex gap-1 overflow-x-auto rounded-xl border border-neutral-200 bg-white p-1">
          {tabs.map((t) => (
            <button
              key={t.key || "all"}
              type="button"
              onClick={() => {
                setStatus(t.key)
                setPage(1)
              }}
              className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${status === t.key ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"}`}
            >
              {t.label}
              {typeof t.count === "number" && (
                <span className={`rounded-full px-1.5 text-xs tabular-nums ${status === t.key ? "bg-white/20" : "bg-neutral-100 text-neutral-700"}`}>{t.count}</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="relative flex-1">
            <span className="sr-only">Search tickets</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search subject, message, ticket or order number, phone"
              className="w-full rounded-lg border border-neutral-300 bg-white py-2 pl-9 pr-3 text-sm focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900"
            />
          </label>
          <select
            aria-label="Filter by service"
            value={service}
            onChange={(e) => {
              setService(e.target.value)
              setSource("")
              setPage(1)
            }}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
          >
            {SERVICES.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
          <select
            aria-label="Filter by who raised it"
            value={source}
            onChange={(e) => {
              setSource(e.target.value)
              setPage(1)
            }}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">Everyone</option>
            {sourceOptions.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </div>

        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
          {loadError ? (
            <div className="px-6 py-14 text-center">
              <p className="text-sm font-medium text-red-700">{loadError}</p>
              <button type="button" onClick={load} className="mt-3 text-sm font-medium text-neutral-900 underline">Try again</button>
            </div>
          ) : loading && !rows.length ? (
            <div className="flex justify-center py-14"><Loader2 className="h-6 w-6 animate-spin text-neutral-400" /></div>
          ) : rows.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <MessageSquare className="mx-auto h-8 w-8 text-neutral-300" />
              <p className="mt-2 text-sm font-medium text-neutral-800">
                {query || service || source ? "No ticket matches these filters" : status === "open" ? "No open tickets" : "No tickets here"}
              </p>
              <p className="mt-1 text-sm text-neutral-500">New tickets from every app appear here as they come in.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wider text-neutral-500">
                    <th className="px-4 py-3 font-medium">Ticket</th>
                    <th className="px-4 py-3 font-medium">Raised by</th>
                    <th className="px-4 py-3 font-medium">From</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Last activity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {rows.map((r) => (
                    <tr
                      key={r.key}
                      tabIndex={0}
                      onClick={() => setOpen({ source: r.source, id: r.id })}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen({ source: r.source, id: r.id }))}
                      className="cursor-pointer hover:bg-neutral-50 focus-visible:bg-neutral-50 focus-visible:outline-none"
                    >
                      <td className="max-w-[320px] px-4 py-3">
                        <p className="truncate font-medium text-neutral-900">{r.subject}</p>
                        <p className="truncate text-xs text-neutral-500">#{r.code}{r.description ? ` · ${r.description}` : ""}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-neutral-900">{r.requesterName || "Unknown"}</p>
                        <p className="text-xs text-neutral-500">{WHO[r.requesterType] || r.requesterType}{r.requesterPhone ? ` · ${r.requesterPhone}` : ""}</p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-neutral-700">{r.sourceLabel}</td>
                      <td className="px-4 py-3"><StatusPill status={r.status} /></td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">{when(r.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {total > limit && (
          <div className="flex items-center justify-between text-sm text-neutral-600">
            <span className="tabular-nums">
              {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}
            </span>
            <div className="flex gap-2">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 disabled:opacity-50">Previous</button>
              <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 disabled:opacity-50">Next</button>
            </div>
          </div>
        )}
      </div>

      {open && <TicketPanel ticketRef={open} onClose={() => setOpen(null)} onSaved={load} />}
    </div>
  )
}
