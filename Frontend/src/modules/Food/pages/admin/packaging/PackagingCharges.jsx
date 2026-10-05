import { useEffect, useState } from "react"
import { Loader2, Package, Save } from "lucide-react"
import { Button } from "@food/components/ui/button"
import { adminAPI } from "@food/api"
import { toast } from "sonner"

/**
 * Who owns the food packaging charge:
 *   ADMIN      - one flat charge per order, kept by the platform.
 *   RESTAURANT - each restaurant sets a per-unit charge on its own menu items.
 * Stored on the single active fee settings doc.
 */
export default function PackagingCharges() {
  const [isEnabled, setIsEnabled] = useState(false)
  const [mode, setMode] = useState("ADMIN")
  const [adminChargePerOrder, setAdminChargePerOrder] = useState("")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        setLoading(true)
        const response = await adminAPI.getFeeSettings()
        const saved = response?.data?.data?.feeSettings?.packagingCharge
        setIsEnabled(saved?.isEnabled === true)
        setMode(saved?.mode === "RESTAURANT" ? "RESTAURANT" : "ADMIN")
        setAdminChargePerOrder(
          saved?.adminChargePerOrder !== undefined && saved?.adminChargePerOrder !== null
            ? String(saved.adminChargePerOrder)
            : ""
        )
      } catch (error) {
        toast.error("Failed to load packaging settings")
      } finally {
        setLoading(false)
      }
    }
    fetchSettings()
  }, [])

  const handleSave = async () => {
    const charge = Number(adminChargePerOrder)
    if (isEnabled && mode === "ADMIN" && (!Number.isFinite(charge) || charge <= 0)) {
      toast.error("Enter a packaging charge per order, or turn the charge off")
      return
    }

    try {
      setSaving(true)
      const response = await adminAPI.createOrUpdateFeeSettings({
        packagingCharge: {
          isEnabled,
          mode,
          adminChargePerOrder: isEnabled && mode === "ADMIN" ? (Number.isFinite(charge) ? charge : 0) : 0,
        },
      })
      if (response?.data?.success) {
        toast.success("Packaging charges saved successfully")
      } else {
        toast.error(response?.data?.error || response?.data?.message || "Failed to save packaging charges")
      }
    } catch (error) {
      toast.error(
        error?.response?.data?.error || error?.response?.data?.message || "Failed to save packaging charges"
      )
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100">
          <Package className="h-5 w-5 text-slate-700" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Packaging Charges</h1>
          <p className="text-sm text-slate-500">
            Choose who charges for packaging and how much.
          </p>
        </div>
      </div>

      <div className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-900">Packaging charge</p>
            <p className="text-xs text-slate-500">
              When off, no packaging fee is added to any order.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsEnabled((v) => !v)}
            aria-pressed={isEnabled}
            className={`relative h-6 w-11 rounded-full transition-colors ${isEnabled ? "bg-slate-900" : "bg-slate-300"}`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${isEnabled ? "left-[22px]" : "left-0.5"}`}
            />
          </button>
        </div>

        {isEnabled && (
          <>
            <div className="space-y-3">
              <p className="text-sm font-semibold text-slate-900">Charged by</p>
              {[
                {
                  value: "ADMIN",
                  title: "Admin",
                  hint: "One flat charge per order. The platform keeps it.",
                },
                {
                  value: "RESTAURANT",
                  title: "Restaurant",
                  hint: "Each restaurant sets a per-unit charge on its own items, and keeps it.",
                },
              ].map((option) => (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${
                    mode === option.value
                      ? "border-slate-900 bg-slate-50"
                      : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="packagingMode"
                    value={option.value}
                    checked={mode === option.value}
                    onChange={() => setMode(option.value)}
                    className="mt-1"
                  />
                  <span>
                    <span className="block text-sm font-medium text-slate-900">
                      {option.title}
                    </span>
                    <span className="block text-xs text-slate-500">{option.hint}</span>
                  </span>
                </label>
              ))}
            </div>

            {mode === "ADMIN" && (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Charge per order (₹)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={adminChargePerOrder}
                  onChange={(e) => setAdminChargePerOrder(e.target.value)}
                  placeholder="e.g. 10"
                  className="w-full max-w-xs rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
            )}

            {mode === "RESTAURANT" && (
              <p className="rounded-xl bg-amber-50 p-4 text-xs text-amber-800">
                Restaurants set the amount per item in their menu. Items with no
                packaging charge configured add nothing to the order.
              </p>
            )}
          </>
        )}

        <div className="flex justify-end border-t border-slate-100 pt-4">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            {saving ? "Saving..." : "Save changes"}
          </Button>
        </div>
      </div>
    </div>
  )
}
