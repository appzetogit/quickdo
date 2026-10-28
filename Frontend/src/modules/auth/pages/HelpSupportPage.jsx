import React, { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { motion, AnimatePresence } from "framer-motion"
import { 
  Search, 
  HelpCircle, 
  Car, 
  Utensils, 
  CreditCard, 
  ChevronDown, 
  Phone, 
  Mail, 
  ArrowLeft, 
  Loader2,
  AlertCircle
} from "lucide-react"
import api from "@food/api"
import { API_ENDPOINTS } from "@food/api/config"

// Default fallback FAQs for a premium out-of-the-box experience
const DEFAULT_HELP_CONTENT = {
  title: "Quick Drop Support Center",
  description: "We are here to help you. Browse FAQs by topic or search for answers.",
  contactEmail: "support@quickdropsindia.com",
  contactPhone: "+91 99999 88888",
  categories: [
    {
      title: "General FAQs",
      icon: "HelpCircle",
      faqs: [
        {
          question: "How do I create an account on Quick Drop?",
          answer: "Creating an account is simple! On the login screen, enter your phone number, verify the 4-digit OTP sent to your phone, enter your name if you are a new user, and you will be ready to access both our ride-hailing and food-delivery ecosystems instantly."
        },
        {
          question: "Is my personal data secure?",
          answer: "Yes, absolutely. We use enterprise-grade end-to-end encryption to secure your phone number, payment details, and personal information. We never share your data with unauthorized third parties."
        },
        {
          question: "Can I use both food delivery and ride-hailing with a single account?",
          answer: "Yes! Quick Drop is a unified ecosystem. You only need one phone number and one profile to seamlessly order food and book rides."
        }
      ]
    },
    {
      title: "Ride Hailing",
      icon: "Car",
      faqs: [
        {
          question: "How do I book a ride?",
          answer: "After logging in, choose the 'Ride Hailing' service. Set your pick-up and drop-off locations on the map, select your preferred ride category (Economy, Premium, or Auto), check the estimated fare, and click 'Book Ride' to match with the nearest driver."
        },
        {
          question: "Can I schedule a ride in advance?",
          answer: "Yes, you can schedule rides. While booking, choose the 'Schedule Ride' option and pick your desired date and time. We will match you with a driver shortly before your scheduled departure."
        },
        {
          question: "What should I do if I leave an item in a Quick Drop ride?",
          answer: "Please contact our support team immediately at support@quickdropsindia.com or call our hotline. Provide your ride ID, time of travel, and driver details so we can assist you in retrieving your lost item."
        }
      ]
    },
    {
      title: "Food Delivery",
      icon: "Utensils",
      faqs: [
        {
          question: "How do I track my food order?",
          answer: "Once your order is placed, go to the active orders section. You can track your order status in real-time, see restaurant preparation progress, and follow the live GPS location of your delivery partner on the map."
        },
        {
          question: "Can I customize my meals or add special instructions?",
          answer: "Yes! When choosing food items, you can select customized add-ons. You can also write specific instructions for the restaurant (e.g., 'Make it spicy') or delivery notes for the driver (e.g., 'Leave at the gate') before checkout."
        },
        {
          question: "What happens if my food order is delayed?",
          answer: "We strive to deliver all orders within the estimated timeframe. If an order is delayed due to high demand or weather conditions, you will receive real-time notifications. You can also chat directly with your assigned delivery partner or contact restaurant support."
        }
      ]
    },
    {
      title: "Payments & Refunds",
      icon: "CreditCard",
      faqs: [
        {
          question: "What payment methods are supported?",
          answer: "We support a wide variety of payment methods including UPI (Google Pay, PhonePe, Paytm), Debit/Credit cards, Net banking, and cash on delivery. You can manage your wallets and payment settings in your profile."
        },
        {
          question: "How long does a refund take?",
          answer: "Refunds for cancelled rides or food orders are processed instantly on our end. Depending on your bank or payment method, the money will reflect in your account within 3-5 business days for cards/UPI, or immediately if refunded to your Quick Drop Wallet."
        },
        {
          question: "Why did my transaction fail?",
          answer: "Transaction failures usually happen due to bank network congestion or insufficient balance. If money was debited for a failed transaction, it will be automatically refunded by your bank within 24 hours."
        }
      ]
    }
  ]
}

// Icon Helper mapping string names to Lucide icons
const getIconComponent = (iconName) => {
  switch (iconName) {
    case "Car":
      return Car
    case "Utensils":
      return Utensils
    case "CreditCard":
      return CreditCard
    case "HelpCircle":
    default:
      return HelpCircle
  }
}

export default function HelpSupportPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [activeCategoryIndex, setActiveCategoryIndex] = useState(0)
  const [openFaqIndex, setOpenFaqIndex] = useState(null)
  
  // Custom states for data from database
  const [helpData, setHelpData] = useState(DEFAULT_HELP_CONTENT)

  useEffect(() => {
    const fetchHelpContent = async () => {
      try {
        setLoading(true)
        const endpoint = API_ENDPOINTS.ADMIN.HELP_SUPPORT_PUBLIC || "/food/pages/help_support"
        const response = await api.get(endpoint)
        if (response.data?.success && response.data?.data) {
          setHelpData(response.data.data)
        }
      } catch (error) {
        console.warn("Failed to fetch dynamic Help & Support content. Using offline defaults.", error)
      } finally {
        setLoading(false)
      }
    }
    fetchHelpContent()
  }, [])

  // Flatten FAQs for searching
  const allFaqs = helpData.categories.reduce((acc, category) => {
    const categoryName = category.title
    const faqsWithCategory = category.faqs.map(faq => ({
      ...faq,
      categoryName
    }))
    return [...acc, ...faqsWithCategory]
  }, [])

  // Filter FAQs based on search query
  const filteredFaqs = searchQuery.trim() !== ""
    ? allFaqs.filter(faq => 
        faq.question.toLowerCase().includes(searchQuery.toLowerCase()) || 
        faq.answer.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : []

  const activeCategory = helpData.categories[activeCategoryIndex] || helpData.categories[0]

  return (
    <div className="min-h-screen bg-slate-50 font-sans flex flex-col">
      {/* Header Banner Section */}
      <div className="bg-gradient-to-r from-[#1A1A1A] via-[#2D2D2D] to-[#1A1A1A] text-white py-12 px-6 relative overflow-hidden shadow-md">
        {/* Decorative orange background glow */}
        <div className="absolute top-0 right-0 w-80 h-80 bg-[#F38F24]/10 rounded-full blur-[100px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-[#F38F24]/5 rounded-full blur-[80px] pointer-events-none" />

        <div className="max-w-6xl mx-auto relative z-10">
          <button 
            onClick={() => navigate("/login")}
            className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-6 transition-colors duration-200"
          >
            <ArrowLeft className="w-4 h-4 text-[#F38F24]" />
            Back to Login
          </button>

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div>
              <h1 className="text-3xl md:text-4xl font-black tracking-tight mb-2">
                {helpData.title}
              </h1>
              <p className="text-gray-400 text-base max-w-xl">
                {helpData.description}
              </p>
            </div>
            
            {/* Search Input Box */}
            <div className="relative w-full md:w-80">
              <span className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none">
                <Search className="h-5 h-5 text-gray-400" />
              </span>
              <input
                type="text"
                placeholder="Search for questions..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  setOpenFaqIndex(null) // reset open accordion when searching
                }}
                className="w-full h-12 pl-11 pr-4 bg-white/10 hover:bg-white/15 focus:bg-white text-white focus:text-[#1A1A1A] placeholder:text-gray-400 focus:placeholder:text-gray-500 rounded-2xl border border-white/20 focus:border-[#F38F24] outline-none transition-all duration-300 shadow-inner"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 max-w-6xl w-full mx-auto px-6 py-10 flex flex-col md:flex-row gap-8">
        
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center py-20">
            <Loader2 className="w-10 h-10 animate-spin text-[#F38F24]" />
            <p className="mt-4 text-slate-500 font-medium">Loading FAQs...</p>
          </div>
        ) : searchQuery.trim() !== "" ? (
          // Search Results View
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-6">
              <h2 className="text-xl font-bold text-slate-800">
                Search Results for "{searchQuery}"
              </h2>
              <span className="px-2.5 py-0.5 bg-slate-200 text-slate-700 text-xs font-semibold rounded-full">
                {filteredFaqs.length} found
              </span>
            </div>

            {filteredFaqs.length > 0 ? (
              <div className="space-y-4">
                {filteredFaqs.map((faq, idx) => (
                  <FAQAccordionItem
                    key={idx}
                    question={faq.question}
                    answer={faq.answer}
                    categoryName={faq.categoryName}
                    isOpen={openFaqIndex === idx}
                    onToggle={() => setOpenFaqIndex(openFaqIndex === idx ? null : idx)}
                  />
                ))}
              </div>
            ) : (
              <div className="bg-white rounded-3xl p-8 border border-slate-200 text-center shadow-sm">
                <AlertCircle className="w-12 h-12 text-[#F38F24]/60 mx-auto mb-4" />
                <h3 className="text-lg font-bold text-slate-800 mb-1">No matches found</h3>
                <p className="text-slate-500 text-sm max-w-md mx-auto">
                  We couldn't find any FAQs matching your search. Try adjusting your keywords, or browse through the topics.
                </p>
                <button
                  onClick={() => setSearchQuery("")}
                  className="mt-4 px-5 py-2 bg-[#1A1A1A] hover:bg-[#2A2A2A] text-white rounded-full text-xs font-semibold shadow-sm transition-all"
                >
                  Clear Search
                </button>
              </div>
            )}
          </div>
        ) : (
          // Standard Category + FAQ View
          <>
            {/* Sidebar navigation for Categories */}
            <div className="w-full md:w-64 shrink-0 flex flex-col gap-2.5">
              <h3 className="text-xs font-bold text-slate-400 tracking-wider uppercase mb-1 px-3">
                FAQ Categories
              </h3>
              <div className="flex flex-row md:flex-col gap-2 overflow-x-auto pb-2 md:pb-0 scrollbar-none">
                {helpData.categories.map((category, idx) => {
                  const IconComponent = getIconComponent(category.icon)
                  const isActive = activeCategoryIndex === idx
                  return (
                    <button
                      key={idx}
                      onClick={() => {
                        setActiveCategoryIndex(idx)
                        setOpenFaqIndex(null)
                      }}
                      className={`flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-bold transition-all whitespace-nowrap shrink-0 ${
                        isActive
                          ? "bg-white border-l-4 border-l-[#F38F24] text-[#F38F24] shadow-sm font-black"
                          : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                      }`}
                    >
                      <IconComponent className={`w-4 h-4 ${isActive ? 'text-[#F38F24]' : 'text-slate-400'}`} />
                      {category.title}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* FAQs List for the selected category */}
            <div className="flex-1">
              {activeCategory ? (
                <div>
                  <h2 className="text-xl font-bold text-slate-800 mb-6 px-1 flex items-center gap-2.5">
                    {activeCategory.title}
                  </h2>
                  <div className="space-y-4">
                    {activeCategory.faqs.map((faq, idx) => (
                      <FAQAccordionItem
                        key={idx}
                        question={faq.question}
                        answer={faq.answer}
                        isOpen={openFaqIndex === idx}
                        onToggle={() => setOpenFaqIndex(openFaqIndex === idx ? null : idx)}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center text-slate-500 py-10">
                  No FAQs in this category.
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Footer Contact Support Section */}
      <div className="bg-white border-t border-slate-200 py-12 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-2xl font-black text-slate-800 mb-2">Still Need Help?</h2>
          <p className="text-slate-500 text-sm mb-8 max-w-md mx-auto">
            Can't find the answer you're looking for? Reach out directly to our dedicated customer support team.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-6">
            {/* Email Support */}
            {helpData.contactEmail && (
              <a 
                href={`mailto:${helpData.contactEmail}`}
                className="flex items-center gap-4 px-6 py-4 rounded-2xl bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-all duration-300 w-full sm:w-auto shadow-sm"
              >
                <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center text-[#F38F24]">
                  <Mail className="w-5 h-5" />
                </div>
                <div className="text-left">
                  <p className="text-[11px] text-gray-500 font-bold uppercase tracking-wider mb-0.5">Email Support</p>
                  <p className="text-[14px] font-black text-slate-800">{helpData.contactEmail}</p>
                </div>
              </a>
            )}

            {/* Phone Support */}
            {helpData.contactPhone && (
              <a 
                href={`tel:${helpData.contactPhone}`}
                className="flex items-center gap-4 px-6 py-4 rounded-2xl bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-all duration-300 w-full sm:w-auto shadow-sm"
              >
                <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center text-[#F38F24]">
                  <Phone className="w-5 h-5" />
                </div>
                <div className="text-left">
                  <p className="text-[11px] text-gray-500 font-bold uppercase tracking-wider mb-0.5">Call Hotline</p>
                  <p className="text-[14px] font-black text-slate-800">{helpData.contactPhone}</p>
                </div>
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// Accordion child component with Framer Motion for premium aesthetics
function FAQAccordionItem({ question, answer, categoryName, isOpen, onToggle }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm transition-all duration-300 hover:border-slate-300 hover:shadow-md">
      <button
        onClick={onToggle}
        className="w-full px-6 py-4 flex items-center justify-between text-left focus:outline-none"
      >
        <div className="pr-4">
          {categoryName && (
            <span className="text-[10px] font-bold text-[#F38F24] uppercase tracking-widest block mb-1">
              {categoryName}
            </span>
          )}
          <h3 className="text-[16px] font-bold text-slate-800 leading-tight">
            {question}
          </h3>
        </div>
        <ChevronDown 
          className={`w-5 h-5 text-slate-400 shrink-0 transition-transform duration-300 ${
            isOpen ? "transform rotate-180 text-[#F38F24]" : ""
          }`} 
        />
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden bg-slate-50/50"
          >
            <div className="px-6 pb-5 pt-1 text-slate-600 text-sm leading-relaxed border-t border-slate-100">
              {answer}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
