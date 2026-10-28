import { useState, useMemo, useRef, useEffect, useCallback } from "react"
import { useSearchParams, Link, useNavigate } from "react-router-dom"
import { 
  ArrowLeft, Star, Clock, Search, SlidersHorizontal, 
  ChevronDown, Bookmark, BadgePercent, Mic, Grid2x2,
  X, Utensils, Store, Loader2, History
} from "lucide-react"
import { Card, CardContent } from "@food/components/ui/card"
import { Button } from "@food/components/ui/button"
import { Input } from "@food/components/ui/input"
import { useProfile } from "@food/context/ProfileContext"
import { useLocation as useGeoLocation } from "@food/hooks/useLocation"
import { useZone } from "@food/hooks/useZone"
import { searchAPI } from "@/services/api"
import { motion, AnimatePresence } from "framer-motion"

// Helper to resolve media URLs consistently
const getMediaUrl = (url) => {
  if (!url || typeof url !== 'string') return null;
  if (url.startsWith('http')) return url;
  
  // Use VITE_API_BASE_URL to derive the backend origin
  // Falls back to same-origin, matching config/runtimeEnv.js. It used to fall
  // back to a hosted deployment of the previous product, so a build with the
  // variable unset would have quietly fetched images from someone else.
  const apiBase = import.meta.env.VITE_API_BASE_URL || "";
  const origin = apiBase.split('/api/v1')[0];
  
  return `${origin}${url.startsWith('/') ? url : '/' + url}`;
};

// Debounce hook for real-time search
function useDebounce(value, delay) {
  const [debouncedValue, setDebouncedValue] = useState(value)
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay)
    return () => clearTimeout(handler)
  }, [value, delay])
  return debouncedValue
}

const SEARCH_HISTORY_KEY = "professional_search_history_v1"

export default function ProfessionalSearch() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialQuery = searchParams.get("q") || ""
  const navigate = useNavigate()
  const { getDefaultAddress } = useProfile()
  const { location: userCoords } = useGeoLocation()
  const [deliveryAddressMode, setDeliveryAddressMode] = useState(() => {
    try {
      return window.localStorage.getItem("deliveryAddressMode") || "saved"
    } catch {
      return "saved"
    }
  })
  const defaultSavedAddress = useMemo(
    () => getDefaultAddress?.() || null,
    [getDefaultAddress],
  )
  const defaultSavedAddressLocation = useMemo(() => {
    const coords = defaultSavedAddress?.location?.coordinates
    if (Array.isArray(coords) && coords.length >= 2) {
      const lng = Number(coords[0])
      const lat = Number(coords[1])
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { latitude: lat, longitude: lng }
      }
    }

    const lat = Number(defaultSavedAddress?.latitude || defaultSavedAddress?.lat)
    const lng = Number(defaultSavedAddress?.longitude || defaultSavedAddress?.lng)
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { latitude: lat, longitude: lng }
    }

    return null
  }, [defaultSavedAddress])
  const effectiveLocation = useMemo(() => {
    const useSavedAddress =
      deliveryAddressMode === "saved" &&
      Number.isFinite(defaultSavedAddressLocation?.latitude) &&
      Number.isFinite(defaultSavedAddressLocation?.longitude)

    return useSavedAddress ? defaultSavedAddressLocation : userCoords
  }, [deliveryAddressMode, defaultSavedAddressLocation, userCoords])
  const { zoneId, zoneStatus, loading: zoneLoading } = useZone(effectiveLocation, { persistToStorage: false })
  const hasEffectiveCoordinates = useMemo(
    () =>
      Number.isFinite(effectiveLocation?.latitude) &&
      Number.isFinite(effectiveLocation?.longitude),
    [effectiveLocation],
  )
  
  const [query, setQuery] = useState(initialQuery)
  const debouncedQuery = useDebounce(query, 500)
  
  const [results, setResults] = useState({ restaurants: [], dishes: [] })
  const [loading, setLoading] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [categories, setCategories] = useState([])
  const [selectedCategoryId, setSelectedCategoryId] = useState(searchParams.get("cat") || null)
  const [history, setHistory] = useState([])
  const lastSearchedParamsRef = useRef(null)

  // Load search history
  useEffect(() => {
    const savedHistory = localStorage.getItem(SEARCH_HISTORY_KEY)
    if (savedHistory) setHistory(JSON.parse(savedHistory))
  }, [])

  useEffect(() => {
    fetchCategories()
  }, [zoneId, zoneStatus, zoneLoading, hasEffectiveCoordinates])

  // Sync URL changes to local query state (e.g. consecutive searches from navbar)
  useEffect(() => {
    const urlQuery = searchParams.get("q") || ""
    if (urlQuery !== query) {
      setQuery(urlQuery)
    }
  }, [searchParams.get("q")])

  useEffect(() => {
    const readMode = () => {
      try {
        setDeliveryAddressMode(window.localStorage.getItem("deliveryAddressMode") || "saved")
      } catch {
        setDeliveryAddressMode("saved")
      }
    }

    window.addEventListener("deliveryAddressModeChanged", readMode)
    return () => {
      window.removeEventListener("deliveryAddressModeChanged", readMode)
    }
  }, [])

  const fetchCategories = async () => {
    if (hasEffectiveCoordinates && (zoneLoading || zoneStatus === "loading")) {
      return
    }

    if (hasEffectiveCoordinates && !zoneId) {
      setCategories([])
      return
    }

    try {
      const res = await searchAPI.getAdminCategories({ zoneId })
      if (res.data?.success) setCategories(res.data.data.categories)
    } catch (err) {
      console.error("Failed to fetch categories", err)
    }
  }

  const addToHistory = (term) => {
    const newHistory = [term, ...history.filter(h => h !== term)].slice(0, 5)
    setHistory(newHistory)
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(newHistory))
  }

  const performSearch = useCallback(async (searchTerm, catId) => {
    if (hasEffectiveCoordinates && (zoneLoading || zoneStatus === "loading")) {
      return
    }

    if (!searchTerm && !catId) {
      setResults({ restaurants: [], dishes: [] })
      lastSearchedParamsRef.current = null
      return
    }

    // Skip redundant search if parameters are exactly the same to prevent loop
    if (
      lastSearchedParamsRef.current?.q === searchTerm &&
      lastSearchedParamsRef.current?.cat === catId &&
      lastSearchedParamsRef.current?.zoneId === zoneId
    ) {
      return
    }
    
    setLoading(true)
    try {
      const res = await searchAPI.unifiedSearch({
        q: searchTerm,
        categoryId: catId,
        zoneId
      })
      
      if (res.data?.success) {
        lastSearchedParamsRef.current = { q: searchTerm, cat: catId, zoneId }
        const all = res.data.data.restaurants || []
        setResults({
          restaurants: all.filter(r => r.matchType === 'restaurant' || !r.matchType),
          dishes: all.filter(r => r.matchType === 'food')
        })
      }
    } catch (err) {
      console.error("Search failed", err)
    } finally {
      setLoading(false)
    }
  }, [effectiveLocation, zoneId, zoneStatus, zoneLoading, hasEffectiveCoordinates])

  useEffect(() => {
    performSearch(debouncedQuery, selectedCategoryId)
    
    // Wait until the debounced query catches up to the actual query before syncing URL.
    // This prevents stale debounced queries from overwriting the URL immediately after a clear.
    if (query !== debouncedQuery) {
      return
    }

    const currentQ = searchParams.get("q") || ""
    const currentCat = searchParams.get("cat") || null
    
    // Only update search params if they are actually different to avoid infinite route changes
    if (debouncedQuery !== currentQ || selectedCategoryId !== currentCat) {
        const newParams = {}
        if (debouncedQuery) newParams.q = debouncedQuery
        if (selectedCategoryId) newParams.cat = selectedCategoryId
        setSearchParams(newParams, { replace: true })
    }
  }, [debouncedQuery, query, selectedCategoryId, performSearch, setSearchParams])

  // Speech Recognition Implementation
  const handleVoiceSearch = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      alert("Voice search is not supported in this browser.")
      return
    }

    const recognition = new SpeechRecognition()
    recognition.lang = 'en-IN'
    recognition.onstart = () => setIsListening(true)
    recognition.onend = () => setIsListening(false)
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript
      setQuery(transcript)
      addToHistory(transcript)
    }
    recognition.start()
  }

  const handleClear = () => {
    setQuery("")
    setSelectedCategoryId(null)
    setSearchParams({}, { replace: true })
    setResults({ restaurants: [], dishes: [] })
  }

  const handleCategoryClick = (id) => {
    const newCat = selectedCategoryId === id ? null : id
    setSelectedCategoryId(newCat)
    if (newCat) {
        setSearchParams({ ...Object.fromEntries(searchParams), cat: newCat }, { replace: true })
    } else {
        const p = Object.fromEntries(searchParams)
        delete p.cat
        setSearchParams(p, { replace: true })
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-zinc-950">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-white dark:bg-zinc-900 border-b border-slate-150 dark:border-zinc-850 px-4 py-3 md:hidden shadow-sm">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <button type="button" onClick={() => navigate('/food/user')} className="p-2 hover:bg-slate-50 dark:hover:bg-zinc-800 rounded-full transition-colors active:scale-95">
            <ArrowLeft className="w-5 h-5 text-gray-700 dark:text-gray-300" />
          </button>
          
          <form onSubmit={(e) => {
            e.preventDefault()
            setSearchParams({ q: query, ...(selectedCategoryId ? { cat: selectedCategoryId } : {}) }, { replace: true })
            performSearch(query, selectedCategoryId)
          }} className="flex-1 relative">
            <button type="submit" className="absolute left-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-rose-500 z-10 transition-colors">
              <Search className="w-4 h-4" />
            </button>
            <Input 
              autoFocus
              placeholder="Search for restaurants or dishes..." 
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-10 pr-10 h-11 bg-slate-50 dark:bg-zinc-800/60 border border-slate-200 dark:border-zinc-700/60 focus:ring-2 focus:ring-[#ff6d00] focus:border-transparent rounded-xl shadow-sm text-sm transition-all"
            />
            {query && (
              <button type="button" onClick={handleClear} className="absolute right-10 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 z-10 active:scale-90">
                <X className="w-4 h-4" />
              </button>
            )}
            <button 
              type="button"
              onClick={handleVoiceSearch}
              className={`absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full transition-all z-10 ${isListening ? 'text-[#ff6d00] scale-125 animate-pulse' : 'text-slate-400'}`}
            >
              <Mic className="w-5 h-5" />
            </button>
          </form>
        </div>
      </div>

      <div className="max-w-3xl mx-auto p-4">
        {/* Desktop Search Input */}
        <div className="hidden md:block mb-8 relative">
          <form onSubmit={(e) => {
            e.preventDefault()
            setSearchParams({ q: query, ...(selectedCategoryId ? { cat: selectedCategoryId } : {}) }, { replace: true })
            performSearch(query, selectedCategoryId)
          }} className="relative">
            <button type="submit" className="absolute left-4 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-[#ff6d00] z-10 transition-colors">
              <Search className="w-5 h-5" />
            </button>
            <Input 
              autoFocus
              placeholder="Search for restaurants or dishes..." 
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-12 pr-12 h-12 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800/80 focus:ring-2 focus:ring-[#ff6d00] focus:border-transparent rounded-2xl shadow-sm text-sm transition-all hover:border-slate-350"
            />
            {query && (
              <button type="button" onClick={handleClear} className="absolute right-12 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 transition-colors z-10 active:scale-90">
                <X className="w-4 h-4" />
              </button>
            )}
            <button 
              type="button"
              onClick={handleVoiceSearch}
              className={`absolute right-4 top-1/2 -translate-y-1/2 p-1 rounded-full transition-all z-10 ${isListening ? 'text-[#ff6d00] scale-125 animate-pulse' : 'text-slate-400'}`}
            >
              <Mic className="w-5 h-5" />
            </button>
          </form>
        </div>

        {/* Popular Searches (Main Page Style) */}
        {!query && !loading && (
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4 px-1">Popular Searches</h3>
            <div className="relative w-full overflow-hidden">
              <div className="flex items-center gap-2.5 overflow-x-auto scrollbar-hide py-1 px-0.5 pointer-events-auto pr-8">
                {[
                  { name: 'Pizza', emoji: '🍕', style: 'bg-red-50 dark:bg-red-950/20 border-red-100 dark:border-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100/50' },
                  { name: 'Biryani', emoji: '🍛', style: 'bg-amber-50 dark:bg-amber-950/20 border-amber-100 dark:border-amber-900/30 text-amber-700 dark:text-amber-400 hover:bg-amber-100/50' },
                  { name: 'Burger', emoji: '🍔', style: 'bg-orange-50 dark:bg-orange-950/20 border-orange-100 dark:border-orange-900/30 text-orange-600 dark:text-orange-400 hover:bg-orange-100/50' },
                  { name: 'Momos', emoji: '🥟', style: 'bg-yellow-50/60 dark:bg-yellow-950/10 border-yellow-100/80 dark:border-yellow-900/20 text-yellow-755 dark:text-yellow-400 hover:bg-yellow-100/40' },
                  { name: 'Thali', emoji: '🍲', style: 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-100 dark:border-emerald-900/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100/50' },
                  { name: 'Desserts', emoji: '🍰', style: 'bg-rose-50 dark:bg-rose-950/20 border-rose-100 dark:border-rose-900/30 text-rose-600 dark:text-rose-400 hover:bg-rose-100/50' }
                ].map((chip) => (
                  <button
                    key={chip.name}
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setQuery(chip.name);
                      addToHistory(chip.name);
                      performSearch(chip.name, selectedCategoryId);
                    }}
                    className={`flex items-center gap-1 flex-shrink-0 px-4 py-2 border rounded-full text-xs font-bold transition-all duration-200 shadow-sm hover:shadow active:scale-95 ${chip.style}`}
                  >
                    <span className="text-sm leading-none">{chip.emoji}</span>
                    <span>{chip.name}</span>
                  </button>
                ))}
              </div>
              <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-slate-50 to-transparent dark:from-zinc-950 pointer-events-none z-10" />
            </div>
          </div>
        )}
        {!query && !loading && (
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4 px-1">Top Categories</h3>
            <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-4">
              {categories.map((cat) => (
                <button 
                  key={cat._id} 
                  onClick={() => handleCategoryClick(cat._id)}
                  className={`flex flex-col items-center group transition-all ${selectedCategoryId === cat._id ? 'scale-110' : ''}`}
                >
                  <div className={`w-14 h-14 rounded-2xl mb-2 flex items-center justify-center overflow-hidden border-2 transition-all ${selectedCategoryId === cat._id ? 'border-rose-500 shadow-lg shadow-rose-100' : 'border-transparent bg-white dark:bg-zinc-900'}`}>
                    {cat.image ? (
                      <img 
                        src={getMediaUrl(cat.image)} 
                        alt={cat.name} 
                        className="w-full h-full object-cover group-hover:scale-110 transition-transform" 
                      />
                    ) : (
                      <Utensils className="w-6 h-6 text-slate-300" />
                    )}
                  </div>
                  <span className={`text-[11px] font-medium text-center line-clamp-1 ${selectedCategoryId === cat._id ? 'text-rose-600' : 'text-slate-600 dark:text-slate-400'}`}>
                    {cat.name}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Loading Spinner */}
        <AnimatePresence>
          {(loading || (hasEffectiveCoordinates && (zoneLoading || zoneStatus === "loading"))) && (
            <motion.div 
               initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
               className="flex flex-col items-center justify-center py-20"
            >
              <Loader2 className="w-8 h-8 text-rose-500 animate-spin mb-3" />
              <p className="text-slate-400 text-sm">Finding the best for you...</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Recent History */}
        {!query && !loading && history.length > 0 && (
          <div className="mb-8">
             <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2 px-1">Recently Searched</h3>
             <div className="flex flex-wrap gap-2">
                {history.map((term, i) => (
                  <button 
                    key={i} 
                    onClick={() => setQuery(term)}
                    className="flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-full text-sm text-slate-600 dark:text-zinc-400 hover:bg-slate-50 transition-colors"
                  >
                    <History className="w-3 h-3" />
                    {term}
                  </button>
                ))}
             </div>
          </div>
        )}

        {/* Search Results */}
        {!loading && (query || selectedCategoryId) && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
            
            {/* Dish Results Section */}
            {results.dishes.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-4">
                   <div className="w-1 h-5 bg-primary-orange/50 rounded-full" />
                   <h2 className="text-lg font-bold dark:text-white">Dishes from restaurants</h2>
                </div>
                <div className="grid gap-4">
                  {results.dishes.map((r) => (
                    <Link to={`/food/user/restaurants/${r.slug || r._id}${r.matchedDishId ? `?dish=${r.matchedDishId}` : ''}`} key={r._id} className="flex gap-4 p-3 bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-slate-100 dark:border-zinc-800 hover:shadow-md transition-shadow group">
                       <div className="w-24 h-24 rounded-xl overflow-hidden bg-slate-100 flex-shrink-0 relative">
                           <img 
                            src={getMediaUrl(r.matchedDishImage || r.profileImage || r.image || (Array.isArray(r.images) && r.images[0]))} 
                            className="w-full h-full object-cover group-hover:scale-110 transition-transform"
                            onError={(e) => (e.target.src = "/placeholder-dish.jpg")}
                          />
                          {r.pureVegRestaurant && (
                            <div className="absolute top-1 left-1 w-4 h-4 border border-green-600 p-[1px] bg-white rounded-sm">
                               <div className="w-full h-full bg-green-600 rounded-full" />
                            </div>
                          )}
                       </div>
                       <div className="flex-1 min-w-0 flex flex-col justify-center">
                          <div className="text-rose-500 text-[10px] font-bold uppercase tracking-wider mb-1">
                             Matched: {r.matchedDish || query}
                          </div>
                          <h3 className="font-bold text-slate-900 dark:text-white line-clamp-1">{r.restaurantName}</h3>
                          <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-zinc-400 mt-1">
                             <div className="flex items-center gap-1">
                                <Star className="w-3 h-3 text-primary-orange/50 fill-orange-500" />
                                <span className="font-semibold text-slate-700 dark:text-white">{r.rating || "New"}</span>
                             </div>
                             <span>•</span>
                             <span>{r.estimatedDeliveryTime || "30-40 mins"}</span>
                             <span>•</span>
                             <span className="line-clamp-1">{r.cuisines?.slice(0, 2).join(", ")}</span>
                          </div>
                       </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {/* Restaurant Results Section */}
            {results.restaurants.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-4">
                   <div className="w-1 h-5 bg-rose-500 rounded-full" />
                   <h2 className="text-lg font-bold dark:text-white">Restaurants</h2>
                </div>
                <div className="grid gap-6">
                  {results.restaurants.map((r) => (
                    <Link to={`/food/user/restaurants/${r._id}`} key={r._id} className="block group">
                      <div className="relative rounded-3xl overflow-hidden aspect-[16/9] mb-3 bg-slate-200">
                         <img 
                          src={getMediaUrl(r.profileImage || r.image || (Array.isArray(r.images) && r.images[0]))} 
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                          onError={(e) => (e.target.src = "/placeholder-restaurant.jpg")}
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                        <div className="absolute bottom-4 left-4 right-4 flex justify-between items-end">
                           <div>
                              <h3 className="text-xl font-bold text-white mb-1">{r.restaurantName}</h3>
                              <p className="text-white/80 text-xs line-clamp-1">{r.cuisines?.join(", ")}</p>
                           </div>
                           <div className="bg-white/20 backdrop-blur-md border border-white/30 px-2 py-1 rounded-lg flex items-center gap-1">
                              <Star className="w-3 h-3 text-white fill-white" />
                              <span className="text-white text-xs font-bold">{r.rating || "4.0"}</span>
                           </div>
                        </div>
                        {r.offer && (
                           <div className="absolute top-4 left-0 bg-blue-600 text-white text-[10px] font-black px-3 py-1.5 rounded-r-lg shadow-lg flex items-center gap-1 tracking-tighter">
                              <BadgePercent className="w-3 h-3" />
                              {r.offer.toUpperCase()}
                           </div>
                        )}
                      </div>
                      <div className="flex items-center justify-between px-1">
                         <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-zinc-400 font-medium">
                            <div className="flex items-center gap-1">
                               <Clock className="w-3 h-3" />
                               {r.estimatedDeliveryTime || "30 mins"}
                            </div>
                            <span>•</span>
                            <span>{r.location?.area || "Nearby"}</span>
                         </div>
                         <div className="text-[10px] font-bold text-rose-500 bg-rose-50 dark:bg-rose-500/10 px-2 py-0.5 rounded-full uppercase tracking-wider">
                            Top Pick
                         </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {/* Empty State */}
            {!loading && !(hasEffectiveCoordinates && (zoneLoading || zoneStatus === "loading")) && results.restaurants.length === 0 && results.dishes.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                 <div className="w-20 h-20 bg-slate-100 dark:bg-zinc-900 rounded-full flex items-center justify-center mb-4">
                    <Search className="w-8 h-8 text-slate-300" />
                 </div>
                 <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">We couldn't find any results</h2>
                 <p className="text-slate-500 text-sm max-w-xs">Maybe try searching for something else or check your spelling</p>
                 <Button variant="outline" onClick={handleClear} className="mt-6 rounded-xl border-rose-500 text-rose-500 hover:bg-rose-50">
                    Clear all filters
                 </Button>
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  )
}
