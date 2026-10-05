import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { Search, Loader2, Download, Upload, History, X, Package, AlertTriangle, CircleSlash, Boxes } from "lucide-react"
import { stockAPI } from "@food/api"

/**
 * Stock, per product variant, per store.
 *
 * One screen for the admin (Quick Commerce and Medical panels, any store) and
 * for a store's own dashboard (`scope="restaurant"`, its products only). Every
 * count here is the one the customer app sells against: an order takes units
 * off the exact variant bought, a cancel or return puts them back.
 */

const STATUS = {
  in: { label: "In stock", cls: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  low: { label: "Low", cls: "bg-amber-50 text-amber-900 ring-amber-200" },
  out: { label: "Out of stock", cls: "bg-red-50 text-red-800 ring-red-200" },
  untracked: { label: "Not tracked", cls: "bg-neutral-100 text-neutral-600 ring-neutral-200" },
}
const REASON = {
  sale: "Sold",
  cancel: "Order cancelled",
  return: "Returned",
  manual: "Edited",
  bulk: "Bulk edit",
  import: "Sheet upload",
  tracking: "Tracking changed",
}

const keyOf = (r) => `${r.itemId}|${r.variantId}`
const errText = (err, fallback) => err?.response?.data?.message || err?.message || fallback
const when = (iso) =>
  iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : ""

/* A CSV the seller can open in Excel, edit and upload back. */
const CSV_HEAD = ["itemId", "variantId", "store", "product", "variant", "sku", "stock", "lowStockLevel"]
const csvCell = (v) => {
  const s = v === null || v === undefined ? "" : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
function parseCsv(text) {
  const rows = []
  let row = [], cell = "", quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ",") { row.push(cell); cell = "" }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++
      row.push(cell); rows.push(row); row = []; cell = ""
    } else cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows.filter((r) => r.some((c) => c.trim() !== ""))
}

function StatusPill({ status }) {
  const s = STATUS[status] || STATUS.untracked
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${s.cls}`}>{s.label}</span>
}

function HistoryPanel({ scope, row, onClose }) {
  const [items, setItems] = useState(null)
  useEffect(() => {
    stockAPI
      .history(scope, { itemId: row.itemId, variantId: row.variantId })
      .then((res) => setItems(res?.data?.data || []))
      .catch((err) => {
        toast.error(errText(err, "Could not load the history"))
        setItems([])
      })
  }, [scope, row])
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="stock-history-title">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-neutral-900/40" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-neutral-200 px-5 py-4">
          <div>
            <h2 id="stock-history-title" className="font-semibold text-neutral-900">{row.itemName}</h2>
            <p className="text-sm text-neutral-500">{row.variantName || "No variants"} · every stock change, newest first</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto">
          {items === null ? (
            <p className="flex items-center gap-2 p-5 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading</p>
          ) : items.length === 0 ? (
            <p className="p-5 text-sm text-neutral-500">No changes recorded yet. Changes are recorded from today onwards.</p>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {items.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-neutral-900">{REASON[h.reason] || h.reason}</p>
                    <p className="truncate text-xs text-neutral-500">
                      {when(h.at)}{h.by ? ` · ${h.by}` : ""}{h.note ? ` · ${h.note}` : ""}
                    </p>
                  </div>
                  <div className="text-right tabular-nums">
                    <p className={`text-sm font-semibold ${h.delta > 0 ? "text-emerald-700" : h.delta < 0 ? "text-red-700" : "text-neutral-500"}`}>
                      {h.delta > 0 ? `+${h.delta}` : h.delta}
                    </p>
                    <p className="text-xs text-neutral-500">{h.after === null ? "untracked" : `${h.after} left`}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

export default function StockManager({ scope = "admin" }) {
  const isAdmin = scope === "admin"
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState("")
  const [status, setStatus] = useState("")
  const [store, setStore] = useState("")
  const [page, setPage] = useState(1)
  const [drafts, setDrafts] = useState({})
  const [savingKey, setSavingKey] = useState("")
  const [selected, setSelected] = useState(() => new Set())
  const [bulkValue, setBulkValue] = useState("")
  const [bulkMode, setBulkMode] = useState("add")
  const [bulkBusy, setBulkBusy] = useState(false)
  const [historyRow, setHistoryRow] = useState(null)
  const fileRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const res = await stockAPI.list(scope, {
        q: q.trim() || undefined,
        status: status || undefined,
        restaurantId: isAdmin && store ? store : undefined,
        page,
        limit: 100,
      })
      setData(res?.data?.data || null)
    } catch (err) {
      toast.error(errText(err, "Could not load stock"))
    } finally {
      setLoading(false)
    }
  }, [scope, q, status, store, page, isAdmin])

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0)
    return () => clearTimeout(t)
  }, [load, q])

  useEffect(() => {
    setPage(1)
    setSelected(new Set())
  }, [q, status, store])

  const rows = data?.rows || []
  const summary = data?.summary
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(keyOf(r)))

  const replaceRow = (next) =>
    setData((d) => (d ? { ...d, rows: d.rows.map((r) => (keyOf(r) === keyOf(next) ? { ...r, ...next } : r)) } : d))

  const save = async (row, payload, message = "Stock updated") => {
    const key = keyOf(row)
    setSavingKey(key)
    try {
      const res = await stockAPI.adjust(scope, { itemId: row.itemId, variantId: row.variantId, ...payload })
      const next = res?.data?.data
      if (next) replaceRow({ ...row, ...next, storeName: row.storeName, image: row.image })
      setDrafts((d) => {
        const { [key]: _, ...rest } = d
        return rest
      })
      toast.success(message)
    } catch (err) {
      toast.error(errText(err, "Could not update stock"))
    } finally {
      setSavingKey("")
    }
  }

  /* Edits wait for Save. drafts[key] = { stock?, low? } as typed. */
  const setDraft = (key, field, value) => setDrafts((d) => ({ ...d, [key]: { ...(d[key] || {}), [field]: value } }))
  const dropDraft = (key) => setDrafts(({ [key]: _, ...rest }) => rest)
  const same = (typed, saved) => (typed === "" ? saved === null || saved === undefined : Number(typed) === Number(saved))
  const changesOf = (row) => {
    const d = drafts[keyOf(row)]
    if (!d) return null
    const out = {}
    if (d.stock !== undefined && !same(d.stock, row.stockQty)) {
      out.mode = "set"
      out.value = d.stock === "" ? null : Number(d.stock)
    }
    if (d.low !== undefined && !same(d.low, row.lowStockThreshold)) out.lowStockThreshold = d.low === "" ? null : Number(d.low)
    return Object.keys(out).length ? out : null
  }
  const pending = rows.filter((r) => changesOf(r))
  const [savingAll, setSavingAll] = useState(false)

  const saveRow = (row) => {
    const changes = changesOf(row)
    if (!changes) return dropDraft(keyOf(row))
    save(row, changes, "Saved")
  }

  const saveAll = async () => {
    setSavingAll(true)
    try {
      const res = await stockAPI.bulk(scope, {
        rows: pending.map((r) => ({ itemId: r.itemId, variantId: r.variantId, ...changesOf(r) })),
      })
      const out = res?.data?.data
      const firstError = out?.results?.find((x) => !x.ok)
      toast.success(`${out?.updated || 0} saved`, {
        description: out?.failed ? `${out.failed} not saved. Row ${firstError.row}: ${firstError.error}` : undefined,
      })
      setDrafts({})
      load()
    } catch (err) {
      toast.error(errText(err, "Could not save"))
    } finally {
      setSavingAll(false)
    }
  }

  const runBulk = async () => {
    const n = Number(bulkValue)
    if (bulkValue === "" || !Number.isFinite(n)) return toast.error("Enter a number")
    const chosen = rows.filter((r) => selected.has(keyOf(r)))
    setBulkBusy(true)
    try {
      const res = await stockAPI.bulk(scope, {
        rows: chosen.map((r) => ({ itemId: r.itemId, variantId: r.variantId, mode: bulkMode, value: n })),
      })
      const out = res?.data?.data
      toast.success(`${out?.updated || 0} updated${out?.failed ? `, ${out.failed} could not be changed` : ""}`)
      setSelected(new Set())
      setBulkValue("")
      load()
    } catch (err) {
      toast.error(errText(err, "Could not update stock"))
    } finally {
      setBulkBusy(false)
    }
  }

  const downloadSheet = async () => {
    try {
      const res = await stockAPI.list(scope, { restaurantId: isAdmin && store ? store : undefined, limit: 500, page: 1 })
      let all = res?.data?.data?.rows || []
      const pages = res?.data?.data?.pagination?.pages || 1
      for (let p = 2; p <= pages; p++) {
        const more = await stockAPI.list(scope, { restaurantId: isAdmin && store ? store : undefined, limit: 500, page: p })
        all = all.concat(more?.data?.data?.rows || [])
      }
      const lines = [CSV_HEAD.join(",")].concat(
        all.map((r) => [r.itemId, r.variantId, r.storeName, r.itemName, r.variantName, r.sku, r.stockQty ?? "", r.lowStockThreshold ?? ""].map(csvCell).join(",")),
      )
      const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" })
      const a = document.createElement("a")
      a.href = URL.createObjectURL(blob)
      a.download = `stock-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (err) {
      toast.error(errText(err, "Could not prepare the sheet"))
    }
  }

  const uploadSheet = async (file) => {
    if (!file) return
    try {
      const table = parseCsv(await file.text())
      const head = (table.shift() || []).map((h) => h.trim().toLowerCase())
      const col = (name) => head.indexOf(name.toLowerCase())
      const [iItem, iVar, iSku, iStock, iLow] = [col("itemId"), col("variantId"), col("sku"), col("stock"), col("lowStockLevel")]
      if (iStock < 0 || (iItem < 0 && iSku < 0)) {
        return toast.error("The sheet needs a 'stock' column and an 'itemId' or 'sku' column. Download the sheet first to get the right format.")
      }
      const payload = table
        .map((r) => ({
          itemId: iItem >= 0 ? r[iItem]?.trim() || undefined : undefined,
          variantId: iVar >= 0 ? r[iVar]?.trim() || "" : "",
          sku: iSku >= 0 ? r[iSku]?.trim() || undefined : undefined,
          value: r[iStock]?.trim() === "" ? null : Number(r[iStock]),
          ...(iLow >= 0 && r[iLow]?.trim() !== "" ? { lowStockThreshold: Number(r[iLow]) } : {}),
        }))
        .filter((r) => r.itemId || r.sku)
      if (!payload.length) return toast.error("No rows found in that sheet")
      const res = await stockAPI.bulk(scope, { rows: payload, source: "sheet", restaurantId: isAdmin && store ? store : undefined })
      const out = res?.data?.data
      const firstError = out?.results?.find((r) => !r.ok)
      toast.success(`${out?.updated || 0} rows updated`, {
        description: out?.failed ? `${out.failed} skipped. Row ${firstError.row}: ${firstError.error}` : undefined,
      })
      load()
    } catch (err) {
      toast.error(errText(err, "Could not read that sheet"))
    } finally {
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  const tiles = useMemo(
    () => [
      { key: "", label: "Products & variants", value: summary?.rows ?? 0, Icon: Boxes },
      { key: "attention", label: "Need attention", value: (summary?.low ?? 0) + (summary?.out ?? 0), Icon: AlertTriangle },
      { key: "out", label: "Out of stock", value: summary?.out ?? 0, Icon: CircleSlash },
      { key: "untracked", label: "Not tracked", value: (summary?.rows ?? 0) - (summary?.tracked ?? 0), Icon: Package },
    ],
    [summary],
  )

  return (
    <div className="min-h-full bg-neutral-100 p-4 lg:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-neutral-900">Stock</h1>
            <p className="mt-1 max-w-2xl text-sm text-neutral-600">
              Units on hand for every product and size. An order takes stock off the size bought; a cancel or return puts it back.
              Leave a count empty to sell without a limit. Type the new numbers, then press Save or Enter.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={downloadSheet} className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-800 hover:bg-neutral-50">
              <Download className="h-4 w-4" /> Download sheet
            </button>
            <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-2 text-sm font-semibold text-white hover:bg-neutral-800">
              <Upload className="h-4 w-4" /> Upload sheet
            </button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => uploadSheet(e.target.files?.[0])} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {tiles.map((t) => (
            <button
              key={t.label}
              type="button"
              onClick={() => setStatus(t.key)}
              aria-pressed={status === t.key}
              className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${status === t.key ? "border-neutral-900 bg-white" : "border-transparent bg-white/70 hover:bg-white"}`}
            >
              <t.Icon className={`h-5 w-5 shrink-0 ${t.key === "out" ? "text-red-600" : t.key === "attention" ? "text-amber-600" : "text-neutral-400"}`} />
              <span>
                <span className="block text-xl font-semibold tabular-nums text-neutral-900">{t.value}</span>
                <span className="text-xs text-neutral-500">{t.label}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search product, size, SKU or category"
              className="w-full rounded-lg border border-neutral-300 bg-white py-2 pl-9 pr-3 text-sm focus:border-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900/10"
            />
          </div>
          {isAdmin && (
            <select value={store} onChange={(e) => setStore(e.target.value)} aria-label="Store" className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm sm:w-64">
              <option value="">All stores</option>
              {(data?.stores || []).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm">
            <option value="">Every status</option>
            <option value="attention">Low or out</option>
            <option value="in">In stock</option>
            <option value="low">Low</option>
            <option value="out">Out of stock</option>
            <option value="untracked">Not tracked</option>
          </select>
        </div>

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-neutral-900 px-4 py-2.5 text-sm text-white">
            <span className="font-medium">{selected.size} selected</span>
            <select value={bulkMode} onChange={(e) => setBulkMode(e.target.value)} className="rounded-md bg-white/10 px-2 py-1 text-sm" aria-label="Bulk action">
              <option value="add" className="text-neutral-900">Add (use − to remove)</option>
              <option value="set" className="text-neutral-900">Set stock to</option>
            </select>
            <input
              type="number"
              value={bulkValue}
              onChange={(e) => setBulkValue(e.target.value)}
              className="w-24 rounded-md bg-white px-2 py-1 text-sm text-neutral-900 tabular-nums"
              aria-label="Quantity"
            />
            <button type="button" disabled={bulkBusy} onClick={runBulk} className="inline-flex items-center gap-1 rounded-md bg-white px-3 py-1 font-semibold text-neutral-900 disabled:opacity-60">
              {bulkBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Apply
            </button>
            <button type="button" onClick={() => setSelected(new Set())} className="ml-auto text-white/70 hover:text-white">Clear</button>
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
          {loading ? (
            <p className="flex items-center gap-2 px-5 py-12 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading stock</p>
          ) : rows.length === 0 ? (
            <div className="px-5 py-14 text-center">
              <p className="text-sm font-medium text-neutral-800">{q || status || store ? "Nothing matches these filters" : "No products yet"}</p>
              <p className="mt-1 text-sm text-neutral-500">{q || status || store ? "Clear the search or pick another status." : "Products added by stores appear here."}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wider text-neutral-500">
                    <th className="w-10 px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label="Select all on this page"
                        checked={allChecked}
                        onChange={() => setSelected(allChecked ? new Set() : new Set(rows.map(keyOf)))}
                      />
                    </th>
                    <th className="px-2 py-3 font-medium">Product</th>
                    <th className="px-4 py-3 font-medium">Size</th>
                    <th className="px-4 py-3 font-medium">SKU</th>
                    <th className="px-4 py-3 font-medium">In stock</th>
                    <th className="px-4 py-3 font-medium">Low at</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {rows.map((r) => {
                    const key = keyOf(r)
                    const busy = savingKey === key
                    const draft = drafts[key] || {}
                    const changed = Boolean(changesOf(r))
                    return (
                      <tr key={key} className={changed ? "bg-amber-50/60" : r.status === "out" ? "bg-red-50/40" : ""}>
                        <td className="px-4 py-2.5">
                          <input
                            type="checkbox"
                            aria-label={`Select ${r.itemName} ${r.variantName}`}
                            checked={selected.has(key)}
                            onChange={() =>
                              setSelected((s) => {
                                const next = new Set(s)
                                next.has(key) ? next.delete(key) : next.add(key)
                                return next
                              })
                            }
                          />
                        </td>
                        <td className="px-2 py-2.5">
                          <div className="flex items-center gap-3">
                            <span className="h-9 w-9 shrink-0 overflow-hidden rounded-md bg-neutral-100">
                              {r.image && <img src={r.image} alt="" className="h-full w-full object-cover" loading="lazy" />}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate font-medium text-neutral-900">{r.itemName}</p>
                              <p className="truncate text-xs text-neutral-500">
                                {[isAdmin ? r.storeName : "", r.categoryName].filter(Boolean).join(" · ")}
                                {r.manuallyOff && " · switched off by the store"}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-neutral-700">{r.variantName || "—"}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-neutral-600">{r.sku || "—"}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min="0"
                              inputMode="numeric"
                              value={draft.stock !== undefined ? draft.stock : r.stockQty ?? ""}
                              placeholder="No limit"
                              disabled={busy}
                              aria-label={`Stock for ${r.itemName} ${r.variantName}`}
                              onChange={(e) => setDraft(key, "stock", e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveRow(r)
                                if (e.key === "Escape") dropDraft(key)
                              }}
                              className="w-24 rounded-md border border-neutral-300 px-2 py-1 text-sm tabular-nums focus:border-neutral-900 focus:outline-none"
                            />
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => save(r, { mode: "add", value: 10 }, "Added 10")}
                              className="rounded-md border border-neutral-200 px-1.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
                              title="Add 10"
                            >
                              +10
                            </button>
                            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-neutral-400" />}
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <input
                            type="number"
                            min="0"
                            value={draft.low !== undefined ? draft.low : r.lowStockThreshold ?? ""}
                            placeholder="—"
                            disabled={busy}
                            aria-label={`Low-stock level for ${r.itemName} ${r.variantName}`}
                            onChange={(e) => setDraft(key, "low", e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveRow(r)
                              if (e.key === "Escape") dropDraft(key)
                            }}
                            className="w-16 rounded-md border border-neutral-200 px-2 py-1 text-sm tabular-nums focus:border-neutral-900 focus:outline-none"
                          />
                        </td>
                        <td className="px-4 py-2.5"><StatusPill status={r.status} /></td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                          {changed && (
                            <>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => saveRow(r)}
                                className="inline-flex items-center gap-1 rounded-md bg-neutral-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-neutral-800 disabled:opacity-60"
                              >
                                {busy && <Loader2 className="h-3 w-3 animate-spin" />} Save
                              </button>
                              <button type="button" onClick={() => dropDraft(key)} className="rounded-md px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100">
                                Undo
                              </button>
                            </>
                          )}
                          <button type="button" onClick={() => setHistoryRow(r)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900">
                            <History className="h-3.5 w-3.5" /> History
                          </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {data?.pagination?.pages > 1 && (
            <div className="flex items-center justify-between border-t border-neutral-200 px-4 py-2.5 text-sm text-neutral-600">
              <span>Page {data.pagination.page} of {data.pagination.pages} · {data.pagination.total} rows</span>
              <div className="flex gap-2">
                <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-md border border-neutral-300 px-3 py-1 disabled:opacity-40">Previous</button>
                <button type="button" disabled={page >= data.pagination.pages} onClick={() => setPage((p) => p + 1)} className="rounded-md border border-neutral-300 px-3 py-1 disabled:opacity-40">Next</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {pending.length > 0 && (
        <div className="sticky bottom-4 z-40 mx-auto mt-4 flex max-w-7xl flex-wrap items-center justify-between gap-3 rounded-xl bg-neutral-900 px-4 py-3 text-sm text-white shadow-xl">
          <span>
            <span className="font-semibold">{pending.length} unsaved change{pending.length === 1 ? "" : "s"}</span>
            <span className="ml-2 text-white/60">Edited rows are highlighted.</span>
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={() => setDrafts({})} className="rounded-lg px-3 py-1.5 text-white/80 hover:bg-white/10">Discard</button>
            <button
              type="button"
              disabled={savingAll}
              onClick={saveAll}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-4 py-1.5 font-semibold text-neutral-900 hover:bg-neutral-100 disabled:opacity-60"
            >
              {savingAll && <Loader2 className="h-4 w-4 animate-spin" />} Save all
            </button>
          </div>
        </div>
      )}

      {historyRow && <HistoryPanel scope={scope} row={historyRow} onClose={() => setHistoryRow(null)} />}
    </div>
  )
}
