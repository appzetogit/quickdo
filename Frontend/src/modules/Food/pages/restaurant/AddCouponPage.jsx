import { useState, useEffect, useRef } from "react"
import { motion } from "framer-motion"
import { useNavigate } from "react-router-dom"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"
import { 
  ArrowLeft,
  Calendar,
  ChevronDown,
  Wand2,
  Percent,
  IndianRupee,
  Tag,
  Loader2
} from "lucide-react"
import { restaurantAPI } from "@food/api"
import { toast } from "sonner"

export default function AddCouponPage(props) {
  const { mode = "create" } = props || {}
  const isEditMode = mode === "edit"

  const navigate = useNavigate()
  const goBack = useRestaurantBackNavigation()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showDiscountTypeDropdown, setShowDiscountTypeDropdown] = useState(false)
  const discountTypeRef = useRef(null)

  const [formData, setFormData] = useState({
    couponCode: "",
    discountType: "percentage",
    discountValue: "",
    minOrderValue: "",
    maxDiscount: "",
    usageLimit: "",
    perUserLimit: "",
    startDate: "",
    endDate: "",
  })

  const [errors, setErrors] = useState({})

  useEffect(() => {
    const handle = (e) => {
      if (discountTypeRef.current && !discountTypeRef.current.contains(e.target)) setShowDiscountTypeDropdown(false)
    }
    document.addEventListener("mousedown", handle)
    return () => document.removeEventListener("mousedown", handle)
  }, [])

  const set = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: null }))
  }

  const generateCode = () => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    let code = ""
    for (let i = 0; i < 8; i++) code += chars.charAt(Math.floor(Math.random() * chars.length))
    set("couponCode", code)
  }

  const validate = () => {
    const e = {}
    if (!formData.couponCode.trim()) e.couponCode = "Coupon code is required"
    if (!formData.discountValue || isNaN(formData.discountValue) || Number(formData.discountValue) <= 0)
      e.discountValue = "Enter a valid discount value"
    if (formData.discountType === "percentage" && Number(formData.discountValue) > 100)
      e.discountValue = "Percentage cannot exceed 100"
    if (!formData.startDate) e.startDate = "Start date is required"
    if (!formData.endDate) e.endDate = "End date is required"
    if (formData.startDate && formData.endDate && new Date(formData.startDate) > new Date(formData.endDate))
      e.endDate = "End date must be after start date"
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSubmit = async () => {
    if (!validate()) return
    setIsSubmitting(true)
    try {
      const payload = {
        couponCode: formData.couponCode.toUpperCase(),
        discountType: formData.discountType,
        discountValue: Number(formData.discountValue),
        minOrderValue: Number(formData.minOrderValue) || 0,
        maxDiscount: formData.maxDiscount ? Number(formData.maxDiscount) : undefined,
        usageLimit: formData.usageLimit ? Number(formData.usageLimit) : undefined,
        perUserLimit: formData.perUserLimit ? Number(formData.perUserLimit) : undefined,
        startDate: formData.startDate || undefined,
        endDate: formData.endDate || undefined,
        status: "active"
      }
      await restaurantAPI.createMyOffer(payload)
      toast.success("Coupon created successfully!")
      navigate("/restaurant/coupon")
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Failed to save coupon")
    } finally {
      setIsSubmitting(false)
    }
  }

  const inputCls = (field) =>
    `w-full px-4 py-3 bg-gray-50 border rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 transition-colors ${
      errors[field]
        ? "border-red-300 focus:ring-red-300"
        : "border-gray-200 focus:ring-gray-400 focus:border-gray-500"
    }`

  const FieldLabel = ({ children, required }) => (
    <label className="block text-sm font-semibold text-gray-700 mb-1.5">
      {children} {required && <span className="text-red-500">*</span>}
    </label>
  )

  const ErrorMsg = ({ field }) => errors[field]
    ? <p className="text-xs text-red-500 mt-1">{errors[field]}</p>
    : null

  return (
    <div className="min-h-screen bg-neutral-50/60 pb-28 text-gray-900">
      {/* Header */}
      <div className="bg-white/95 backdrop-blur-md border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={goBack} className="p-2 -ml-2 hover:bg-gray-100 rounded-xl text-gray-600 hover:text-gray-900 transition-colors" aria-label="Go back">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-base sm:text-lg font-bold text-gray-900">
                {isEditMode ? "Edit Coupon" : "Create Coupon"}
              </h1>
              <p className="text-xs text-gray-500 hidden sm:block">Configure custom discount rules and validity periods for your store</p>
            </div>
          </div>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="hidden sm:inline-flex items-center justify-center gap-2 px-6 py-2 bg-gray-900 hover:bg-black text-white text-sm font-semibold rounded-xl transition-all shadow-sm disabled:opacity-50"
          >
            {isSubmitting ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
            ) : (
              isEditMode ? "Update Coupon" : "Save & Publish"
            )}
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Basic Details */}
        <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm space-y-4">
          <div>
            <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">1. Coupon & Discount Rule</h2>
            <p className="text-xs text-gray-500">Define the coupon code and discount structure customers will receive at checkout.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            {/* Coupon Code */}
            <div>
              <FieldLabel required>Coupon Code</FieldLabel>
              <div className="flex gap-2">
                <input
                  value={formData.couponCode}
                  onChange={(e) => set("couponCode", e.target.value.toUpperCase())}
                  placeholder="e.g. SAVE20"
                  className={`${inputCls("couponCode")} flex-1 font-mono uppercase tracking-wider`}
                />
                <button
                  type="button"
                  onClick={generateCode}
                  className="px-3.5 py-2.5 bg-gray-100 hover:bg-gray-200 border border-gray-200 rounded-xl transition-colors flex items-center gap-1 text-xs font-bold text-gray-700 shrink-0"
                  title="Auto-generate random code"
                >
                  <Wand2 className="w-4 h-4" />
                  <span>Generate</span>
                </button>
              </div>
              <ErrorMsg field="couponCode" />
            </div>

            {/* Discount */}
            <div>
              <FieldLabel required>Discount Amount / Rate</FieldLabel>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={formData.discountValue}
                  onChange={(e) => set("discountValue", e.target.value)}
                  placeholder="e.g. 20"
                  className={`${inputCls("discountValue")} flex-1`}
                />
                {/* Discount type toggle */}
                <div className="relative" ref={discountTypeRef}>
                  <button
                    type="button"
                    onClick={() => setShowDiscountTypeDropdown(!showDiscountTypeDropdown)}
                    className="flex items-center gap-1.5 px-3.5 py-3 bg-gray-100 hover:bg-gray-200 border border-gray-200 rounded-xl transition-colors text-xs font-bold text-gray-800 min-w-[90px] justify-center"
                  >
                    {formData.discountType === "percentage"
                      ? <Percent className="w-3.5 h-3.5 text-gray-700" />
                      : <IndianRupee className="w-3.5 h-3.5 text-gray-700" />}
                    <span>{formData.discountType === "percentage" ? "% Off" : "₹ Off"}</span>
                    <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
                  </button>
                  {showDiscountTypeDropdown && (
                    <motion.div
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden min-w-[160px]"
                    >
                      {[
                        { value: "percentage", label: "Percentage (%)", icon: Percent },
                        { value: "flat-price", label: "Flat Amount (₹)", icon: IndianRupee }
                      ].map(opt => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => { set("discountType", opt.value); setShowDiscountTypeDropdown(false) }}
                          className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-semibold transition-colors ${
                            formData.discountType === opt.value
                              ? "bg-gray-900 text-white"
                              : "text-gray-700 hover:bg-gray-50"
                          }`}
                        >
                          <opt.icon className="w-3.5 h-3.5" />
                          {opt.label}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </div>
              </div>
              <ErrorMsg field="discountValue" />
            </div>

            {/* Min Order */}
            <div>
              <FieldLabel>Minimum Cart Order Value (₹)</FieldLabel>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">₹</span>
                <input
                  type="number"
                  value={formData.minOrderValue}
                  onChange={(e) => set("minOrderValue", e.target.value)}
                  placeholder="0 (No minimum)"
                  className={`${inputCls("minOrderValue")} pl-8`}
                />
              </div>
            </div>

            {/* Max Discount (only for percentage) */}
            {formData.discountType === "percentage" && (
              <div>
                <FieldLabel>Maximum Discount Cap (₹)</FieldLabel>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">₹</span>
                  <input
                    type="number"
                    value={formData.maxDiscount}
                    onChange={(e) => set("maxDiscount", e.target.value)}
                    placeholder="No cap (Unlimited)"
                    className={`${inputCls("maxDiscount")} pl-8`}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Usage Limits */}
        <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm space-y-4">
          <div>
            <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">2. Redemption & Usage Limits</h2>
            <p className="text-xs text-gray-500">Control budget impact by restricting total redemption counts.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div>
              <FieldLabel>Total Global Redemptions</FieldLabel>
              <input
                type="number"
                value={formData.usageLimit}
                onChange={(e) => set("usageLimit", e.target.value)}
                placeholder="Unlimited uses across all customers"
                className={inputCls("usageLimit")}
              />
            </div>
            <div>
              <FieldLabel>Per-Customer Limit</FieldLabel>
              <input
                type="number"
                value={formData.perUserLimit}
                onChange={(e) => set("perUserLimit", e.target.value)}
                placeholder="1 (Once per user)"
                className={inputCls("perUserLimit")}
              />
            </div>
          </div>
        </div>

        {/* Validity */}
        <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm space-y-4">
          <div>
            <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">3. Schedule & Validity Window</h2>
            <p className="text-xs text-gray-500">Set the active calendar dates for when this coupon is redeemable.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            {/* Start Date */}
            <div>
              <FieldLabel required>Start Date</FieldLabel>
              <div className="relative">
                <input
                  type="date"
                  value={formData.startDate}
                  onChange={(e) => set("startDate", e.target.value)}
                  className={`${inputCls("startDate")} pr-10 appearance-none`}
                  style={{ colorScheme: "light" }}
                />
                <Calendar className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>
              <ErrorMsg field="startDate" />
            </div>

            {/* End Date */}
            <div>
              <FieldLabel required>End Date</FieldLabel>
              <div className="relative">
                <input
                  type="date"
                  value={formData.endDate}
                  onChange={(e) => set("endDate", e.target.value)}
                  min={formData.startDate || undefined}
                  className={`${inputCls("endDate")} pr-10 appearance-none`}
                  style={{ colorScheme: "light" }}
                />
                <Calendar className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>
              <ErrorMsg field="endDate" />
            </div>
          </div>
        </div>

        {/* Mobile Submit */}
        <div className="sm:hidden pt-2">
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="w-full flex items-center justify-center gap-2 bg-gray-900 hover:bg-black disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-xl transition-colors text-sm shadow-md"
          >
            {isSubmitting ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
            ) : (
              isEditMode ? "Update Coupon" : "Create Coupon"
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
