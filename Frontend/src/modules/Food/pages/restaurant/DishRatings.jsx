import { useNavigate } from "react-router-dom"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"
import { ArrowLeft } from "lucide-react"

export default function DishRatings() {
  const navigate = useNavigate()
  const goBack = useRestaurantBackNavigation()

  return (
    <div className="min-h-screen bg-neutral-50/60 flex flex-col pb-28 text-gray-900">
      <div className="bg-white/95 backdrop-blur-md border-b border-gray-200 sticky top-0 z-40 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3.5 flex items-center gap-3">
          <button
            onClick={goBack}
            className="p-2 -ml-2 hover:bg-gray-100 rounded-xl text-gray-600 hover:text-gray-900 transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-base sm:text-lg font-bold text-gray-900">Menu Dish Ratings</h1>
            <p className="text-xs text-gray-500 hidden sm:block">Item-level review scores and customer sentiment breakdown</p>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto w-full flex-1 flex items-center justify-center px-4 sm:px-6 py-12">
        <div className="text-center p-12 bg-white rounded-2xl border border-dashed border-gray-300 shadow-sm max-w-md w-full">
          <p className="text-sm font-bold text-gray-900">
            No Dish Ratings Yet
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Ratings for individual dishes will appear here once customers start reviewing menu items on their orders.
          </p>
        </div>
      </div>
    </div>
  )
}
