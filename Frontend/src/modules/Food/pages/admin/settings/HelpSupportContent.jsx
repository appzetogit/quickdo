import React, { useState, useEffect } from "react"
import { toast } from "sonner"
import api from "@food/api"
import { API_ENDPOINTS } from "@food/api/config"
import { 
  HelpCircle, 
  Car, 
  Utensils, 
  CreditCard, 
  Plus, 
  X, 
  Trash2, 
  Edit3, 
  Check, 
  ChevronRight, 
  ChevronDown,
  Info
} from "lucide-react"
import { Button } from "@food/components/ui/button"
import { Input } from "@food/components/ui/input"
import { Textarea } from "@food/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@food/components/ui/card"
import { Label } from "@food/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@food/components/ui/select"

const iconOptions = [
  { value: "HelpCircle", label: "Help Circle" },
  { value: "Car", label: "Car (Rides)" },
  { value: "Utensils", label: "Utensils (Food)" },
  { value: "CreditCard", label: "Credit Card (Payments)" }
]

export default function HelpSupportContent() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activeCategoryIndex, setActiveCategoryIndex] = useState(0)

  // Editor State
  const [helpData, setHelpData] = useState({
    title: "Help & Support",
    description: "We are here to help you.",
    contactEmail: "",
    contactPhone: "",
    categories: []
  })

  // State for creating new category
  const [newCatTitle, setNewCatTitle] = useState("")
  const [newCatIcon, setNewCatIcon] = useState("HelpCircle")
  const [isAddingCategory, setIsAddingCategory] = useState(false)

  // State for editing category title inline
  const [editingCatIndex, setEditingCatIndex] = useState(null)
  const [editingCatTitle, setEditingCatTitle] = useState("")

  // State for creating new FAQ
  const [newFaqQuestion, setNewFaqQuestion] = useState("")
  const [newFaqAnswer, setNewFaqAnswer] = useState("")
  const [isAddingFaq, setIsAddingFaq] = useState(false)

  // State for editing FAQ inline
  const [editingFaqIndex, setEditingFaqIndex] = useState(null)
  const [editingFaqQuestion, setEditingFaqQuestion] = useState("")
  const [editingFaqAnswer, setEditingFaqAnswer] = useState("")

  useEffect(() => {
    fetchHelpContent()
  }, [])

  const fetchHelpContent = async () => {
    try {
      setLoading(true)
      const endpoint = API_ENDPOINTS.ADMIN.HELP_SUPPORT || "/food/admin/pages-social-media/help_support"
      const response = await api.get(endpoint, { contextModule: "admin" })
      if (response.data?.success && response.data?.data) {
        const data = response.data.data
        setHelpData({
          title: data.title || "Help & Support",
          description: data.description || "We are here to help you.",
          contactEmail: data.contactEmail || "",
          contactPhone: data.contactPhone || "",
          categories: Array.isArray(data.categories) ? data.categories : []
        })
      }
    } catch (error) {
      console.error("Error fetching Help & Support content:", error)
      toast.error("Failed to load Help & Support data")
    } finally {
      setLoading(false)
    }
  }

  const handleSaveAll = async () => {
    try {
      setSaving(true)
      const endpoint = API_ENDPOINTS.ADMIN.HELP_SUPPORT || "/food/admin/pages-social-media/help_support"
      const response = await api.put(endpoint, helpData, { contextModule: "admin" })
      if (response.data?.success) {
        toast.success("Help & Support content updated successfully")
        if (response.data.data) {
          const data = response.data.data
          setHelpData({
            title: data.title || "Help & Support",
            description: data.description || "We are here to help you.",
            contactEmail: data.contactEmail || "",
            contactPhone: data.contactPhone || "",
            categories: Array.isArray(data.categories) ? data.categories : []
          })
        }
      }
    } catch (error) {
      console.error("Error saving Help & Support data:", error)
      toast.error(error.response?.data?.message || "Failed to save changes")
    } finally {
      setSaving(false)
    }
  }

  // Categories Operations
  const handleAddCategory = () => {
    const title = newCatTitle.trim()
    if (!title) {
      toast.error("Category title is required")
      return
    }
    
    setHelpData(prev => {
      const updatedCategories = [...prev.categories, {
        title,
        icon: newCatIcon,
        faqs: []
      }]
      return { ...prev, categories: updatedCategories }
    })
    
    // Reset state
    setNewCatTitle("")
    setNewCatIcon("HelpCircle")
    setIsAddingCategory(false)
    setActiveCategoryIndex(helpData.categories.length)
    toast.success("Category added to draft (Remember to Save changes)")
  }

  const handleStartEditCategory = (index, currentTitle) => {
    setEditingCatIndex(index)
    setEditingCatTitle(currentTitle)
  }

  const handleSaveEditCategory = (index) => {
    const title = editingCatTitle.trim()
    if (!title) {
      toast.error("Category title cannot be empty")
      return
    }

    setHelpData(prev => {
      const updatedCategories = [...prev.categories]
      updatedCategories[index] = {
        ...updatedCategories[index],
        title
      }
      return { ...prev, categories: updatedCategories }
    })

    setEditingCatIndex(null)
    setEditingCatTitle("")
  }

  const handleUpdateCategoryIcon = (index, icon) => {
    setHelpData(prev => {
      const updatedCategories = [...prev.categories]
      updatedCategories[index] = {
        ...updatedCategories[index],
        icon
      }
      return { ...prev, categories: updatedCategories }
    })
  }

  const handleDeleteCategory = (index) => {
    if (!window.confirm("Are you sure you want to delete this category and all its FAQs?")) {
      return
    }

    setHelpData(prev => {
      const updatedCategories = prev.categories.filter((_, i) => i !== index)
      return { ...prev, categories: updatedCategories }
    })

    setActiveCategoryIndex(prev => {
      if (prev >= helpData.categories.length - 1) {
        return Math.max(0, helpData.categories.length - 2)
      }
      return prev
    })
    toast.success("Category removed from draft")
  }

  // FAQs Operations
  const handleAddFaq = () => {
    const question = newFaqQuestion.trim()
    const answer = newFaqAnswer.trim()
    
    if (!question || !answer) {
      toast.error("Both Question and Answer are required")
      return
    }

    setHelpData(prev => {
      const updatedCategories = [...prev.categories]
      const targetCategory = updatedCategories[activeCategoryIndex]
      if (targetCategory) {
        targetCategory.faqs = [...(targetCategory.faqs || []), { question, answer }]
      }
      return { ...prev, categories: updatedCategories }
    })

    // Reset fields
    setNewFaqQuestion("")
    setNewFaqAnswer("")
    setIsAddingFaq(false)
    toast.success("FAQ added to draft")
  }

  const handleStartEditFaq = (idx, faq) => {
    setEditingFaqIndex(idx)
    setEditingFaqQuestion(faq.question)
    setEditingFaqAnswer(faq.answer)
  }

  const handleSaveEditFaq = (idx) => {
    const q = editingFaqQuestion.trim()
    const a = editingFaqAnswer.trim()

    if (!q || !a) {
      toast.error("Both Question and Answer are required")
      return
    }

    setHelpData(prev => {
      const updatedCategories = [...prev.categories]
      const targetCategory = updatedCategories[activeCategoryIndex]
      if (targetCategory && targetCategory.faqs) {
        targetCategory.faqs[idx] = { question: q, answer: a }
      }
      return { ...prev, categories: updatedCategories }
    })

    setEditingFaqIndex(null)
    setEditingFaqQuestion("")
    setEditingFaqAnswer("")
  }

  const handleDeleteFaq = (idx) => {
    setHelpData(prev => {
      const updatedCategories = [...prev.categories]
      const targetCategory = updatedCategories[activeCategoryIndex]
      if (targetCategory && targetCategory.faqs) {
        targetCategory.faqs = targetCategory.faqs.filter((_, i) => i !== idx)
      }
      return { ...prev, categories: updatedCategories }
    })
    toast.success("FAQ removed from draft")
  }

  if (loading) {
    return (
      <div className="h-full overflow-y-auto bg-slate-50 p-4 lg:p-6 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-slate-600">Loading Help & Support Panel...</p>
        </div>
      </div>
    )
  }

  const activeCategory = helpData.categories[activeCategoryIndex]

  return (
    <div className="h-full overflow-y-auto bg-slate-50 p-4 lg:p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Help & Support Editor</h1>
            <p className="text-sm text-slate-600 mt-1">Configure categories, FAQs, and support hotlines displayed to users.</p>
          </div>
          <Button onClick={handleSaveAll} disabled={saving} className="bg-slate-950 hover:bg-slate-900 text-white font-semibold shadow-md shrink-0">
            {saving ? "Saving Changes..." : "Save Changes"}
          </Button>
        </div>

        {/* General Settings */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Page Metadata & Contact Details</CardTitle>
            <CardDescription>Configure the main title, support description, email, and hotline phone.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="pageTitle">Support Center Title</Label>
              <Input
                id="pageTitle"
                value={helpData.title}
                onChange={(e) => setHelpData(prev => ({ ...prev, title: e.target.value }))}
                placeholder="Help & Support"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pageDesc">Subheading Description</Label>
              <Input
                id="pageDesc"
                value={helpData.description}
                onChange={(e) => setHelpData(prev => ({ ...prev, description: e.target.value }))}
                placeholder="We are here to help you."
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="supportEmail">Support Email Address</Label>
              <Input
                id="supportEmail"
                type="email"
                value={helpData.contactEmail}
                onChange={(e) => setHelpData(prev => ({ ...prev, contactEmail: e.target.value }))}
                placeholder="support@company.com"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="supportPhone">Support Hotline Phone</Label>
              <Input
                id="supportPhone"
                value={helpData.contactPhone}
                onChange={(e) => setHelpData(prev => ({ ...prev, contactPhone: e.target.value }))}
                placeholder="+91 99999 88888"
              />
            </div>
          </CardContent>
        </Card>

        {/* Categories & FAQs Split Layout */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Categories Manager Panel */}
          <Card className="md:col-span-1 h-fit">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">FAQ Categories</CardTitle>
                <CardDescription>Select or edit topics</CardDescription>
              </div>
              <Button 
                onClick={() => setIsAddingCategory(!isAddingCategory)} 
                size="sm" 
                variant="outline" 
                className="h-8 w-8 p-0"
              >
                {isAddingCategory ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              
              {/* Add Category Form */}
              {isAddingCategory && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-3 mb-2 animate-fadeIn">
                  <div className="space-y-1">
                    <Label htmlFor="newCatTitle" className="text-xs">Category Title</Label>
                    <Input
                      id="newCatTitle"
                      size="sm"
                      value={newCatTitle}
                      onChange={(e) => setNewCatTitle(e.target.value)}
                      placeholder="e.g. Account Setup"
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Category Icon</Label>
                    <Select value={newCatIcon} onValueChange={setNewCatIcon}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {iconOptions.map(opt => (
                          <SelectItem key={opt.value} value={opt.value} className="text-xs">
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={handleAddCategory} size="sm" className="w-full h-8 text-xs bg-slate-900">
                    Add Category
                  </Button>
                </div>
              )}

              {/* Categories list */}
              <div className="space-y-1">
                {helpData.categories.map((cat, idx) => {
                  const isSelected = activeCategoryIndex === idx
                  const isEditing = editingCatIndex === idx

                  return (
                    <div
                      key={idx}
                      className={`group flex items-center justify-between p-2.5 rounded-xl border transition-all text-sm font-semibold cursor-pointer ${
                        isSelected
                          ? "bg-slate-900 border-slate-900 text-white shadow-sm font-bold"
                          : "bg-white hover:bg-slate-50 border-slate-200 text-slate-700"
                      }`}
                      onClick={() => !isEditing && setActiveCategoryIndex(idx)}
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {/* Inline Icon Selector */}
                        <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                          <Select
                            value={cat.icon || "HelpCircle"}
                            onValueChange={(val) => handleUpdateCategoryIcon(idx, val)}
                          >
                            <SelectTrigger className="w-9 h-8 p-0 border-0 bg-transparent flex justify-center focus:ring-0">
                              <span className={isSelected ? 'text-[#F38F24]' : 'text-slate-400'}>
                                {cat.icon === "Car" && <Car className="w-4 h-4" />}
                                {cat.icon === "Utensils" && <Utensils className="w-4 h-4" />}
                                {cat.icon === "CreditCard" && <CreditCard className="w-4 h-4" />}
                                {(!cat.icon || cat.icon === "HelpCircle") && <HelpCircle className="w-4 h-4" />}
                              </span>
                            </SelectTrigger>
                            <SelectContent>
                              {iconOptions.map(opt => (
                                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                                  {opt.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {isEditing ? (
                          <input
                            type="text"
                            value={editingCatTitle}
                            onChange={(e) => setEditingCatTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveEditCategory(idx)
                              if (e.key === 'Escape') setEditingCatIndex(null)
                            }}
                            className="flex-1 bg-transparent border-b border-white outline-none py-0.5 text-sm font-semibold text-white px-1"
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <span className="truncate pr-2">{cat.title}</span>
                        )}
                      </div>

                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                        {isEditing ? (
                          <button
                            onClick={() => handleSaveEditCategory(idx)}
                            className="p-1 hover:bg-green-700 text-white rounded"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                        ) : (
                          <button
                            onClick={() => handleStartEditCategory(idx, cat.title)}
                            className={`p-1 rounded ${isSelected ? 'hover:bg-slate-800 text-white' : 'hover:bg-slate-100 text-slate-500 hover:text-slate-800'}`}
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteCategory(idx)}
                          className={`p-1 rounded ${isSelected ? 'hover:bg-slate-800 text-red-400' : 'hover:bg-slate-100 text-red-500 hover:text-red-700'}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )
                })}

                {helpData.categories.length === 0 && (
                  <p className="text-center text-slate-500 text-xs py-6">No categories. Click "+" to create one.</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* FAQs Manager Panel */}
          <Card className="md:col-span-2">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">
                  FAQs in "{activeCategory ? activeCategory.title : "No Category Selected"}"
                </CardTitle>
                <CardDescription>Manage Q&A items in this folder</CardDescription>
              </div>
              
              {activeCategory && (
                <Button 
                  onClick={() => setIsAddingFaq(!isAddingFaq)} 
                  size="sm" 
                  variant="outline"
                  className="flex items-center gap-1.5 h-8 px-3"
                >
                  {isAddingFaq ? (
                    <>
                      <X className="h-3.5 w-3.5" />
                      Close Form
                    </>
                  ) : (
                    <>
                      <Plus className="h-3.5 w-3.5" />
                      Add FAQ
                    </>
                  )}
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              
              {/* Add FAQ form */}
              {isAddingFaq && activeCategory && (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3 animate-fadeIn">
                  <h4 className="text-xs font-bold text-slate-600 uppercase tracking-wider">New FAQ details</h4>
                  <div className="space-y-1">
                    <Label htmlFor="faqQuestion" className="text-xs">Question Text</Label>
                    <Input
                      id="faqQuestion"
                      value={newFaqQuestion}
                      onChange={(e) => setNewFaqQuestion(e.target.value)}
                      placeholder="e.g. How long do refunds take?"
                      className="text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="faqAnswer" className="text-xs">Answer Text</Label>
                    <Textarea
                      id="faqAnswer"
                      value={newFaqAnswer}
                      onChange={(e) => setNewFaqAnswer(e.target.value)}
                      placeholder="Write FAQ details..."
                      rows={3}
                      className="text-sm w-full"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button onClick={() => setIsAddingFaq(false)} variant="ghost" size="sm">
                      Cancel
                    </Button>
                    <Button onClick={handleAddFaq} size="sm" className="bg-slate-900">
                      Add FAQ
                    </Button>
                  </div>
                </div>
              )}

              {/* FAQs list */}
              {activeCategory ? (
                <div className="space-y-3">
                  {(activeCategory.faqs || []).map((faq, idx) => {
                    const isFaqEditing = editingFaqIndex === idx

                    return (
                      <div key={idx} className="p-4 bg-white border border-slate-200 rounded-2xl shadow-sm space-y-2 relative group">
                        
                        {isFaqEditing ? (
                          // Editing mode
                          <div className="space-y-3">
                            <div className="space-y-1">
                              <Label className="text-xs">Question</Label>
                              <Input
                                value={editingFaqQuestion}
                                onChange={(e) => setEditingFaqQuestion(e.target.value)}
                                className="text-sm"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Answer</Label>
                              <Textarea
                                value={editingFaqAnswer}
                                onChange={(e) => setEditingFaqAnswer(e.target.value)}
                                rows={3}
                                className="text-sm w-full"
                              />
                            </div>
                            <div className="flex justify-end gap-2">
                              <Button onClick={() => setEditingFaqIndex(null)} variant="ghost" size="sm">
                                Cancel
                              </Button>
                              <Button onClick={() => handleSaveEditFaq(idx)} size="sm" className="bg-slate-900">
                                Save FAQ
                              </Button>
                            </div>
                          </div>
                        ) : (
                          // View mode
                          <>
                            <div className="flex justify-between items-start gap-4">
                              <h4 className="text-sm font-bold text-slate-800 leading-snug">
                                {idx + 1}. {faq.question}
                              </h4>
                              
                              <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={() => handleStartEditFaq(idx, faq)}
                                  className="p-1.5 hover:bg-slate-100 rounded text-slate-500 hover:text-slate-800"
                                >
                                  <Edit3 className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  onClick={() => handleDeleteFaq(idx)}
                                  className="p-1.5 hover:bg-slate-100 rounded text-red-500 hover:text-red-700"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                            <p className="text-slate-600 text-xs leading-relaxed mt-1">
                              {faq.answer}
                            </p>
                          </>
                        )}
                      </div>
                    )
                  })}

                  {(activeCategory.faqs || []).length === 0 && (
                    <div className="border border-dashed border-slate-200 rounded-2xl p-8 text-center text-slate-500 text-sm">
                      No questions in this category yet. Click "Add FAQ" to write some.
                    </div>
                  )}
                </div>
              ) : (
                <div className="border border-dashed border-slate-200 rounded-2xl p-8 text-center text-slate-500 text-sm">
                  Select or create a Category from the sidebar to view and manage questions.
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Tip Banner */}
        <div className="mt-6 flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-xl text-blue-800 text-xs">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <strong>Draft Mode Alert:</strong> Clicking "Add Category", "Add FAQ", or editing inline updates the page draft structure in your local browser state. You <strong>MUST</strong> click the <strong>"Save Changes"</strong> button at the top right of this screen to store updates to the database.
          </div>
        </div>
      </div>
    </div>
  )
}
