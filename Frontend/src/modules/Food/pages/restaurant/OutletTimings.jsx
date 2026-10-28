import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { motion, AnimatePresence } from "framer-motion"
import Lenis from "lenis"
import { ArrowLeft, ChevronUp, ChevronDown, Clock, Edit2 } from "lucide-react"
import { Switch } from "@food/components/ui/switch"
import { MobileTimePicker } from "@mui/x-date-pickers/MobileTimePicker"
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider"
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFns"
import { useCompanyName } from "@food/hooks/useCompanyName"
import { restaurantAPI } from "@food/api"
import { toast } from "sonner"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

// Helper function to convert "HH:mm" string to Date object
const stringToTime = (timeString) => {
  if (!timeString || !timeString.includes(":")) {
    return new Date(2000, 0, 1, 9, 0) // Default to 9:00 AM
  }
  const [hours, minutes] = timeString.split(":").map(Number)
  // Ensure we handle 0 correctly for time (12 AM is hour 0)
  const validHours = Math.max(0, Math.min(23, isNaN(hours) ? 9 : hours))
  const validMinutes = Math.max(0, Math.min(59, isNaN(minutes) ? 0 : minutes))
  return new Date(2000, 0, 1, validHours, validMinutes)
}

// Helper function to convert Date object to "HH:mm" string
const timeToString = (date) => {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
    return "09:00"
  }
  const hours = date.getHours().toString().padStart(2, "0")
  const minutes = date.getMinutes().toString().padStart(2, "0")
  return `${hours}:${minutes}`
}

// Format time from 24-hour to 12-hour format for display
const formatTime12Hour = (time24) => {
  if (!time24) return "09:00 AM"
  const [hours, minutes] = time24.split(":").map(Number)
  const period = hours >= 12 ? 'PM' : 'AM'
  const hours12 = hours % 12 || 12
  const minutesStr = minutes.toString().padStart(2, '0')
  return `${hours12}:${minutesStr} ${period}`
}

const getDefaultDays = () => ({
  Monday: { isOpen: true, openingTime: "09:00", closingTime: "22:00" },
  Tuesday: { isOpen: true, openingTime: "09:00", closingTime: "22:00" },
  Wednesday: { isOpen: true, openingTime: "09:00", closingTime: "22:00" },
  Thursday: { isOpen: true, openingTime: "09:00", closingTime: "22:00" },
  Friday: { isOpen: true, openingTime: "09:00", closingTime: "22:00" },
  Saturday: { isOpen: true, openingTime: "09:00", closingTime: "22:00" },
  Sunday: { isOpen: true, openingTime: "09:00", closingTime: "22:00" },
})

export default function OutletTimings() {
  const companyName = useCompanyName()
  const navigate = useNavigate()
  const [expandedDay, setExpandedDay] = useState("Monday")
  const isInternalUpdate = useRef(false)
  const [days, setDays] = useState(getDefaultDays)
  const [loading, setLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  // Load from backend on mount.
  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        setLoading(true)
        const res = await restaurantAPI.getOutletTimings()
        const outletTimings = res?.data?.data?.outletTimings || res?.data?.outletTimings
        if (mounted && outletTimings && typeof outletTimings === "object") {
          setDays({ ...getDefaultDays(), ...outletTimings })
        }
      } catch (error) {
        debugError("Error loading outlet timings from backend:", error)
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  // Mark unsaved changes whenever days change (after initial load)
  useEffect(() => {
    if (loading) return
    setHasUnsavedChanges(true)
  }, [days, loading])

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

  const toggleDay = (day) => {
    setExpandedDay(expandedDay === day ? null : day)
  }

  const toggleDayOpen = (day) => {
    isInternalUpdate.current = true
    setDays(prev => {
      const newOpen = !prev[day].isOpen
      return {
        ...prev,
        [day]: {
          ...prev[day],
          isOpen: newOpen,
          openingTime: newOpen ? (prev[day].openingTime || "09:00") : "",
          closingTime: newOpen ? (prev[day].closingTime || "22:00") : ""
        }
      }
    })
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await restaurantAPI.saveOutletTimings(days)
      window.dispatchEvent(new Event("outletTimingsUpdated"))
      setHasUnsavedChanges(false)
      toast.success("Outlet timings saved successfully!")
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to save timings. Please try again.")
    } finally {
      setIsSaving(false)
    }
  }

  const handleTimeChange = (day, timeType, newTime) => {
    if (!newTime) {
      debugWarn('?? No time value received in handleTimeChange')
      return
    }
    
    isInternalUpdate.current = true
    const timeString = timeToString(newTime)
    
    // Validate time string format
    if (!timeString || !timeString.includes(":")) {
      debugWarn('?? Invalid time string generated:', timeString)
      return
    }
    
    debugLog(`?? Time changed for ${day} - ${timeType}: ${timeString}`)
    
    setDays(prev => ({
      ...prev,
      [day]: {
        ...prev[day],
        [timeType]: timeString
      }
    }))
  }

  const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-sm text-gray-600">Loading outlet timings...</div>
      </div>
    )
  }

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns}>
      <div className="min-h-screen bg-white overflow-x-hidden">
        {/* Header */}
        <div className="bg-white/95 backdrop-blur-md border-b border-gray-200 sticky top-0 z-50 shadow-sm">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate("/food/restaurant/explore")}
                className="p-2 -ml-2 hover:bg-gray-100 rounded-xl text-gray-600 hover:text-gray-900 transition-colors"
                aria-label="Go back"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-base sm:text-lg font-bold text-gray-900">Outlet Operating Hours</h1>
                <p className="text-xs text-gray-500 hidden sm:block">Set open/close schedules and customer ordering windows</p>
              </div>
            </div>
            {/* Save Button in Header */}
            {hasUnsavedChanges && (
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-5 py-2 bg-gray-900 hover:bg-black disabled:opacity-60 text-white text-xs font-bold rounded-xl transition-colors flex items-center gap-2 shadow-sm"
              >
                {isSaving ? (
                  <><div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving...</>
                ) : "Save Timings"}
              </button>
            )}
          </div>
        </div>

        {/* Main Content */}
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 pb-28">

          {/* Day-wise Accordion */}
          <div className="space-y-2">
            {dayNames.map((day, index) => {
              const dayData = days[day] || { isOpen: true, openingTime: "09:00", closingTime: "22:00" }
              const isExpanded = expandedDay === day

              return (
                <motion.div
                  key={day}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: index * 0.03 }}
                  className="bg-white border border-gray-200 rounded-sm overflow-hidden"
                >
                  {/* Day Header */}
                  <div
                    className={`w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-color transition-all ${isExpanded ? "bg-gray-100" : ""}`}
                  >
                    <button
                      onClick={() => toggleDay(day)}
                      className="flex items-center gap-3 flex-1 text-left"
                    >
                      {isExpanded ? (
                        <ChevronUp className="w-5 h-5 text-gray-700" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-gray-700" />
                      )}
                      <span className="text-base font-medium text-gray-900">{day}</span>
                    </button>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-gray-700">{dayData.isOpen ? "Open" : "Close"}</span>
                      <div onClick={(e) => e.stopPropagation()}>
                        <Switch
                          checked={dayData.isOpen}
                          onCheckedChange={() => toggleDayOpen(day)}
                          className="data-[state=checked]:bg-green-500 data-[state=unchecked]:bg-gray-300"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Expanded Content */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="p-4 space-y-4 border-t border-gray-100">
                          {dayData.isOpen ? (
                            <>
                              {/* Opening Time */}
                              <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                                  <Clock className="w-4 h-4" />
                                  Opening time
                                </label>
                                <div className="border border-gray-200 rounded-md px-3 py-2 bg-gray-50/60">
                                  <MobileTimePicker
                                    value={stringToTime(dayData.openingTime)}
                                    onChange={(newValue) => {
                                      debugLog('?? Opening time picker onChange:', newValue)
                                      if (newValue) {
                                        handleTimeChange(day, "openingTime", newValue)
                                      }
                                    }}
                                    onAccept={(newValue) => {
                                      debugLog('? Opening time picker onAccept:', newValue)
                                      if (newValue) {
                                        handleTimeChange(day, "openingTime", newValue)
                                      }
                                    }}
                                    slotProps={{
                                      textField: {
                                        variant: "outlined",
                                        size: "small",
                                        placeholder: "Select opening time",
                                        sx: {
                                          "& .MuiOutlinedInput-root": {
                                            height: "36px",
                                            fontSize: "12px",
                                            backgroundColor: "white",
                                            "& fieldset": {
                                              borderColor: "#e5e7eb",
                                            },
                                            "&:hover fieldset": {
                                              borderColor: "#d1d5db",
                                            },
                                            "&.Mui-focused fieldset": {
                                              borderColor: "#000",
                                            },
                                          },
                                          "& .MuiInputBase-input": {
                                            padding: "8px 12px",
                                            fontSize: "12px",
                                          },
                                        },
                                      },
                                    }}
                                    format="hh:mm a"
                                  />
                                </div>
                                <p className="text-xs text-gray-500">
                                  Current: {formatTime12Hour(dayData.openingTime)}
                                </p>
                              </div>

                              {/* Closing Time */}
                              <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                                  <Clock className="w-4 h-4" />
                                  Closing time
                                </label>
                                <div className="border border-gray-200 rounded-md px-3 py-2 bg-gray-50/60">
                                  <MobileTimePicker
                                    value={stringToTime(dayData.closingTime)}
                                    onChange={(newValue) => {
                                      debugLog('?? Closing time picker onChange:', newValue)
                                      if (newValue) {
                                        handleTimeChange(day, "closingTime", newValue)
                                      }
                                    }}
                                    onAccept={(newValue) => {
                                      debugLog('? Closing time picker onAccept:', newValue)
                                      if (newValue) {
                                        handleTimeChange(day, "closingTime", newValue)
                                      }
                                    }}
                                    slotProps={{
                                      textField: {
                                        variant: "outlined",
                                        size: "small",
                                        placeholder: "Select closing time",
                                        sx: {
                                          "& .MuiOutlinedInput-root": {
                                            height: "36px",
                                            fontSize: "12px",
                                            backgroundColor: "white",
                                            "& fieldset": {
                                              borderColor: "#e5e7eb",
                                            },
                                            "&:hover fieldset": {
                                              borderColor: "#d1d5db",
                                            },
                                            "&.Mui-focused fieldset": {
                                              borderColor: "#000",
                                            },
                                          },
                                          "& .MuiInputBase-input": {
                                            padding: "8px 12px",
                                            fontSize: "12px",
                                          },
                                        },
                                      },
                                    }}
                                    format="hh:mm a"
                                  />
                                </div>
                                <p className="text-xs text-gray-500">
                                  Current: {formatTime12Hour(dayData.closingTime)}
                                </p>
                              </div>
                            </>
                          ) : (
                            <p className="text-sm text-gray-500 pl-6">This day is closed</p>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )
            })}
          </div>

          {/* Bottom Save Button */}
          {hasUnsavedChanges && (
            <div className="mt-6 pb-6 px-4">
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="w-full flex items-center justify-center gap-2 bg-gray-900 hover:bg-gray-800 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-lg transition-colors text-sm shadow-lg shadow-gray-200"
              >
                {isSaving ? (
                  <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving...</>
                ) : "Save All Changes"}
              </button>
            </div>
          )}
        </div>
      </div>
    </LocalizationProvider>
  )
}


