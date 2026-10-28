import { useState, useEffect } from "react"
import ManagedInMasterNotice from "../../../../../components/shared/ManagedInMasterNotice"
import { toast } from "sonner"
import api from "@food/api"
import { API_ENDPOINTS } from "@food/api/config"
import { Textarea } from "@food/components/ui/textarea"
import { legalHtmlToPlainText, plainTextToLegalHtml } from "@food/utils/legalContentFormat"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}


export default function PrivacyPolicy() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [viewMode, setViewMode] = useState("edit") // "edit" | "preview"
  const [activeTab, setActiveTab] = useState("User")
  const [privacyData, setPrivacyData] = useState({
    title: 'Privacy Policy',
    content: ''
  })

  useEffect(() => {
    fetchPrivacyData()
  }, [activeTab])

  const fetchPrivacyData = async () => {
    try {
      setLoading(true)
      const endpoint = activeTab === "Restaurant" 
        ? "/food/admin/pages-social-media/privacy_restaurant" 
        : activeTab === "Delivery" 
          ? "/food/admin/pages-social-media/privacy_delivery" 
          : API_ENDPOINTS.ADMIN.PRIVACY;
          
      const response = await api.get(endpoint, { contextModule: "admin" })
      if (response.data.success) {
        // Convert HTML to plain text for textarea
        const content = response.data.data?.content || ''
        const textContent = legalHtmlToPlainText(content)
        setPrivacyData({
          ...(response.data.data || {}),
          content: textContent
        })
      }
    } catch (error) {
      debugError('Error fetching privacy data:', error)
      toast.error('Failed to load privacy policy')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      setSaving(true)
      const htmlContent = plainTextToLegalHtml(privacyData.content)
      
      const endpoint = activeTab === "Restaurant" 
        ? "/food/admin/pages-social-media/privacy_restaurant" 
        : activeTab === "Delivery" 
          ? "/food/admin/pages-social-media/privacy_delivery" 
          : API_ENDPOINTS.ADMIN.PRIVACY;
      
      const response = await api.put(
        endpoint,
        { title: privacyData.title, content: htmlContent },
        { contextModule: "admin" }
      )
      if (response.data.success) {
        toast.success('Privacy policy updated successfully')
        // Convert HTML to plain text for display in textarea
        const content = response.data.data?.content || ''
        const textContent = legalHtmlToPlainText(content)
        setPrivacyData({
          ...(response.data.data || {}),
          content: textContent
        })
      }
    } catch (error) {
      debugError('Error saving privacy policy:', error)
      toast.error(error.response?.data?.message || 'Failed to save privacy policy')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="h-full overflow-y-auto bg-slate-50 p-4 lg:p-6 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-slate-600">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-50 p-4 lg:p-6">
      <ManagedInMasterNotice what="The Privacy Policy" />
      <div className="max-w-6xl mx-auto">
        {/* Page Header */}
        <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Privacy Policy</h1>
            <p className="text-sm text-slate-600 mt-1">Manage your Privacy Policy content</p>
          </div>
          <div className="flex bg-slate-100 p-1 rounded-lg">
            <button
              onClick={() => setActiveTab("User")}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                activeTab === "User" ? "bg-white text-blue-600 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              User
            </button>
            <button
              onClick={() => setActiveTab("Restaurant")}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                activeTab === "Restaurant" ? "bg-white text-blue-600 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Restaurant
            </button>
            <button
              onClick={() => setActiveTab("Delivery")}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                activeTab === "Delivery" ? "bg-white text-blue-600 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Delivery
            </button>
          </div>
        </div>

        {/* Text Area */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="text-sm text-slate-600">
              Use headings like <span className="font-mono">#</span>, <span className="font-mono">##</span> and bold like <span className="font-mono">**text**</span>.
            </div>
            <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
              <button
                type="button"
                onClick={() => setViewMode("edit")}
                className={`px-3 py-1.5 text-sm font-medium ${viewMode === "edit" ? "bg-slate-900 text-white" : "bg-white text-slate-700 hover:bg-slate-50"}`}
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => setViewMode("preview")}
                className={`px-3 py-1.5 text-sm font-medium ${viewMode === "preview" ? "bg-slate-900 text-white" : "bg-white text-slate-700 hover:bg-slate-50"}`}
              >
                Preview
              </button>
            </div>
          </div>

          {viewMode === "edit" ? (
            <Textarea
              value={privacyData.content}
              onChange={(e) => setPrivacyData(prev => ({ ...prev, content: e.target.value }))}
              placeholder="Enter privacy policy content..."
              className="min-h-[600px] w-full text-sm text-slate-700 leading-relaxed resize-y"
              dir="ltr"
              style={{
                direction: 'ltr',
                textAlign: 'left',
                unicodeBidi: 'bidi-override',
                width: '100%',
                maxWidth: '100%'
              }}
            />
          ) : (
            <div className="min-h-[600px] w-full rounded-md border border-slate-200 bg-white p-4">
              <div
                className="prose prose-slate max-w-none
                  prose-headings:text-slate-900
                  prose-p:text-slate-700
                  prose-strong:text-slate-900
                  prose-ul:text-slate-700
                  prose-li:my-1
                  leading-relaxed"
                dangerouslySetInnerHTML={{ __html: plainTextToLegalHtml(privacyData.content) }}
              />
            </div>
          )}
        </div>

        {/* Submit Button */}
        <div className="flex justify-end mt-6">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

