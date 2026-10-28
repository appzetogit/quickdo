import { useState, useEffect, useRef } from "react"
import { RESTAURANT_PROFILE_UPDATED } from "@food/components/restaurant/RestaurantSidebar"
import { useNavigate } from "react-router-dom"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"
import { motion, AnimatePresence } from "framer-motion"
import Lenis from "lenis"
import {
  ArrowLeft,
  Edit,
  Pencil,
  Plus,
  MapPin,
  Clock,
  Star,
  ChevronRight,
  X,
  Trash2,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@food/components/ui/dialog"
import { Button } from "@food/components/ui/button"
import { Input } from "@food/components/ui/input"
import { restaurantAPI } from "@food/api"
import { toast } from "sonner"
import { ImageSourcePicker } from "@food/components/ImageSourcePicker"
import { isFlutterBridgeAvailable, convertBase64ToFile } from "@food/utils/imageUploadUtils"

const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}


const CUISINES_STORAGE_KEY = "restaurant_cuisines"



export default function OutletInfo() {
  const navigate = useNavigate()
  const goBack = useRestaurantBackNavigation()
  
  // State management
  const [restaurantData, setRestaurantData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [restaurantName, setRestaurantName] = useState("")
  const [cuisineTags, setCuisineTags] = useState("")
  const [address, setAddress] = useState("")
  const [mainImage, setMainImage] = useState("https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=800&h=400&fit=crop")
  const [thumbnailImage, setThumbnailImage] = useState("https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=200&h=200&fit=crop")
  const [coverImages, setCoverImages] = useState([]) // Array of cover images (separate from menu images)
  const [showEditNameDialog, setShowEditNameDialog] = useState(false)
  const [editNameValue, setEditNameValue] = useState("")
  const [restaurantId, setRestaurantId] = useState("")
  const [restaurantMongoId, setRestaurantMongoId] = useState("")
  const [uploadingImage, setUploadingImage] = useState(false)
  const [imageType, setImageType] = useState(null) // 'profile' or 'menu'
  const [uploadingCount, setUploadingCount] = useState(0) // Track how many images are being uploaded
  
  const profileImageInputRef = useRef(null)
  const menuImageInputRef = useRef(null)
  const [activePicker, setActivePicker] = useState(null) // { type: 'profile' | 'cover', ref: any, title: string, multiple: boolean }

  // Format address from location object
  const formatAddress = (location) => {
    if (!location) return ""
    
    const parts = []
    if (location.addressLine1) parts.push(location.addressLine1.trim())
    if (location.addressLine2) parts.push(location.addressLine2.trim())
    if (location.area) parts.push(location.area.trim())
    if (location.city) {
      const city = location.city.trim()
      // Only add city if it's not already included in area
      if (!location.area || !location.area.includes(city)) {
        parts.push(city)
      }
    }
    if (location.landmark) parts.push(location.landmark.trim())
    
    return parts.join(", ") || ""
  }

  // Fetch restaurant data on mount
  useEffect(() => {
    const fetchRestaurantData = async () => {
      try {
        setLoading(true)
        const response = await restaurantAPI.getCurrentRestaurant()
        const data = response?.data?.data?.restaurant || response?.data?.restaurant
        if (data) {
          setRestaurantData(data)
          
          // Set restaurant name
          setRestaurantName(data.name || "")
          
          // Set restaurant ID
          setRestaurantId(data.restaurantId || data.id || "")
          // Set MongoDB _id for last 5 digits display
          const mongoId = String(data.id || data._id || "")
          setRestaurantMongoId(mongoId)
          
          // Format and set address
          const formattedAddress = formatAddress(data.location)
          setAddress(formattedAddress)
          
          // Format cuisines
          if (data.cuisines && Array.isArray(data.cuisines) && data.cuisines.length > 0) {
            setCuisineTags(data.cuisines.join(", "))
          }
          
          // Set images
          if (data.profileImage?.url) {
            setThumbnailImage(data.profileImage.url)
          }
          // Use coverImages if available, otherwise fallback to menuImages for backward compatibility
          if (data.coverImages && Array.isArray(data.coverImages) && data.coverImages.length > 0) {
            setCoverImages(data.coverImages.map(img => ({
              url: img.url || img,
              publicId: img.publicId
            })))
            setMainImage(data.coverImages[0].url || data.coverImages[0])
          } else if (data.menuImages && Array.isArray(data.menuImages) && data.menuImages.length > 0) {
            setCoverImages(data.menuImages.map(img => ({
              url: img.url,
              publicId: img.publicId
            })))
            setMainImage(data.menuImages[0].url)
          } else {
            setCoverImages([])
          }
        }
      } catch (error) {
        if (error.code !== 'ERR_NETWORK' && error.code !== 'ECONNABORTED' && !error.message?.includes('timeout')) {
          debugError("Error fetching restaurant data:", error)
        }
      } finally {
        setLoading(false)
      }
    }

    fetchRestaurantData()

    // Listen for updates from edit pages
    const handleCuisinesUpdate = () => {
      fetchRestaurantData()
    }
    const handleAddressUpdate = () => {
      fetchRestaurantData()
    }

    window.addEventListener("cuisinesUpdated", handleCuisinesUpdate)
    window.addEventListener("addressUpdated", handleAddressUpdate)
    
    return () => {
      window.removeEventListener("cuisinesUpdated", handleCuisinesUpdate)
      window.removeEventListener("addressUpdated", handleAddressUpdate)
    }
  }, [])

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

  // Handle profile image replacement
  const handleProfileImageReplace = async (file) => {
    if (!file) return

    try {
      setUploadingImage(true)
      setImageType('profile')

      // Upload image to Cloudinary
      const uploadResponse = await restaurantAPI.uploadProfileImage(file)
      const uploadedImage = uploadResponse?.data?.data?.profileImage

      if (uploadedImage) {
        if (uploadedImage.url) {
          setThumbnailImage(uploadedImage.url)
        }
        
        // Refresh restaurant data
        const response = await restaurantAPI.getCurrentRestaurant()
        const data = response?.data?.data?.restaurant || response?.data?.restaurant
        if (data) {
          setRestaurantData(data)
          if (data.profileImage?.url) {
            setThumbnailImage(data.profileImage.url)
          }
        }
      }
      window.dispatchEvent(new CustomEvent(RESTAURANT_PROFILE_UPDATED))
    } catch (error) {
      debugError("Error uploading profile image:", error)
      toast.error("Failed to upload image. Please try again.")
    } finally {
      setUploadingImage(false)
      setImageType(null)
    }
  }

  // Handle multiple cover images addition
  const handleCoverImageAdd = async (files) => {
    if (!files || (Array.isArray(files) && files.length === 0)) return
    const fileArray = Array.isArray(files) ? files : [files]

    try {
      setUploadingImage(true)
      setImageType('menu')
      setUploadingCount(fileArray.length)

      // Get current images
      const currentResponse = await restaurantAPI.getCurrentRestaurant()
      const currentData = currentResponse?.data?.data?.restaurant || currentResponse?.data?.restaurant
      const existingImages = currentData?.menuImages && Array.isArray(currentData.menuImages)
        ? currentData.menuImages.map(img => ({
            url: img.url,
            publicId: img.publicId
          }))
        : []

      const uploadedImageData = []
      const failedUploads = []
      
      for (let i = 0; i < fileArray.length; i++) {
        try {
          const uploadResponse = await restaurantAPI.uploadMenuImage(fileArray[i])
          const uploadedImage = uploadResponse?.data?.data?.menuImage
          if (uploadedImage?.url) {
            uploadedImageData.push({
              url: uploadedImage.url,
              publicId: uploadedImage.publicId || null
            })
          }
        } catch (error) {
          failedUploads.push({ fileName: fileArray[i]?.name || "image", error: error.message })
        }
      }

      if (uploadedImageData.length > 0) {
        const allImages = [...existingImages]
        uploadedImageData.forEach(uploaded => {
          if (!allImages.find(img => img.url === uploaded.url)) {
            allImages.push(uploaded)
          }
        })

        try {
          await restaurantAPI.updateProfile({ menuImages: allImages })
          toast.success(`Successfully uploaded ${uploadedImageData.length} image(s)`)
        } catch (updateError) {
          toast.error("Images uploaded but failed to save.")
        }

        setCoverImages(allImages)
        if (allImages.length > 0) setMainImage(allImages[0].url)
      }
    } catch (error) {
      toast.error("Failed to upload images.")
    } finally {
      setUploadingImage(false)
      setImageType(null)
      setUploadingCount(0)
    }
  }

  const handleImageClick = (type, ref, title, multiple = false) => {
    if (isFlutterBridgeAvailable()) {
      setActivePicker({ type, ref, title, multiple })
    } else {
      ref.current?.click()
    }
  }

  // Handle cover image deletion
  const handleCoverImageDelete = async (indexToDelete) => {
    if (!window.confirm("Are you sure you want to delete this cover image?")) return

    try {
      setUploadingImage(true)
      setImageType('menu')

      const updatedImages = coverImages.filter((_, index) => index !== indexToDelete)
      const menuImagesForBackend = updatedImages.map(img => ({
        url: img.url,
        publicId: img.publicId || null
      }))

      await restaurantAPI.updateProfile({ menuImages: menuImagesForBackend })
      setCoverImages(updatedImages)
      if (indexToDelete === 0 && updatedImages.length > 0) {
        setMainImage(updatedImages[0].url)
      } else if (updatedImages.length === 0) {
        setMainImage("https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=800&h=400&fit=crop")
      }
      toast.success("Image deleted successfully")
    } catch (error) {
      toast.error("Failed to delete image.")
    } finally {
      setUploadingImage(false)
      setImageType(null)
    }
  }

  // Handle edit name dialog
  const handleOpenEditDialog = () => {
    setEditNameValue(restaurantName)
    setShowEditNameDialog(true)
  }

  const handleSaveName = async () => {
    const newName = editNameValue.trim()
    if (!newName) return
    try {
      await restaurantAPI.updateProfile({ name: newName })
      setRestaurantName(newName)
      window.dispatchEvent(new CustomEvent(RESTAURANT_PROFILE_UPDATED))
      setShowEditNameDialog(false)
      toast.success("Name updated successfully")
    } catch (error) {
      toast.error("Failed to update name")
    }
  }

  return (
    <>
      <div className="min-h-screen bg-neutral-50/60 pb-28 text-gray-900">
        {/* Header */}
        <div className="bg-white/95 backdrop-blur-md border-b border-gray-200 sticky top-0 z-50 shadow-sm">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={goBack} className="p-2 -ml-2 hover:bg-gray-100 rounded-xl text-gray-600 hover:text-gray-900 transition-colors">
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-base sm:text-lg font-bold text-gray-900">Outlet Profile & Credentials</h1>
                <p className="text-xs text-gray-500 hidden sm:block">Public profile images, branding banner and address</p>
              </div>
            </div>
            <div className="flex items-center gap-2 bg-gray-100 px-3 py-1.5 rounded-xl border border-gray-200">
              <span className="text-xs text-gray-700 font-bold">
                ID: {loading ? "..." : (restaurantMongoId && restaurantMongoId.length >= 5 ? restaurantMongoId.slice(-5) : (restaurantId || "N/A"))}
              </span>
            </div>
          </div>
        </div>

        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
          {/* Main Image Section Card */}
          <div className="bg-white rounded-3xl overflow-hidden border border-gray-200 shadow-sm relative">
            <div className="relative w-full h-56 sm:h-72 overflow-hidden bg-gray-900">
              <img src={mainImage} alt="Restaurant banner" className="w-full h-full object-cover opacity-90" />
              
              <button
                onClick={() => handleImageClick('cover', menuImageInputRef, "Add Cover Image", true)}
                disabled={uploadingImage}
                className="absolute bottom-4 right-4 bg-gray-900/90 hover:bg-black px-4 py-2 rounded-xl flex items-center gap-2 text-xs font-bold text-white transition-all shadow-lg z-20 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus className="w-4 h-4" />
                <span>{uploadingImage && imageType === 'menu' ? `Uploading ${uploadingCount}...` : 'Add Cover Photo'}</span>
              </button>
              <input
                ref={menuImageInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => handleCoverImageAdd(Array.from(e.target.files || []))}
              />
              
              {/* Cover Images Gallery */}
              {coverImages.length > 0 && (
                <div className="absolute bottom-16 right-4 flex gap-2.5 z-10">
                  {coverImages.slice(0, 4).map((img, index) => (
                    <div
                      key={index}
                      className={`relative w-12 h-12 rounded-xl border-2 overflow-hidden bg-gray-200 shadow-md transition-all ${
                        mainImage === img.url ? "border-white scale-105" : "border-white/60"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setMainImage(img.url)}
                        className="w-full h-full"
                      >
                        <img src={img.url} alt={`Cover ${index + 1}`} className="w-full h-full object-cover" />
                      </button>
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleCoverImageDelete(index); }}
                        disabled={uploadingImage}
                        className="absolute top-0.5 right-0.5 bg-red-500/95 hover:bg-red-600 p-0.5 rounded-full transition-colors z-10"
                      >
                        <Trash2 className="w-2.5 h-2.5 text-white" />
                      </button>
                    </div>
                  ))}
                  {coverImages.length > 4 && (
                    <div className="w-12 h-12 rounded-xl border-2 border-white bg-black/70 flex items-center justify-center shadow-md">
                      <span className="text-white text-xs font-bold">+{coverImages.length - 4}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Profile Avatar Bar */}
            <div className="p-6 pt-4 flex items-end justify-between gap-4 border-b border-gray-100">
              <div className="flex items-center gap-4">
                <div className="relative w-20 h-20 -mt-10 rounded-2xl overflow-hidden border-4 border-white shadow-lg bg-gray-100 flex-shrink-0">
                  <img src={thumbnailImage} alt="Restaurant thumbnail" className="w-full h-full object-cover" />
                </div>
                <div>
                  <button
                    onClick={() => handleImageClick('profile', profileImageInputRef, "Update Profile Photo")}
                    disabled={uploadingImage}
                    className="text-xs font-bold text-gray-900 hover:underline transition-colors"
                  >
                    {uploadingImage && imageType === 'profile' ? 'Uploading...' : 'Change Logo / Profile Picture'}
                  </button>
                  <input
                    ref={profileImageInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => handleProfileImageReplace(e.target.files?.[0])}
                  />
                </div>
              </div>

              <button onClick={() => navigate("/food/restaurant/ratings-reviews")} className="flex items-center gap-2">
                <div className="bg-emerald-600 px-3 py-1 rounded-xl flex items-center gap-1">
                  <span className="text-white text-xs font-bold">{restaurantData?.rating?.toFixed(1) || "0.0"}</span>
                  <Star className="w-3 h-3 text-white fill-white" />
                </div>
                <span className="text-gray-500 text-xs font-bold hidden sm:inline">{restaurantData?.totalRatings || 0} Ratings</span>
              </button>
            </div>
          </div>

        <div className="px-4 py-4"><h2 className="text-base font-bold text-gray-900 text-center">Restaurant Information</h2></div>

        <div className="px-4 pb-6 space-y-3">
          <div className="bg-blue-100/50 rounded-lg p-4 border border-blue-300">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-500 font-normal mb-1">Restaurant's name</p>
                <p className="text-base font-semibold text-gray-900">{loading ? "Loading..." : (restaurantName || "N/A")}</p>
              </div>
              <button onClick={handleOpenEditDialog} className="text-blue-600 text-sm font-normal">Edit</button>
            </div>
          </div>
          {/* ... other info cards ... */}
        </div>
      </div>
    </div>

      <Dialog open={showEditNameDialog} onOpenChange={setShowEditNameDialog}>
        <DialogContent aria-describedby={undefined} className="sm:max-w-md p-0 overflow-hidden rounded-xl w-[90%]">
          <DialogHeader className="p-4 border-b border-gray-100"><DialogTitle className="text-lg font-bold">Edit restaurant name</DialogTitle></DialogHeader>
          <div className="p-4"><Input value={editNameValue} onChange={(e) => setEditNameValue(e.target.value)} placeholder="Enter restaurant name" className="w-full" /></div>
          <DialogFooter className="p-4 bg-gray-50 flex flex-row gap-3">
            <Button variant="outline" onClick={() => setShowEditNameDialog(false)}>Cancel</Button>
            <Button onClick={handleSaveName} disabled={!editNameValue.trim()} className="bg-blue-600 text-white">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
 

      <ImageSourcePicker
        isOpen={!!activePicker}
        onClose={() => setActivePicker(null)}
        onFileSelect={(file) => {
          if (activePicker?.type === 'profile') {
            handleProfileImageReplace(file)
          } else {
            handleCoverImageAdd(file)
          }
        }}
        title={activePicker?.title}
        description={`Choose how to upload your ${activePicker?.type} photo`}
        fileNamePrefix={`outlet-${activePicker?.type}`}
        galleryInputRef={activePicker?.ref}
      />
    </>
  )
}
