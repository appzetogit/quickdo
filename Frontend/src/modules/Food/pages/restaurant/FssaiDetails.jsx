import { useNavigate } from "react-router-dom"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"
import { ArrowLeft, Download } from "lucide-react"

export default function FssaiDetails() {
  const navigate = useNavigate()
  const goBack = useRestaurantBackNavigation()

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <div className="px-4 pt-4 pb-3 flex items-center gap-3 border-b border-gray-200">
        <button
          onClick={goBack}
          className="p-2 rounded-full hover:bg-gray-100"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5 text-gray-900" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-1">
            <h1 className="text-base font-semibold text-gray-900">FSSAI Details</h1>
          </div>
          <p className="text-xs text-gray-500">No live restaurant license data available.</p>
        </div>
      </div>

      <div className="flex-1 px-4 pt-4 pb-28 space-y-4">
        <div className="rounded-2xl bg-[#ffe9b3] px-4 py-3 flex items-start gap-3">
          <div className="mt-1 h-6 w-6 rounded-full bg-black/80 flex items-center justify-center text-white text-xs font-semibold">
            i
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-gray-900">
              FSSAI details are not available
            </p>
            <p className="text-xs text-gray-700 mt-1">
              Upload or sync your license information to manage compliance here.
            </p>
          </div>
        </div>

        <div className="rounded-2xl bg-white shadow-sm border border-gray-100 p-4 space-y-3">
          <div>
            <p className="text-xs text-gray-500 mb-1">FSSAI registration number</p>
            <p className="text-sm font-semibold text-gray-900">Not available</p>
          </div>

          <div className="border-t border-dashed border-gray-200" />

          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 mb-1">Document</p>
              <p className="text-sm font-semibold text-gray-900">No document uploaded</p>
            </div>
            <button
              type="button"
              className="w-9 h-9 rounded-full border border-gray-300 flex items-center justify-center hover:bg-gray-50"
            >
              <Download className="w-4 h-4 text-gray-800" />
            </button>
          </div>

          <div className="border-t border-dashed border-gray-200" />

          <div>
            <p className="text-xs text-gray-500 mb-1">Valid up to</p>
            <p className="text-sm font-semibold text-gray-900">Not available</p>
          </div>
        </div>
      </div>

      <div className="px-4 pb-6 pt-3 border-t border-gray-200 bg-white">
        <button
          type="button"
          className="w-full py-3 rounded-full bg-black text-white text-sm font-medium mb-2"
          onClick={() => navigate("/restaurant/fssai/update")}
        >
          Update FSSAI license
        </button>
        <p className="text-xs text-center text-gray-600">
          Haven&apos;t renewed your FSSAI?{" "}
          <button
            type="button"
            className="text-blue-600 underline underline-offset-2"
            onClick={() => navigate("/restaurant/fssai/update")}
          >
            Apply Now
          </button>
        </p>
      </div>
    </div>
  )
}
