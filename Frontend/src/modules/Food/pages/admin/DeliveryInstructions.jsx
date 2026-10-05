import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader2, Trash2, Plus, GripVertical } from "lucide-react"
import apiClient from "@food/api/axios"

/**
 * The checkout chip list ("Don't ring bell", "Leave at door", ...) the
 * customer app shows on the cart screen and lets a customer pick from.
 * Whatever's picked is saved on the order and shown to the delivery partner
 * (order.model.js `deliveryInstructions`, orders/services/order.helpers.js).
 */

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 ${checked ? "bg-emerald-600" : "bg-neutral-300"}`}
    >
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0.5"}`} />
    </button>
  )
}

export default function DeliveryInstructions() {
  const [rows, setRows] = useState(null)
  const [newLabel, setNewLabel] = useState("")
  const [adding, setAdding] = useState(false)
  const [busyId, setBusyId] = useState(null)

  const load = () => {
    apiClient
      .get("/food/admin/delivery-instructions", { contextModule: "admin" })
      .then((res) => setRows(res?.data?.data || []))
      .catch((err) => toast.error(err?.response?.data?.message || "Could not load delivery instructions"))
  }

  useEffect(load, [])

  const addRow = async () => {
    const label = newLabel.trim()
    if (!label) return
    setAdding(true)
    try {
      const res = await apiClient.post("/food/admin/delivery-instructions", { label }, { contextModule: "admin" })
      setRows((prev) => [...(prev || []), res?.data?.data])
      setNewLabel("")
      toast.success("Added. It's live on the checkout screen now.")
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not add this instruction")
    } finally {
      setAdding(false)
    }
  }

  const toggleActive = async (row) => {
    setBusyId(row.id)
    try {
      const res = await apiClient.patch(
        `/food/admin/delivery-instructions/${row.id}`,
        { isActive: !row.isActive },
        { contextModule: "admin" },
      )
      const updated = res?.data?.data
      setRows((prev) => prev.map((r) => (r.id === row.id ? updated : r)))
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not save")
    } finally {
      setBusyId(null)
    }
  }

  const renameRow = async (row, label) => {
    const trimmed = label.trim()
    if (!trimmed || trimmed === row.label) return
    try {
      const res = await apiClient.patch(
        `/food/admin/delivery-instructions/${row.id}`,
        { label: trimmed },
        { contextModule: "admin" },
      )
      const updated = res?.data?.data
      setRows((prev) => prev.map((r) => (r.id === row.id ? updated : r)))
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not save")
      load()
    }
  }

  const removeRow = async (row) => {
    if (!window.confirm(`Remove "${row.label}"? Orders already placed with it keep it — only the checkout list changes.`)) return
    setBusyId(row.id)
    try {
      await apiClient.delete(`/food/admin/delivery-instructions/${row.id}`, { contextModule: "admin" })
      setRows((prev) => prev.filter((r) => r.id !== row.id))
      toast.success("Removed.")
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not remove")
    } finally {
      setBusyId(null)
    }
  }

  if (!rows) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-neutral-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading
      </div>
    )
  }

  return (
    <div className="min-h-full bg-neutral-100 p-4 lg:p-6">
      <div className="mx-auto max-w-2xl space-y-5">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Delivery instructions</h1>
          <p className="mt-1 text-sm text-neutral-600">
            The chip options a customer can pick on the checkout screen (e.g. "Leave at door"). Whatever they pick is
            saved on the order and shown to the delivery partner. Turn one off to hide it from checkout without
            deleting it — orders already placed keep whatever was picked.
          </p>
        </div>

        <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
          {rows.length === 0 ? (
            <p className="px-5 py-6 text-center text-sm text-neutral-500">No delivery instructions yet. Add the first one below.</p>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {rows.map((row) => (
                <li key={row.id} className="flex items-center gap-3 px-5 py-3">
                  <GripVertical className="h-4 w-4 shrink-0 text-neutral-300" />
                  <input
                    defaultValue={row.label}
                    onBlur={(e) => renameRow(row, e.target.value)}
                    className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm text-neutral-900 hover:border-neutral-200 focus:border-neutral-300 focus:bg-neutral-50 focus:outline-none"
                  />
                  <Toggle
                    checked={row.isActive}
                    onChange={() => toggleActive(row)}
                    label={row.isActive ? `Hide "${row.label}"` : `Show "${row.label}"`}
                  />
                  <button
                    type="button"
                    disabled={busyId === row.id}
                    onClick={() => removeRow(row)}
                    className="rounded-lg p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                    aria-label={`Remove ${row.label}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center gap-2 border-t border-neutral-100 bg-neutral-50 px-5 py-3">
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addRow()}
              placeholder={'e.g. "🔔 Don\'t ring bell"'}
              className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900/10"
            />
            <button
              type="button"
              disabled={!newLabel.trim() || adding}
              onClick={addRow}
              className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-4 py-1.5 text-sm font-semibold text-white hover:bg-neutral-800 disabled:bg-neutral-300"
            >
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
