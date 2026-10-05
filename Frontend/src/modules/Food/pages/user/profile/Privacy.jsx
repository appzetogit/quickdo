import { Link, useNavigate } from "react-router-dom"
import { useState, useEffect } from "react"
import { ArrowLeft, Lock, Loader2 } from "lucide-react"
import { motion } from "framer-motion"
import AnimatedPage from "@food/components/user/AnimatedPage"
import { Button } from "@food/components/ui/button"
import api from "@food/api"
import useAppBackNavigation from "@food/hooks/useAppBackNavigation"
import { API_ENDPOINTS } from "@food/api/config"

export default function Privacy() {
  const navigate = useNavigate()
  const goBack = useAppBackNavigation()
  const [loading, setLoading] = useState(true)
  const [privacyData, setPrivacyData] = useState({
    title: 'Privacy Policy',
    content: ''
  })

  useEffect(() => {
    fetchPrivacyData()
  }, [])

  const fetchPrivacyData = async () => {
    try {
      setLoading(true)
      const response = await api.get(API_ENDPOINTS.ADMIN.PRIVACY_PUBLIC)
      if (response.data.success) {
        setPrivacyData(response.data.data || { title: 'Privacy Policy', content: '' })
      }
    } catch (error) {
      console.error('Error fetching privacy data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleBack = () => {
    if (window.history.length > 2) {
      goBack()
    } else {
      navigate('/food/user')
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-white dark:bg-[#0a0a0a] flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-[#ff6d00]" />
          <p className="text-gray-500 font-bold uppercase tracking-widest text-xs">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <AnimatedPage className="min-h-screen bg-white dark:bg-[#0a0a0a] pb-10">
      {/* Premium Sticky Header */}
      <div className="sticky top-0 z-50 bg-white/80 dark:bg-[#0a0a0a]/80 backdrop-blur-xl border-b border-gray-100 dark:border-gray-900">
        <div className="max-w-4xl mx-auto px-4 h-16 md:h-20 flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={handleBack}
            className="h-10 w-10 rounded-full hover:bg-gray-100 dark:hover:bg-gray-900 transition-all active:scale-95"
          >
            <ArrowLeft className="h-6 w-6 text-gray-900 dark:text-white" />
          </Button>
          <div className="flex-1">
             <h1 className="text-xl md:text-2xl font-black text-gray-900 dark:text-white tracking-tight leading-none">
               {privacyData.title || "Privacy Policy"}
             </h1>
             <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">Quick Drop Policy</p>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8">
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white dark:bg-[#111] rounded-[2rem] p-6 md:p-10 shadow-sm border border-gray-50 dark:border-gray-900"
        >
          {privacyData.content ? (
            <div
              className="prose prose-slate dark:prose-invert max-w-none
                prose-headings:font-black prose-headings:text-gray-900 dark:prose-headings:text-white
                prose-p:text-gray-600 dark:prose-p:text-gray-400 prose-p:leading-relaxed
                prose-strong:text-gray-900 dark:prose-strong:text-white
                prose-a:text-[#ff6d00] dark:prose-a:text-[#EB590E]
                prose-li:text-gray-600 dark:prose-li:text-gray-400
                text-sm leading-relaxed text-gray-600 dark:text-gray-400
                [&_h1]:text-2xl [&_h1]:font-black [&_h1]:text-gray-900 dark:[&_h1]:text-white [&_h1]:mb-2
                [&_h3]:text-lg [&_h3]:font-black [&_h3]:text-gray-900 dark:[&_h3]:text-white [&_h3]:mt-8 [&_h3]:mb-2
                [&_p]:mb-3 [&_strong]:text-gray-900 dark:[&_strong]:text-white [&_a]:text-[#ff6d00] [&_a]:underline
                [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-4 [&_li]:mb-1.5"
              dangerouslySetInnerHTML={{ __html: privacyData.content }}
            />
          ) : (
            <div className="text-center py-20">
               <Lock className="w-16 h-16 text-gray-100 dark:text-gray-800 mx-auto mb-4" />
               <p className="text-gray-400 font-medium">No content available at the moment.</p>
            </div>
          )}
        </motion.div>

        <p className="text-center mt-10 text-[10px] text-gray-400 font-black uppercase tracking-[0.2em] leading-relaxed">
          Last updated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} <br />
          © {new Date().getFullYear()} Quick Drop. All Rights Reserved.
        </p>
      </div>
    </AnimatedPage>
  )
}



