import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, Wallet } from "lucide-react"
import BottomNavOrders from "@food/components/restaurant/BottomNavOrders"
import { restaurantAPI } from "@food/api"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}


export default function WithdrawalHistoryPage() {
  const navigate = useNavigate()
  const [withdrawalHistoryTab, setWithdrawalHistoryTab] = useState('pending')
  const [withdrawalRequests, setWithdrawalRequests] = useState([])
  const [loadingWithdrawalRequests, setLoadingWithdrawalRequests] = useState(false)

  // Fetch withdrawal requests on mount
  useEffect(() => {
    const fetchWithdrawalRequests = async () => {
      try {
        setLoadingWithdrawalRequests(true)
        const response = await restaurantAPI.getWithdrawalHistory()
        // API returns { success: true, data: [...] }
        const history = response?.data?.data || []
        
        // Map backend fields to the local UI names
        const mapped = history.map(h => ({
          id: h._id,
          amount: h.amount,
          status: h.status === 'approved' ? 'Approved' : h.status === 'rejected' ? 'Rejected' : 'Pending',
          requestedAt: h.createdAt,
          processedAt: h.processedAt
        }))
        
        setWithdrawalRequests(mapped)
      } catch (error) {
        if (error.response?.status !== 401) {
          debugError('Error fetching withdrawal requests:', error)
        }
      } finally {
        setLoadingWithdrawalRequests(false)
      }
    }

    fetchWithdrawalRequests()
  }, [])

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col pb-28 text-gray-900">
      {/* Header */}
      <div className="sticky bg-white/95 backdrop-blur-md top-0 z-40 border-b border-gray-200 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3.5 flex items-center gap-3">
          <button
            onClick={() => navigate("/restaurant/hub-finance")}
            className="p-2 -ml-2 hover:bg-gray-100 rounded-xl transition-colors text-gray-600 hover:text-gray-900"
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-base sm:text-lg font-bold text-gray-900">Withdrawal History</h1>
            <p className="text-xs text-gray-500 hidden sm:block">Track payout request status and transfer timelines</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="max-w-4xl mx-auto w-full px-4 sm:px-6 pt-5">
        <div className="flex gap-2 max-w-md">
          <button
            onClick={() => setWithdrawalHistoryTab('pending')}
            className={`flex-1 px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all ${
              withdrawalHistoryTab === 'pending'
                ? "bg-gray-900 text-white shadow-sm"
                : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
            }`}
          >
            Pending Requests
          </button>
          <button
            onClick={() => setWithdrawalHistoryTab('successful')}
            className={`flex-1 px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all ${
              withdrawalHistoryTab === 'successful'
                ? "bg-gray-900 text-white shadow-sm"
                : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
            }`}
          >
            Processed / Completed
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto w-full flex-1 px-4 sm:px-6 py-6">
        {loadingWithdrawalRequests ? (
          <div className="py-16 text-center text-gray-500 bg-white rounded-2xl border border-gray-200 shadow-sm">
            Loading withdrawal requests...
          </div>
        ) : (
          <>
            {withdrawalHistoryTab === 'pending' ? (
              <div className="space-y-3">
                {withdrawalRequests
                  .filter(req => req.status === 'Pending')
                  .length === 0 ? (
                  <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-gray-300 shadow-sm">
                    <Wallet className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-900 text-base font-bold">No pending withdrawal requests</p>
                    <p className="text-gray-500 text-xs mt-1">All requested transfers have been processed.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {withdrawalRequests
                      .filter(req => req.status === 'Pending')
                      .map((request) => (
                        <div
                          key={request.id}
                          className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm hover:border-gray-300 transition-all flex flex-col justify-between"
                        >
                          <div className="flex justify-between items-start mb-3">
                            <div>
                              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Amount</p>
                              <p className="text-2xl font-black text-gray-900 mt-0.5">
                                ₹{request.amount?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </p>
                            </div>
                            <span className="px-3 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-bold uppercase tracking-wider">
                              Pending
                            </span>
                          </div>
                          <div className="pt-3 border-t border-gray-100 text-xs text-gray-500 space-y-0.5">
                            <p>
                              Requested: {request.requestedAt ? new Date(request.requestedAt).toLocaleString('en-IN', {
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              }) : 'N/A'}
                            </p>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {withdrawalRequests
                  .filter(req => req.status === 'Approved' || req.status === 'Processed')
                  .length === 0 ? (
                  <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-gray-300 shadow-sm">
                    <Wallet className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-900 text-base font-bold">No successful withdrawals recorded</p>
                    <p className="text-gray-500 text-xs mt-1">Processed bank transfers will be listed here.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {withdrawalRequests
                      .filter(req => req.status === 'Approved' || req.status === 'Processed')
                      .map((request) => (
                        <div
                          key={request.id}
                          className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm hover:border-gray-300 transition-all flex flex-col justify-between"
                        >
                          <div className="flex justify-between items-start mb-3">
                            <div>
                              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Amount</p>
                              <p className="text-2xl font-black text-gray-900 mt-0.5">
                                ₹{request.amount?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </p>
                            </div>
                            <span className="px-3 py-1 bg-emerald-100 text-emerald-800 rounded-full text-xs font-bold uppercase tracking-wider">
                              Completed
                            </span>
                          </div>
                          <div className="pt-3 border-t border-gray-100 text-xs text-gray-500 space-y-0.5">
                            <p>
                              Processed: {request.processedAt ? new Date(request.processedAt).toLocaleString('en-IN', {
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              }) : request.requestedAt ? new Date(request.requestedAt).toLocaleString('en-IN') : 'N/A'}
                            </p>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div className="lg:hidden">
        <BottomNavOrders />
      </div>
    </div>
  )
}
