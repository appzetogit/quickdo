import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"
import { ArrowLeft, AlertCircle, Upload, Loader2 } from "lucide-react"
import { restaurantAPI, uploadAPI } from "@food/api"
import { ImageSourcePicker } from "@food/components/ImageSourcePicker"
import { isFlutterBridgeAvailable } from "@food/utils/imageUploadUtils"
import { toast } from "sonner"

const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/
const UPI_REGEX = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/

const EMPTY_FORM = {
  accountHolderName: "",
  accountNumber: "",
  confirmAccountNumber: "",
  ifscCode: "",
  upiId: "",
  upiQrImage: "",
}

export default function UpdateBankDetails() {
  const navigate = useNavigate()
  const goBack = useRestaurantBackNavigation()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploadingQr, setUploadingQr] = useState(false)
  const [lastUpdated, setLastUpdated] = useState("")

  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})
  const [isQrPickerOpen, setIsQrPickerOpen] = useState(false)
  const qrInputRef = useRef(null)

  const formattedUpdatedAt = useMemo(() => {
    if (!lastUpdated) return ""
    const date = new Date(lastUpdated)
    if (Number.isNaN(date.getTime())) return ""
    return date.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    })
  }, [lastUpdated])

  const validate = () => {
    const nextErrors = {}
    const accountHolderName = String(form.accountHolderName || "").trim()
    const accountNumber = String(form.accountNumber || "").replace(/\s|-/g, "")
    const confirmAccountNumber = String(form.confirmAccountNumber || "").replace(/\s|-/g, "")
    const ifscCode = String(form.ifscCode || "").trim().toUpperCase()
    const upiId = String(form.upiId || "").trim()

    const anyBankField = Boolean(accountHolderName || accountNumber || ifscCode)

    if (anyBankField) {
      if (!accountHolderName) nextErrors.accountHolderName = "Account holder name is required"
      if (!accountNumber) {
        nextErrors.accountNumber = "Account number is required"
      } else if (!/^\d{9,18}$/.test(accountNumber)) {
        nextErrors.accountNumber = "Account number must be 9 to 18 digits"
      }
      if (!confirmAccountNumber) {
        nextErrors.confirmAccountNumber = "Please confirm account number"
      } else if (confirmAccountNumber !== accountNumber) {
        nextErrors.confirmAccountNumber = "Account numbers do not match"
      }
      if (!ifscCode) {
        nextErrors.ifscCode = "IFSC code is required"
      } else if (!IFSC_REGEX.test(ifscCode)) {
        nextErrors.ifscCode = "Invalid IFSC format (e.g. SBIN0018764)"
      }
    }

    if (upiId && !UPI_REGEX.test(upiId)) {
      nextErrors.upiId = "Invalid UPI ID format (e.g. name@bank)"
    }

    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const loadProfile = async () => {
    try {
      setLoading(true)
      const response = await restaurantAPI.getCurrentRestaurant()
      const doc = response?.data?.data?.restaurant || response?.data?.restaurant || null
      if (!doc) return

      const accountNumber = String(doc.accountNumber || "").replace(/\s|-/g, "")
      const upiQrImage =
        typeof doc.upiQrImage === "string"
          ? doc.upiQrImage
          : String(doc.upiQrImage?.url || "")

      setForm({
        accountHolderName: String(doc.accountHolderName || ""),
        accountNumber,
        confirmAccountNumber: accountNumber,
        ifscCode: String(doc.ifscCode || "").toUpperCase(),
        upiId: String(doc.upiId || ""),
        upiQrImage,
      })
      setLastUpdated(doc.updatedAt || "")
    } catch (error) {
      alert(error?.response?.data?.message || "Failed to load bank details")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadProfile()
  }, [])

  const handleQrUpload = async (file) => {
    if (!file) return
    try {
      if (file.size > 5 * 1024 * 1024) {
        toast.error("Image size too large. Max 5MB allowed.")
        return
      }
      setUploadingQr(true)
      const response = await uploadAPI.uploadMedia(file, { folder: "food/restaurants/upi-qr" })
      const url =
        response?.data?.data?.url ||
        response?.data?.url ||
        ""
      if (!url) throw new Error("Upload failed")
      setForm((prev) => ({ ...prev, upiQrImage: url }))
      toast.success("QR updated successfully")
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Failed to upload QR image")
    } finally {
      setUploadingQr(false)
    }
  }

  const handleQrClick = () => {
    if (isFlutterBridgeAvailable()) {
      setIsQrPickerOpen(true)
    } else {
      qrInputRef.current?.click()
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!validate()) return

    const payload = {
      accountHolderName: String(form.accountHolderName || "").trim(),
      accountNumber: String(form.accountNumber || "").replace(/\s|-/g, ""),
      ifscCode: String(form.ifscCode || "").trim().toUpperCase(),
      upiId: String(form.upiId || "").trim(),
      upiQrImage: String(form.upiQrImage || "").trim(),
    }

    try {
      setSaving(true)
      await restaurantAPI.updateProfile(payload)
      await loadProfile()
      setErrors({})
      alert("Bank details updated successfully")
    } catch (error) {
      alert(error?.response?.data?.message || "Failed to update bank details")
    } finally {
      setSaving(false)
    }
  }

  const inputClass = (key) =>
    `w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 text-base transition-colors ${
      errors[key]
        ? "border-red-500 focus:ring-red-500 focus:border-red-500"
        : "border-gray-300 focus:ring-blue-500 focus:border-transparent"
    }`

  return (
    <div className="min-h-screen bg-neutral-50/60 flex flex-col pb-28 text-gray-900">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-md px-4 sm:px-6 py-3.5 flex items-center gap-3 border-b border-gray-200 shadow-sm">
        <div className="max-w-4xl mx-auto w-full flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={goBack} className="p-2 -ml-2 rounded-xl hover:bg-gray-100 text-gray-600 hover:text-gray-900 transition-colors" aria-label="Back">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-base sm:text-lg font-bold text-gray-900">Bank & Settlement Details</h1>
              <p className="text-xs text-gray-500 hidden sm:block">Bank account and UPI details for automated direct deposits</p>
            </div>
          </div>
          <button
            onClick={handleSubmit}
            disabled={saving || uploadingQr}
            className="hidden sm:inline-flex items-center justify-center bg-gray-900 hover:bg-black disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-6 py-2 rounded-xl text-xs font-bold transition-all shadow-sm"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto w-full flex-1 px-4 sm:px-6 py-6">
        {loading ? (
          <div className="py-16 flex flex-col items-center justify-center gap-3 text-gray-500 bg-white rounded-2xl border border-gray-200 shadow-sm">
            <Loader2 className="w-6 h-6 animate-spin text-gray-900" />
            <span className="text-sm font-medium">Loading bank credentials...</span>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Bank details card */}
            <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 pb-3 border-b border-gray-100">
                <div>
                  <h2 className="text-base font-bold text-gray-900">Direct Bank Account Details</h2>
                  <p className="text-xs text-gray-500">Funds are transferred to this verified bank account</p>
                </div>
                {formattedUpdatedAt && (
                  <p className="text-[11px] text-gray-400 font-medium">Last updated: {formattedUpdatedAt}</p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">Account Holder Name</label>
                  <input
                    type="text"
                    value={form.accountHolderName}
                    onChange={(e) => setForm((p) => ({ ...p, accountHolderName: e.target.value }))}
                    className={inputClass("accountHolderName")}
                    placeholder="Enter registered account holder name"
                  />
                  {errors.accountHolderName && (
                    <p className="mt-1.5 text-xs text-red-600 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> {errors.accountHolderName}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">Account Number</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={form.accountNumber}
                    onChange={(e) => setForm((p) => ({ ...p, accountNumber: e.target.value.replace(/[^\d\s-]/g, "") }))}
                    className={inputClass("accountNumber")}
                    placeholder="Enter 9-18 digit account number"
                  />
                  {errors.accountNumber && (
                    <p className="mt-1.5 text-xs text-red-600 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> {errors.accountNumber}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">Confirm Account Number</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={form.confirmAccountNumber}
                    onChange={(e) => setForm((p) => ({ ...p, confirmAccountNumber: e.target.value.replace(/[^\d\s-]/g, "") }))}
                    className={inputClass("confirmAccountNumber")}
                    placeholder="Re-enter account number"
                  />
                  {errors.confirmAccountNumber && (
                    <p className="mt-1.5 text-xs text-red-600 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> {errors.confirmAccountNumber}
                    </p>
                  )}
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">Bank IFSC Code</label>
                  <input
                    type="text"
                    maxLength={11}
                    value={form.ifscCode}
                    onChange={(e) => setForm((p) => ({ ...p, ifscCode: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") }))}
                    className={inputClass("ifscCode")}
                    placeholder="e.g. SBIN0018764"
                  />
                  {errors.ifscCode && (
                    <p className="mt-1.5 text-xs text-red-600 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> {errors.ifscCode}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* UPI details card */}
            <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm space-y-4">
              <div className="pb-3 border-b border-gray-100">
                <h2 className="text-base font-bold text-gray-900">UPI / QR Code Details</h2>
                <p className="text-xs text-gray-500">Optional secondary settlement method</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Virtual Payment Address (UPI ID)</label>
                <input
                  type="text"
                  value={form.upiId}
                  onChange={(e) => setForm((p) => ({ ...p, upiId: e.target.value.trim() }))}
                  className={inputClass("upiId")}
                  placeholder="e.g. merchant@okaxis"
                />
                {errors.upiId && (
                  <p className="mt-1.5 text-xs text-red-600 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> {errors.upiId}
                  </p>
                )}
              </div>

              <div className="pt-2">
                <label className="block text-xs font-semibold text-gray-700 mb-2">UPI QR Code Image</label>
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                  {form.upiQrImage ? (
                    <img
                      src={form.upiQrImage}
                      alt="UPI QR"
                      className="w-36 h-36 object-contain border border-gray-200 rounded-xl bg-white p-2 shadow-sm"
                    />
                  ) : (
                    <div className="w-36 h-36 border border-dashed border-gray-300 rounded-xl flex items-center justify-center text-xs text-gray-400 bg-gray-50 text-center p-3">
                      No QR code uploaded
                    </div>
                  )}

                  <div className="space-y-2">
                    <div 
                      onClick={handleQrClick}
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-300 text-xs font-bold cursor-pointer hover:bg-gray-50 transition-colors shadow-sm"
                    >
                      {uploadingQr ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Uploading...</span>
                        </>
                      ) : (
                        <>
                          <Upload className="w-4 h-4" />
                          <span>Upload QR Code</span>
                        </>
                      )}
                      <input
                        ref={qrInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={uploadingQr}
                        onChange={(e) => handleQrUpload(e.target.files?.[0])}
                      />
                    </div>
                    <p className="text-[11px] text-gray-400">JPG, PNG format max 5MB</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Mobile Submit Button */}
            <div className="sm:hidden pt-2">
              <button
                type="submit"
                disabled={saving || uploadingQr}
                className="w-full bg-gray-900 hover:bg-black disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-xl text-sm transition-colors shadow-md"
              >
                {saving ? "Saving..." : "Save Bank Details"}
              </button>
            </div>
          </form>
        )}
      </div>
      
      <ImageSourcePicker
        isOpen={isQrPickerOpen}
        onClose={() => setIsQrPickerOpen(false)}
        onFileSelect={handleQrUpload}
        title="Upload UPI QR"
        description="Choose how to upload your bank UPI QR image"
        fileNamePrefix="upi-qr"
        galleryInputRef={qrInputRef}
      />
    </div>
  )
}
