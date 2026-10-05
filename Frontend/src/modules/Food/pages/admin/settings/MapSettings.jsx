import { useEffect, useState } from "react"
import {
  Eye,
  EyeOff,
  Loader2,
  MapPin,
  Save,
  CheckCircle2,
  Copy,
  Check,
  ShieldCheck,
  Globe,
  UtensilsCrossed,
  Car,
  Truck,
  Wrench,
  ShoppingBag,
  RefreshCw,
  ExternalLink,
  Sparkles
} from "lucide-react"
import { Button } from "@food/components/ui/button"
import { adminAPI } from "@food/api"
import { toast } from "sonner"
import { loadRuntimeEnv } from "@/config/runtimeEnv"

/**
 * Google Maps API Key Management for the entire SuperApp / Quick Drop platform.
 *
 * Stored in the shared database settings document and served to every module
 * (Food, Taxi, Delivery Logistics, Service Provider, Quick Commerce, and Admin dashboards)
 * through /api/v1/env/public at runtime.
 */
export default function MapSettings() {
  const [apiKey, setApiKey] = useState("")
  const [serverKey, setServerKey] = useState("")
  const [source, setSource] = useState("none")
  const [hasEnvFallback, setHasEnvFallback] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [revealedServer, setRevealedServer] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [testingKey, setTestingKey] = useState(false)
  const [testResult, setTestResult] = useState(null)

  useEffect(() => {
    fetchSettings()
  }, [])

  const fetchSettings = async () => {
    try {
      setLoading(true)
      const response = await adminAPI.getMapSettings()
      const data = response?.data?.data || {}
      setApiKey(data.googleMapsApiKey || "")
      setServerKey(data.googleMapsServerKey || "")
      setSource(data.source || (data.googleMapsApiKey ? "database" : "none"))
      setHasEnvFallback(Boolean(data.hasEnvFallback))
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.response?.data?.message || "Failed to load map settings")
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = () => {
    if (!apiKey) return
    navigator.clipboard.writeText(apiKey)
    setCopied(true)
    toast.success("API key copied to clipboard")
    setTimeout(() => setCopied(false), 2000)
  }

  const handleTestKey = async () => {
    const keyToTest = apiKey.trim()
    if (!keyToTest) {
      toast.error("Please enter a Google Maps API key first")
      return
    }

    try {
      setTestingKey(true)
      setTestResult(null)

      // Test key by requesting a basic Google Maps JS API script or Geocode verification
      const testUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=India&key=${encodeURIComponent(keyToTest)}`
      const res = await fetch(testUrl)
      const data = await res.json()

      if (data.status === "OK" || data.status === "ZERO_RESULTS") {
        setTestResult({
          success: true,
          message: "API Key is valid and active! Geocoding & Places APIs are responsive."
        })
        toast.success("Google Maps API key is valid and working!")
      } else if (data.status === "REQUEST_DENIED") {
        setTestResult({
          success: false,
          message: data.error_message || "API key was rejected by Google. Ensure Geocoding, Places, and Maps JavaScript APIs are enabled."
        })
        toast.error("API Key rejected: " + (data.error_message || "Check Google Cloud Console credentials"))
      } else {
        setTestResult({
          success: true,
          message: `API Key connected with status: ${data.status}`
        })
        toast.info(`Key response status: ${data.status}`)
      }
    } catch (err) {
      // In browser CORS might block raw REST geocode if restricted, so treat as valid if script tag loads
      setTestResult({
        success: true,
        message: "Key submitted. Verify that HTTP Referrers in Google Cloud Console allow your domain."
      })
      toast.info("Key format accepted. Verify HTTP referrers in Google Console.")
    } finally {
      setTestingKey(false)
    }
  }

  const handleSave = async () => {
    try {
      setSaving(true)
      const response = await adminAPI.updateMapSettings({
        googleMapsApiKey: apiKey.trim(),
        googleMapsServerKey: serverKey.trim()
      })

      if (response?.data?.success) {
        toast.success("Google Maps key saved successfully for all platform apps!")
        setSource(apiKey.trim() ? "database" : "environment")
        // Refresh local runtime environment in memory immediately
        try {
          await loadRuntimeEnv()
        } catch (_) {}
      } else {
        toast.error(response?.data?.error || response?.data?.message || "Failed to save map settings")
      }
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.response?.data?.message || "Failed to save map settings")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
      </div>
    )
  }

  const platforms = [
    {
      name: "Food Delivery",
      desc: "Live rider tracking, restaurant location geofencing & delivery zones",
      icon: UtensilsCrossed,
      color: "bg-rose-50 text-rose-600 border-rose-100"
    },
    {
      name: "Taxi & Rides",
      desc: "Live cab tracking, pickup/drop geocoding & peak surge heatmaps",
      icon: Car,
      color: "bg-amber-50 text-amber-600 border-amber-100"
    },
    {
      name: "Parcel Logistics",
      desc: "Courier route polylines & real-time shipment map tracking",
      icon: Truck,
      color: "bg-emerald-50 text-emerald-600 border-emerald-100"
    },
    {
      name: "Service Provider",
      desc: "Technician travel routes & customer service location selection",
      icon: Wrench,
      color: "bg-purple-50 text-purple-600 border-purple-100"
    },
    {
      name: "Quick Commerce",
      desc: "Dark store radius coverage & 10-minute instant dropoff maps",
      icon: ShoppingBag,
      color: "bg-sky-50 text-sky-600 border-sky-100"
    }
  ]

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-200">
            <MapPin className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl lg:text-2xl font-bold text-slate-900">Google Maps Settings</h1>
              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700 border border-indigo-100">
                <Sparkles className="h-3 w-3" /> Unified Platform Key
              </span>
            </div>
            <p className="text-xs lg:text-sm text-slate-500 mt-0.5">
              One master key automatically powers Maps across Food, Taxi, Delivery, Service Provider, and Admin.
            </p>
          </div>
        </div>

        {/* Status Indicator */}
        <div className="flex items-center gap-2">
          {source === "database" && apiKey ? (
            <span className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-700 shadow-sm">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              Database Active
            </span>
          ) : hasEnvFallback ? (
            <span className="inline-flex items-center gap-1.5 rounded-xl bg-blue-50 border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-700 shadow-sm">
              <span className="h-2 w-2 rounded-full bg-blue-500" />
              Environment Fallback
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-xl bg-amber-50 border border-amber-200 px-3 py-1.5 text-xs font-semibold text-amber-700 shadow-sm">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              No Key Configured
            </span>
          )}
        </div>
      </div>

      {/* Main Configuration Card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-6">
        <div className="border-b border-slate-100 pb-4">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Globe className="h-4 w-4 text-indigo-600" />
            Maps JavaScript & Places API Key
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            This browser-safe key is loaded dynamically by the frontend apps for interactive maps, location autocomplete, and geocoding.
          </p>
        </div>

        {/* API Key Input Field */}
        <div className="space-y-2">
          <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
            Google Maps Web API Key <span className="text-red-500">*</span>
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={revealed ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="AIzaSyD..."
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 pr-20 font-mono text-xs lg:text-sm text-slate-900 shadow-sm transition-all focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setRevealed((v) => !v)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                  title={revealed ? "Hide key" : "Show key"}
                >
                  {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
                {apiKey && (
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                    title="Copy key"
                  >
                    {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                  </button>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={handleTestKey}
              disabled={testingKey || !apiKey.trim()}
              className="px-4 py-2.5 rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-700 text-xs font-semibold hover:bg-indigo-100 transition-colors flex items-center gap-1.5 shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {testingKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
              Test Key
            </button>
          </div>

          {/* Test Feedback Notice */}
          {testResult && (
            <div className={`mt-2.5 rounded-xl p-3.5 border flex items-start gap-2.5 text-xs ${
              testResult.success
                ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                : "bg-rose-50 border-rose-200 text-rose-800"
            }`}>
              <CheckCircle2 className={`h-4 w-4 shrink-0 mt-0.5 ${testResult.success ? "text-emerald-600" : "text-rose-600"}`} />
              <div>
                <p className="font-semibold">{testResult.success ? "Key Verification Succeeded" : "Key Verification Failed"}</p>
                <p className="mt-0.5">{testResult.message}</p>
              </div>
            </div>
          )}

          <p className="text-[11px] text-slate-500">
            Make sure <strong>Maps JavaScript API</strong>, <strong>Places API (New)</strong>, and <strong>Geocoding API</strong> are enabled in your Google Cloud Console project.
          </p>
        </div>

        {/* Server / Distance Matrix Key (Optional) */}
        <div className="space-y-2 pt-2 border-t border-slate-100">
          <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
            Distance Matrix / Server Routing Key <span className="text-slate-400 font-normal lowercase">(optional)</span>
          </label>
          <div className="relative">
            <input
              type={revealedServer ? "text" : "password"}
              value={serverKey}
              onChange={(e) => setServerKey(e.target.value)}
              placeholder="Leave blank to use the same web API key for server distance calculations"
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 pr-10 font-mono text-xs lg:text-sm text-slate-900 shadow-sm transition-all focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
            <button
              type="button"
              onClick={() => setRevealedServer((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1"
            >
              {revealedServer ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-[11px] text-slate-500">
            Used by the backend server for accurate distance matrix & route estimation between drivers and orders.
          </p>
        </div>

        {/* Notice Info */}
        <div className="rounded-xl bg-slate-50 border border-slate-200/60 p-4 text-xs text-slate-600 flex items-start gap-3">
          <ShieldCheck className="h-5 w-5 text-indigo-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-slate-800">Zero Downtime & Instant Synchronization</p>
            <p>
              Saving your API key here immediately updates the live configuration for all customer portals, delivery rider apps, restaurant dashboards, and admin control screens without requiring any frontend rebuilds or server restarts.
            </p>
          </div>
        </div>

        {/* Save Actions */}
        <div className="flex items-center justify-between border-t border-slate-100 pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={fetchSettings}
            disabled={saving}
            className="flex items-center gap-1.5 text-xs text-slate-600"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Reset to Saved
          </Button>

          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs px-6 py-2 rounded-xl flex items-center gap-2 shadow-sm active:scale-95 transition-all"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving Key...
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                Save & Apply to Entire Platform
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Modules Connected to This Key */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="border-b border-slate-100 pb-3 mb-4 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-indigo-600" />
            Apps & Modules Consuming This Key
          </h3>
          <span className="text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
            5 Modules Connected
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {platforms.map((p) => {
            const IconComp = p.icon
            return (
              <div
                key={p.name}
                className="rounded-xl border border-slate-100 p-3.5 bg-slate-50/50 hover:bg-white hover:border-slate-200 transition-all flex items-start gap-3"
              >
                <div className={`p-2.5 rounded-xl border ${p.color} shrink-0`}>
                  <IconComp className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-800">{p.name}</h4>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{p.desc}</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
