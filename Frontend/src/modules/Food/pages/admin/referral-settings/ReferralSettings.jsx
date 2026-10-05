import { useEffect, useState } from "react"
import { Save, Loader2, Gift } from "lucide-react"
import { Button } from "@food/components/ui/button"
import { adminAPI } from "@food/api"
import { toast } from "sonner"

const debugError = (...args) => {}

export default function ReferralSettings() {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState({
    referralRewardUser: "",
    referralRewardDelivery: "",
    referralLimitUser: "",
    referralLimitDelivery: "",
  })

  const fetchSettings = async () => {
    try {
      setLoading(true)
      const res = await adminAPI.getReferralSettings()
      const s = res?.data?.data?.referralSettings
      if (res?.data?.success && s) {
        setSettings({
          referralRewardUser: s.referralRewardUser ?? "",
          referralRewardDelivery: s.referralRewardDelivery ?? "",
          referralLimitUser: s.referralLimitUser ?? "",
          referralLimitDelivery: s.referralLimitDelivery ?? "",
        })
      } else {
        setSettings({
          referralRewardUser: "",
          referralRewardDelivery: "",
          referralLimitUser: "",
          referralLimitDelivery: "",
        })
      }
    } catch (e) {
      debugError("Error fetching referral settings:", e)
      toast.error("Failed to load referral settings")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSettings()
  }, [])

  const handleSave = async () => {
    try {
      setSaving(true)
      const body = {
        referralRewardUser: settings.referralRewardUser === "" ? 0 : Number(settings.referralRewardUser),
        referralRewardDelivery: settings.referralRewardDelivery === "" ? 0 : Number(settings.referralRewardDelivery),
        referralLimitUser: settings.referralLimitUser === "" ? 0 : Number(settings.referralLimitUser),
        referralLimitDelivery: settings.referralLimitDelivery === "" ? 0 : Number(settings.referralLimitDelivery),
        isActive: true,
      }
      const res = await adminAPI.createOrUpdateReferralSettings(body)
      if (res?.data?.success) {
        toast.success("Referral settings saved successfully")
        const saved = res?.data?.data?.referralSettings
        if (saved) {
          setSettings({
            referralRewardUser: saved.referralRewardUser ?? "",
            referralRewardDelivery: saved.referralRewardDelivery ?? "",
            referralLimitUser: saved.referralLimitUser ?? "",
            referralLimitDelivery: saved.referralLimitDelivery ?? "",
          })
        }
      } else {
        toast.error(res?.data?.message || "Failed to save referral settings")
      }
    } catch (e) {
      debugError("Error saving referral settings:", e)
      toast.error(e?.response?.data?.message || "Failed to save referral settings")
    } finally {
      setSaving(false)
    }
  }

  const onChange = (key) => (e) => {
    const v = String(e.target.value ?? "")
      .replace(/[^\d.]/g, "")
      .replace(/^0+(\d)/, "$1")
    setSettings((prev) => ({ ...prev, [key]: v }))
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary-orange/80 to-accent-orange flex items-center justify-center">
            <Gift className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Referral Settings</h1>
        </div>
        <p className="text-sm text-slate-600">
          Configure referral reward amounts and maximum credits per referrer.
        </p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Configuration</h2>
              <p className="text-sm text-slate-500 mt-1">
                These values apply instantly to new referrals.
              </p>
            </div>
            <Button
              onClick={handleSave}
              disabled={saving || loading}
              className="bg-accent-orange hover:bg-accent-orange/90 text-white flex items-center gap-2"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save Settings
                </>
              )}
            </Button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-accent-orange" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="border border-slate-200 rounded-xl p-4">
                <h3 className="font-semibold text-slate-900 mb-3">User Referral</h3>
                <label className="block text-sm text-slate-600 mb-1">Reward amount (₹)</label>
                <input
                  value={settings.referralRewardUser}
                  onChange={onChange("referralRewardUser")}
                  inputMode="numeric"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2"
                  placeholder="e.g. 50"
                />
                <label className="block text-sm text-slate-600 mb-1 mt-3">Max credits per referrer</label>
                <input
                  value={settings.referralLimitUser}
                  onChange={onChange("referralLimitUser")}
                  inputMode="numeric"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2"
                  placeholder="e.g. 10"
                />
              </div>

              <div className="border border-slate-200 rounded-xl p-4">
                <h3 className="font-semibold text-slate-900 mb-3">Delivery Partner Referral</h3>
                <label className="block text-sm text-slate-600 mb-1">Reward amount (₹)</label>
                <input
                  value={settings.referralRewardDelivery}
                  onChange={onChange("referralRewardDelivery")}
                  inputMode="numeric"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2"
                  placeholder="e.g. 2000"
                />
                <label className="block text-sm text-slate-600 mb-1 mt-3">Max credits per referrer</label>
                <input
                  value={settings.referralLimitDelivery}
                  onChange={onChange("referralLimitDelivery")}
                  inputMode="numeric"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2"
                  placeholder="e.g. 5"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

