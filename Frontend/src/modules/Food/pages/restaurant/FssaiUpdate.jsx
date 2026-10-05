import { useState, useRef } from "react"
import { useNavigate } from "react-router-dom"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"
import { ArrowLeft, Upload } from "lucide-react"
import { ImageSourcePicker } from "@food/components/ImageSourcePicker"
import { isFlutterBridgeAvailable } from "@food/utils/imageUploadUtils"
import { toast } from "sonner"

export default function FssaiUpdate() {
  const navigate = useNavigate()
  const goBack = useRestaurantBackNavigation()
  const [uploadedFile, setUploadedFile] = useState(null)
  const [isPhotoPickerOpen, setIsPhotoPickerOpen] = useState(false)
  const fileInputRef = useRef(null)

  const handleFileSelect = (file) => {
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        toast.error("Image size too large. Max 5MB allowed.")
        return
      }
      setUploadedFile(file)
      toast.success("FSSAI license uploaded")
    }
  }

  const handleFileClick = () => {
    if (isFlutterBridgeAvailable()) {
      setIsPhotoPickerOpen(true)
    } else {
      fileInputRef.current?.click()
    }
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    // For now just go back
    toast.success("FSSAI details updated")
    goBack()
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 flex items-center gap-3 border-b border-gray-200">
        <button
          onClick={goBack}
          className="p-2 rounded-full hover:bg-gray-100"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5 text-gray-900" />
        </button>
        <h1 className="text-base font-semibold text-gray-900">Update FSSAI</h1>
      </div>

      <form onSubmit={handleSubmit} id="fssai-form" className="flex-1 px-4 pt-4 pb-28 space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            FSSAI registration number
          </label>
          <input
            type="text"
            placeholder="eg. 19138110019201"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-black focus:border-black"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Valid up to
          </label>
          <input
            type="text"
            placeholder="DD-MM-YYYY"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-black focus:border-black"
          />
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-medium text-gray-700">
            Upload your FSSAI license
          </label>
          <div 
            onClick={handleFileClick}
            className="w-full rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-8 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-gray-100 transition-colors"
          >
            {uploadedFile ? (
              <div className="space-y-2">
                <div className="text-2xl">✅</div>
                <p className="text-sm font-medium text-gray-900">{uploadedFile.name}</p>
                <p className="text-xs text-gray-500">Click to change</p>
              </div>
            ) : (
              <>
                <div className="mb-2 text-2xl">⬆️</div>
                <p className="text-sm font-medium text-gray-900 mb-1">
                  Upload your FSSAI license
                </p>
                <p className="text-xs text-gray-500">
                  jpeg, png, or pdf (up to 5MB)
                </p>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => handleFileSelect(e.target.files?.[0])}
              accept="image/*,application/pdf"
            />
          </div>
          <button
            type="button"
            className="text-xs text-gray-700 underline underline-offset-2"
          >
            View upload guidelines
          </button>
        </div>
      </form>

      {/* Bottom button */}
      <div className="px-4 pb-6 pt-2 border-t border-gray-200 bg-white">
        <button
          type="submit"
          form="fssai-form"
          className={`w-full py-3 rounded-full text-sm font-medium transition-colors ${
            uploadedFile 
              ? "bg-black text-white hover:bg-gray-900" 
              : "bg-gray-200 text-gray-500 cursor-not-allowed"
          }`}
          disabled={!uploadedFile}
        >
          Confirm
        </button>
      </div>

      <ImageSourcePicker
        isOpen={isPhotoPickerOpen}
        onClose={() => setIsPhotoPickerOpen(false)}
        onFileSelect={handleFileSelect}
        title="Upload FSSAI License"
        description="Choose how to upload your FSSAI license"
        fileNamePrefix="fssai-license"
        galleryInputRef={fileInputRef}
      />
    </div>
  )
}
