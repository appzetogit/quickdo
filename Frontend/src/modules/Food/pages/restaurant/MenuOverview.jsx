import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { AlertTriangle, ArrowLeft, Download, Loader2, Pencil, RefreshCw, Search } from "lucide-react"
import { restaurantAPI } from "@food/api"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"
import TablePagination, { usePagination, SCROLL_TABLE_CLASS, STICKY_THEAD_CLASS } from "@food/components/admin/TablePagination"

/**
 * Menu Overview: every item on one compact table -- category, price, variants
 * with their prices, packaging charge and approval status -- so a restaurant
 * can review its whole menu at a glance and jump to Edit for anything that is
 * missing. Reads the same menu the Inventory page loads; nothing is edited here.
 */

const money = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`

const flattenMenu = (menu) => {
  const rows = []
  const walk = (section, parentName = "") => {
    const sectionName = section?.name || parentName
    for (const item of section?.items || []) {
      rows.push({ ...item, _section: section, _categoryName: item.categoryName || item.category || sectionName || "" })
    }
    for (const sub of section?.subsections || []) walk(sub, sectionName)
  }
  for (const section of menu?.sections || []) walk(section)
  return rows
}

/** What a reviewer should fix on this item. */
const missingInfo = (item) => {
  const missing = []
  const variants = Array.isArray(item.variants) ? item.variants : []
  if (!String(item._categoryName || "").trim()) missing.push("Category")
  if (variants.length === 0 && !(Number(item.price) > 0)) missing.push("Price")
  if (variants.some((v) => !(Number(v?.price) > 0))) missing.push("Variant price")
  if (!item.image) missing.push("Image")
  if (!String(item.description || "").trim()) missing.push("Description")
  if (item.packagingCharge && !(item.packagingCharge.isEnabled && Number(item.packagingCharge.amount) > 0)) {
    missing.push("Packaging")
  }
  return missing
}

const packagingLabel = (pc) => {
  if (!pc) return null
  if (!pc.isEnabled || !(Number(pc.amount) > 0)) return null
  const units = Math.max(1, Number(pc.unitsPerCharge) || 1)
  return `${money(pc.amount)} per ${units === 1 ? "unit" : `${units} units`}`
}

const STATUS_STYLES = {
  approved: "bg-green-100 text-green-700",
  pending: "bg-amber-100 text-amber-700",
  rejected: "bg-red-100 text-red-700",
}

const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`

export default function MenuOverview() {
  const navigate = useNavigate()
  const goBack = useRestaurantBackNavigation()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState("all")
  const [status, setStatus] = useState("all")
  const [onlyMissing, setOnlyMissing] = useState(false)

  const load = async () => {
    try {
      setLoading(true)
      setError("")
      const res = await restaurantAPI.getMenu()
      const menu = res?.data?.data?.menu || res?.data?.data || res?.data?.menu || {}
      setRows(flattenMenu(menu).map((item) => ({ ...item, _missing: missingInfo(item) })))
    } catch (e) {
      setError(e?.response?.data?.message || "Could not load your menu. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const categories = useMemo(
    () => [...new Set(rows.map((r) => r._categoryName).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [rows],
  )
  const missingCount = useMemo(() => rows.filter((r) => r._missing.length > 0).length, [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (q && !String(r.name || "").toLowerCase().includes(q) && !String(r._categoryName).toLowerCase().includes(q)) return false
      if (category !== "all" && r._categoryName !== category) return false
      if (status !== "all" && String(r.approvalStatus || "approved") !== status) return false
      if (onlyMissing && r._missing.length === 0) return false
      return true
    })
  }, [rows, search, category, status, onlyMissing])

  const pagination = usePagination(filtered, {
    storageKey: "restaurant-menu-overview",
    defaultPageSize: 25,
    resetOn: [search, category, status, onlyMissing],
  })

  const editItem = (item) => {
    const categoryId = item.categoryId || item._section?.id || item._section?.categoryId || ""
    navigate(`/food/restaurant/hub-menu/item/${item.id}`, {
      state: {
        backTo: "/food/restaurant/menu-overview",
        item: { ...item, category: item._categoryName, categoryId, isAvailable: item.isAvailable !== false },
        category: item._categoryName,
        categoryId,
        groupId: categoryId,
      },
    })
  }

  const downloadCsv = () => {
    const header = ["Item", "Category", "Price", "Variants", "Packaging charge", "Food type", "Status", "Missing"]
    const lines = filtered.map((r) => [
      r.name,
      r._categoryName,
      (r.variants || []).length ? "" : r.price,
      (r.variants || []).map((v) => `${v.name}: ${v.price}`).join(" | "),
      packagingLabel(r.packagingCharge) || (r.packagingCharge ? "Not set" : ""),
      r.foodType || "",
      r.approvalStatus || "approved",
      r._missing.join(", "),
    ].map(csvCell).join(","))
    const blob = new Blob([[header.map(csvCell).join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "menu-overview.csv"
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="min-h-screen bg-slate-50/60 pb-24 text-slate-900">
      <div className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={goBack} className="rounded-xl p-2 text-slate-600 hover:bg-slate-100 transition-colors" aria-label="Go back">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-bold text-slate-900">Menu Overview</h1>
              <p className="text-xs text-slate-500 hidden sm:block">Every item with its price, variants and packaging charge. Use Edit to fill in anything missing.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={load} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50" aria-label="Refresh">
              <RefreshCw className="h-4 w-4" />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <button onClick={downloadCsv} disabled={!filtered.length} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-black disabled:opacity-40">
              <Download className="h-4 w-4" />
              <span>Export</span>
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 space-y-4">
        {/* Summary */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Items</p>
            <p className="mt-1 text-2xl font-bold">{rows.length}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Categories</p>
            <p className="mt-1 text-2xl font-bold">{categories.length}</p>
          </div>
          <button
            type="button"
            onClick={() => setOnlyMissing((v) => !v)}
            className={`col-span-2 sm:col-span-1 rounded-2xl border p-4 text-left transition-colors ${onlyMissing ? "border-amber-400 bg-amber-50" : "border-slate-200 bg-white hover:bg-amber-50/50"}`}
          >
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">Missing information</p>
            <p className="mt-1 text-2xl font-bold text-amber-700">{missingCount}</p>
            <p className="text-xs text-slate-500">{onlyMissing ? "Showing only these — tap to show all" : "Tap to show only these"}</p>
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center">
          <div className="flex flex-1 items-center gap-2 rounded-xl border border-slate-200 px-3">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search item or category"
              className="h-10 w-full bg-transparent text-sm outline-none"
            />
          </div>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm">
            <option value="all">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm">
            <option value="all">All statuses</option>
            <option value="approved">Approved</option>
            <option value="pending">Pending approval</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-20 text-slate-500">
              <Loader2 className="h-6 w-6 animate-spin" /> Loading your menu…
            </div>
          ) : error ? (
            <div className="py-16 text-center">
              <p className="text-sm text-red-600">{error}</p>
              <button onClick={load} className="mt-3 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Try again</button>
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-16 text-center text-sm text-slate-500">
              {rows.length === 0 ? "No items on your menu yet. Add them from Inventory." : "No items match these filters."}
            </p>
          ) : (
            <>
              <div className={SCROLL_TABLE_CLASS}>
                <table className="w-full min-w-[900px] text-sm">
                  <thead className={`bg-slate-50 border-b border-slate-200 ${STICKY_THEAD_CLASS}`}>
                    <tr className="text-left text-xs font-semibold uppercase tracking-wider text-slate-600">
                      <th className="px-4 py-3">#</th>
                      <th className="px-4 py-3">Item</th>
                      <th className="px-4 py-3">Category</th>
                      <th className="px-4 py-3">Price</th>
                      <th className="px-4 py-3">Variants</th>
                      <th className="px-4 py-3">Packaging</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Missing</th>
                      <th className="px-4 py-3 text-right">Edit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {pagination.pageItems.map((item, index) => {
                      const variants = Array.isArray(item.variants) ? item.variants : []
                      const pack = packagingLabel(item.packagingCharge)
                      const st = String(item.approvalStatus || "approved")
                      return (
                        <tr key={item.id} className={item._missing.length ? "bg-amber-50/40" : "hover:bg-slate-50"}>
                          <td className="px-4 py-3 text-slate-500">{pagination.rowNumber(index)}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className={`h-3 w-3 shrink-0 rounded-sm border-2 ${item.foodType === "Veg" ? "border-green-600" : "border-red-600"}`} title={item.foodType || ""} />
                              <span className="font-semibold text-slate-900">{item.name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-slate-700">{item._categoryName || <span className="text-amber-700">—</span>}</td>
                          <td className="px-4 py-3 font-semibold whitespace-nowrap">
                            {variants.length ? <span className="font-normal text-slate-500">from {money(item.price)}</span> : Number(item.price) > 0 ? money(item.price) : <span className="text-amber-700">₹0</span>}
                          </td>
                          <td className="px-4 py-3">
                            {variants.length ? (
                              <div className="flex flex-wrap gap-1">
                                {variants.map((v, i) => (
                                  <span key={v.id || i} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700 whitespace-nowrap">
                                    {v.name}: <span className="font-semibold">{Number(v.price) > 0 ? money(v.price) : "₹0"}</span>
                                  </span>
                                ))}
                              </div>
                            ) : <span className="text-slate-400">—</span>}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            {pack ? (
                              <span className="rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-semibold text-orange-700">{pack}</span>
                            ) : item.packagingCharge ? (
                              <span className="text-xs text-amber-700">Not set</span>
                            ) : <span className="text-slate-400">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[st] || "bg-slate-100 text-slate-700"}`}>{st}</span>
                          </td>
                          <td className="px-4 py-3">
                            {item._missing.length ? (
                              <span className="inline-flex items-start gap-1 text-xs text-amber-800">
                                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                {item._missing.join(", ")}
                              </span>
                            ) : <span className="text-xs text-green-700">Complete</span>}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => editItem(item)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                            >
                              <Pencil className="h-3.5 w-3.5" /> Edit
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <TablePagination pagination={pagination} label="items" />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
