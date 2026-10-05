import { useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"
import { AnimatePresence, motion } from "framer-motion"
import {
  ArrowLeft,
  BadgeCheck,
  Clock3,
  Edit2,
  Eye,
  EyeOff,
  Globe,
  Loader2,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react"
import { restaurantAPI, uploadAPI } from "@food/api"
import { toast } from "sonner"
import { ImageSourcePicker } from "@food/components/ImageSourcePicker"
import { isFlutterBridgeAvailable } from "@food/utils/imageUploadUtils"

const defaultFormData = {
  name: "",
  type: "",
  image: "",
  isActive: true,
  sortOrder: 0,
  foodTypeScope: "Veg",
}

const approvalBadgeClass = (status) => {
  const value = String(status || "pending").toLowerCase()
  if (value === "approved") return "bg-emerald-50 text-emerald-700 border-emerald-200"
  if (value === "rejected") return "bg-rose-50 text-rose-700 border-rose-200"
  return "bg-amber-50 text-amber-700 border-amber-200"
}

const scopePillClass = (scope) => {
  if (scope === "Veg") return "bg-green-50 text-green-700 border-green-200"
  if (scope === "Non-Veg") return "bg-red-50 text-red-700 border-red-200"
  return "bg-slate-100 text-slate-700 border-slate-200"
}

export default function MenuCategoriesPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const goBack = useRestaurantBackNavigation()
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingCategory, setEditingCategory] = useState(null)
  const [formData, setFormData] = useState(defaultFormData)
  const [selectedImageFile, setSelectedImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [isPhotoPickerOpen, setIsPhotoPickerOpen] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => {
    fetchCategories()
  }, [])

  useEffect(() => {
    const draftCategoryName = String(location.state?.draftCategoryName || "").trim()
    if (!draftCategoryName) return
    setEditingCategory(null)
    setFormData((prev) => ({ ...prev, ...defaultFormData, name: draftCategoryName }))
    setSelectedImageFile(null)
    setImagePreview(null)
    setShowModal(true)
    navigate(location.pathname, { replace: true, state: null })
  }, [location.pathname, location.state, navigate])

  const ownCategories = useMemo(
    () => categories.filter((category) => category.ownedByRestaurant),
    [categories],
  )

  const fetchCategories = async () => {
    try {
      setLoading(true)
      const response = await restaurantAPI.getAllCategories()
      const list = response?.data?.data?.categories || []
      setCategories(Array.isArray(list) ? list : [])
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load categories")
      setCategories([])
    } finally {
      setLoading(false)
    }
  }

  const resetModal = () => {
    setShowModal(false)
    setEditingCategory(null)
    setFormData(defaultFormData)
    setSelectedImageFile(null)
    setImagePreview(null)
    setUploadingImage(false)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const openCreateModal = () => {
    setEditingCategory(null)
    setFormData(defaultFormData)
    setSelectedImageFile(null)
    setImagePreview(null)
    setShowModal(true)
  }

  const openEditModal = (category) => {
    if (!category?.canEdit) {
      toast.error("Admin controls this category now")
      return
    }
    setEditingCategory(category)
    setFormData({
      name: category?.name || "",
      type: category?.type || "",
      image: category?.image || "",
      isActive: category?.isActive !== false,
      sortOrder: Number.isFinite(Number(category?.sortOrder)) ? Number(category.sortOrder) : 0,
      foodTypeScope: category?.foodTypeScope || "Veg",
    })
    setSelectedImageFile(null)
    setImagePreview(category?.image || null)
    setShowModal(true)
  }

  const handleImageFileChange = (file) => {
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image size exceeds 5MB limit.")
      return
    }
    setSelectedImageFile(file)
    try {
      setImagePreview(URL.createObjectURL(file))
    } catch {
      setImagePreview(null)
    }
  }

  const handleImageClick = () => {
    if (isFlutterBridgeAvailable()) {
      setIsPhotoPickerOpen(true)
    } else {
      fileInputRef.current?.click()
    }
  }

  const handleSaveCategory = async () => {
    if (!String(formData.name || "").trim()) {
      toast.error("Category name is required")
      return
    }

    try {
      setUploadingImage(true)
      let imageUrl = String(formData.image || "").trim()

      if (selectedImageFile) {
        const res = await uploadAPI.uploadMedia(selectedImageFile, { folder: "food/categories" })
        const url = res?.data?.data?.url || res?.data?.url
        if (url) imageUrl = String(url)
      }

      const payload = {
        name: String(formData.name || "").trim(),
        type: String(formData.type || "").trim(),
        image: imageUrl,
        isActive: formData.isActive !== false,
        sortOrder: Number.isFinite(Number(formData.sortOrder)) ? Number(formData.sortOrder) : 0,
        foodTypeScope: formData.foodTypeScope,
      }

      if (editingCategory) {
        await restaurantAPI.updateCategory(editingCategory._id || editingCategory.id, payload)
        toast.success("Category updated and sent for admin approval")
      } else {
        await restaurantAPI.createCategory(payload)
        toast.success("Category created and sent for admin approval")
      }

      resetModal()
      fetchCategories()
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to save category")
    } finally {
      setUploadingImage(false)
    }
  }

  const handleDeleteCategory = async (category) => {
    if (!category?.canDelete) {
      toast.error(category?.canEdit ? "Remove foods from this category before deleting it" : "Admin controls this category now")
      return
    }
    if (!window.confirm(`Delete "${category.name}"?`)) return

    try {
      await restaurantAPI.deleteCategory(category._id || category.id)
      toast.success("Category deleted successfully")
      fetchCategories()
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to delete category")
    }
  }

  const handleToggleActive = async (category) => {
    if (!category?.canEdit) {
      toast.error("Admin controls this category now")
      return
    }
    try {
      await restaurantAPI.updateCategory(category._id || category.id, {
        isActive: !(category?.isActive !== false),
      })
      toast.success("Category updated and sent for admin approval")
      fetchCategories()
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to update category")
    }
  }

  return (
    <div className="min-h-screen bg-slate-50/60 pb-24 text-slate-900">
      {/* Header */}
      <div className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button onClick={goBack} className="rounded-xl p-2 text-slate-600 hover:bg-slate-100 transition-colors" aria-label="Go back">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-lg sm:text-xl font-bold text-slate-900">Menu Categories</h1>
              <p className="text-xs text-slate-500 hidden sm:block">Create categories, track approvals, and resubmit edits safely.</p>
            </div>
          </div>

          <button
            onClick={openCreateModal}
            className="hidden sm:inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-black transition-colors shadow-sm"
          >
            <Plus className="h-4 w-4" />
            <span>Add Category</span>
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Info Card */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-bold text-slate-900">Category Approval Workflow</p>
          <p className="mt-1.5 text-xs sm:text-sm text-slate-600 leading-relaxed">
            New categories stay pending until admin approval. Editing an approved category sends it back for review.
            Only approved categories can be attached to food items.
          </p>
        </div>

        {/* Mobile Add Category Button */}
        <button
          onClick={openCreateModal}
          className="sm:hidden flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3.5 font-semibold text-white shadow-sm"
        >
          <Plus className="h-5 w-5" />
          Add Category
        </button>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-7 w-7 animate-spin text-slate-500" />
          </div>
        ) : ownCategories.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
            <div className="mx-auto w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mb-3">
              <Plus className="w-6 h-6" />
            </div>
            <p className="text-base font-bold text-slate-900">No restaurant categories yet</p>
            <p className="mt-1.5 text-xs sm:text-sm text-slate-500 max-w-sm mx-auto">
              Start with a category and choose whether it should accept veg, non-veg, or both kinds of dishes.
            </p>
            <button
              onClick={openCreateModal}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-black transition-colors"
            >
              <Plus className="h-4 w-4" />
              <span>Create First Category</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {ownCategories.map((category) => {
              const status = category?.approvalStatus || "pending"
              const isEditable = category?.canEdit
              const isGlobal = category?.isGlobal

              return (
                <motion.div
                  key={category._id || category.id}
                  layout
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:border-slate-300 transition-all flex flex-col justify-between"
                >
                  <div>
                    <div className="flex gap-3.5">
                      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-slate-100 border border-slate-100">
                        {category?.image ? (
                          <img src={category.image} alt={category.name} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-lg font-bold text-slate-500">
                            {String(category?.name || "C").slice(0, 1).toUpperCase()}
                          </div>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${approvalBadgeClass(status)}`}>
                            {status === "approved" ? <BadgeCheck className="mr-1 h-3 w-3" /> : <Clock3 className="mr-1 h-3 w-3" />}
                            {status}
                          </span>
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${scopePillClass(category?.foodTypeScope)}`}>
                            {category?.foodTypeScope || "Both"}
                          </span>
                          {isGlobal && (
                            <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-sky-700">
                              <Globe className="mr-1 h-3 w-3" />
                              Global
                            </span>
                          )}
                        </div>
                        <h3 className="text-base font-bold text-slate-900 truncate">{category.name}</h3>
                      </div>
                    </div>

                    <div className="mt-3.5 pt-3 border-t border-slate-100 space-y-1 text-xs text-slate-500">
                      <p className="font-semibold text-slate-700">{category?.itemCount || 0} item(s) linked</p>
                      {isGlobal ? (
                        <p>Admin controls this category now, so you can use it but not rename or delete it.</p>
                      ) : status === "approved" ? (
                        <p>Editing this category will send it back for admin approval.</p>
                      ) : (
                        <p>Foods can be added only after approval.</p>
                      )}
                      {status === "rejected" && category?.rejectionReason && (
                        <p className="text-rose-600 font-medium">Reason: {category.rejectionReason}</p>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                    <button
                      onClick={() => handleToggleActive(category)}
                      className="rounded-xl bg-slate-100 hover:bg-slate-200 p-2 text-slate-700 disabled:opacity-50 transition-colors"
                      disabled={!isEditable}
                      title={category?.isActive !== false ? "Deactivate" : "Activate"}
                    >
                      {category?.isActive !== false ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    </button>
                    <button
                      onClick={() => openEditModal(category)}
                      className="rounded-xl bg-blue-50 hover:bg-blue-100 p-2 text-blue-700 disabled:opacity-50 transition-colors"
                      disabled={!isEditable}
                      title="Edit Category"
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteCategory(category)}
                      className="rounded-xl bg-rose-50 hover:bg-rose-100 p-2 text-rose-700 disabled:opacity-50 transition-colors"
                      disabled={!category?.canDelete}
                      title="Delete Category"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}
      </div>

      {/* Centered Modal on PC, Bottom Sheet on Mobile */}
      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={resetModal}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ y: "100%", opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: "100%", opacity: 0 }}
              transition={{ type: "spring", damping: 28, stiffness: 300 }}
              className="relative w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl z-50 max-h-[90vh] overflow-y-auto p-5 sm:p-6 mx-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-5 flex items-center justify-between pb-3 border-b border-slate-100">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">
                    {editingCategory ? "Edit Category" : "Create Category"}
                  </h2>
                  <p className="text-xs text-slate-500">
                    {editingCategory
                      ? "Any edit sends this category back for admin approval."
                      : "Choose the diet scope carefully before sending it for approval."}
                  </p>
                </div>
                <button onClick={resetModal} className="p-1 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">Category Name <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="Enter category name"
                    className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">Diet Scope</label>
                  <select
                    value={formData.foodTypeScope}
                    onChange={(e) => setFormData((prev) => ({ ...prev, foodTypeScope: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all"
                  >
                    <option value="Veg">Veg</option>
                    <option value="Non-Veg">Non-Veg</option>
                    <option value="Both">Both</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">Optional Type Label</label>
                  <input
                    type="text"
                    value={formData.type}
                    onChange={(e) => setFormData((prev) => ({ ...prev, type: e.target.value }))}
                    placeholder="Examples: Starters, Desserts, Drinks"
                    className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all"
                  />
                </div>

                <div className="flex items-center gap-3 pt-1">
                  {(imagePreview || formData.image) && (
                    <img
                      src={imagePreview || formData.image}
                      alt="Category preview"
                      className="h-14 w-14 rounded-xl object-cover border border-slate-200"
                    />
                  )}
                  <button
                    type="button"
                    onClick={handleImageClick}
                    className="flex items-center gap-2 rounded-xl border border-slate-300 hover:bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-700 transition-colors"
                  >
                    <Upload className="h-4 w-4" />
                    <span>Upload Image</span>
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept="image/*"
                    onChange={(e) => handleImageFileChange(e.target.files?.[0])}
                  />
                </div>

                <label className="flex items-center gap-2 text-xs font-medium text-slate-700 pt-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.isActive}
                    onChange={() => setFormData((prev) => ({ ...prev, isActive: !prev.isActive }))}
                    className="rounded text-slate-900 focus:ring-slate-900 w-4 h-4"
                  />
                  <span>Keep category active</span>
                </label>
              </div>

              <div className="mt-6 flex gap-3 pt-3 border-t border-slate-100">
                <button onClick={resetModal} className="flex-1 rounded-xl border border-slate-300 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleSaveCategory}
                  disabled={uploadingImage}
                  className="flex-1 rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white hover:bg-black disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
                >
                  {uploadingImage ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Uploading...</span>
                    </>
                  ) : (
                    editingCategory ? "Save & Resubmit" : "Create"
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ImageSourcePicker
        isOpen={isPhotoPickerOpen}
        onClose={() => setIsPhotoPickerOpen(false)}
        onFileSelect={handleImageFileChange}
        title="Category Image"
        description="Choose how to upload your category image"
        fileNamePrefix="category-photo"
        galleryInputRef={fileInputRef}
      />
    </div>
  )
}
