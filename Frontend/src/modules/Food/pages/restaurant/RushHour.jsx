import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"
import Lenis from "lenis"
import { ArrowLeft, Zap } from "lucide-react"
import { RadioGroup, RadioGroupItem } from "@food/components/ui/radio-group"
import { Label } from "@food/components/ui/label"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}


export default function RushHour() {
  const navigate = useNavigate()
  const goBack = useRestaurantBackNavigation()
  const [selectedTime, setSelectedTime] = useState("30")

  // Lenis smooth scrolling
  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
    })

    function raf(time) {
      lenis.raf(time)
      requestAnimationFrame(raf)
    }

    requestAnimationFrame(raf)

    return () => {
      lenis.destroy()
    }
  }, [])

  const handleConfirm = () => {
    // Handle rush hour confirmation logic here
    debugLog("Rush hour confirmed for:", selectedTime, "minutes")
    // You can add API call or state management here
    goBack() // Go back after confirmation
  }

  const timeOptions = [
    { value: "30", label: "30 minutes" },
    { value: "60", label: "1 hour" },
    { value: "90", label: "1 hour 30 minutes" },
    { value: "120", label: "2 hours" },
  ]

  return (
    <div className="min-h-screen bg-neutral-50/60 flex flex-col pb-28 text-gray-900">
      {/* Header */}
      <div className="bg-white/95 backdrop-blur-md border-b border-gray-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button 
              onClick={goBack}
              className="p-2 -ml-2 hover:bg-gray-100 rounded-xl text-gray-600 hover:text-gray-900 transition-colors"
              aria-label="Go back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-base sm:text-lg font-bold text-gray-900">Kitchen Rush Hour Mode</h1>
              <p className="text-xs text-gray-500 hidden sm:block">Extend preparation time estimates when order volume spikes</p>
            </div>
          </div>
          <button
            onClick={handleConfirm}
            className="hidden sm:inline-flex items-center justify-center bg-gray-900 hover:bg-black text-white px-5 py-2 rounded-xl text-xs font-bold transition-all shadow-sm"
          >
            Confirm Mode
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-3xl mx-auto w-full flex-1 px-4 sm:px-6 py-6 space-y-6">
        {/* Informational Banner */}
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-5 flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-amber-500 flex items-center justify-center shrink-0 text-white shadow-md shadow-amber-500/20">
            <Zap className="w-6 h-6" strokeWidth={2.5} fill="white" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-gray-900">High Order Rush Alert</h2>
            <p className="text-xs text-gray-600 leading-relaxed mt-1">
              Temporarily extends customer-facing preparation times by 10-15 minutes so your kitchen team can pace orders without missing SLA metrics.
            </p>
          </div>
        </div>

        {/* How this helps you Section */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-4">
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Benefits of Rush Mode</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { title: "More Prep Buffer", desc: "Prevents rider rush before food is packed" },
              { title: "Accurate ETAs", desc: "Customer app displays realistic arrival times" },
              { title: "Clean Handover", desc: "Avoids crowding of riders at your pick-up counter" }
            ].map((benefit, index) => (
              <div key={index} className="p-4 rounded-xl bg-gray-50 border border-gray-100 flex flex-col justify-between">
                <span className="w-6 h-6 rounded-full bg-gray-900 text-white text-xs font-bold flex items-center justify-center mb-2">
                  {index + 1}
                </span>
                <p className="text-xs font-bold text-gray-900">{benefit.title}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">{benefit.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Time Selection Section */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-4">
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider">
            Extend Food Preparation Time For Next
          </h2>
          <RadioGroup value={selectedTime} onValueChange={setSelectedTime} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {timeOptions.map((option) => {
              const isSelected = selectedTime === option.value
              return (
                <label
                  key={option.value}
                  htmlFor={option.value}
                  className={`flex items-center gap-3 p-4 rounded-xl border cursor-pointer transition-all ${
                    isSelected ? "bg-gray-50 border-gray-900 shadow-sm ring-1 ring-gray-900" : "bg-white border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  <RadioGroupItem value={option.value} id={option.value} className="h-4 w-4" />
                  <span className="text-xs font-bold text-gray-900 flex-1">
                    {option.label}
                  </span>
                </label>
              )
            })}
          </RadioGroup>
        </div>

        {/* Mobile Confirm Button */}
        <div className="sm:hidden pt-2">
          <button
            onClick={handleConfirm}
            className="w-full bg-gray-900 hover:bg-black text-white font-bold py-3.5 px-4 rounded-xl text-sm transition-colors shadow-md"
          >
            Confirm Rush Hour
          </button>
        </div>
      </div>
    </div>
  )
}

