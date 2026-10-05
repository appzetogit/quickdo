import { useState, useEffect } from "react"
import { Phone, Save, Loader2, AlertCircle, CheckCircle2 } from "lucide-react"
import { adminAPI } from "@food/api"
import { toast } from "sonner"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}


export default function DeliveryEmergencyHelp() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formData, setFormData] = useState({
    medicalEmergency: "",
    accidentHelpline: "",
    contactPolice: "",
    insurance: "",
  })
  const [formErrors, setFormErrors] = useState({})

  // Fetch emergency help numbers on component mount
  useEffect(() => {
    fetchEmergencyHelp()
  }, [])

  const fetchEmergencyHelp = async () => {
    try {
      setLoading(true)
      const response = await adminAPI.getEmergencyHelp()
      
      if (response?.data?.success && response?.data?.data) {
        const data = response.data.data
        setFormData({
          medicalEmergency: data.medicalEmergency || "",
          accidentHelpline: data.accidentHelpline || "",
          contactPolice: data.contactPolice || "",
          insurance: data.insurance || "",
        })
      }
    } catch (error) {
      debugError("Error fetching emergency help:", error)
      toast.error("Failed to load emergency help numbers")
    } finally {
      setLoading(false)
    }
  }

  const validateForm = () => {
    const errors = {}
    const phoneRegex = /^\d{3,15}$/
    const normalizeDigits = (value) => String(value || "").replace(/[^\d]/g, "")

    if (formData.medicalEmergency && !phoneRegex.test(normalizeDigits(formData.medicalEmergency))) {
      errors.medicalEmergency = "Phone number must be 3 to 15 digits"
    }
    if (formData.accidentHelpline && !phoneRegex.test(normalizeDigits(formData.accidentHelpline))) {
      errors.accidentHelpline = "Phone number must be 3 to 15 digits"
    }
    if (formData.contactPolice && !phoneRegex.test(normalizeDigits(formData.contactPolice))) {
      errors.contactPolice = "Phone number must be 3 to 15 digits"
    }
    if (formData.insurance && !phoneRegex.test(normalizeDigits(formData.insurance))) {
      errors.insurance = "Phone number must be 3 to 15 digits"
    }

    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleInputChange = (field, value) => {
    const sanitizedValue = String(value || "").replace(/[^\d]/g, "").slice(0, 15)
    setFormData(prev => ({
      ...prev,
      [field]: sanitizedValue
    }))
    // Clear error for this field when user starts typing
    if (formErrors[field]) {
      setFormErrors(prev => {
        const newErrors = { ...prev }
        delete newErrors[field]
        return newErrors
      })
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!validateForm()) {
      toast.error("Please fix the errors in the form")
      return
    }

    try {
      setSaving(true)
      const response = await adminAPI.createOrUpdateEmergencyHelp({
        medicalEmergency: formData.medicalEmergency.trim(),
        accidentHelpline: formData.accidentHelpline.trim(),
        contactPolice: formData.contactPolice.trim(),
        insurance: formData.insurance.trim(),
      })

      if (response?.data?.success) {
        toast.success("Emergency help numbers saved successfully!")
        // Refresh data
        await fetchEmergencyHelp()
      } else {
        toast.error(response?.data?.message || "Failed to save emergency help numbers")
      }
    } catch (error) {
      debugError("Error saving emergency help:", error)
      toast.error(error?.response?.data?.message || "Failed to save emergency help numbers")
    } finally {
      setSaving(false)
    }
  }

  const emergencyFields = [
    {
      id: "medicalEmergency",
      label: "Medical Emergency",
      placeholder: "Enter medical emergency phone number",
      icon: "??",
      description: "Phone number for medical emergencies (e.g., 108, +91-XXX-XXX-XXXX)"
    },
    {
      id: "accidentHelpline",
      label: "Accident Helpline",
      placeholder: "Enter accident helpline phone number",
      icon: "??",
      description: "Phone number for accident helpline"
    },
    {
      id: "contactPolice",
      label: "Contact Police",
      placeholder: "Enter police emergency phone number",
      icon: "??",
      description: "Phone number for police emergency (e.g., 100)"
    },
    {
      id: "insurance",
      label: "Insurance",
      placeholder: "Enter insurance helpline phone number",
      icon: "???",
      description: "Phone number for insurance claims and policy help"
    }
  ]

  if (loading) {
    return (
      <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-slate-600" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <Phone className="w-6 h-6 text-slate-600" />
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Delivery Emergency Help</h1>
              <p className="text-sm text-slate-600 mt-1">
                Manage emergency contact numbers for delivery partners
              </p>
            </div>
          </div>

          {/* Info Card */}
          <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
              <div className="text-sm text-blue-800">
                <p className="font-semibold mb-1">Important Information</p>
                <p>
                  These phone numbers will be displayed to delivery partners in the emergency help section. 
                  When a delivery partner clicks on any emergency option, it will automatically dial the corresponding number.
                </p>
              </div>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-6">
            {emergencyFields.map((field) => (
              <div key={field.id} className="space-y-2">
                <label className="block text-sm font-semibold text-slate-900">
                  <span className="mr-2">{field.icon}</span>
                  {field.label}
                </label>
                <p className="text-xs text-slate-600 mb-2">{field.description}</p>
                <div className="relative">
                  <input
                    type="text"
                    value={formData[field.id]}
                    onChange={(e) => handleInputChange(field.id, e.target.value)}
                    placeholder={field.placeholder}
                    inputMode="numeric"
                    maxLength={15}
                    className={`w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      formErrors[field.id]
                        ? "border-red-300 focus:ring-red-500"
                        : "border-slate-300"
                    }`}
                  />
                  {formErrors[field.id] && (
                    <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                      <AlertCircle className="w-4 h-4" />
                      {formErrors[field.id]}
                    </p>
                  )}
                </div>
              </div>
            ))}

            {/* Submit Button */}
            <div className="pt-4 border-t border-slate-200">
              <button
                type="submit"
                disabled={saving}
                className="w-full sm:w-auto px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-5 h-5" />
                    Save Emergency Numbers
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Success Message */}
          {!loading && !saving && (
            <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-center gap-2 text-green-800">
                <CheckCircle2 className="w-5 h-5" />
                <p className="text-sm font-medium">
                  Changes will be reflected immediately for all delivery partners
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

