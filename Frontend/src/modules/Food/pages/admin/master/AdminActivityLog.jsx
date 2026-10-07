import { useState, useEffect, useCallback, useRef } from "react"
import { adminAuditLogAPI } from "@food/api"
import { toast } from "sonner"
import { Loader2, Search, ClipboardList, ChevronLeft, ChevronRight, ChevronDown } from "lucide-react"

/**
 * Master > Admin Activity Log: every admin write on every panel.
 *
 * Rows come from core/admin/adminActivityLog.middleware.js (one per admin
 * POST / PUT / PATCH / DELETE on Food, Quick Commerce, Taxi, Services and Master)
 * and from requireFinancePermission (money moves, with the permission decision).
 * Request bodies are stored as a redacted summary: passwords, codes, tokens, keys
 * and card or bank numbers never reach this screen.
 *
 * Superadmins only (the server refuses sub-admins).
 */

const PAGE_SIZE = 25

const MODULES = [
  { id: "", label: "All panels" },
  { id: "food", label: "Food" },
  { id: "quickCommerce", label: "Quick Commerce" },
  { id: "taxi", label: "Taxi" },
  { id: "serviceProvider", label: "Services" },
  { id: "platform", label: "Master" },
]
const MODULE_LABEL = Object.fromEntries(MODULES.filter((m) => m.id).map((m) => [m.id, m.label]))

const ACTIONS = [
  { id: "", label: "Any action" },
  { id: "create", label: "Create" },
  { id: "update", label: "Update" },
  { id: "delete", label: "Delete" },
  { id: "write", label: "Money move" },
]

const OUTCOME_STYLES = {
  succeeded: "bg-emerald-50 text-emerald-700",
  rejected: "bg-amber-50 text-amber-800",
  failed: "bg-red-50 text-red-700",
}

const METHOD_STYLES = {
  POST: "bg-sky-50 text-sky-700",
  PUT: "bg-violet-50 text-violet-700",
  PATCH: "bg-violet-50 text-violet-700",
  DELETE: "bg-red-50 text-red-700",
}

const inputCls =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900/10"
const ghostCls =
  "inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"

const errText = (err, fallback) => err?.response?.data?.message || err?.message || fallback
const when = (d) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"

function Details({ row }) {
  const summary = row.bodySummary ? JSON.stringify(row.bodySummary, null, 2) : null
  return (
    <div className="grid gap-3 bg-neutral-50 px-5 py-4 text-xs text-neutral-700 md:grid-cols-2">
      <dl className="space-y-1.5">
        <div><dt className="inline font-medium text-neutral-500">Path: </dt><dd className="inline break-all font-mono">{row.path}</dd></div>
        <div><dt className="inline font-medium text-neutral-500">Status: </dt><dd className="inline">{row.statusCode}</dd></div>
        {row.targetIds?.length > 0 && (
          <div><dt className="inline font-medium text-neutral-500">Targets: </dt><dd className="inline break-all font-mono">{row.targetIds.join(", ")}</dd></div>
        )}
        {row.reason && <div><dt className="inline font-medium text-neutral-500">Reason: </dt><dd className="inline">{row.reason}</dd></div>}
        {row.kind === "finance" && (
          <div>
            <dt className="inline font-medium text-neutral-500">Permission: </dt>
            <dd className="inline">
              {row.resource}.{row.action} — {row.permitted ? "held" : row.toleratedViolation ? "missing (allowed while enforcement is off)" : "missing"}
            </dd>
          </div>
        )}
        <div><dt className="inline font-medium text-neutral-500">IP: </dt><dd className="inline font-mono">{row.ip || "—"}</dd></div>
        {row.requestId && <div><dt className="inline font-medium text-neutral-500">Request id: </dt><dd className="inline font-mono">{row.requestId}</dd></div>}
      </dl>
      <div>
        <p className="mb-1 font-medium text-neutral-500">What was sent (secrets removed)</p>
        {summary ? (
          <pre className="max-h-64 overflow-auto rounded-lg border border-neutral-200 bg-white p-3 font-mono text-[11px] leading-relaxed">{summary}</pre>
        ) : (
          <p className="text-neutral-400">No body.</p>
        )}
      </div>
    </div>
  )
}

export default function AdminActivityLog() {
  const [rows, setRows] = useState([])
  const [meta, setMeta] = useState({ page: 1, totalPages: 1, total: 0 })
  const [admins, setAdmins] = useState([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(null)

  const [adminId, setAdminId] = useState("")
  const [module, setModule] = useState("")
  const [action, setAction] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)
  const [applied, setApplied] = useState({ adminId: "", module: "", action: "", from: "", to: "", q: "" })
  const firstLoad = useRef(true)

  useEffect(() => {
    adminAuditLogAPI
      .admins()
      .then((res) => setAdmins(res?.data?.data || []))
      .catch(() => setAdmins([]))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = Object.fromEntries(Object.entries({ ...applied, page, limit: PAGE_SIZE }).filter(([, v]) => v !== ""))
      const res = await adminAuditLogAPI.list(params)
      const data = res?.data?.data
      setRows(data?.rows || [])
      setMeta({ page: data?.page || 1, totalPages: data?.totalPages || 1, total: data?.total || 0 })
    } catch (err) {
      toast.error(errText(err, "Could not load the activity log"))
    } finally {
      setLoading(false)
      firstLoad.current = false
    }
  }, [applied, page])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1)
      setApplied({ adminId, module, action, from, to, q: q.trim() })
    }, firstLoad.current ? 0 : 350)
    return () => clearTimeout(t)
  }, [adminId, module, action, from, to, q])

  return (
    <div className="min-h-full bg-neutral-100 p-4 lg:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Admin Activity Log</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Every change an admin made, on every panel: who, what, when and whether it worked.
          </p>
        </div>

        <section className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <label className="block lg:col-span-2">
              <span className="text-xs font-medium text-neutral-600">Search</span>
              <div className="relative mt-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                <input className={`${inputCls} pl-9`} placeholder="Path, record id or admin email" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-neutral-600">Admin</span>
              <select className={`${inputCls} mt-1`} value={adminId} onChange={(e) => setAdminId(e.target.value)}>
                <option value="">Any admin</option>
                {admins.map((a) => (
                  <option key={a.id} value={a.id}>{a.email || a.id}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-neutral-600">Panel</span>
              <select className={`${inputCls} mt-1`} value={module} onChange={(e) => setModule(e.target.value)}>
                {MODULES.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-neutral-600">Action</span>
              <select className={`${inputCls} mt-1`} value={action} onChange={(e) => setAction(e.target.value)}>
                {ACTIONS.map((a) => (
                  <option key={a.id} value={a.id}>{a.label}</option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs font-medium text-neutral-600">From</span>
                <input type="date" className={`${inputCls} mt-1`} value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-neutral-600">To</span>
                <input type="date" className={`${inputCls} mt-1`} value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
          <div className="flex items-center gap-2 border-b border-neutral-100 px-5 py-3">
            <ClipboardList className="h-4 w-4 text-neutral-400" />
            <p className="text-sm text-neutral-600">{loading ? "Loading…" : `${meta.total.toLocaleString("en-IN")} entries`}</p>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 px-5 py-12 text-neutral-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading activity
            </div>
          ) : rows.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-neutral-500">No admin activity matches these filters.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-xs font-medium uppercase tracking-wide text-neutral-500">
                    <th className="px-5 py-2">When</th>
                    <th className="px-3 py-2">Admin</th>
                    <th className="px-3 py-2">Panel</th>
                    <th className="px-3 py-2">Action</th>
                    <th className="px-3 py-2">Section</th>
                    <th className="px-3 py-2">Result</th>
                    <th className="px-5 py-2"><span className="sr-only">Details</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const isOpen = open === r._id
                    return (
                      <FragmentRow key={r._id}>
                        <tr className="border-b border-neutral-100 hover:bg-neutral-50">
                          <td className="whitespace-nowrap px-5 py-3 text-neutral-700">{when(r.createdAt)}</td>
                          <td className="px-3 py-3">
                            <p className="font-medium text-neutral-900">{r.actorEmail || "Unknown admin"}</p>
                            <p className="text-xs text-neutral-400">{r.actorRole}</p>
                          </td>
                          <td className="px-3 py-3 text-neutral-700">{MODULE_LABEL[r.module] || r.module || "—"}</td>
                          <td className="px-3 py-3">
                            <span className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold ${METHOD_STYLES[r.method] || "bg-neutral-100 text-neutral-700"}`}>{r.method}</span>
                            <span className="ml-2 capitalize text-neutral-700">{r.kind === "finance" ? "money move" : r.action}</span>
                          </td>
                          <td className="px-3 py-3 text-neutral-700">{r.resource || "—"}</td>
                          <td className="px-3 py-3">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${OUTCOME_STYLES[r.outcome] || "bg-neutral-100 text-neutral-700"}`}>
                              {r.outcome || "—"}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-right">
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 text-xs font-medium text-neutral-700 hover:underline"
                              aria-expanded={isOpen}
                              onClick={() => setOpen(isOpen ? null : r._id)}
                            >
                              Details <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                            </button>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="border-b border-neutral-100">
                            <td colSpan={7} className="p-0"><Details row={r} /></td>
                          </tr>
                        )}
                      </FragmentRow>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {meta.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-neutral-100 px-5 py-3">
              <p className="text-xs text-neutral-500">Page {meta.page} of {meta.totalPages}</p>
              <div className="flex gap-2">
                <button type="button" className={ghostCls} disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
                  <ChevronLeft className="h-4 w-4" /> Previous
                </button>
                <button type="button" className={ghostCls} disabled={page >= meta.totalPages || loading} onClick={() => setPage((p) => p + 1)}>
                  Next <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function FragmentRow({ children }) {
  return <>{children}</>
}
