import { useEffect, useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react"

/**
 * Client-side pagination for the long admin lists.
 *
 * The lists render every row in a horizontally scrolling table, so on a long
 * list the horizontal scrollbar sat below hundreds of rows and was out of
 * reach. Paging the rows (5 by default, as operations asked) and capping the
 * table height together keep that scrollbar on screen.
 *
 * The chosen page size is remembered per list (localStorage, best-effort).
 */
export const PAGE_SIZE_OPTIONS = [5, 10, 25, 50]
export const DEFAULT_PAGE_SIZE = 5

/** The table wrapper: caps height so the horizontal scrollbar stays visible. Pair with a sticky <thead>. */
export const SCROLL_TABLE_CLASS = "overflow-auto max-h-[70vh]"
/** For the <thead>: stays visible while the rows scroll under it. */
export const STICKY_THEAD_CLASS = "sticky top-0 z-10"

const readStoredSize = (storageKey) => {
  try {
    const n = Number(localStorage.getItem(`admin_page_size:${storageKey}`))
    return PAGE_SIZE_OPTIONS.includes(n) ? n : null
  } catch {
    return null
  }
}

/**
 * @param {Array} items        the full, already filtered and sorted list
 * @param {object} options
 * @param {string} options.storageKey   remembers this list's page size
 * @param {Array}  [options.resetOn]    values that send the list back to page 1 (search, filters)
 * @param {number} [options.defaultPageSize]  first-visit page size (default 5)
 */
export function usePagination(items, { storageKey, resetOn = [], defaultPageSize = DEFAULT_PAGE_SIZE } = {}) {
  const [pageSize, setPageSizeState] = useState(() => (storageKey && readStoredSize(storageKey)) || defaultPageSize)
  const [page, setPage] = useState(1)
  const total = Array.isArray(items) ? items.length : 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const setPageSize = (size) => {
    setPageSizeState(size)
    setPage(1)
    if (storageKey) {
      try {
        localStorage.setItem(`admin_page_size:${storageKey}`, String(size))
      } catch {
        // Private mode: the choice just isn't remembered.
      }
    }
  }

  // New search or filter: back to the first page.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(1) }, resetOn)

  // The list shrank under the current page (a delete, a filter): clamp.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  const pageItems = useMemo(() => {
    const start = (page - 1) * pageSize
    return (items || []).slice(start, start + pageSize)
  }, [items, page, pageSize])

  return {
    page,
    pageSize,
    total,
    totalPages,
    pageItems,
    /** 1-based row number across all pages, for the "#" column. */
    rowNumber: (indexOnPage) => (page - 1) * pageSize + indexOnPage + 1,
    setPage: (p) => setPage(Math.min(Math.max(1, p), totalPages)),
    setPageSize,
  }
}

/**
 * The same pager for a list the SERVER pages: the page asks the API for
 * `page`/`pageSize` and reports the server's total with `setTotal`. Works with
 * <TablePagination pagination={...} /> like usePagination.
 */
export function useServerPagination({ storageKey, resetOn = [], defaultPageSize = 10 } = {}) {
  const [pageSize, setPageSizeState] = useState(() => (storageKey && readStoredSize(storageKey)) || defaultPageSize)
  const [page, setPageState] = useState(1)
  const [total, setTotal] = useState(0)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setPageState(1) }, resetOn)
  useEffect(() => {
    if (total > 0 && page > totalPages) setPageState(totalPages)
  }, [page, total, totalPages])

  return {
    page,
    pageSize,
    total,
    totalPages,
    setTotal,
    rowNumber: (indexOnPage) => (page - 1) * pageSize + indexOnPage + 1,
    setPage: (p) => setPageState(Math.min(Math.max(1, p), totalPages)),
    setPageSize: (size) => {
      setPageSizeState(size)
      setPageState(1)
      if (storageKey) {
        try {
          localStorage.setItem(`admin_page_size:${storageKey}`, String(size))
        } catch {
          // Private mode: the choice just isn't remembered.
        }
      }
    },
  }
}

/** Page numbers to show: first, last, and a window around the current page. */
const pageWindow = (page, totalPages) => {
  const pages = new Set([1, totalPages, page - 1, page, page + 1])
  const sorted = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b)
  const out = []
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push("…")
    out.push(p)
  })
  return out
}

export default function TablePagination({ pagination, label = "rows" }) {
  const { page, pageSize, total, totalPages, setPage, setPageSize } = pagination
  if (total === 0) return null
  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  const btn = "inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"

  return (
    <div className="flex flex-col gap-3 border-t border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3 text-sm text-slate-600">
        <span>
          Showing <span className="font-semibold text-slate-800">{from}</span>–
          <span className="font-semibold text-slate-800">{to}</span> of{" "}
          <span className="font-semibold text-slate-800">{total}</span> {label}
        </span>
        <label className="flex items-center gap-1.5">
          <span className="text-slate-500">Rows per page</span>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="h-8 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-700 outline-none focus:border-slate-500"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex items-center gap-1">
        <button type="button" className={`${btn} border-slate-200 text-slate-600 hover:bg-slate-50`} onClick={() => setPage(1)} disabled={page === 1} aria-label="First page">
          <ChevronsLeft className="h-4 w-4" />
        </button>
        <button type="button" className={`${btn} border-slate-200 text-slate-600 hover:bg-slate-50`} onClick={() => setPage(page - 1)} disabled={page === 1} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </button>
        {pageWindow(page, totalPages).map((p, i) =>
          p === "…" ? (
            <span key={`gap-${i}`} className="px-1 text-slate-400">…</span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => setPage(p)}
              aria-current={p === page ? "page" : undefined}
              className={`${btn} ${p === page ? "border-blue-600 bg-blue-600 font-semibold text-white" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}
            >
              {p}
            </button>
          ),
        )}
        <button type="button" className={`${btn} border-slate-200 text-slate-600 hover:bg-slate-50`} onClick={() => setPage(page + 1)} disabled={page >= totalPages} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </button>
        <button type="button" className={`${btn} border-slate-200 text-slate-600 hover:bg-slate-50`} onClick={() => setPage(totalPages)} disabled={page >= totalPages} aria-label="Last page">
          <ChevronsRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
