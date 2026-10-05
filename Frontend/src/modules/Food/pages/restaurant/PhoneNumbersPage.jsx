import { useState } from "react"
import { useNavigate } from "react-router-dom"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowLeft, Edit, Phone, Users, ChevronDown, X } from "lucide-react"

export default function PhoneNumbersPage() {
  const navigate = useNavigate()
  const goBack = useRestaurantBackNavigation()
  const [editingNumber, setEditingNumber] = useState(null) // { type: 'orderReminder1' | 'orderReminder2' | 'restaurantPage' }
  const [countryCode, setCountryCode] = useState("+91")
  const [phoneNumber, setPhoneNumber] = useState("")
  const [isCountryCodeOpen, setIsCountryCodeOpen] = useState(false)
  const [showOtpPopup, setShowOtpPopup] = useState(false)
  const [otp, setOtp] = useState(["", "", "", "", "", ""])
  const [pendingPhoneData, setPendingPhoneData] = useState(null) // Store phone data to save after OTP verification

  // Phone numbers data - only mobile now
  const [phoneData, setPhoneData] = useState({
    orderReminder1: "+91-9981127415",
    orderReminder2: "+91-9981127415",
    restaurantPage: "+91-9981127415"
  })

  // Country codes
  const countryCodes = [
    { code: "+91", country: "India", flag: "🇮🇳" },
    { code: "+1", country: "USA", flag: "🇺🇸" },
    { code: "+44", country: "UK", flag: "🇬🇧" },
    { code: "+971", country: "UAE", flag: "🇦🇪" },
    { code: "+65", country: "Singapore", flag: "🇸🇬" },
    { code: "+86", country: "China", flag: "🇨🇳" },
    { code: "+81", country: "Japan", flag: "🇯🇵" },
    { code: "+61", country: "Australia", flag: "🇦🇺" },
  ]

  const handleEditClick = (type) => {
    const currentNumber = phoneData[type]
    const parts = currentNumber.split('-')
    setCountryCode(parts[0] || "+91")
    setPhoneNumber(parts[1] || "")
    setEditingNumber(type)
  }

  const handleSaveEdit = () => {
    if (!editingNumber || !phoneNumber.trim()) return
    
    // Store the data to save after OTP verification
    setPendingPhoneData({
      type: editingNumber,
      value: `${countryCode}-${phoneNumber.trim()}`,
      countryCode: countryCode,
      phoneNumber: phoneNumber.trim()
    })
    
    // Close edit popup and show OTP popup
    setEditingNumber(null)
    setShowOtpPopup(true)
    setOtp(["", "", "", "", "", ""])
  }

  const handleCancelEdit = () => {
    setEditingNumber(null)
    setCountryCode("+91")
    setPhoneNumber("")
  }

  const handleOtpChange = (index, value) => {
    if (!/^\d*$/.test(value)) return // Only allow digits
    
    const newOtp = [...otp]
    newOtp[index] = value.slice(-1) // Only take last character
    
    // Auto-focus next input
    if (value && index < 5) {
      const nextInput = document.getElementById(`otp-${index + 1}`)
      if (nextInput) nextInput.focus()
    }
    
    setOtp(newOtp)
  }

  const handleOtpKeyDown = (index, e) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      const prevInput = document.getElementById(`otp-${index - 1}`)
      if (prevInput) prevInput.focus()
    }
  }

  const handleVerifyOtp = () => {
    const otpString = otp.join("")
    
    // For demo purposes, accept any 6-digit OTP
    // In production, this would verify against the backend
    if (otpString.length === 6) {
      // Save the phone number
      if (pendingPhoneData) {
        setPhoneData(prev => ({
          ...prev,
          [pendingPhoneData.type]: pendingPhoneData.value
        }))
      }
      
      // Close OTP popup and reset
      setShowOtpPopup(false)
      setPendingPhoneData(null)
      setOtp(["", "", "", "", "", ""])
      setCountryCode("+91")
      setPhoneNumber("")
    }
  }

  const handleResendOtp = () => {
    // Reset OTP input
    setOtp(["", "", "", "", "", ""])
    // In production, this would trigger a new OTP to be sent
  }

  const handleCancelOtp = () => {
    setShowOtpPopup(false)
    setPendingPhoneData(null)
    setOtp(["", "", "", "", "", ""])
  }

  const getDisplayNumber = (type) => {
    return phoneData[type] || ""
  }

  return (
    <div className="min-h-screen bg-neutral-50/60 pb-28 text-gray-900">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-gray-200 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3.5 flex items-center gap-3">
          <button
            onClick={goBack}
            className="p-2 -ml-2 rounded-xl hover:bg-gray-100 text-gray-600 hover:text-gray-900 transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-base sm:text-lg font-bold text-gray-900">Important Contacts</h1>
            <p className="text-xs text-gray-500 hidden sm:block">Customer support lines and automated order alert phone numbers</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        {/* Order reminder numbers */}
        <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm space-y-4">
          <div className="flex items-center gap-3 pb-3 border-b border-gray-100">
            <div className="w-10 h-10 bg-orange-50 rounded-xl flex items-center justify-center text-primary-orange">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">Order Reminder Numbers</h2>
              <p className="text-xs text-gray-500">
                Primary phones contacted by automated calls for new order placement and operational support.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            {/* Order reminder number #1 */}
            <div className="p-4 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Reminder Line #1</p>
                <p className="text-base font-bold text-gray-900 mt-1">{getDisplayNumber("orderReminder1")}</p>
              </div>
              <button
                onClick={() => handleEditClick("orderReminder1")}
                className="p-2 hover:bg-white rounded-lg text-gray-600 hover:text-gray-900 border border-transparent hover:border-gray-200 transition-colors"
                title="Edit number"
              >
                <Edit className="w-4 h-4" />
              </button>
            </div>

            {/* Order reminder number #2 */}
            <div className="p-4 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Reminder Line #2</p>
                <p className="text-base font-bold text-gray-900 mt-1">{getDisplayNumber("orderReminder2")}</p>
              </div>
              <button
                onClick={() => handleEditClick("orderReminder2")}
                className="p-2 hover:bg-white rounded-lg text-gray-600 hover:text-gray-900 border border-transparent hover:border-gray-200 transition-colors"
                title="Edit number"
              >
                <Edit className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Restaurant page number */}
        <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm space-y-4">
          <div className="flex items-center gap-3 pb-3 border-b border-gray-100">
            <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600">
              <Phone className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">Customer Helpline Number</h2>
              <p className="text-xs text-gray-500">
                Public telephone number displayed on the app for customers to contact your outlet.
              </p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Public Phone</p>
              <p className="text-base font-bold text-gray-900 mt-1">{getDisplayNumber("restaurantPage")}</p>
            </div>
            <button
              onClick={() => handleEditClick("restaurantPage")}
              className="p-2 hover:bg-white rounded-lg text-gray-600 hover:text-gray-900 border border-transparent hover:border-gray-200 transition-colors"
              title="Edit number"
            >
              <Edit className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Edit Phone Number Popup */}
      <AnimatePresence>
        {editingNumber && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={handleCancelEdit}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
            />
            <motion.div
              initial={{ y: "100%", opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: "100%", opacity: 0 }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl z-50 max-h-[85vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <h2 className="text-base font-bold text-gray-900">Edit Phone Number</h2>
                <button
                  onClick={handleCancelEdit}
                  className="p-1 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-700"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
                {/* Country Code Selector */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                    Country Dialing Code
                  </label>
                  <button
                    type="button"
                    onClick={() => setIsCountryCodeOpen(true)}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-left flex items-center justify-between bg-white hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-lg">
                        {countryCodes.find(c => c.code === countryCode)?.flag || "🇮🇳"}
                      </span>
                      <span className="text-sm font-semibold text-gray-900">{countryCode}</span>
                    </div>
                    <ChevronDown className="w-4 h-4 text-gray-400" />
                  </button>
                </div>

                {/* Phone Number Input */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, ''))}
                    placeholder="Enter phone number"
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-gray-900"
                  />
                </div>
              </div>
              <div className="px-5 py-4 border-t border-gray-100 flex gap-3">
                <button
                  onClick={handleCancelEdit}
                  className="flex-1 py-2.5 px-4 border border-gray-300 rounded-xl text-xs font-bold text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={!phoneNumber.trim()}
                  className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-bold transition-colors ${
                    phoneNumber.trim()
                      ? "bg-gray-900 text-white hover:bg-black"
                      : "bg-gray-200 text-gray-400 cursor-not-allowed"
                  }`}
                >
                  Save & Verify
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Country Code Selection Popup */}
      <AnimatePresence>
        {isCountryCodeOpen && (
          <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsCountryCodeOpen(false)}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60]"
            />
            <motion.div
              initial={{ y: "100%", opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: "100%", opacity: 0 }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl z-[60] max-h-[70vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <h2 className="text-base font-bold text-gray-900">Select Country Code</h2>
                <button
                  onClick={() => setIsCountryCodeOpen(false)}
                  className="p-1 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-700"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
                {countryCodes.map((country) => (
                  <button
                    key={country.code}
                    onClick={() => {
                      setCountryCode(country.code)
                      setIsCountryCodeOpen(false)
                    }}
                    className={`w-full text-left px-4 py-2.5 rounded-xl text-xs font-semibold transition-colors flex items-center gap-3 ${
                      countryCode === country.code
                        ? "bg-gray-900 text-white"
                        : "bg-gray-50 text-gray-900 hover:bg-gray-100"
                    }`}
                  >
                    <span className="text-lg">{country.flag}</span>
                    <span className="flex-1">{country.country}</span>
                    <span className={countryCode === country.code ? "text-white" : "text-gray-500"}>
                      {country.code}
                    </span>
                  </button>
                ))}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* OTP Verification Popup */}
      <AnimatePresence>
        {showOtpPopup && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={handleCancelOtp}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
            />
            <motion.div
              initial={{ y: "100%", opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: "100%", opacity: 0 }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl z-50 max-h-[80vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <h2 className="text-base font-bold text-gray-900">Verify OTP</h2>
                <button
                  onClick={handleCancelOtp}
                  className="p-1 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-700"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-6">
                <div className="space-y-5">
                  <div className="text-center">
                    <p className="text-xs text-gray-500 mb-1">
                      We've sent a 6-digit verification code to
                    </p>
                    <p className="text-sm font-bold text-gray-900">
                      {pendingPhoneData ? `${pendingPhoneData.countryCode}-${pendingPhoneData.phoneNumber}` : ""}
                    </p>
                  </div>

                  {/* OTP Input Fields */}
                  <div className="flex items-center justify-center gap-2">
                    {otp.map((digit, index) => (
                      <input
                        key={index}
                        id={`otp-${index}`}
                        type="text"
                        inputMode="numeric"
                        maxLength={1}
                        value={digit}
                        onChange={(e) => handleOtpChange(index, e.target.value)}
                        onKeyDown={(e) => handleOtpKeyDown(index, e)}
                        className="w-11 h-12 text-center text-lg font-bold border-2 border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-gray-900"
                        autoFocus={index === 0}
                      />
                    ))}
                  </div>

                  <div className="text-center">
                    <button
                      onClick={handleResendOtp}
                      className="text-xs text-blue-600 hover:underline font-semibold"
                    >
                      Resend Code
                    </button>
                  </div>
                </div>
              </div>
              <div className="px-5 py-4 border-t border-gray-100 flex gap-3">
                <button
                  onClick={handleCancelOtp}
                  className="flex-1 py-2.5 px-4 border border-gray-300 rounded-xl text-xs font-bold text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleVerifyOtp}
                  disabled={otp.join("").length !== 6}
                  className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-bold transition-colors ${
                    otp.join("").length === 6
                      ? "bg-gray-900 text-white hover:bg-black"
                      : "bg-gray-200 text-gray-400 cursor-not-allowed"
                  }`}
                >
                  Verify & Confirm
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
