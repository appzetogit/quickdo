import { useMemo, useState, useEffect } from "react"
import { Save, Loader2, DollarSign, Plus, Pencil, Trash2 } from "lucide-react"
import { Button } from "@food/components/ui/button"
import { adminAPI, platformSettingsAPI } from "@food/api"
import { Link } from "react-router-dom"
import { toast } from "sonner"

const toNum = (v, fallback = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export default function FeeSettings() {
  const [feeSettings, setFeeSettings] = useState({
    deliveryFeeComputationMode: "distance_order_value",
    distanceSlabAdminDeliveryCommission: [],
    deliveryPartnerIncentiveRule: {
      isEnabled: false,
      minOrderAmount: "0",
      incentivePercent: "0",
    },
    freeDeliveryRule: {
      isEnabled: false,
      maxDistanceKm: "3",
      minOrderAmount: "300",
    },
    platformFee: "",
    gstRate: "",
    platformFeeGstRate: "",
    codOrderLimit: "",
    maxOrderQuantityCeiling: "",
  })
  const [distanceRules, setDistanceRules] = useState([])
  // Master > Delivery earnings formula in force, if one is saved: this table is then unused.
  const [masterFormula, setMasterFormula] = useState(null)
  const [loadingFeeSettings, setLoadingFeeSettings] = useState(false)
  const [savingFeeSettings, setSavingFeeSettings] = useState(false)

  const [slabModalOpen, setSlabModalOpen] = useState(false)
  const [editingRule, setEditingRule] = useState(null)
  const [savingRule, setSavingRule] = useState(false)
  const [form, setForm] = useState({
    name: "",
    minDistance: "0",
    maxDistance: "",
    maxDistanceUnlimited: false,
    basePayout: "",
    commissionPerKm: "",
    status: true,
  })

  const [newRange, setNewRange] = useState({
    minDistance: "0",
    maxDistance: "",
    maxDistanceUnlimited: false,
    basePayout: "0",
    commissionPerKm: "0",
    adminCommissionPercent: "0",
  })

  const [zoneSurges, setZoneSurges] = useState([])
  const [savingZoneId, setSavingZoneId] = useState("")
  const [zoneSearchQuery, setZoneSearchQuery] = useState("")
  const [zonePage, setZonePage] = useState(1)
  const zonePageSize = 5

  const getDistanceRuleAdminCommissionConfig = (ruleId) =>
    feeSettings.distanceSlabAdminDeliveryCommission.find((r) => String(r.distanceRuleId) === String(ruleId)) || null

  const setDistanceRuleAdminCommissionConfig = (ruleId, updater) => {
    const prev = feeSettings.distanceSlabAdminDeliveryCommission
    const idx = prev.findIndex((r) => String(r.distanceRuleId) === String(ruleId))
    const next = [...prev]
    if (idx === -1) {
      next.push(updater({ distanceRuleId: String(ruleId), isEnabled: false, adminDeliveryCommissionPercent: 0 }))
    } else {
      next[idx] = updater(next[idx])
    }
    setFeeSettings((s) => ({ ...s, distanceSlabAdminDeliveryCommission: next }))
  }

  const sortedDistanceRules = useMemo(() => {
    return [...distanceRules].sort((a, b) => toNum(a.minDistance) - toNum(b.minDistance))
  }, [distanceRules])

  const filteredZoneSurges = useMemo(() => {
    const q = String(zoneSearchQuery || "").trim().toLowerCase()
    if (!q) return zoneSurges
    return zoneSurges.filter((z) => String(z.zoneName || "").toLowerCase().includes(q))
  }, [zoneSurges, zoneSearchQuery])

  const zoneTotalPages = Math.max(1, Math.ceil(filteredZoneSurges.length / zonePageSize))
  const paginatedZoneSurges = useMemo(() => {
    const safePage = Math.min(zonePage, zoneTotalPages)
    const start = (safePage - 1) * zonePageSize
    return filteredZoneSurges.slice(start, start + zonePageSize)
  }, [filteredZoneSurges, zonePage, zoneTotalPages])

  const fetchFeeSettings = async () => {
    try {
      setLoadingFeeSettings(true)
      const response = await adminAPI.getFeeSettings()
      const saved = response?.data?.data?.feeSettings
      if (saved) {
        setFeeSettings({
          deliveryFeeComputationMode: "distance_order_value",
          distanceSlabAdminDeliveryCommission: saved.distanceSlabAdminDeliveryCommission || [],
          deliveryPartnerIncentiveRule: {
            isEnabled: saved.deliveryPartnerIncentiveRule?.isEnabled === true,
            minOrderAmount: String(saved.deliveryPartnerIncentiveRule?.minOrderAmount ?? 0),
            incentivePercent: String(saved.deliveryPartnerIncentiveRule?.incentivePercent ?? 0),
          },
          freeDeliveryRule: {
            isEnabled: saved.freeDeliveryRule?.isEnabled === true,
            maxDistanceKm: String(saved.freeDeliveryRule?.maxDistanceKm ?? 3),
            minOrderAmount: String(saved.freeDeliveryRule?.minOrderAmount ?? 300),
          },
          platformFee: saved.platformFee ?? "",
          gstRate: saved.gstRate ?? "",
          platformFeeGstRate: saved.platformFeeGstRate ?? "",
          codOrderLimit: saved.codOrderLimit ?? "",
          maxOrderQuantityCeiling: saved.maxOrderQuantityCeiling ?? "",
        })
      } else {
        setFeeSettings({
          deliveryFeeComputationMode: "distance_order_value",
          distanceSlabAdminDeliveryCommission: [],
          deliveryPartnerIncentiveRule: {
            isEnabled: false,
            minOrderAmount: "0",
            incentivePercent: "0",
          },
          freeDeliveryRule: {
            isEnabled: false,
            maxDistanceKm: "3",
            minOrderAmount: "300",
          },
          platformFee: "",
          gstRate: "",
          platformFeeGstRate: "",
          codOrderLimit: "",
          maxOrderQuantityCeiling: "",
        })
      }
    } catch {
      toast.error("Failed to load fee settings")
    } finally {
      setLoadingFeeSettings(false)
    }
  }

  const fetchDistanceRules = async () => {
    try {
      const response = await adminAPI.getCommissionRules()
      const rows = response?.data?.data?.commissions || []
      setDistanceRules(Array.isArray(rows) ? rows : [])
    } catch {
      setDistanceRules([])
      toast.error("Failed to load distance slabs")
    }
  }

  const fetchZoneSurges = async () => {
    try {
      const response = await adminAPI.getZoneSurgeConfigs()
      const rows = response?.data?.data?.surgeConfigs
      setZoneSurges(Array.isArray(rows) ? rows : [])
      setZonePage(1)
    } catch {
      setZoneSurges([])
    }
  }

  useEffect(() => {
    fetchFeeSettings()
    fetchDistanceRules()
    fetchZoneSurges()
    // The quick-commerce panel mounts this same page.
    const vertical = window.location.pathname.includes("/quick-commerce") ? "quickCommerce" : "food"
    platformSettingsAPI
      .getEarnings(vertical)
      .then((res) => {
        const d = res?.data?.data
        setMasterFormula(d?.formula ? { source: d.formulaSource } : null)
      })
      .catch(() => setMasterFormula(null))
  }, [])

  const validateSlabPayload = ({ minDistance, maxDistance, basePayout, commissionPerKm }) => {
    if (!Number.isFinite(minDistance) || minDistance < 0) return "Minimum distance must be 0 or greater"
    if (maxDistance !== null && (!Number.isFinite(maxDistance) || maxDistance < minDistance)) return "Maximum distance must be greater than or equal to minimum distance"
    if (!Number.isFinite(basePayout) || basePayout < 0) return "Base payout must be 0 or greater"
    if (!Number.isFinite(commissionPerKm) || commissionPerKm < 0) return "Per km charge must be 0 or greater"
    if (minDistance > 0 && commissionPerKm <= 0) return "Non-base slab must have per km charge > 0"
    return null
  }

  const openEditSlab = (rule) => {
    setEditingRule(rule)
    const isUnlimited = rule.maxDistance == null
    setForm({
      name: rule.name || "",
      minDistance: String(rule.minDistance ?? 0),
      maxDistance: isUnlimited ? "" : String(rule.maxDistance ?? ""),
      maxDistanceUnlimited: isUnlimited,
      basePayout: String(rule.basePayout ?? 0),
      commissionPerKm: String(rule.commissionPerKm ?? 0),
      status: Boolean(rule.status),
    })
    setSlabModalOpen(true)
  }

  const handleSaveSlab = async () => {
    const minDistance = toNum(form.minDistance, NaN)
    const maxDistance = form.maxDistanceUnlimited || form.maxDistance === "" ? null : toNum(form.maxDistance, NaN)
    const basePayout = toNum(form.basePayout, NaN)
    const commissionPerKm = toNum(form.commissionPerKm, NaN)
    const validationError = validateSlabPayload({ minDistance, maxDistance, basePayout, commissionPerKm })
    if (validationError) {
      toast.error(validationError)
      return
    }
    try {
      setSavingRule(true)
      const payload = {
        name: String(form.name || "").trim() || (maxDistance == null ? `${minDistance}+ km` : `${minDistance}-${maxDistance} km`),
        minDistance,
        maxDistance,
        userDeliveryFee: commissionPerKm,
        basePayout,
        commissionPerKm,
        status: Boolean(form.status),
      }
      await adminAPI.updateCommissionRule(editingRule._id, payload)
      toast.success("Distance slab updated")
      setSlabModalOpen(false)
      await fetchDistanceRules()
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.response?.data?.message || "Failed to update distance slab")
    } finally {
      setSavingRule(false)
    }
  }

  const handleAddRange = async () => {
    const minDistance = toNum(newRange.minDistance, NaN)
    const maxDistance = newRange.maxDistanceUnlimited || newRange.maxDistance === "" ? null : toNum(newRange.maxDistance, NaN)
    const basePayout = toNum(newRange.basePayout, NaN)
    const commissionPerKm = toNum(newRange.commissionPerKm, NaN)
    const adminCommissionPercent = toNum(newRange.adminCommissionPercent, 0)
    const validationError = validateSlabPayload({ minDistance, maxDistance, basePayout, commissionPerKm })
    if (validationError) {
      toast.error(validationError)
      return
    }
    if (adminCommissionPercent < 0 || adminCommissionPercent > 100) {
      toast.error("Admin commission must be between 0 and 100")
      return
    }
    try {
      setSavingRule(true)
      const payload = {
        name: maxDistance == null ? `${minDistance}+ km` : `${minDistance}-${maxDistance} km`,
        minDistance,
        maxDistance,
        userDeliveryFee: commissionPerKm,
        basePayout,
        commissionPerKm,
        status: true,
      }
      const response = await adminAPI.createCommissionRule(payload)
      const created = response?.data?.data?.commission || response?.data?.commission
      const newRuleId = created?._id
      if (newRuleId) {
        setDistanceRuleAdminCommissionConfig(newRuleId, () => ({
          distanceRuleId: String(newRuleId),
          isEnabled: adminCommissionPercent > 0,
          adminDeliveryCommissionPercent: adminCommissionPercent,
        }))
      }
      setNewRange({
        minDistance: "0",
        maxDistance: "",
        maxDistanceUnlimited: false,
        basePayout: "0",
        commissionPerKm: "0",
        adminCommissionPercent: "0",
      })
      await fetchDistanceRules()
      toast.success("Distance slab added")
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.response?.data?.message || "Failed to add distance slab")
    } finally {
      setSavingRule(false)
    }
  }

  const handleDeleteSlab = async (rule) => {
    if (!rule?._id) return
    const ok = window.confirm(`Delete slab "${rule.name}"?`)
    if (!ok) return
    try {
      await adminAPI.deleteCommissionRule(rule._id)
      setFeeSettings((prev) => ({
        ...prev,
        distanceSlabAdminDeliveryCommission: (prev.distanceSlabAdminDeliveryCommission || []).filter(
          (r) => String(r.distanceRuleId) !== String(rule._id)
        ),
      }))
      await fetchDistanceRules()
      toast.success("Distance slab deleted")
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.response?.data?.message || "Failed to delete slab")
    }
  }

  const handleSaveFeeSettings = async () => {
    try {
      const invalidCommission = (feeSettings.distanceSlabAdminDeliveryCommission || []).find((row) =>
        (!Number.isFinite(Number(row?.adminDeliveryCommissionPercent)) ||
          Number(row?.adminDeliveryCommissionPercent) < 0 ||
          Number(row?.adminDeliveryCommissionPercent) > 100)
      )
      if (invalidCommission) {
        toast.error("Admin delivery commission must be between 0 and 100")
        return
      }
      const incentiveThreshold = Number(feeSettings.deliveryPartnerIncentiveRule?.minOrderAmount || 0)
      const incentivePercent = Number(feeSettings.deliveryPartnerIncentiveRule?.incentivePercent || 0)
      if (!Number.isFinite(incentiveThreshold) || incentiveThreshold < 0) {
        toast.error("Incentive threshold must be 0 or greater")
        return
      }
      if (!Number.isFinite(incentivePercent) || incentivePercent < 0 || incentivePercent > 100) {
        toast.error("Incentive percentage must be between 0 and 100")
        return
      }
      const platformFee = Number(feeSettings.platformFee)
      if (feeSettings.platformFee === "" || !Number.isFinite(platformFee) || platformFee < 0) {
        toast.error("Platform fee must be 0 or greater")
        return
      }
      const gstRate = Number(feeSettings.gstRate)
      if (feeSettings.gstRate === "" || !Number.isFinite(gstRate) || gstRate < 0 || gstRate > 100) {
        toast.error("GST rate must be between 0 and 100")
        return
      }
      // Blank is allowed here and means the statutory 18%, so an admin who
      // never touches this field is not blocked from saving the rest.
      const platformFeeGstRate = Number(feeSettings.platformFeeGstRate)
      if (
        feeSettings.platformFeeGstRate !== "" &&
        (!Number.isFinite(platformFeeGstRate) || platformFeeGstRate < 0 || platformFeeGstRate > 100)
      ) {
        toast.error("Govt. fee on the platform fee must be between 0 and 100")
        return
      }

      const codOrderLimit = Number(feeSettings.codOrderLimit)
      if (feeSettings.codOrderLimit !== "" && (!Number.isFinite(codOrderLimit) || codOrderLimit < 0)) {
        toast.error("COD Order Limit must be 0 or greater")
        return
      }
      // A ceiling of 0 would make every item unorderable, so the floor is 1.
      const maxOrderQuantityCeiling = Number(feeSettings.maxOrderQuantityCeiling)
      if (feeSettings.maxOrderQuantityCeiling !== "" && (!Number.isFinite(maxOrderQuantityCeiling) || maxOrderQuantityCeiling < 1 || maxOrderQuantityCeiling > 9999)) {
        toast.error("Max quantity per item must be between 1 and 9999")
        return
      }

      setSavingFeeSettings(true)
      const response = await adminAPI.createOrUpdateFeeSettings({
        deliveryFeeComputationMode: "distance_order_value",
        distanceSlabAdminDeliveryCommission: (feeSettings.distanceSlabAdminDeliveryCommission || []).map((r) => ({
          distanceRuleId: r.distanceRuleId,
          adminDeliveryCommissionPercent: Number(r.adminDeliveryCommissionPercent || 0),
          isEnabled: Number(r.adminDeliveryCommissionPercent || 0) > 0,
        })),
        deliveryPartnerIncentiveRule: {
          isEnabled: feeSettings.deliveryPartnerIncentiveRule?.isEnabled === true,
          minOrderAmount: Number(feeSettings.deliveryPartnerIncentiveRule?.minOrderAmount || 0),
          incentivePercent: Number(feeSettings.deliveryPartnerIncentiveRule?.incentivePercent || 0),
        },
        freeDeliveryRule: {
          isEnabled: feeSettings.freeDeliveryRule?.isEnabled === true,
          maxDistanceKm: Number(feeSettings.freeDeliveryRule?.maxDistanceKm || 0),
          minOrderAmount: Number(feeSettings.freeDeliveryRule?.minOrderAmount || 0),
        },
        platformFee,
        gstRate,
        platformFeeGstRate: feeSettings.platformFeeGstRate === "" ? null : platformFeeGstRate,
        codOrderLimit: feeSettings.codOrderLimit === "" ? null : codOrderLimit,
        maxOrderQuantityCeiling: feeSettings.maxOrderQuantityCeiling === "" ? null : maxOrderQuantityCeiling,
        isActive: true,
      })
      if (response?.data?.success) {
        toast.success("Fee settings saved successfully")
        await fetchFeeSettings()
      } else {
        toast.error(response?.data?.error || response?.data?.message || "Failed to save fee settings")
      }
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.response?.data?.message || "Failed to save fee settings")
    } finally {
      setSavingFeeSettings(false)
    }
  }

  const updateZoneSurge = async (zoneId, next) => {
    try {
      setSavingZoneId(String(zoneId))
      await adminAPI.upsertZoneSurgeConfig({
        zoneId,
        surgeAmount: Number(next.surgeAmount || 0),
        isEnabled: Boolean(next.isEnabled),
      })
      await fetchZoneSurges()
      toast.success("Zone surge updated")
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.response?.data?.message || "Failed to update zone surge")
    } finally {
      setSavingZoneId("")
    }
  }

  const incentiveRule = feeSettings.deliveryPartnerIncentiveRule || {
    isEnabled: false,
    minOrderAmount: "0",
    incentivePercent: "0",
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center">
            <DollarSign className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Delivery & Platform Fee</h1>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Fee Configuration</h2>
              <p className="text-sm text-slate-500 mt-1">Set the fees and charges that will be applied to all orders</p>
            </div>
            <Button onClick={handleSaveFeeSettings} disabled={savingFeeSettings || loadingFeeSettings} className="bg-green-600 hover:bg-green-700 text-white flex items-center gap-2">
              {savingFeeSettings ? <><Loader2 className="w-4 h-4 animate-spin" />Saving...</> : <><Save className="w-4 h-4" />Save Settings</>}
            </Button>
          </div>

          {loadingFeeSettings ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-green-600" />
            </div>
          ) : (
            <>
              {masterFormula && (
                <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  Delivery fees and rider pay now come from the delivery formula in{" "}
                  <Link to="/admin/master/delivery-earnings" className="font-semibold underline">
                    Master &rsaquo; Delivery earnings
                  </Link>{" "}
                  ({masterFormula.source}). The distance table and admin delivery commission below are no longer used.
                </div>
              )}
              <h3 className="text-lg font-semibold text-slate-900 mb-1">Delivery Fee by Distance Range</h3>
              <p className="text-sm text-slate-500 mb-4">Set different delivery fees based on distance ranges (in km)</p>

              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Min Distance (km)</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Max Distance (km)</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">User Delivery Fee (₹)</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Admin Commission (%)</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">DB Base Pay (₹)</th>
                      <th className="px-4 py-3 text-center text-sm font-semibold text-slate-700">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedDistanceRules.map((rule) => {
                      const min = toNum(rule.minDistance, 0)
                      const max = rule.maxDistance == null ? null : toNum(rule.maxDistance, 0)
                      const isBase = min <= 0
                      const adminCfg = getDistanceRuleAdminCommissionConfig(rule._id) || { adminDeliveryCommissionPercent: 0 }
                      const userDeliveryFeeDisplay = `Rs.${toNum(rule.commissionPerKm, 0)}/km`
                      return (
                        <tr key={rule._id} className="border-t border-slate-200">
                          <td className="px-4 py-3 text-slate-900">{min} km</td>
                          <td className="px-4 py-3 text-slate-900">{max == null ? "Unlimited" : `${max} km`}</td>
                          <td className="px-4 py-3 text-emerald-600 font-semibold">{userDeliveryFeeDisplay}</td>
                          <td className="px-4 py-3">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="0.01"
                              value={adminCfg.adminDeliveryCommissionPercent ?? 0}
                              onChange={(e) =>
                                setDistanceRuleAdminCommissionConfig(rule._id, (cfg) => ({
                                  ...cfg,
                                  adminDeliveryCommissionPercent: e.target.value,
                                  isEnabled: Number(e.target.value || 0) > 0,
                                }))
                              }
                              className="w-28 px-2 py-1 border border-slate-300 rounded-md text-sm"
                            />
                          </td>
                          <td className="px-4 py-3 text-slate-900">₹{toNum(rule.basePayout, 0)}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-center gap-2">
                              <button onClick={() => openEditSlab(rule)} className="p-1.5 rounded text-blue-600 hover:bg-blue-50" title="Edit">
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button onClick={() => handleDeleteSlab(rule)} className="p-1.5 rounded text-red-600 hover:bg-red-50" title="Delete">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                    {sortedDistanceRules.length === 0 && (
                      <tr>
                        <td className="px-4 py-5 text-sm text-slate-500" colSpan={6}>No distance slabs found.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <h4 className="text-2sm font-semibold text-slate-800 flex items-center gap-2 mb-3">
                  <Plus className="w-4 h-4 text-emerald-600" />
                  Add New Range
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
                  <div>
                    <label className="block text-sm text-slate-700 mb-1">Min Distance (km)</label>
                    <input type="number" min="0" step="0.01" value={newRange.minDistance} onChange={(e) => setNewRange((p) => ({ ...p, minDistance: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-700 mb-1">Max Distance (km)</label>
                    <input type="number" min="0" step="0.01" disabled={newRange.maxDistanceUnlimited} value={newRange.maxDistance} onChange={(e) => setNewRange((p) => ({ ...p, maxDistance: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-lg disabled:bg-slate-100" />
                    <label className="inline-flex items-center gap-2 text-xs text-slate-600 mt-1">
                      <input type="checkbox" checked={newRange.maxDistanceUnlimited} onChange={(e) => setNewRange((p) => ({ ...p, maxDistanceUnlimited: e.target.checked, maxDistance: e.target.checked ? "" : p.maxDistance }))} />
                      Unlimited
                    </label>
                  </div>
                  <div>
                    <label className="block text-sm text-slate-700 mb-1">User Delivery Fee (Rs.)</label>
                    <input
                      type="text"
                      readOnly
                      value={`Rs.${toNum(newRange.commissionPerKm, 0)}/km`}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-700 mb-1">Admin Commission (%)</label>
                    <input type="number" min="0" max="100" step="0.01" value={newRange.adminCommissionPercent} onChange={(e) => setNewRange((p) => ({ ...p, adminCommissionPercent: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-700 mb-1">DB Base Pay (₹)</label>
                    <input type="number" min="0" step="0.01" value={newRange.basePayout} onChange={(e) => setNewRange((p) => ({ ...p, basePayout: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-700 mb-1">Per Km Charge (₹)</label>
                    <input type="number" min="0" step="0.01" value={newRange.commissionPerKm} onChange={(e) => setNewRange((p) => ({ ...p, commissionPerKm: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
                  </div>
                </div>
                <div className="mt-3 flex justify-end">
                  <Button onClick={handleAddRange} disabled={savingRule} className="bg-green-600 hover:bg-green-700 text-white">
                    {savingRule ? "Adding..." : "Add Range"}
                  </Button>
                </div>
              </div>

              <div className="mt-8 border-t border-slate-200 pt-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-3">Zone-wise Surge Amount</h3>
                <div className="mb-4">
                  <div className="relative w-full sm:max-w-sm">
                    <input
                      type="text"
                      placeholder="Search zone..."
                      value={zoneSearchQuery}
                      onChange={(e) => setZoneSearchQuery(e.target.value)}
                      className="pl-3 pr-4 py-2.5 w-full text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400"
                    />
                  </div>
                </div>
                <div className="space-y-3">
                  {paginatedZoneSurges.map((z) => (
                    <div key={z.zoneId} className="grid grid-cols-12 gap-3 items-center p-3 border border-slate-200 rounded-lg">
                      <div className="col-span-12 sm:col-span-5 text-sm font-medium text-slate-800">{z.zoneName || "Unnamed Zone"}</div>
                      <div className="col-span-6 sm:col-span-3">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={z.surgeAmount ?? 0}
                          onChange={(e) => {
                            const value = e.target.value
                            setZoneSurges((prev) => prev.map((r) => r.zoneId === z.zoneId ? { ...r, surgeAmount: value } : r))
                          }}
                          className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm"
                        />
                      </div>
                      <div className="col-span-3 sm:col-span-2">
                        <button
                          onClick={() => updateZoneSurge(z.zoneId, { ...z, isEnabled: !z.isEnabled })}
                          className={`px-3 py-2 rounded-md text-xs font-semibold ${z.isEnabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}
                        >
                          {z.isEnabled ? "Enabled" : "Disabled"}
                        </button>
                      </div>
                      <div className="col-span-3 sm:col-span-2 text-right">
                        <button
                          onClick={() => updateZoneSurge(z.zoneId, z)}
                          disabled={savingZoneId === String(z.zoneId)}
                          className="px-3 py-2 rounded-md bg-blue-600 text-white text-xs font-semibold disabled:opacity-60"
                        >
                          {savingZoneId === String(z.zoneId) ? "Saving..." : "Save"}
                        </button>
                      </div>
                    </div>
                  ))}
                  {filteredZoneSurges.length === 0 && <p className="text-sm text-slate-500">No zones found.</p>}
                </div>
                <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <p className="text-xs text-slate-500">
                    Showing {(filteredZoneSurges.length === 0) ? 0 : ((zonePage - 1) * zonePageSize + 1)}-
                    {Math.min(zonePage * zonePageSize, filteredZoneSurges.length)} of {filteredZoneSurges.length}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setZonePage((prev) => Math.max(1, prev - 1))}
                      disabled={zonePage <= 1}
                      className="px-3 py-1.5 rounded-md border border-slate-300 text-sm text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Previous
                    </button>
                    <span className="text-sm text-slate-700">
                      Page {zonePage} / {zoneTotalPages}
                    </span>
                    <button
                      onClick={() => setZonePage((prev) => Math.min(zoneTotalPages, prev + 1))}
                      disabled={zonePage >= zoneTotalPages}
                      className="px-3 py-1.5 rounded-md border border-slate-300 text-sm text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">Delivery Partner Incentive</h3>
                    <p className="text-sm text-slate-600 mt-1">
                      If subtotal reaches the threshold, the rider gets an extra payout based on the order subtotal.
                    </p>
                  </div>
                  <label className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm">
                    <input
                      type="checkbox"
                      checked={Boolean(incentiveRule.isEnabled)}
                      onChange={(e) =>
                        setFeeSettings((prev) => ({
                          ...prev,
                          deliveryPartnerIncentiveRule: {
                            ...(prev.deliveryPartnerIncentiveRule || incentiveRule),
                            isEnabled: e.target.checked,
                          },
                        }))
                      }
                    />
                    Enable Incentive
                  </label>
                </div>

                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="block text-sm font-semibold text-slate-700">Order Amount Threshold (₹)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={incentiveRule.minOrderAmount}
                      onChange={(e) =>
                        setFeeSettings((prev) => ({
                          ...prev,
                          deliveryPartnerIncentiveRule: {
                            ...(prev.deliveryPartnerIncentiveRule || incentiveRule),
                            minOrderAmount: e.target.value,
                          },
                        }))
                      }
                      className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all bg-white"
                      placeholder="500"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-sm font-semibold text-slate-700">Incentive Percentage (%)</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={incentiveRule.incentivePercent}
                      onChange={(e) =>
                        setFeeSettings((prev) => ({
                          ...prev,
                          deliveryPartnerIncentiveRule: {
                            ...(prev.deliveryPartnerIncentiveRule || incentiveRule),
                            incentivePercent: e.target.value,
                          },
                        }))
                      }
                      className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all bg-white"
                      placeholder="10"
                    />
                  </div>
                </div>

              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 border-t border-slate-200 pt-6 mt-6">
                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-slate-700">Platform Fee (₹)</label>
                  <input
                    type="number"
                    value={feeSettings.platformFee}
                    onChange={(e) => setFeeSettings((s) => ({ ...s, platformFee: e.target.value }))}
                    min="0"
                    step="1"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition-all"
                    placeholder="0"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-slate-700">GST Rate (%)</label>
                  <input
                    type="number"
                    value={feeSettings.gstRate}
                    onChange={(e) => setFeeSettings((s) => ({ ...s, gstRate: e.target.value }))}
                    min="0"
                    max="100"
                    step="0.1"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition-all"
                    placeholder="5"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-slate-700">Govt. Fee on Platform Fee (%)</label>
                  <input
                    type="number"
                    value={feeSettings.platformFeeGstRate}
                    onChange={(e) => setFeeSettings((s) => ({ ...s, platformFeeGstRate: e.target.value }))}
                    min="0"
                    max="100"
                    step="0.1"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition-all"
                    placeholder="18"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    GST charged on the platform fee, shown as its own line on the customer&apos;s bill.
                    Leave blank for the statutory 18%.
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-slate-700">COD Order Limit (₹)</label>
                  <input
                    type="number"
                    value={feeSettings.codOrderLimit}
                    onChange={(e) => setFeeSettings((s) => ({ ...s, codOrderLimit: e.target.value }))}
                    min="0"
                    step="1"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition-all"
                    placeholder="e.g. 299"
                  />
                  <p className="text-xs text-slate-500 mt-1">COD will be hidden for cart totals above this amount.</p>
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-slate-700">Max Quantity Per Item</label>
                  <input
                    type="number"
                    value={feeSettings.maxOrderQuantityCeiling}
                    onChange={(e) => setFeeSettings((s) => ({ ...s, maxOrderQuantityCeiling: e.target.value }))}
                    min="1"
                    max="9999"
                    step="1"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition-all"
                    placeholder="Leave blank for 99"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Platform-wide cap on how many of one item a customer can order. An item&apos;s own
                    limit still applies and wins when it is lower. Blank means the default of 99.
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {slabModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl border border-slate-200 p-5">
            <h3 className="text-lg font-bold text-slate-900 mb-4">Edit Distance Slab</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Rule Name</label>
                <input className="w-full px-3 py-2 border border-slate-300 rounded-lg" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Minimum Distance (km)</label>
                <input type="number" min="0" step="0.01" className="w-full px-3 py-2 border border-slate-300 rounded-lg" value={form.minDistance} onChange={(e) => setForm((f) => ({ ...f, minDistance: e.target.value }))} />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-semibold text-slate-700">Maximum Distance (km)</label>
                  <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                    <input type="checkbox" checked={form.maxDistanceUnlimited} onChange={(e) => setForm((f) => ({ ...f, maxDistanceUnlimited: e.target.checked, maxDistance: e.target.checked ? "" : f.maxDistance }))} />
                    Unlimited
                  </label>
                </div>
                <input type="number" min="0" step="0.01" disabled={form.maxDistanceUnlimited} className="w-full px-3 py-2 border border-slate-300 rounded-lg disabled:bg-slate-100" value={form.maxDistance} onChange={(e) => setForm((f) => ({ ...f, maxDistance: e.target.value, maxDistanceUnlimited: false }))} />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">DB Base Pay (Rs.)</label>
                <input type="number" min="0" step="0.01" className="w-full px-3 py-2 border border-slate-300 rounded-lg" value={form.basePayout} onChange={(e) => setForm((f) => ({ ...f, basePayout: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Per Km Charge (₹)</label>
                <input type="number" min="0" step="0.01" className="w-full px-3 py-2 border border-slate-300 rounded-lg" value={form.commissionPerKm} onChange={(e) => setForm((f) => ({ ...f, commissionPerKm: e.target.value }))} />
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={Boolean(form.status)} onChange={(e) => setForm((f) => ({ ...f, status: e.target.checked }))} />
                Active
              </label>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <Button variant="outline" onClick={() => setSlabModalOpen(false)}>Cancel</Button>
              <Button onClick={handleSaveSlab} disabled={savingRule} className="bg-blue-600 hover:bg-blue-700 text-white">
                {savingRule ? <Loader2 className="w-4 h-4 animate-spin" /> : "Update Slab"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
