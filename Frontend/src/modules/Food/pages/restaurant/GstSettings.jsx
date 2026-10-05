import { useEffect, useMemo, useState } from "react"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"
import { motion } from "framer-motion"
import { ArrowLeft, Receipt, AlertTriangle, Loader2 } from "lucide-react"
import { Switch } from "@food/components/ui/switch"
import { restaurantAPI } from "@food/api"
import { toast } from "sonner"

const SAMPLE_PRICE = 200

const money = (n) =>
  `₹${Number(n || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

/**
 * What a menu price of Rs 200 means under each setting.
 *
 * The same two sums the bill uses, so what the restaurant is shown here is what
 * the customer will actually be charged. Exclusive adds the tax on top;
 * inclusive takes it out of the price, which is not the same figure -- 5% of
 * 200 is 10, but the 5% inside 200 is 9.52.
 */
const previewFor = (price, rate, inclusive) => {
  const fraction = Math.max(0, Number(rate) || 0) / 100
  const net = inclusive ? price / (1 + fraction) : price
  const tax = inclusive ? price - net : price * fraction
  return {
    net: Math.round(net * 100) / 100,
    tax: Math.round(tax * 100) / 100,
    customerPays: Math.round((net + tax) * 100) / 100,
  }
}

export default function GstSettings() {
  const goBack = useRestaurantBackNavigation()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [inclusive, setInclusive] = useState(false)
  const [gstRate, setGstRate] = useState(0)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const response = await restaurantAPI.getTaxSettings()
        const data = response?.data?.data || response?.data || {}
        if (cancelled) return
        setInclusive(data.priceIncludesGst === true)
        setGstRate(Number(data.gstRate) || 0)
      } catch {
        if (!cancelled) toast.error("Could not load your GST setting")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const preview = useMemo(
    () => previewFor(SAMPLE_PRICE, gstRate, inclusive),
    [gstRate, inclusive],
  )

  const handleToggle = async (checked) => {
    const next = Boolean(checked)
    const previous = inclusive
    // Shown immediately and rolled back on failure, so the switch never sits in
    // a position the server did not accept.
    setInclusive(next)
    setSaving(true)
    try {
      await restaurantAPI.updateTaxSettings(next)
      toast.success(
        next
          ? "Your menu prices now include GST"
          : "GST will be added on top of your menu prices",
      )
    } catch (error) {
      setInclusive(previous)
      toast.error(
        error?.response?.data?.message || "Could not save your GST setting",
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50/60 flex flex-col pb-28 text-gray-900">
      <div className="bg-white/95 backdrop-blur-md border-b border-gray-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3.5 flex items-center gap-3">
          <button
            onClick={goBack}
            className="p-2 -ml-2 hover:bg-gray-100 rounded-xl text-gray-600 hover:text-gray-900 transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-base sm:text-lg font-bold text-gray-900">GST on menu prices</h1>
            <p className="text-xs text-gray-500 hidden sm:block">
              Tell us whether the prices you enter already include tax
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto w-full flex-1 px-4 sm:px-6 py-6 space-y-4">
        {loading ? (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-10 flex items-center justify-center gap-2 text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading your setting</span>
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="space-y-4"
          >
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-5">
              <div className="flex items-center gap-3 pb-3 border-b border-gray-100">
                <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center">
                  <Receipt className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-gray-900">Price entry</h2>
                  <p className="text-xs text-gray-500">
                    Applies to every dish on your menu, now and in future
                  </p>
                </div>
              </div>

              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <p className="text-base font-bold text-gray-900 mb-1.5">
                    My prices already include GST
                  </p>
                  <p className="text-sm text-gray-500">
                    {inclusive
                      ? "The price you type is the whole price. We take the tax out of it, so the customer pays exactly what your menu says."
                      : "The price you type is before tax. We add GST on top, so the customer pays more than your menu says."}
                  </p>
                </div>
                <Switch
                  checked={inclusive}
                  onCheckedChange={handleToggle}
                  disabled={saving}
                  aria-label="Menu prices include GST"
                />
              </div>
            </div>

            {/* What the setting does to a real price, in the customer's terms. */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-4">
              <div>
                <h2 className="text-base font-bold text-gray-900">
                  A dish priced at {money(SAMPLE_PRICE)}
                </h2>
                <p className="text-xs text-gray-500">
                  GST is currently {gstRate}%, set by the platform
                </p>
              </div>

              <div className="rounded-xl border border-gray-100 bg-neutral-50/70 divide-y divide-gray-100 text-sm">
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-gray-600">You earn</span>
                  <span className="font-semibold text-gray-900">{money(preview.net)}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-gray-600">GST @ {gstRate}%</span>
                  <span className="font-semibold text-gray-900">{money(preview.tax)}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3 bg-white">
                  <span className="font-bold text-gray-900">Customer pays for the dish</span>
                  <span className="font-bold text-gray-900">{money(preview.customerPays)}</span>
                </div>
              </div>

              <p className="text-xs text-gray-500">
                Delivery, platform and packaging charges are added separately at
                checkout. Commission is charged on what you earn, never on the
                tax.
              </p>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex gap-3">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800 leading-relaxed">
                Changing this does not change any price you have entered &mdash; it
                changes what those prices mean. Turning it on makes every dish
                cheaper for the customer by the tax amount; turning it off makes
                every dish dearer. Check your menu after switching.
              </p>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  )
}
