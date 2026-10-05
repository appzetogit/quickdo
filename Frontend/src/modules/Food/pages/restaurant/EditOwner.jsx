import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"
import Lenis from "lenis"
import {
  ArrowLeft,
  User,
  Edit,
  Trash2,
} from "lucide-react"
import { Button } from "@food/components/ui/button"
import { Input } from "@food/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@food/components/ui/dialog"
import { restaurantAPI } from "@food/api"
import OptimizedImage from "@food/components/OptimizedImage"
import { clearModuleAuth } from "@food/utils/auth"
import { firebaseAuth, ensureFirebaseInitialized } from "@food/firebase"

import { ImageSourcePicker } from "@food/components/ImageSourcePicker"
import { isFlutterBridgeAvailable } from "@food/utils/imageUploadUtils"
import { toast } from "sonner"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}


const STORAGE_KEY = "restaurant_owner_contact"

export default function EditOwner() {
  const navigate = useNavigate()
  const goBack = useRestaurantBackNavigation()
  const [ownerData, setOwnerData] = useState({
    name: "",
    phone: "",
    email: "",
    photo: null
  })
  
  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    email: "",
    photo: null
  })
  const [hasChanges, setHasChanges] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [profileImageFile, setProfileImageFile] = useState(null)
  const fileInputRef = useRef(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isPhotoPickerOpen, setIsPhotoPickerOpen] = useState(false)

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

  // Fetch restaurant data from backend on mount
  useEffect(() => {
    const fetchRestaurantData = async () => {
      try {
        setLoading(true)
        const response = await restaurantAPI.getCurrentRestaurant()
        const data = response?.data?.data?.restaurant || response?.data?.restaurant
        if (data) {
          const ownerDataFromBackend = {
            name: data.ownerName || data.name || "",
            phone: data.ownerPhone || data.primaryContactNumber || data.phone || "",
            email: data.ownerEmail || data.email || "",
            photo: data.profileImage?.url || null
          }
          setOwnerData(ownerDataFromBackend)
          setFormData(ownerDataFromBackend)
        }
      } catch (error) {
        // Only log error if it's not a network/timeout error (backend might be down/slow)
        if (error.code !== 'ERR_NETWORK' && error.code !== 'ECONNABORTED' && !error.message?.includes('timeout')) {
          debugError("Error fetching restaurant data:", error)
        }
        // Fallback to localStorage
        try {
          const saved = localStorage.getItem(STORAGE_KEY)
          if (saved) {
            const parsed = JSON.parse(saved)
            setOwnerData(parsed)
            setFormData(parsed)
          }
        } catch (e) {
          debugError("Error loading owner data from localStorage:", e)
        }
      } finally {
        setLoading(false)
      }
    }

    fetchRestaurantData()
  }, [])

  // Check for changes
  useEffect(() => {
    const changed = 
      formData.name !== ownerData.name ||
      formData.email !== ownerData.email ||
      profileImageFile !== null
    setHasChanges(changed)
  }, [formData.name, formData.email, ownerData.name, ownerData.email, profileImageFile])

  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }))
  }

  const handlePhotoClick = () => {
    if (isFlutterBridgeAvailable()) {
      setIsPhotoPickerOpen(true)
    } else {
      fileInputRef.current?.click()
    }
  }

  const handlePhotoSelect = (file) => {
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        toast.error("Image size too large. Max 5MB allowed.")
        return
      }
      setProfileImageFile(file)
      const reader = new FileReader()
      reader.onload = (e) => {
        const photoData = e.target?.result
        setFormData(prev => ({
          ...prev,
          photo: photoData
        }))
      }
      reader.readAsDataURL(file)
    }
  }

  const handlePhotoChange = (event) => {
    const file = event.target.files?.[0]
    handlePhotoSelect(file)
  }

  const handleSave = async () => {
    try {
      setSaving(true)

      // First, upload profile image if changed
      if (profileImageFile) {
        try {
          const imageResponse = await restaurantAPI.uploadProfileImage(profileImageFile)
          const imageData = imageResponse?.data?.data?.image || imageResponse?.data?.image
          if (imageData?.url) {
            formData.photo = imageData.url
          }
        } catch (error) {
          debugError("Error uploading profile image:", error)
          alert("Failed to upload profile image. Please try again.")
          setSaving(false)
          return
        }
      }

      // Update owner details in backend
      const updatePayload = {
        ownerName: formData.name.trim(),
        ownerEmail: formData.email.trim(),
        // The phone is read-only here and is the login number. It is not sent:
        // this form fills it from primaryContactNumber when ownerPhone is empty,
        // which silently replaced the login number with the contact number.
      }

      // If profile image was uploaded, include it
      if (profileImageFile && formData.photo) {
        // Extract publicId from the uploaded image response if available
        // For now, we'll let the backend handle it via the profileImage field
        // The uploadProfileImage already updates it, so we might not need to send it again
      }

      const response = await restaurantAPI.updateProfile(updatePayload)
      
      if (response?.data?.success) {
        // Save to localStorage as backup
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(formData))
        } catch (e) {
          debugError("Error saving to localStorage:", e)
        }
        
        // Dispatch event to notify parent page
        window.dispatchEvent(new Event("ownerDataUpdated"))
        
        // Update local state
        setOwnerData({ ...formData })
        setProfileImageFile(null)
        setHasChanges(false)
        
        // Navigate back
        goBack()
      } else {
        throw new Error("Invalid response from server")
      }
    } catch (error) {
      debugError("Error saving owner data:", error)
      alert(`Failed to save owner details: ${error.response?.data?.message || error.message || "Please try again."}`)
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteAccount = async () => {
    if (isDeleting) return // Prevent multiple clicks
    
    setIsDeleting(true)
    
    try {
      // Call backend API to delete the account
      await restaurantAPI.deleteAccount()
      
      // Sign out from Firebase if restaurant logged in via Google
      try {
        const { signOut } = await import("firebase/auth")
        // Firebase Auth is lazy-initialized now; ensure it before accessing firebaseAuth.currentUser
        ensureFirebaseInitialized({ enableAuth: true, enableRealtimeDb: false })
        const currentUser = firebaseAuth.currentUser
        if (currentUser) {
          await signOut(firebaseAuth)
        }
      } catch (firebaseError) {
        // Continue even if Firebase logout fails
        debugWarn("Firebase logout failed, continuing with cleanup:", firebaseError)
      }

      // Clear restaurant module authentication data
      clearModuleAuth("restaurant")
      
      // Clear all restaurant-related localStorage data
      localStorage.removeItem(STORAGE_KEY)
      localStorage.removeItem("restaurant_onboarding")
      localStorage.removeItem("restaurant_accessToken")
      localStorage.removeItem("restaurant_authenticated")
      localStorage.removeItem("restaurant_user")
      localStorage.removeItem("restaurant_invited_users")
      
      // Clear sessionStorage
      sessionStorage.removeItem("restaurantAuthData")
      
      // Dispatch auth change event to notify other components
      window.dispatchEvent(new Event("restaurantAuthChanged"))
      
      setShowDeleteDialog(false)
      
      // Navigate to welcome page
      setTimeout(() => {
        navigate("/restaurant/welcome", { replace: true })
      }, 300)
    } catch (error) {
      debugError("Error deleting account:", error)
      alert(`Failed to delete account: ${error.response?.data?.message || error.message || "Please try again."}`)
      setIsDeleting(false)
    }
  }

  return (
    <>
      <div className="min-h-screen bg-neutral-50/60 pb-28 text-gray-900">
        {/* Header */}
        <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-gray-200">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={goBack}
                className="p-2 -ml-2 rounded-xl text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors"
                aria-label="Go back"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-lg sm:text-xl font-bold text-gray-900">Contact Details</h1>
                <p className="text-xs text-gray-500 hidden sm:block">Manage restaurant owner and manager profile information</p>
              </div>
            </div>

            <button
              onClick={handleSave}
              disabled={!hasChanges || loading || saving}
              className="hidden sm:inline-flex items-center justify-center px-5 py-2 rounded-xl text-sm font-semibold transition-colors bg-gray-900 hover:bg-black text-white disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-6">
          <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm space-y-6">
            {/* Profile Photo Section */}
            <div className="flex flex-col items-center gap-3 pb-6 border-b border-gray-100">
              <div className="relative">
                <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center overflow-hidden border-2 border-gray-200 shadow-inner">
                  {loading ? (
                    <User className="w-12 h-12 text-gray-400" />
                  ) : formData.photo ? (
                    <OptimizedImage
                      src={formData.photo}
                      alt="Owner profile"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <User className="w-12 h-12 text-gray-400" />
                  )}
                </div>
              </div>
              <button
                onClick={handlePhotoClick}
                disabled={loading || saving}
                className="text-gray-900 text-xs font-semibold hover:underline transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Change Photo
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhotoChange}
                disabled={loading || saving}
              />
            </div>

            {/* Editable Fields */}
            <div className="space-y-4">
              {/* Name Field */}
              <div>
                <label className="text-xs font-semibold text-gray-700 mb-1.5 block">Owner / Contact Name</label>
                <div className="relative">
                  <Input
                    type="text"
                    value={loading ? "Loading..." : formData.name}
                    onChange={(e) => handleInputChange("name", e.target.value)}
                    placeholder="Enter name"
                    className="w-full pr-10 rounded-xl"
                    disabled={loading || saving}
                  />
                  <Edit className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                </div>
              </div>

              {/* Phone Number Field */}
              <div>
                <label className="text-xs font-semibold text-gray-700 mb-1.5 block">Registered Phone Number</label>
                <Input
                  type="tel"
                  value={loading ? "Loading..." : formData.phone}
                  placeholder="Enter phone number"
                  className="w-full bg-gray-50 rounded-xl cursor-not-allowed"
                  readOnly
                  disabled={loading || saving}
                />
                <p className="text-[11px] text-gray-400 mt-1">Phone number is managed via outlet verification and cannot be changed directly.</p>
              </div>

              {/* Email Field */}
              <div>
                <label className="text-xs font-semibold text-gray-700 mb-1.5 block">Email Address</label>
                <div className="relative">
                  <Input
                    type="email"
                    value={loading ? "Loading..." : formData.email}
                    onChange={(e) => handleInputChange("email", e.target.value)}
                    placeholder="Enter email address"
                    className="w-full pr-10 rounded-xl"
                    disabled={loading || saving}
                  />
                  <Edit className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                </div>
              </div>
            </div>

            {/* Delete Account Section */}
            <div className="pt-4 border-t border-gray-100 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-red-600">Delete Restaurant Account</p>
                <p className="text-xs text-gray-500">Permanently remove this store and all linked records</p>
              </div>
              <button
                onClick={() => setShowDeleteDialog(true)}
                className="px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 text-xs font-semibold transition-colors flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete</span>
              </button>
            </div>
          </div>
        </div>

        {/* Delete Account Confirmation Dialog */}
        <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <DialogContent className="sm:max-w-md p-6 w-[90%] rounded-2xl">
            <DialogHeader className="text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
                <span className="text-2xl leading-none text-red-600">!</span>
              </div>
              <DialogTitle className="text-base font-bold text-gray-900 text-center">
                You are about to delete your Quick Drop Store account
              </DialogTitle>
              <DialogDescription className="mt-2 text-xs text-gray-600 leading-relaxed text-center">
                All information associated with your account will be deleted, and you will lose access to your restaurant permanently.
                This information cannot be recovered once deleted. Are you sure you want to proceed?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex flex-col sm:flex-row gap-2 mt-4">
              <Button
                variant="outline"
                onClick={() => setShowDeleteDialog(false)}
                disabled={isDeleting}
                className="w-full sm:flex-1 rounded-xl"
              >
                Cancel
              </Button>
              <Button
                onClick={handleDeleteAccount}
                disabled={isDeleting}
                className="w-full sm:flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl disabled:opacity-50"
              >
                {isDeleting ? "Deleting..." : "Confirm Delete"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Save Button - Responsive Sticky Footer */}
        <div className="fixed lg:sticky bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-gray-200 px-4 py-3.5 z-30 shadow-lg lg:shadow-none">
          <div className="max-w-3xl mx-auto flex justify-end">
            <Button
              onClick={handleSave}
              disabled={!hasChanges || loading || saving}
              className={`w-full sm:w-auto px-8 py-2.5 rounded-xl font-bold ${
                hasChanges && !loading && !saving
                  ? "bg-gray-900 hover:bg-black text-white" 
                  : "bg-gray-200 text-gray-500 cursor-not-allowed"
              } transition-colors`}
            >
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      </div>

      <ImageSourcePicker
        isOpen={isPhotoPickerOpen}
        onClose={() => setIsPhotoPickerOpen(false)}
        onFileSelect={handlePhotoSelect}
        title="Update owner photo"
        description="Choose how to upload your owner profile photo"
        fileNamePrefix="owner-photo"
        galleryInputRef={fileInputRef}
      />
    </>
  )
}
