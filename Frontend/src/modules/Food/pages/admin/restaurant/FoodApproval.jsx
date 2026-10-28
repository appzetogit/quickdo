import { useState, useMemo, useEffect, useCallback, useRef } from "react"
import { Search, CheckCircle2, XCircle, Eye, Clock, Loader2, ChevronLeft, ChevronRight } from "lucide-react"
import { Card } from "@food/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@food/components/ui/dialog"
import { adminAPI } from "@food/api"
import { toast } from "sonner"
import { SCROLL_TABLE_CLASS, STICKY_THEAD_CLASS } from "@food/components/admin/TablePagination"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}


const PAGE_SIZES = [25, 50, 100]

/** Page numbers around the current one, with gaps: 1 … 4 5 [6] 7 8 … 16 */
const pageWindow = (page, pages) => {
  const out = []
  for (let p = 1; p <= pages; p += 1) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 2) out.push(p)
    else if (out[out.length - 1] !== "…") out.push("…")
  }
  return out
}

function Pager({ page, pages, total, pageSize, onPage, onPageSize }) {
  if (total === 0) return null
  const from = (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  const btn =
    "inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3 text-sm text-gray-600">
        <span className="tabular-nums">
          Showing <b>{from}</b>–<b>{to}</b> of <b>{total}</b>
        </span>
        <label className="flex items-center gap-1.5">
          <span className="text-gray-500">Rows</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm"
          >
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" className={`${btn} border-gray-300 bg-white text-gray-700 hover:bg-gray-50`} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </button>
        {pageWindow(page, pages).map((p, i) =>
          p === "…" ? (
            <span key={`gap-${i}`} className="px-1 text-gray-400">…</span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onPage(p)}
              aria-current={p === page ? "page" : undefined}
              className={`${btn} tabular-nums ${p === page ? "border-[#006fbd] bg-[#006fbd] text-white" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"}`}
            >
              {p}
            </button>
          ),
        )}
        <button type="button" className={`${btn} border-gray-300 bg-white text-gray-700 hover:bg-gray-50`} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

/** "₹10 per unit" / "₹10 per 3 units" / null when the dish charges nothing. */
const describePackaging = (pc) => {
  if (!pc?.isEnabled || !(Number(pc.amount) > 0)) return null
  const units = Math.max(1, Number(pc.unitsPerCharge) || 1)
  return `₹${Number(pc.amount)} per ${units === 1 ? "unit" : `${units} units`}`
}

export default function FoodApproval() {
  const [foodRequests, setFoodRequests] = useState([])
  // Fee Settings packaging mode: RESTAURANT bills each dish's own charge,
  // ADMIN bills one platform charge instead, OFF bills none.
  const [packagingMode, setPackagingMode] = useState(null)
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [restaurantFilter, setRestaurantFilter] = useState("")
  const [kindFilter, setKindFilter] = useState("all") // all | food | addon
  const [dietFilter, setDietFilter] = useState("all") // all | Veg | Non-Veg
  const [categoryFilter, setCategoryFilter] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [selectedRequest, setSelectedRequest] = useState(null)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [rejectReason, setRejectReason] = useState("")
  const [processing, setProcessing] = useState(false)
  const isMountedRef = useRef(true)

  // Fetch pending food approval requests
  const fetchFoodRequests = useCallback(async ({ silent = false } = {}) => {
    try {
      if (!silent) {
        setLoading(true)
      }
      // Page through every pending request. One call used to return the
      // server's default 200, so anything past that (a big bulk upload) never
      // showed here.
      const PAGE_SIZE = 500
      const data = []
      let response = null
      for (let page = 1; page <= 40; page += 1) {
        response = await adminAPI.getPendingFoodApprovals({ page, limit: PAGE_SIZE })
        const body = response?.data?.data || response?.data || {}
        data.push(...(body.requests || []))
        if (!body.hasMore) break
      }
      if (!isMountedRef.current) return
      setFoodRequests(data)
      setPackagingMode(response?.data?.data?.packagingMode || null)
    } catch (error) {
      debugError('Error fetching food approval requests:', error)
      if (!isMountedRef.current) return
      if (!silent) {
        toast.error('Failed to load food approval requests')
      }
      setFoodRequests([])
    } finally {
      if (!silent && isMountedRef.current) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    isMountedRef.current = true
    fetchFoodRequests()

    const onFocus = () => fetchFoodRequests({ silent: true })
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        fetchFoodRequests({ silent: true })
      }
    }
    const onPageShow = () => fetchFoodRequests({ silent: true })

    const intervalId = setInterval(() => {
      if (document.visibilityState === "visible") {
        fetchFoodRequests({ silent: true })
      }
    }, 30000)

    window.addEventListener("focus", onFocus)
    window.addEventListener("pageshow", onPageShow)
    document.addEventListener("visibilitychange", onVisibility)

    return () => {
      isMountedRef.current = false
      clearInterval(intervalId)
      window.removeEventListener("focus", onFocus)
      window.removeEventListener("pageshow", onPageShow)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [fetchFoodRequests])

  // Filter requests based on search query
  // Filter options, with how many pending items each holds.
  const restaurantKey = (r) => r.restaurantRef || r.restaurantId || r.restaurantName
  const restaurantOptions = useMemo(() => {
    const byRef = new Map()
    for (const r of foodRequests) {
      const ref = restaurantKey(r)
      const cur = byRef.get(ref) || { ref, name: r.restaurantName || "Unknown Restaurant", count: 0 }
      cur.count += 1
      byRef.set(ref, cur)
    }
    return [...byRef.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [foodRequests])

  const categoryOptions = useMemo(() => {
    const counts = new Map()
    for (const r of foodRequests) {
      if (r.entityType === "addon") continue
      if (restaurantFilter && restaurantKey(r) !== restaurantFilter) continue
      const name = r.category || "Uncategorised"
      counts.set(name, (counts.get(name) || 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [foodRequests, restaurantFilter])

  const filteredRequests = useMemo(() => {
    const query = searchQuery.toLowerCase().trim()
    return foodRequests.filter((request) => {
      if (restaurantFilter && restaurantKey(request) !== restaurantFilter) return false
      if (kindFilter !== "all" && (request.entityType || "food") !== kindFilter) return false
      if (dietFilter !== "all" && (request.entityType === "addon" || request.foodType !== dietFilter)) return false
      if (categoryFilter && (request.category || "Uncategorised") !== categoryFilter) return false
      if (!query) return true
      return (
        request.itemName?.toLowerCase().includes(query) ||
        request.category?.toLowerCase().includes(query) ||
        request.restaurantName?.toLowerCase().includes(query) ||
        request.restaurantId?.toLowerCase().includes(query) ||
        request.approvalStatus?.toLowerCase().includes(query) ||
        request.entityType?.toLowerCase().includes(query)
      )
    })
  }, [foodRequests, searchQuery, restaurantFilter, kindFilter, dietFilter, categoryFilter])

  const totalRequests = filteredRequests.length
  const pages = Math.max(1, Math.ceil(totalRequests / pageSize))
  const currentPage = Math.min(page, pages)
  const rowOffset = (currentPage - 1) * pageSize
  const pageRows = filteredRequests.slice(rowOffset, rowOffset + pageSize)

  // Any change to what is shown starts again from the first page.
  useEffect(() => {
    setPage(1)
  }, [searchQuery, restaurantFilter, kindFilter, dietFilter, categoryFilter, pageSize])

  // A category picked for another restaurant would hide everything.
  useEffect(() => {
    setCategoryFilter("")
  }, [restaurantFilter])

  const filtersActive = Boolean(searchQuery.trim() || restaurantFilter || kindFilter !== "all" || dietFilter !== "all" || categoryFilter)
  const clearFilters = () => {
    setSearchQuery("")
    setRestaurantFilter("")
    setKindFilter("all")
    setDietFilter("all")
    setCategoryFilter("")
  }

  // Bulk approval works on everything pending, or on one restaurant's items.
  const selectedRestaurant = restaurantOptions.find((o) => o.ref === restaurantFilter) || null
  const bulkCount = selectedRestaurant ? selectedRestaurant.count : foodRequests.length

  // Handle approve food item or addon
  /*
   * Whether the dish being approved joins the price adjustment standing over
   * its menu.
   *
   * Defaults to "leave it untouched" deliberately. A dish arriving for approval
   * was created after every run that shaped the menu around it, so approving it
   * as-is puts it live at its bare base price beside neighbours the platform
   * has marked up and discounted -- but silently applying an old discount to a
   * price a restaurant has just set is the worse mistake of the two, so the
   * quiet default is the one that changes nothing.
   */
  const [applyGlobalPricing, setApplyGlobalPricing] = useState(false)
  const [standing, setStanding] = useState(null)

  /*
   * Reset the choice whenever a different request is opened. It is a decision
   * about one dish, and carrying it over would apply an adjustment the admin
   * chose for something else.
   */
  useEffect(() => {
    setApplyGlobalPricing(false)
    setStanding(null)
    const id = selectedRequest?._id || selectedRequest?.id
    if (!id || selectedRequest?.entityType === 'addon') return undefined
    let cancelled = false
    adminAPI
      .getStandingAdjustment(id)
      .then((res) => {
        if (!cancelled) setStanding(res?.data?.data ?? null)
      })
      .catch(() => {
        // The choice still works without the preview; it just has to be made
        // without the numbers in view, so this stays quiet rather than alarming.
        if (!cancelled) setStanding(null)
      })
    return () => {
      cancelled = true
    }
  }, [selectedRequest])

  const handleApprove = async (request) => {
    if (!request?.isActionable) return
    try {
      setProcessing(true)
      const id = request._id || request.id
      
      if (request.entityType === 'addon') {
        await adminAPI.approveRestaurantAddon(id)
        toast.success('Add-on approved successfully')
      } else {
        await adminAPI.approveFoodItem(id, { applyGlobalPricing })
        toast.success(
          applyGlobalPricing
            ? 'Approved with the menu\'s current price adjustment'
            : 'Approved at its own price',
        )
      }
      
      await fetchFoodRequests()
      setShowDetailModal(false)
      setSelectedRequest(null)
    } catch (error) {
      debugError('Error approving item:', error)
      toast.error(error?.response?.data?.message || 'Failed to approve item')
    } finally {
      setProcessing(false)
    }
  }

  // Handle reject food item or addon
  const handleReject = async () => {
    if (!selectedRequest?.isActionable) {
      setShowRejectModal(false)
      return
    }
    if (!rejectReason.trim()) {
      toast.error('Please provide a rejection reason')
      return
    }

    try {
      setProcessing(true)
      const id = selectedRequest._id || selectedRequest.id
      
      if (selectedRequest.entityType === 'addon') {
        await adminAPI.rejectRestaurantAddon(id, rejectReason)
        toast.success('Add-on rejected')
      } else {
        await adminAPI.rejectFoodItem(id, rejectReason)
        toast.success('Food item rejected')
      }
      
      await fetchFoodRequests()
      setShowRejectModal(false)
      setShowDetailModal(false)
      setSelectedRequest(null)
      setRejectReason("")
    } catch (error) {
      debugError('Error rejecting item:', error)
      toast.error(error?.response?.data?.message || 'Failed to reject item')
    } finally {
      setProcessing(false)
    }
  }

  // View food item details
  const handleViewDetails = (request) => {
    setSelectedRequest(request)
    setShowDetailModal(true)
  }

  // Open reject modal
  const handleRejectClick = (request) => {
    if (!request?.isActionable) return
    setSelectedRequest(request)
    setShowRejectModal(true)
  }

  return (
    <div className="p-6 space-y-4">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-green-500" />
          <h1 className="text-lg sm:text-xl font-semibold text-gray-900">
            Food Approval
          </h1>
        </div>
      </div>

      {/* Food Approval List Section */}
      <Card className="border border-gray-200 shadow-sm">
        <div className="p-4">
          {/* Section Header */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-gray-900">Pending Food & Add-on Approvals</h2>
              <span className="inline-flex items-center rounded-full bg-primary-orange/10 px-3 py-1 text-xs font-medium text-accent-orange">
                {foodRequests.length}
              </span>
            </div>
            {bulkCount > 0 && (
              <button
                onClick={async () => {
                  const scope = selectedRestaurant ? ` from ${selectedRestaurant.name}` : ""
                  if (window.confirm(`Approve all ${bulkCount} pending items${scope}?`)) {
                    try {
                      setProcessing(true)
                      await adminAPI.bulkApproveFoodItems(selectedRestaurant && /^[a-f0-9]{24}$/i.test(selectedRestaurant.ref) ? selectedRestaurant.ref : undefined)
                      toast.success(`Approved ${bulkCount} items${scope}`)
                      await fetchFoodRequests()
                    } catch (error) {
                      debugError('Bulk approval error:', error)
                      toast.error('Failed to perform bulk approval')
                    } finally {
                      setProcessing(false)
                    }
                  }
                }}
                disabled={processing}
                className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-bold rounded-xl hover:bg-green-700 transition-all shadow-lg shadow-green-100 disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4" />
                {selectedRestaurant ? `Approve all from ${selectedRestaurant.name}` : "Bulk Approve All"}
              </button>
            )}
          </div>

          {/* Search and filters */}
          <div className="mb-4 space-y-3">
            <div className="relative flex-1">
              <span className="absolute inset-y-0 left-2.5 flex items-center text-gray-400">
                <Search className="w-4 h-4" />
              </span>
              <input
                type="text"
                placeholder="Search by name, category, restaurant or status"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white py-1.5 pl-9 pr-3 text-sm focus:outline-none focus:border-[#006fbd] focus:ring-1 focus:ring-[#006fbd]"
              />
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <select
                value={restaurantFilter}
                onChange={(e) => setRestaurantFilter(e.target.value)}
                aria-label="Filter by restaurant"
                className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm lg:col-span-2"
              >
                <option value="">All restaurants ({foodRequests.length})</option>
                {restaurantOptions.map((o) => (
                  <option key={o.ref} value={o.ref}>{o.name} ({o.count})</option>
                ))}
              </select>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                aria-label="Filter by category"
                className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
              >
                <option value="">All categories</option>
                {categoryOptions.map(([name, count]) => (
                  <option key={name} value={name}>{name} ({count})</option>
                ))}
              </select>
              <select
                value={kindFilter}
                onChange={(e) => setKindFilter(e.target.value)}
                aria-label="Filter by type"
                className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
              >
                <option value="all">Dishes and add-ons</option>
                <option value="food">Dishes only</option>
                <option value="addon">Add-ons only</option>
              </select>
              <select
                value={dietFilter}
                onChange={(e) => setDietFilter(e.target.value)}
                aria-label="Filter by veg or non-veg"
                className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
              >
                <option value="all">Veg and non-veg</option>
                <option value="Veg">Veg only</option>
                <option value="Non-Veg">Non-veg only</option>
              </select>
            </div>
            {filtersActive && (
              <div className="flex items-center justify-between text-sm text-gray-600">
                <span><b className="tabular-nums">{totalRequests}</b> of {foodRequests.length} match</span>
                <button type="button" onClick={clearFilters} className="font-medium text-[#006fbd] hover:underline">
                  Clear filters
                </button>
              </div>
            )}
          </div>

          {!loading && (
            <div className="mb-3">
              <Pager page={currentPage} pages={pages} total={totalRequests} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} />
            </div>
          )}

          {/* Table */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-[#006fbd]" />
            </div>
          ) : (
            <div className="border-t border-gray-200">
              <div className={`w-full ${SCROLL_TABLE_CLASS}`}>
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className={STICKY_THEAD_CLASS} style={{ backgroundColor: "#e6f1f8" }}>
                    <tr>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        S.No
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Restaurant
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Category
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Item Name
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Type
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Price
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Packaging
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Requested Date
                      </th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {filteredRequests.length === 0 ? (
                      <tr>
                        <td colSpan="10" className="px-3 py-8 text-center text-sm text-gray-500">
                          {loading ? "Loading..." : filtersActive ? "Nothing matches these filters." : "No food or add-on records found."}
                        </td>
                      </tr>
                    ) : (
                      pageRows.map((request, index) => (
                        <tr key={request._id || request.id} className="hover:bg-gray-50">
                          <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-700 font-semibold">
                            {rowOffset + index + 1}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap">
                            <div className="text-sm">
                              <div className="font-semibold text-gray-900">{request.restaurantName || '-'}</div>
                              <div className="text-gray-500 text-xs">{request.restaurantId || '-'}</div>
                            </div>
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-700">
                            {request.category || '-'}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-700 font-semibold">
                            {request.itemName || '-'}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-700 capitalize text-center">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${request.entityType === 'addon' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                                {request.entityType || 'food'}
                            </span>
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-sm">
                            <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium capitalize ${
                              request.isActionable
                                ? 'bg-amber-100 text-amber-700'
                                : String(request.approvalStatus || '').toLowerCase() === 'approved'
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-gray-100 text-gray-700'
                            }`}>
                              {request.approvalStatus || (request.isActionable ? 'pending' : 'active')}
                            </span>
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-700 font-semibold">
                            {request.price !== null && request.price !== undefined ? `Rs ${request.price}` : '-'}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-sm">
                            {request.entityType === 'addon' || !request.packagingCharge ? (
                              <span className="text-gray-400">—</span>
                            ) : describePackaging(request.packagingCharge) ? (
                              <span className="inline-flex items-center rounded-full bg-orange-100 px-2.5 py-1 text-xs font-semibold text-orange-700">
                                {describePackaging(request.packagingCharge)}
                              </span>
                            ) : (
                              <span className="text-xs text-gray-500">No charge</span>
                            )}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-500">
                            {request.requestedAt ? new Date(request.requestedAt).toLocaleDateString() : '-'}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-right text-sm">
                            <div className="flex justify-end gap-1.5">
                              <button
                                onClick={() => handleViewDetails(request)}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-white transition-colors"
                                style={{ backgroundColor: "#006fbd" }}
                                title="View Details"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleApprove(request)}
                                disabled={processing || !request.isActionable}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Approve"
                              >
                                <CheckCircle2 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleRejectClick(request)}
                                disabled={processing || !request.isActionable}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Reject"
                              >
                                <XCircle className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {pages > 1 && (
                <div className="mt-3">
                  <Pager page={currentPage} pages={pages} total={totalRequests} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} />
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      {/* Item Details Modal */}
      <Dialog open={showDetailModal} onOpenChange={setShowDetailModal}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto p-0 bg-white shadow-2xl rounded-2xl border-none">
          <DialogHeader className="p-6 pb-4 border-b border-gray-100 bg-slate-50/50">
            <DialogTitle className="text-xl font-bold text-gray-900">
              {selectedRequest?.entityType === 'addon' ? 'Add-on Details' : 'Food Item Details'}
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-500 mt-1">
              Review the submitted details before approval.
            </DialogDescription>
          </DialogHeader>
          {selectedRequest && (
            <div className="p-6 space-y-6">
              {/* Restaurant Info */}
              <div className="p-4 bg-blue-50/50 rounded-xl border border-blue-100/50 flex items-center justify-between">
                <div>
                   <h3 className="font-bold text-xs text-blue-700 uppercase tracking-wider mb-1">Restaurant</h3>
                   <p className="text-sm font-semibold text-gray-900">{selectedRequest.restaurantName || '-'}</p>
                   <p className="text-xs text-gray-500">ID: {selectedRequest.restaurantId || '-'}</p>
                </div>
                <div className="px-3 py-1 bg-white rounded-full border border-blue-100 text-[10px] font-bold text-blue-600">
                    {selectedRequest.entityType?.toUpperCase()}
                </div>
              </div>

              {/* Item Info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                    <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Item Name</label>
                        <p className="text-sm font-semibold text-gray-900">{selectedRequest.itemName || '-'}</p>
                    </div>
                    <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Category</label>
                        <p className="text-sm text-gray-700">{selectedRequest.category || '-'}</p>
                    </div>
                    <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Price</label>
                        <p className="text-sm font-bold text-green-600">{selectedRequest.price !== null && selectedRequest.price !== undefined ? `₹${selectedRequest.price}` : '-'}</p>
                    </div>
                    <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Status</label>
                        <p className="text-sm text-gray-700 capitalize font-medium">{selectedRequest.approvalStatus || 'pending'}</p>
                    </div>
                </div>

                <div className="space-y-4">
                    {selectedRequest.entityType !== 'addon' && selectedRequest.packagingCharge && (
                        <div className="rounded-xl border border-orange-200 bg-orange-50 p-3">
                            <label className="block text-[10px] font-bold text-orange-700 uppercase tracking-wider mb-1">Packaging Charge</label>
                            {describePackaging(selectedRequest.packagingCharge) ? (
                                <>
                                    <p className="text-base font-bold text-orange-700">{describePackaging(selectedRequest.packagingCharge)}</p>
                                    {Number(selectedRequest.packagingCharge.unitsPerCharge) > 1 && (
                                        <p className="text-xs text-gray-600 mt-0.5">
                                            1–{selectedRequest.packagingCharge.unitsPerCharge} units pay one charge, the next {selectedRequest.packagingCharge.unitsPerCharge} pay another.
                                        </p>
                                    )}
                                    {selectedRequest.price !== null && selectedRequest.price !== undefined && (
                                        <p className="text-xs text-gray-600 mt-0.5">
                                            One unit: ₹{Number(selectedRequest.price)} + ₹{Number(selectedRequest.packagingCharge.amount)} packaging = <span className="font-bold">₹{Number(selectedRequest.price) + Number(selectedRequest.packagingCharge.amount)}</span>
                                        </p>
                                    )}
                                </>
                            ) : (
                                <p className="text-sm font-semibold text-gray-700">No packaging charge on this dish</p>
                            )}
                            <p className={`text-[11px] mt-2 font-medium ${selectedRequest.packagingCharge.billed ? 'text-green-700' : 'text-gray-500'}`}>
                                {selectedRequest.packagingCharge.billed
                                    ? 'Billed to customers: Fee Settings has packaging set per restaurant.'
                                    : packagingMode === 'ADMIN'
                                        ? 'Not billed right now: Fee Settings uses one platform packaging charge instead.'
                                        : 'Not billed right now: packaging charges are switched off in Fee Settings.'}
                            </p>
                        </div>
                    )}
                    {selectedRequest.foodType && (
                        <div>
                            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Food Type</label>
                            <p className="text-sm text-gray-700">{selectedRequest.foodType}</p>
                        </div>
                    )}
                    {selectedRequest.requestedAt && (
                        <div>
                            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Requested On</label>
                            <p className="text-sm text-gray-700">{new Date(selectedRequest.requestedAt).toLocaleString()}</p>
                        </div>
                    )}
                </div>

                {selectedRequest.description && (
                  <div className="col-span-full">
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Description</label>
                    <p className="text-sm text-gray-700 leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-100">{selectedRequest.description}</p>
                  </div>
                )}

                {/* Images */}
                {(() => {
                  const allImages = (selectedRequest.images || []).filter(img => img && typeof img === 'string');
                  if (selectedRequest.image && !allImages.includes(selectedRequest.image)) {
                      allImages.unshift(selectedRequest.image);
                  }
                  
                  return allImages.length > 0 ? (
                    <div className="col-span-full">
                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                        Images ({allImages.length})
                      </label>
                      <div className="flex flex-wrap gap-3">
                        {allImages.map((img, idx) => (
                            <img 
                              key={idx}
                              src={img} 
                              alt="Item preview"
                              className="w-24 h-24 object-cover rounded-xl border border-gray-100 shadow-sm hover:scale-105 transition-transform cursor-zoom-in"
                              onClick={() => window.open(img, '_blank')}
                              onError={(e) => { e.target.style.display = 'none'; }}
                            />
                        ))}
                      </div>
                    </div>
                  ) : null;
                })()}
              </div>
            </div>
          )}
          {/*
            The pricing choice, above the buttons rather than beside them: it
            changes what Approve does, so it has to be read before the button is
            reached. Only shown when there is actually an adjustment standing --
            offering a choice between two identical outcomes is noise.
          */}
          {selectedRequest?.isActionable
            && selectedRequest?.entityType !== 'addon'
            && standing?.standing
            && (standing.standing.markupPercent > 0 || standing.standing.discountPercent > 0) ? (
            <div className="px-6 pt-4">
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-semibold text-amber-900">
                  This menu is on a price adjustment
                </p>
                <p className="mt-1 text-xs text-amber-800">
                  {standing.standing.markupPercent > 0
                    ? `${standing.standing.markupPercent}% markup`
                    : null}
                  {standing.standing.markupPercent > 0 && standing.standing.discountPercent > 0
                    ? " and "
                    : null}
                  {standing.standing.discountPercent > 0
                    ? `${standing.standing.discountPercent}% discount`
                    : null}
                  {" "}applies to the other dishes here.
                </p>

                <div className="mt-3 space-y-2">
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-amber-200 bg-white p-3">
                    <input
                      type="radio"
                      name="approval-pricing"
                      className="mt-0.5"
                      checked={!applyGlobalPricing}
                      onChange={() => setApplyGlobalPricing(false)}
                    />
                    <span className="text-xs">
                      <span className="block font-semibold text-slate-900">
                        Keep its current pricing
                      </span>
                      <span className="block text-slate-600">
                        Goes live as it stands
                        {standing.preview?.untouched?.pays != null
                          ? ` — customers pay ${"\u20B9"}${standing.preview.untouched.pays}, nothing struck through`
                          : ""}
                        .
                      </span>
                    </span>
                  </label>

                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-amber-200 bg-white p-3">
                    <input
                      type="radio"
                      name="approval-pricing"
                      className="mt-0.5"
                      checked={applyGlobalPricing}
                      onChange={() => setApplyGlobalPricing(true)}
                    />
                    <span className="text-xs">
                      <span className="block font-semibold text-slate-900">
                        Apply the current adjustment
                      </span>
                      <span className="block text-slate-600">
                        Lands where the rest of the menu is
                        {standing.preview?.applied?.pays != null
                          ? ` — customers pay ${"\u20B9"}${standing.preview.applied.pays}`
                          : ""}
                        {standing.preview?.applied?.cutout
                          ? `, struck through at ${"\u20B9"}${standing.preview.applied.cutout}`
                          : ""}
                        .
                      </span>
                    </span>
                  </label>
                </div>

                <p className="mt-2 text-[11px] text-amber-700">
                  The restaurant&rsquo;s own base price is not changed either way.
                </p>
              </div>
            </div>
          ) : null}
          <DialogFooter className="p-6 pt-4 border-t border-gray-100 bg-slate-50/50 flex gap-2">
            <button
              type="button"
              onClick={() => setShowDetailModal(false)}
              className="px-6 py-2 text-sm font-semibold text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
            >
              Close
            </button>
            {selectedRequest?.isActionable && (
              <>
                <button
                  type="button"
                  onClick={() => handleRejectClick(selectedRequest)}
                  className="px-6 py-2 text-sm font-semibold text-white bg-red-500 rounded-xl hover:bg-red-600 shadow-lg shadow-red-200 transition-all active:scale-95"
                >
                  Reject
                </button>
                <button
                  type="button"
                  onClick={() => handleApprove(selectedRequest)}
                  disabled={processing}
                  className="px-6 py-2 text-sm font-semibold text-white bg-green-500 rounded-xl hover:bg-green-600 shadow-lg shadow-green-200 transition-all active:scale-95 disabled:opacity-50"
                >
                  {processing ? "Processing..." : "Approve Item"}
                </button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Confirmation Modal */}
      <Dialog open={showRejectModal} onOpenChange={setShowRejectModal}>
        <DialogContent className="max-w-md p-0 bg-white rounded-2xl border-none shadow-2xl">
          <DialogHeader className="p-6 pb-4 border-b border-gray-100 bg-red-50/30">
            <DialogTitle className="text-xl font-bold text-red-700 flex items-center gap-2">
                <XCircle className="w-5 h-5" />
                Reject Item
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-500 mt-1">
              Please provide a clear reason for rejecting this {selectedRequest?.entityType || 'item'}.
            </DialogDescription>
          </DialogHeader>
          <div className="p-6">
            <div className="space-y-4">
              <div>
                <label htmlFor="rejectReason" className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                  Rejection Reason <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="rejectReason"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Tell the restaurant why this item was rejected..."
                  required
                  rows={4}
                  className="w-full rounded-xl border border-gray-200 bg-slate-50 px-4 py-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all"
                />
              </div>
            </div>
            <DialogFooter className="mt-6 flex gap-2">
              <button
                type="button"
                onClick={() => setShowRejectModal(false)}
                className="flex-1 px-4 py-2.5 text-sm font-bold text-gray-500 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleReject}
                disabled={processing || !rejectReason.trim()}
                className="flex-1 px-4 py-2.5 text-sm font-bold text-white bg-red-600 rounded-xl hover:bg-red-700 shadow-lg shadow-red-100 transition-all active:scale-95 disabled:opacity-50"
              >
                {processing ? "Processing..." : "Confirm Rejection"}
              </button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
