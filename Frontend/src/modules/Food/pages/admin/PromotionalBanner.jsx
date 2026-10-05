import { useEffect, useState, useCallback } from "react"
import { Edit, Upload, Info, Trash2, Plus, Calendar, Link as LinkIcon, Save, X, Loader2, Image as ImageIcon } from "lucide-react"
import api from "@food/api"

const debugError = (...args) => {}

export default function PromotionalBanner() {
  const [banners, setBanners] = useState([])
  const [restaurants, setRestaurants] = useState([])
  const [zones, setZones] = useState([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingBanner, setEditingBanner] = useState(null)
  
  const [formData, setFormData] = useState({
    title: "",
    ctaLink: "",
    restaurantId: "",
    zoneId: "",
    startDate: "",
    endDate: "",
    file: null,
    preview: null
  })

  const fetchZones = useCallback(async () => {
    try {
      const response = await api.get("/food/admin/zones")
      if (response.data?.success) {
        setZones(response.data.data?.zones || [])
      }
    } catch (error) {
      debugError("Failed to fetch zones:", error)
    }
  }, [])

  const fetchRestaurants = useCallback(async () => {
    try {
      const response = await api.get("/food/admin/restaurants", { params: { limit: 1000, status: 'approved' } })
      if (response.data?.success) {
        setRestaurants(response.data.data?.restaurants || [])
      }
    } catch (error) {
      debugError("Failed to fetch restaurants:", error)
    }
  }, [])

  const fetchBanners = useCallback(async () => {
    try {
      setLoading(true)
      const response = await api.get("/food/showcase-items/home-promotion")
      if (response.data?.success) {
        setBanners(response.data.banners || [])
      }
    } catch (error) {
      debugError("Failed to fetch banners:", error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchBanners()
    fetchRestaurants()
    fetchZones()
  }, [fetchBanners, fetchRestaurants, fetchZones])

  const handleFileChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > 2 * 1024 * 1024) {
      alert("Image size must be 2MB or less")
      return
    }

    setFormData(prev => ({
      ...prev,
      file,
      preview: URL.createObjectURL(file)
    }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!formData.file && !editingBanner) {
      alert("Please select a banner image")
      return
    }

    try {
      setSubmitting(true)
      const data = new FormData()
      if (formData.file) data.append("file", formData.file)
      data.append("title", formData.title)
      data.append("ctaLink", formData.ctaLink)
      if (formData.zoneId) data.append("zoneId", formData.zoneId)
      if (formData.startDate) data.append("startDate", formData.startDate)
      if (formData.endDate) data.append("endDate", formData.endDate)

      let res
      if (editingBanner) {
        // The new image goes with the edit when one was picked; it used to be
        // left out, so the banner kept its old picture.
        if (formData.file) {
          const edit = new FormData()
          edit.append("file", formData.file)
          edit.append("title", formData.title || "")
          edit.append("ctaLink", formData.ctaLink || "")
          edit.append("zoneId", formData.zoneId || "")
          edit.append("startDate", formData.startDate || "")
          edit.append("endDate", formData.endDate || "")
          res = await api.patch(`/food/showcase-items/home-promotion/${editingBanner._id}`, edit)
        } else {
          res = await api.patch(`/food/showcase-items/home-promotion/${editingBanner._id}`, {
            title: formData.title,
            ctaLink: formData.ctaLink,
            zoneId: formData.zoneId || null,
            startDate: formData.startDate || null,
            endDate: formData.endDate || null
          })
        }
      } else {
        res = await api.post("/food/showcase-items/home-promotion", data)
      }

      if (res.data?.success) {
        fetchBanners()
        resetForm()
        setShowAddModal(false)
        setEditingBanner(null)
      }
    } catch (error) {
      alert("Failed to save banner")
      debugError(error)
    } finally {
      setSubmitting(false)
    }
  }

  const handleToggleStatus = async (id, currentStatus) => {
    try {
      const res = await api.patch(`/food/showcase-items/home-promotion/${id}/status`, { isActive: !currentStatus })
      if (res.data?.success) {
        setBanners(prev => prev.map(b => b._id === id ? { ...b, isActive: !currentStatus } : b))
      }
    } catch (error) {
      debugError(error)
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to delete this banner?")) return
    try {
      const res = await api.delete(`/food/showcase-items/home-promotion/${id}`)
      if (res.data?.success) {
        setBanners(prev => prev.filter(b => b._id !== id))
      }
    } catch (error) {
      debugError(error)
    }
  }

  const resetForm = () => {
    setFormData({
      title: "",
      ctaLink: "",
      restaurantId: "",
      zoneId: "",
      startDate: "",
      endDate: "",
      file: null,
      preview: null
    })
  }

  const openEdit = (banner) => {
    setEditingBanner(banner)
    
    // Try to find if ctaLink matches a restaurant route
    let matchedRestaurantId = "";
    if (banner.ctaLink?.startsWith("/restaurant/")) {
      const slug = banner.ctaLink.replace("/restaurant/", "");
      const found = restaurants.find(r => r.slug === slug);
      if (found) matchedRestaurantId = found._id;
    }

    setFormData({
      title: banner.title || "",
      ctaLink: banner.ctaLink || "",
      restaurantId: matchedRestaurantId,
      zoneId: banner.zoneId?._id || banner.zoneId || "",
      startDate: banner.startDate ? new Date(banner.startDate).toISOString().split('T')[0] : "",
      endDate: banner.endDate ? new Date(banner.endDate).toISOString().split('T')[0] : "",
      file: null,
      preview: banner.imageUrl
    })
    setShowAddModal(true)
  }

  const handleRestaurantChange = (id) => {
    const restaurant = restaurants.find(r => r._id === id);
    
    if (restaurant) {
      // PRO LOGIC: Use existing slug, or generate one from name if missing
      const slug = restaurant.slug || 
                   restaurant.restaurantName
                     .toLowerCase()
                     .trim()
                     .replace(/[^\w\s-]/g, '')
                     .replace(/[\s_-]+/g, '-')
                     .replace(/^-+|-+$/g, '');

      setFormData(prev => ({
        ...prev, 
        restaurantId: id,
        ctaLink: `/food/user/restaurants/${slug}`
      }))
    } else {
      setFormData(prev => ({...prev, restaurantId: ""}))
    }
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-600 rounded-xl shadow-lg shadow-blue-200">
              <Plus className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 leading-tight">Home Promotion Banners</h1>
              <p className="text-slate-500 text-sm mt-0.5">Manage sliding banners visible below pure veg/99 options</p>
            </div>
          </div>
          <button
            onClick={() => { resetForm(); setEditingBanner(null); setShowAddModal(true); }}
            className="flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-all shadow-md active:scale-95 font-semibold text-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Add New Banner</span>
          </button>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
            <p className="text-slate-500 font-medium">Fetching your banners...</p>
          </div>
        ) : banners.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-12 text-center">
            <div className="bg-slate-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4">
              <Upload className="w-10 h-10 text-slate-300" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-2">No Banners Found</h3>
            <p className="text-slate-500 max-w-xs mx-auto mb-6">Create your first promotional banner to start attracting customers.</p>
            <button
               onClick={() => { resetForm(); setEditingBanner(null); setShowAddModal(true); }}
               className="text-blue-600 font-bold hover:underline"
            >
              Add your first banner now
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {banners.map((banner) => (
              <div key={banner._id} className="bg-white rounded-2xl overflow-hidden border border-slate-200 shadow-sm hover:shadow-md transition-shadow group">
                <div className="relative aspect-[2/1] bg-slate-100 overflow-hidden">
                  <img src={banner.imageUrl} alt={banner.title} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
                  <div className="absolute top-2 right-2 flex gap-2">
                    <button 
                      onClick={() => openEdit(banner)}
                      className="p-2 bg-white/90 backdrop-blur-md rounded-lg shadow-sm hover:bg-white text-slate-700 transition-colors"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => handleDelete(banner._id)}
                      className="p-2 bg-red-500/90 backdrop-blur-md rounded-lg shadow-sm hover:bg-red-500 text-white transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="absolute bottom-2 left-2">
                    <button
                      onClick={() => handleToggleStatus(banner._id, banner.isActive)}
                      className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider backdrop-blur-md transition-all ${
                        banner.isActive 
                          ? "bg-green-500/90 text-white" 
                          : "bg-slate-500/90 text-white"
                      }`}
                    >
                      {banner.isActive ? "Active" : "Paused"}
                    </button>
                  </div>
                </div>
                <div className="p-4">
                  <h3 className="font-bold text-slate-900 truncate mb-1">{banner.title || "Untitled Banner"}</h3>
                  <div className="space-y-1.5 mt-3">
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <LinkIcon className="w-3.5 h-3.5" />
                      <span className="truncate">{banner.ctaLink || "No link attached"}</span>
                    </div>
                    {(banner.startDate || banner.endDate) && (
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <Calendar className="w-3.5 h-3.5" />
                        <span>
                          {banner.startDate ? new Date(banner.startDate).toLocaleDateString() : 'Start'} 
                          {' - '} 
                          {banner.endDate ? new Date(banner.endDate).toLocaleDateString() : 'End'}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {showAddModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <div className="bg-white rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <h3 className="text-xl font-bold text-slate-900">{editingBanner ? 'Edit Banner' : 'New Promotional Banner'}</h3>
                <button onClick={() => setShowAddModal(false)} className="p-2 hover:bg-slate-100 rounded-full text-slate-400">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <form onSubmit={handleSubmit} className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <label className="block text-sm font-semibold text-slate-700">Banner Image</label>
                    <div className="relative aspect-[2/1] rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 flex flex-col items-center justify-center overflow-hidden group cursor-pointer hover:border-blue-400 transition-colors">
                      {formData.preview ? (
                        <>
                          <img src={formData.preview} className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                            <Upload className="w-8 h-8 text-white" />
                          </div>
                        </>
                      ) : (
                        <div className="text-center p-4">
                          <ImageIcon className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                          <p className="text-[10px] text-slate-400 font-medium uppercase tracking-widest">Upload 5:1 Image</p>
                        </div>
                      )}
                      <input type="file" accept="image/*" onChange={handleFileChange} className="absolute inset-0 opacity-0 cursor-pointer" />
                    </div>
                    <p className="text-[10px] text-slate-400">JPEG, PNG or WebP. Max 2MB.</p>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">Banner Title</label>
                      <input 
                        type="text" 
                        value={formData.title}
                        onChange={e => setFormData(p => ({...p, title: e.target.value}))}
                        placeholder="e.g. Summer Special"
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">Zone (Required for Filtering)</label>
                      <select
                        value={formData.zoneId}
                        onChange={(e) => setFormData(p => ({...p, zoneId: e.target.value, restaurantId: ""}))}
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-sm appearance-none"
                      >
                        <option value="">Select a zone...</option>
                        {zones.map(z => (
                          <option key={z._id} value={z._id}>{z.name || z.zoneName}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">Link to Restaurant (Optional)</label>
                      <select
                        value={formData.restaurantId}
                        onChange={(e) => handleRestaurantChange(e.target.value)}
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-sm appearance-none"
                      >
                        <option value="">Select a restaurant...</option>
                        {restaurants
                          .filter(r => !formData.zoneId || (r.zoneId?._id || r.zoneId) === formData.zoneId)
                          .map(r => (
                            <option key={r._id} value={r._id}>{r.restaurantName}</option>
                          ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">CTA Link / Slug</label>
                      <input 
                        type="text" 
                        value={formData.ctaLink}
                        onChange={e => setFormData(p => ({...p, ctaLink: e.target.value, restaurantId: ""}))}
                        placeholder="e.g. burgers-king or /food/offers"
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-sm"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mt-6 pt-6 border-t border-slate-100">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">Start Date</label>
                    <input 
                      type="date" 
                      value={formData.startDate}
                      onChange={e => setFormData(p => ({...p, startDate: e.target.value}))}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">End Date</label>
                    <input 
                      type="date" 
                      value={formData.endDate}
                      onChange={e => setFormData(p => ({...p, endDate: e.target.value}))}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-sm"
                    />
                  </div>
                </div>

                <div className="flex items-center flex-col sm:flex-row justify-end gap-3 mt-8">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="w-full sm:w-auto px-6 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full sm:w-auto px-10 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-lg shadow-blue-200 font-bold transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {submitting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    <span>{editingBanner ? 'Update Banner' : 'Publish Banner'}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
