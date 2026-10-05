import { useState, useMemo, useEffect, useRef } from "react"
import { Search, Plus, Edit, Trash2, Upload, Image as ImageIcon, Info, Loader2 } from "lucide-react"
import api from "@food/api"
import { getModuleToken } from "@food/utils/auth"

export default function Banners() {
  const [activeLanguage, setActiveLanguage] = useState("default")
  const [searchQuery, setSearchQuery] = useState("")
  const [bannerType, setBannerType] = useState("all")
  const [banners, setBanners] = useState([])
  const [zones, setZones] = useState([])
  const [restaurants, setRestaurants] = useState([])
  
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  // The app sections that can carry header artwork. One tab each: you pick a
  // section, and both the upload form and the list below belong to it.
  const HERO_BANNER_MODULES = [
    { value: 'food', label: 'Food' },
    { value: 'taxi', label: 'Rides' },
    { value: 'quick_commerce', label: 'Quick Commerce' },
    // Medical shares the quick-commerce backend but is its own screen, so it
    // gets its own artwork rather than inheriting Quick's.
    { value: 'medical', label: 'Medical' },
    { value: 'porter', label: 'Porter' },
  ]

  // Which section is being managed. Food is first so the page opens on what it
  // has always shown.
  const [activeModule, setActiveModule] = useState('food')

  // Restaurants and zones are Food's own concepts — there is no restaurant to
  // link a Rides banner to. Outside Food the banner is just the artwork.
  const isFoodSection = activeModule === 'food'

  const activeModuleLabel =
    (HERO_BANNER_MODULES.find((m) => m.value === activeModule) || { label: 'Food' }).label

  // Header GIFs are heavy — the one live on Food today is 18 MB — so the cap
  // matches what the server accepts on its other header-media route rather
  // than the 2 MB that would reject the app's own current artwork.
  const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

  const [formData, setFormData] = useState({
    title: "",
    zone: "",
    bannerType: "Restaurant wise",
    restaurant: "",
    file: null,
    preview: null,
  })

  const fileInputRef = useRef(null)

  const languageTabs = [
    { key: "default", label: "Default" },
    { key: "en", label: "English(EN)" },
    { key: "bn", label: "Bengali (BN)" },
    { key: "ar", label: "Arabic (AR)" },
    { key: "es", label: "Spanish (ES)" },
  ]

  const getAuthConfig = (additionalConfig = {}) => {
    const adminToken = getModuleToken('admin')
    if (!adminToken || adminToken.trim() === '' || adminToken === 'null' || adminToken === 'undefined') {
      return additionalConfig
    }
    return {
      ...additionalConfig,
      headers: {
        ...additionalConfig.headers,
        Authorization: `Bearer ${adminToken.trim()}`,
      }
    }
  }

  const fetchBanners = async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await api.get('/food/showcase-items', getAuthConfig())
      if (response.data?.success) {
        setBanners(response.data.data?.banners || [])
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to fetch banners.')
    } finally {
      setLoading(false)
    }
  }

  const fetchZones = async () => {
    try {
      const response = await api.get('/food/admin/zones', getAuthConfig())
      if (response.data?.success) {
        setZones(response.data.data?.zones || [])
      }
    } catch (err) {
      console.error('Failed to fetch zones:', err)
    }
  }

  const fetchRestaurants = async () => {
    try {
      const response = await api.get('/food/admin/restaurants', {
        ...getAuthConfig(),
        params: { limit: 1000, status: 'approved' }
      })
      if (response.data?.success) {
        setRestaurants(response.data.data?.restaurants || [])
      }
    } catch (err) {
      console.error('Failed to fetch restaurants:', err)
    }
  }

  useEffect(() => {
    fetchBanners()
    fetchZones()
    fetchRestaurants()
  }, [])

  /** How many banners each section holds, so the tabs show what is set up. */
  const countsByModule = useMemo(() => {
    const counts = {}
    for (const banner of banners) {
      // Rows saved before the field existed are Food's, which is where they
      // actually appear in the app.
      const key = banner.module || 'food'
      counts[key] = (counts[key] || 0) + 1
    }
    return counts
  }, [banners])

  const filteredBanners = useMemo(() => {
    let result = banners.filter((b) => (b.module || 'food') === activeModule)

    if (bannerType !== "all") {
      if (bannerType === "Restaurant wise") {
        result = result.filter(banner => Array.isArray(banner.linkedRestaurantIds) && banner.linkedRestaurantIds.length > 0)
      } else if (bannerType === "Zone wise") {
        result = result.filter(banner => !Array.isArray(banner.linkedRestaurantIds) || banner.linkedRestaurantIds.length === 0)
      }
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim()
      result = result.filter(banner =>
        (banner.title || "").toLowerCase().includes(query)
      )
    }

    return result
  }, [banners, searchQuery, bannerType, activeModule])

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleFileChange = (e) => {
    const file = e.target.files?.[0]
    if (file) {
      if (file.size > MAX_UPLOAD_BYTES) {
        alert(`File must be ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB or less.`)
        return
      }
      setFormData(prev => ({
        ...prev,
        file,
        preview: URL.createObjectURL(file)
      }))
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!formData.title.trim()) {
      alert("Please enter a banner title.")
      return
    }
    if (!formData.file) {
      alert("Please select a banner image.")
      return
    }
    // Only Food links a banner to a restaurant or zone. Requiring it for every
    // section is what made Rides, Quick and Medical impossible to upload at
    // all — there is no restaurant to pick.
    if (isFoodSection) {
      if (formData.bannerType === "Restaurant wise" && !formData.restaurant) {
        alert("Please select a restaurant.")
        return
      }
      if (formData.bannerType === "Zone wise" && !formData.zone) {
        alert("Please select a zone.")
        return
      }
    }

    try {
      setSubmitting(true)
      setError(null)
      setSuccess(null)

      const data = new FormData()
      data.append('files', formData.file)
      data.append('title', formData.title)
      data.append('module', activeModule || 'food')

      if (isFoodSection) {
        if (formData.bannerType === 'Restaurant wise') {
          data.append('ctaLink', `/restaurants/${formData.restaurant}`)
        } else if (formData.bannerType === 'Zone wise') {
          data.append('ctaLink', `/zone/${formData.zone}`)
        }
      }

      const uploadRes = await api.post('/food/showcase-items/multiple', data, getAuthConfig())
      
      if (uploadRes.data?.success) {
        const results = uploadRes.data.data?.results || []
        const createdBanner = results[0]?.banner

        if (createdBanner && isFoodSection && formData.bannerType === 'Restaurant wise' && formData.restaurant) {
          try {
            await api.patch(
              `/food/showcase-items/${createdBanner._id}/link-restaurants`,
              { restaurantIds: [formData.restaurant] },
              getAuthConfig()
            )
          } catch (linkErr) {
            console.error("Failed to link restaurant to banner:", linkErr)
          }
        }

        setSuccess(`Banner added to ${activeModuleLabel}!`)
        handleReset()
        await fetchBanners()
        setTimeout(() => setSuccess(null), 3000)
      } else {
        setError(uploadRes.data?.message || 'Failed to upload banner.')
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to add banner.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleReset = () => {
    setFormData({
      title: "",
      zone: "",
      bannerType: "Restaurant wise",
      restaurant: "",
      file: null,
      preview: null,
    })
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleToggleStatus = async (id, currentStatus) => {
    try {
      setError(null)
      const response = await api.patch(`/food/showcase-items/${id}/status`, { isActive: !currentStatus }, getAuthConfig())
      if (response.data?.success) {
        setBanners(prev => prev.map(b => b._id === id ? { ...b, isActive: !currentStatus } : b))
        setSuccess(`Banner ${currentStatus ? 'deactivated' : 'activated'} successfully!`)
        setTimeout(() => setSuccess(null), 3000)
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update banner status.')
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to delete this banner?")) return
    try {
      setError(null)
      const response = await api.delete(`/food/showcase-items/${id}`, getAuthConfig())
      if (response.data?.success) {
        setBanners(prev => prev.filter(b => b._id !== id))
        setSuccess("Banner deleted successfully!")
        setTimeout(() => setSuccess(null), 3000)
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete banner.')
    }
  }

  const getBannerZoneName = (banner) => {
    if (Array.isArray(banner.linkedRestaurantIds) && banner.linkedRestaurantIds.length > 0) {
      const linkedId = banner.linkedRestaurantIds[0]?._id || banner.linkedRestaurantIds[0];
      const r = restaurants.find(res => res._id === linkedId);
      if (r) {
        const zoneId = r.zoneId || r.zone?._id || r.zone;
        if (zoneId) {
          const z = zones.find(zn => zn._id === zoneId);
          if (z) return z.name || z.zoneName;
        }
        return r.area || r.city || '-';
      }
    } else if (banner.ctaLink && banner.ctaLink.includes('/zone/')) {
      const zoneId = banner.ctaLink.split('/zone/')[1];
      const z = zones.find(zn => zn._id === zoneId);
      if (z) return z.name || z.zoneName;
    }
    return 'All Zones';
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        {/* Alerts */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm flex items-center gap-2">
            <Info className="w-5 h-5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {success && (
          <div className="mb-4 p-4 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm flex items-center gap-2">
            <Plus className="w-5 h-5 flex-shrink-0" />
            <span>{success}</span>
          </div>
        )}

        {/* App Section tabs. Each section keeps its own artwork, so picking one
            here switches both the upload form below and the list under it. */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <ImageIcon className="w-4 h-4 text-slate-500" />
            <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">App Section</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {HERO_BANNER_MODULES.map((m) => {
              const isActive = activeModule === m.value
              const count = countsByModule[m.value] || 0
              return (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => {
                    setActiveModule(m.value)
                    // "Restaurant wise" would hide every banner in a section
                    // that has no restaurants to be linked to.
                    setBannerType("all")
                    handleReset()
                  }}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-all flex items-center gap-2 ${isActive
                    ? "bg-blue-600 border-blue-600 text-white shadow-sm"
                    : "bg-white border-slate-300 text-slate-700 hover:bg-slate-50"
                    }`}
                >
                  {m.label}
                  <span className={`px-1.5 py-0.5 rounded-full text-[11px] font-bold ${isActive ? "bg-blue-500 text-white" : "bg-slate-100 text-slate-600"
                    }`}>
                    {count}
                  </span>
                </button>
              )
            })}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Each section has its own header artwork — upload a GIF here and it
            appears at the top of that screen in the app, and nowhere else.
          </p>
        </div>

        {/* Add New Banner Section */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <Plus className="w-5 h-5 text-blue-600" />
            <h1 className="text-2xl font-bold text-slate-900">
              Add New Banner — {activeModuleLabel}
            </h1>
          </div>

          {/* Language Tabs */}
          <div className="flex items-center gap-2 border-b border-slate-200 mb-6">
            {languageTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveLanguage(tab.key)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeLanguage === tab.key
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-slate-600 hover:text-slate-900"
                  }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Banner Title ({activeLanguage === "default" ? "Default" : languageTabs.find(t => t.key === activeLanguage)?.label}) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => handleInputChange("title", e.target.value)}
                  placeholder="New banner"
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                />
              </div>

              {/* Restaurants and zones only mean something inside Food. The
                  other sections have no catalogue to point a banner at, so the
                  form drops to a title and the artwork. */}
              {isFoodSection && (
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Zone <span className="text-red-500">*</span>
                </label>
                <select
                  value={formData.zone}
                  onChange={(e) => handleInputChange("zone", e.target.value)}
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                >
                  <option value="">---Select---</option>
                  {zones.map(z => (
                    <option key={z._id} value={z._id}>{z.name || z.zoneName || 'Unnamed Zone'}</option>
                  ))}
                </select>
              </div>
              )}

              {isFoodSection && (
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Banner Type <span className="text-red-500">*</span>
                </label>
                <select
                  value={formData.bannerType}
                  onChange={(e) => handleInputChange("bannerType", e.target.value)}
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                >
                  <option value="Restaurant wise">Restaurant wise</option>
                  <option value="Zone wise">Zone wise</option>
                </select>
              </div>
              )}

              {isFoodSection && (
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Restaurant <span className="text-red-500">*</span>
                </label>
                <select
                  value={formData.restaurant}
                  onChange={(e) => handleInputChange("restaurant", e.target.value)}
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                  disabled={formData.bannerType !== "Restaurant wise"}
                >
                  <option value="">Select</option>
                  {restaurants.map(r => (
                    <option key={r._id} value={r._id}>{r.restaurantName || r.name || 'Unnamed Restaurant'}</option>
                  ))}
                </select>
              </div>
              )}
            </div>

            {/* Banner Image Upload */}
            <div className="mb-6">
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Header Artwork <span className="text-red-500">*</span>
              </label>
              <p className="text-sm text-slate-600 mb-3">
                A GIF plays as the animated header at the top of the {activeModuleLabel} screen.
              </p>
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-300 rounded-lg p-12 text-center hover:border-blue-500 transition-colors cursor-pointer relative"
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept="image/*"
                  className="hidden"
                />
                {formData.preview ? (
                  <div className="relative w-full max-h-48 flex justify-center items-center overflow-hidden rounded-lg">
                    <img src={formData.preview} className="max-h-40 object-contain" alt="Preview" />
                  </div>
                ) : (
                  <>
                    <Upload className="w-12 h-12 text-slate-400 mx-auto mb-3" />
                    <p className="text-sm font-medium text-blue-600 mb-1">Click to upload</p>
                    <p className="text-xs text-slate-500 mb-2">Or drag and drop</p>
                    <p className="text-xs text-slate-500">
                      GIF, JPG, JPEG or PNG · up to {Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB · 2:1 works best
                    </p>
                    <p className="text-xs text-amber-600 mt-1">
                      Every customer downloads this each time the screen opens — keep it as small as it can look good.
                    </p>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-4">
              <button
                type="button"
                onClick={handleReset}
                className="px-6 py-2.5 text-sm font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-all"
                disabled={submitting}
              >
                Reset
              </button>
              <button
                type="submit"
                className="px-6 py-2.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-all shadow-md flex items-center gap-2"
                disabled={submitting}
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                Submit
              </button>
            </div>
          </form>
        </div>

        {/* Banner List Section */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-slate-900">{activeModuleLabel} Banners</h2>
              <span className="px-3 py-1 rounded-full text-sm font-semibold bg-slate-100 text-slate-700">
                {filteredBanners.length}
              </span>
            </div>

            <div className="flex items-center gap-3">
              {isFoodSection && (
                <select
                  value={bannerType}
                  onChange={(e) => setBannerType(e.target.value)}
                  className="px-4 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-slate-400"
                >
                  <option value="all">All Banner</option>
                  <option value="Restaurant wise">Restaurant wise</option>
                  <option value="Zone wise">Zone wise</option>
                </select>
              )}

              <div className="relative flex-1 sm:flex-initial min-w-[200px]">
                <input
                  type="text"
                  placeholder="Ex: Search by title ..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 pr-4 py-2.5 w-full text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400"
                />
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
              </div>
            ) : filteredBanners.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                <ImageIcon className="w-12 h-12 mx-auto mb-3 text-slate-400" />
                <p>No banners for {activeModuleLabel} yet.</p>
                <p className="text-sm mt-1">
                  Until one is uploaded, the {activeModuleLabel} screen shows no header — nothing else changes.
                </p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">SI</th>
                    <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Banner Info</th>
                    {isFoodSection && (
                      <>
                        <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Zone</th>
                        <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Banner Type</th>
                      </>
                    )}
                    <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-4 text-center text-[10px] font-bold text-slate-700 uppercase tracking-wider">Action</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-100">
                  {filteredBanners.map((banner, index) => {
                    const isRestaurantWise = Array.isArray(banner.linkedRestaurantIds) && banner.linkedRestaurantIds.length > 0;
                    return (
                      <tr key={banner._id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="text-sm font-medium text-slate-700">{index + 1}</span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-16 h-16 rounded-lg overflow-hidden bg-slate-100 flex-shrink-0">
                              <img
                                src={banner.imageUrl}
                                alt={banner.title || "Banner"}
                                className="w-full h-full object-cover"
                              />
                            </div>
                            <span className="text-sm font-medium text-slate-900">{banner.title || "Untitled Banner"}</span>
                          </div>
                        </td>
                        {isFoodSection && (
                          <>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className="text-sm text-slate-700">{getBannerZoneName(banner)}</span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className="text-sm text-slate-700">{isRestaurantWise ? "Restaurant wise" : "Zone wise"}</span>
                            </td>
                          </>
                        )}
                        <td className="px-6 py-4 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => handleToggleStatus(banner._id, banner.isActive)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${banner.isActive ? "bg-blue-600" : "bg-slate-300"
                              }`}
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${banner.isActive ? "translate-x-6" : "translate-x-1"
                                }`}
                            />
                          </button>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleDelete(banner._id)}
                              className="p-1.5 rounded text-red-600 hover:bg-red-50 transition-colors"
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
