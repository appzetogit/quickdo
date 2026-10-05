import React, { useState, useEffect } from 'react';
import { 
  ArrowLeft, 
  ChevronRight, 
  Mail, 
  Phone, 
  Clock, 
  Filter, 
  ChevronDown, 
  CheckCircle2, 
  X, 
  CreditCard, 
  Star, 
  Car,
  TrendingUp,
  AlertCircle,
  MoreVertical,
  Plus,
  Minus,
  ArrowUpRight,
  ArrowDownRight,
  History as HistoryIcon
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';

const UserDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('Request List');
  const [isWalletModalOpen, setWalletModalOpen] = useState(false);
  const [walletType, setWalletType] = useState('credit'); // credit or debit
  const [walletAmount, setWalletAmount] = useState('');
  
  const [user, setUser] = useState(null);
  const [requests, setRequests] = useState([]);
  const [walletHistory, setWalletHistory] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const token = (localStorage.getItem('admin_accessToken') || localStorage.getItem('adminToken'));

  const fetchData = async () => {
    try {
      setIsLoading(true);
      
      // Fetch User Info
      const userRes = await fetch(`${globalThis.__LEGACY_BACKEND_ORIGIN__}/api/v1/taxi/admin/users/${id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const userData = await userRes.json();
      
      if (userData.success) {
        let u = userData.data;
        if (Array.isArray(u)) u = u[0];
        if (u?.user) u = u.user;
        
        if (u) {
          setUser({
            id: u._id,
            name: u.name || u.user_id?.name || 'Anonymous',
            phone: u.mobile || u.mobile_number || u.user_id?.mobile || 'N/A',
            email: u.email || u.user_id?.email || 'N/A',
            joined: (u.createdAt || u.user_id?.createdAt) ? new Date(u.createdAt || u.user_id?.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A',
            avatar: (u.name || u.user_id?.name || 'A').split(' ').map(n => n[0]).join(''),
            stats: {
               completed: 0, 
               cancelled: 0,
               upcoming: 0
            },
            wallet: {
              total: u.wallet_balance || u.user_id?.wallet_balance || 0,
              spend: 0,
              balance: u.wallet_balance || u.user_id?.wallet_balance || 0
            },
            subscriptionSummary: u.subscriptionSummary || { activeCount: 0, activePlans: [] },
          });
        }

        const userReviews = Array.isArray(userData.data?.reviews)
          ? userData.data.reviews
          : Array.isArray(u?.reviews)
            ? u.reviews
            : [];
        setReviews(
          userReviews.map((review) => ({
            _id: review._id,
            rating: Number(review.rating || 0),
            comment: review.comment || '',
            createdAt: review.createdAt || null,
            driver_id: review.driver_id || null,
          })),
        );
      }

      const subscriptionRes = await fetch(`${globalThis.__LEGACY_BACKEND_ORIGIN__}/api/v1/taxi/admin/users/${id}/subscriptions`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const subscriptionData = await subscriptionRes.json();
      if (subscriptionData.success) {
        setSubscriptions(Array.isArray(subscriptionData.data?.results) ? subscriptionData.data.results : []);
      }

      // Fetch Requests
      const reqRes = await fetch(`${globalThis.__LEGACY_BACKEND_ORIGIN__}/api/v1/taxi/admin/users/${id}/requests`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const reqData = await reqRes.json();
      if (reqData.success) {
        const mappedRequests = (reqData.data?.results || []).map(r => ({
          id: r.request_id || 'N/A',
          date: r.trip_start_time ? new Date(r.trip_start_time).toLocaleDateString() : 'N/A',
          user: userData.data?.name || 'User',
          driver: r.driver_id?.name || 'Pending',
          status: r.is_completed ? 'Completed' : r.is_cancelled ? 'Cancelled' : 'Ongoing',
          paid: r.is_paid ? 'Paid' : 'Not Paid',
          payment: r.payment_type || 'CASH'
        }));
        setRequests(mappedRequests);
        
        // Update stats
        if (userData.success) {
          setUser(prev => ({
            ...prev,
            stats: {
              completed: mappedRequests.filter(r => r.status === 'Completed').length,
              cancelled: mappedRequests.filter(r => r.status === 'Cancelled').length,
              upcoming: mappedRequests.filter(r => r.status === 'Ongoing').length
            }
          }));
        }
      }

      // Fetch Wallet History
      const walletRes = await fetch(`${globalThis.__LEGACY_BACKEND_ORIGIN__}/api/v1/taxi/admin/users/${id}/wallet-history`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const walletData = await walletRes.json();
      if (walletData.success) {
        const history = (walletData.data?.results || []).map(w => {
          // Determine type from transaction_alias or amount sign
          const isCredit = w.transaction_alias === 'ADMIN_CREDIT' || w.amount > 0;
          return {
            id: w._id,
            amount: Math.abs(w.amount), // Use absolute for display but sign for logic
            type: isCredit ? 'credit' : 'debit',
            remarks: w.remarks || (isCredit ? 'Credit Adjustment' : 'Debit Adjustment'),
            date: w.createdAt ? new Date(w.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'N/A'
          };
        });
        setWalletHistory(history);
        
        // Calculate dynamic stats from history
        const totalCredit = history.filter(h => h.type === 'credit').reduce((sum, h) => sum + h.amount, 0);
        const totalDebit = history.filter(h => h.type === 'debit').reduce((sum, h) => sum + h.amount, 0);
        
        setUser(prev => ({
          ...prev,
          wallet: {
            total: totalCredit,
            spend: totalDebit,
            balance: totalCredit - totalDebit
          }
        }));
      }

    } catch (err) {
      setError('Failed to load user details');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [id, token]);

  const handleWalletAction = async () => {
    if (!walletAmount || isSubmitting) return;
    try {
      setIsSubmitting(true);
      const res = await fetch(`${globalThis.__LEGACY_BACKEND_ORIGIN__}/api/v1/taxi/admin/wallet/users/${id}/adjust`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          amount: parseFloat(walletAmount),
          payment_type: walletType,
          remarks: `Admin ${walletType} action`
        })
      });
      
      const data = await res.json();
      if (data.success) {
        setWalletModalOpen(false);
        setWalletAmount('');
        // Refresh data to show new balance and history
        fetchData();
      } else {
        alert(data.message || 'Failed to adjust wallet');
      }
    } catch (err) {
      console.error(err);
      alert('Network error');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[600px] gap-4">
         <div className="w-12 h-12 border-4 border-gray-100 border-t-indigo-600 rounded-full animate-spin"></div>
         <p className="text-[12px] font-black text-gray-400 uppercase tracking-widest">Loading Profile...</p>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[600px] gap-4">
         <div className="w-16 h-16 bg-rose-50 rounded-full flex items-center justify-center text-rose-500">
            <AlertCircle size={32} />
         </div>
         <p className="text-lg font-black text-gray-900 uppercase">{error || 'User not found'}</p>
         <button onClick={() => navigate('/taxi/admin/users')} className="px-6 py-2 bg-black text-white rounded-xl text-[12px] font-black uppercase tracking-widest">Go Back</button>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-700 text-gray-950 font-sans">
      {/* HEADER & BREADCRUMBS */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => navigate('/taxi/admin/users')}
            className="p-2 hover:bg-white rounded-xl border border-transparent hover:border-gray-100 transition-all text-gray-400 hover:text-gray-900"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-xl font-black tracking-tight text-gray-900 uppercase">USER PROFILE</h1>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11px] font-bold text-gray-400 uppercase tracking-widest">
          Users <ChevronRight size={12} className="opacity-50" /> <span className="text-gray-900">User Profile</span>
        </div>
      </div>

      {/* USER INFO CARD */}
      <div className="bg-white rounded-[32px] border border-gray-100 shadow-sm p-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-8">
          <div className="flex items-center gap-6">
            <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-white text-3xl font-black shadow-xl ring-4 ring-white uppercase">
              {user.avatar}
            </div>
            <div>
              <h2 className="text-2xl font-black text-gray-900 tracking-tight">{user.name}</h2>
              <div className="mt-2 space-y-1.5">
                <div className="flex items-center gap-2 text-[13px] font-bold text-gray-400">
                  <Phone size={14} className="text-indigo-500" /> {user.phone}
                </div>
                <div className="flex items-center gap-2 text-[13px] font-bold text-gray-400">
                  <Mail size={14} className="text-indigo-500" /> {user.email}
                </div>
                <div className="flex items-center gap-2 text-[13px] font-bold text-gray-400">
                  <Clock size={14} className="text-indigo-500" /> Joined {user.joined}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* TABS HEADER */}
        <div className="mt-12 flex gap-1 bg-gray-50/50 p-1 rounded-2xl border border-gray-100 w-fit">
          {['Request List', 'User Payment History', 'Review History', 'Subscriptions'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-6 py-2.5 rounded-xl text-[12px] font-black uppercase tracking-widest transition-all ${
                activeTab === tab 
                  ? 'bg-white text-gray-950 shadow-sm border border-gray-100' 
                  : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* TAB CONTENT */}
      <div className="bg-white rounded-[32px] border border-gray-100 shadow-sm p-8 min-h-[500px]">
        {activeTab === 'Request List' && (
          <div className="space-y-8 animate-in fade-in duration-500">
            {/* STAT CARDS */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                { label: 'Completed Rides', val: user.stats.completed, icon: Car, color: 'emerald' },
                { label: 'Cancelled Rides', val: user.stats.cancelled, icon: AlertCircle, color: 'rose' },
                { label: 'Upcoming Rides', val: user.stats.upcoming, icon: Clock, color: 'indigo' }
              ].map((s, i) => (
                <div key={i} className={`bg-gray-50/30 p-6 rounded-2xl border border-gray-100 flex items-center justify-between group hover:bg-white transition-all hover:shadow-md`}>
                  <div>
                    <p className="text-[12px] font-bold text-gray-400 mb-2">{s.label}</p>
                    <p className="text-3xl font-black text-gray-900 leading-none">{s.val}</p>
                  </div>
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                    s.color === 'emerald' ? 'bg-emerald-50 text-emerald-500' : 
                    s.color === 'rose' ? 'bg-rose-50 text-rose-500' : 
                    'bg-indigo-50 text-indigo-500'
                  }`}>
                    <s.icon size={20} />
                  </div>
                </div>
              ))}
            </div>

            {/* TABLE CONTROLS */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[12px] font-bold text-gray-500">
                show 
                <select className="bg-gray-50 border border-gray-100 rounded-lg px-2 py-1 outline-none text-gray-900">
                  <option>15</option>
                  <option>30</option>
                  <option>50</option>
                </select>
                entries
              </div>
              <button className="flex items-center gap-2 bg-rose-500 text-white px-4 py-2 rounded-xl text-[12px] font-black uppercase tracking-widest hover:opacity-90 transition-all shadow-md">
                <Filter size={14} /> Filters
              </button>
            </div>

            {/* TABLE */}
            <div className="overflow-x-auto no-scrollbar">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-gray-50/50 text-[11px] font-black text-gray-400 uppercase tracking-widest">
                    <th className="px-5 py-4 first:rounded-l-xl">Request Id</th>
                    <th className="px-5 py-4">Date</th>
                    <th className="px-5 py-4">User Name</th>
                    <th className="px-5 py-4">Driver Name</th>
                    <th className="px-5 py-4">Trip Status</th>
                    <th className="px-5 py-4">Paid</th>
                    <th className="px-5 py-4 last:rounded-r-xl">Payment Option</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {requests.length > 0 ? requests.map((r, i) => (
                    <tr key={i} className="group hover:bg-gray-50/30 transition-all">
                      <td className="px-5 py-4 text-[12px] font-bold text-gray-500">#{r.id.slice(-8).toUpperCase()}</td>
                      <td className="px-5 py-4 text-[12px] font-bold text-gray-500">{r.date}</td>
                      <td className="px-5 py-4 text-[13px] font-bold text-gray-900">{r.user}</td>
                      <td className="px-5 py-4 text-[13px] font-bold text-gray-900">{r.driver}</td>
                      <td className="px-5 py-4">
                        <span className={`text-[12px] font-bold ${
                          r.status === 'Completed' ? 'text-emerald-500' : 
                          r.status === 'Cancelled' ? 'text-rose-500' : 'text-amber-500'
                        }`}>{r.status}</span>
                      </td>
                      <td className="px-5 py-4 text-[12px] font-bold text-gray-500">{r.paid}</td>
                      <td className="px-5 py-4">
                        <span className={`px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest ${r.payment === 'CASH' ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700'}`}>
                          {r.payment}
                        </span>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan="7" className="px-5 py-12 text-center text-gray-400 font-bold uppercase tracking-widest text-[12px]">No requests found for this user</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* PAGINATION */}
            <div className="flex items-center justify-between pt-4 border-t border-gray-50">
              <p className="text-[12px] font-bold text-gray-400 uppercase tracking-widest">Showing 1 to {requests.length} of {requests.length} entries</p>
              <div className="flex items-center gap-1">
                <button className="px-3 py-1.5 rounded-lg text-[11px] font-black text-gray-400 hover:bg-gray-50">Prev</button>
                <button className="w-8 h-8 rounded-lg bg-indigo-600 text-white text-[11px] font-black">1</button>
                <button className="px-3 py-1.5 rounded-lg text-[11px] font-black text-gray-400 hover:bg-gray-50">Next</button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'User Payment History' && (
          <div className="space-y-8 animate-in fade-in duration-500">
            {/* PAYMENT SUMMARY */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                { label: 'Total Wallet Balance', val: user.wallet.total, icon: WalletIcon, color: 'blue' },
                { label: 'Spend Amount', val: user.wallet.spend, icon: TrendingUp, color: 'rose' },
                { label: 'Available Balance', val: user.wallet.balance, icon: WalletIcon, color: 'emerald' }
              ].map((s, i) => (
                <div key={i} className="bg-gray-50/30 p-8 rounded-3xl border border-gray-100 relative overflow-hidden group">
                  <div className={`absolute top-0 right-0 p-4 opacity-5 text-${s.color}-500 transform translate-x-2 -translate-y-2 group-hover:translate-x-0 group-hover:translate-y-0 transition-transform`}>
                    <s.icon size={80} strokeWidth={1} />
                  </div>
                  <div className="relative z-10 flex flex-col justify-center h-full">
                    <p className="text-[11px] font-black text-gray-400 uppercase tracking-widest mb-3">{s.label}</p>
                    <p className="text-3xl font-black text-gray-900 tracking-tighter">? {s.val.toFixed(2)}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* ACTION BUTTONS */}
            <div className="flex gap-4">
              <button 
                onClick={() => { setWalletType('credit'); setWalletModalOpen(true); }}
                className="flex-1 py-4 bg-emerald-500 text-white rounded-2xl text-[12px] font-black uppercase tracking-widest hover:opacity-90 transition-all shadow-lg flex items-center justify-center gap-2"
              >
                <Plus size={16} /> Credit Amount
              </button>
              <button 
                onClick={() => { setWalletType('debit'); setWalletModalOpen(true); }}
                className="flex-1 py-4 bg-rose-500 text-white rounded-2xl text-[12px] font-black uppercase tracking-widest hover:opacity-90 transition-all shadow-lg flex items-center justify-center gap-2"
              >
                <Minus size={16} /> Debit Amount
              </button>
            </div>

            {/* TRANSACTION LOGS */}
            <div className="space-y-4">
              <h3 className="text-[14px] font-black text-gray-900 uppercase tracking-widest">Recent Transactions</h3>
              <div className="space-y-3">
                {walletHistory.length > 0 ? (
                  walletHistory.map((tr, i) => (
                    <div key={i} className="bg-gray-50/30 rounded-2xl border border-gray-100 p-4 flex items-center justify-between hover:bg-white transition-all shadow-sm">
                      <div className="flex items-center gap-4">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${tr.type === 'credit' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                          {tr.type === 'credit' ? <ArrowUpRight size={18} /> : <ArrowDownRight size={18} />}
                        </div>
                        <div>
                          <p className="text-[13px] font-black text-gray-900 leading-none capitalize">{tr.remarks}</p>
                          <p className="text-[10px] font-bold text-gray-400 mt-1 uppercase">{tr.date}</p>
                        </div>
                      </div>
                      <p className={`text-[15px] font-black tracking-tight ${tr.type === 'credit' ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {tr.type === 'credit' ? '+' : '-'} ?{parseFloat(tr.amount).toFixed(2)}
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="bg-gray-50/30 rounded-2xl border border-gray-100 p-12 flex flex-col items-center justify-center text-center">
                    <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center text-gray-300 mb-4 border border-gray-100">
                      <HistoryIcon size={32} />
                    </div>
                    <p className="text-[12px] font-bold text-gray-400 uppercase tracking-widest">No recent wallet transactions found</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'Review History' && (
          <div className="space-y-6 animate-in fade-in duration-500">
             <div className="flex items-center justify-between mb-2">
                <h3 className="text-[14px] font-black text-gray-900 uppercase tracking-widest">Captain Reviews</h3>
                <div className="flex items-center gap-1 px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full text-[11px] font-black">
                   <Star size={12} className="fill-emerald-500" /> {(reviews.reduce((acc, curr) => acc + curr.rating, 0) / (reviews.length || 1)).toFixed(1)} Avg Rating
                </div>
             </div>

             <div className="space-y-4">
                {reviews.length > 0 ? (
                  reviews.map((rev, i) => (
                    <div key={rev._id || i} className="bg-white rounded-3xl border border-gray-100 p-6 flex items-start gap-5 hover:border-gray-200 transition-all shadow-sm group">
                       <div className="w-14 h-14 rounded-2xl bg-amber-50 flex items-center justify-center text-amber-600 border border-amber-100 flex-shrink-0 group-hover:scale-105 transition-transform">
                          <Star size={24} className="fill-amber-500" />
                       </div>
                       <div className="flex-1">
                          <div className="flex items-center justify-between mb-2">
                             <div className="flex items-center gap-2">
                                {[...Array(5)].map((_, starIdx) => (
                                  <Star 
                                    key={starIdx} 
                                    size={14} 
                                    className={starIdx < rev.rating ? 'fill-amber-500 text-amber-500' : 'text-gray-200'}
                                  />
                                ))}
                             </div>
                             <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest italic">{rev.createdAt ? new Date(rev.createdAt).toLocaleDateString() : 'N/A'}</span>
                          </div>
                          <p className="text-[14px] font-bold text-gray-900 mb-2 italic">"{rev.comment || 'No comment provided'}"</p>
                          <div className="flex items-center gap-2">
                             <div className="w-4 h-4 rounded-full bg-gray-100 flex items-center justify-center text-[8px] font-black">{rev.driver_id?.name?.charAt(0) || 'C'}</div>
                             <p className="text-[11px] font-black text-gray-400 uppercase tracking-widest">Captain {rev.driver_id?.name || 'Unknown'}</p>
                          </div>
                       </div>
                    </div>
                  ))
                ) : (
                  <div className="p-12 bg-gray-50/30 rounded-3xl border border-gray-100 flex flex-col items-center justify-center text-center">
                    <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center text-gray-300 mb-4 border border-gray-100">
                      <Star size={32} />
                    </div>
                    <p className="text-[12px] font-bold text-gray-400 uppercase tracking-widest">No reviews found for this user</p>
                  </div>
                )}
             </div>
          </div>
        )}

        {activeTab === 'Subscriptions' && (
          <div className="space-y-6 animate-in fade-in duration-500">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-gray-50/30 p-6 rounded-2xl border border-gray-100">
                <p className="text-[12px] font-bold text-gray-400 mb-2">Active Plans</p>
                <p className="text-3xl font-black text-gray-900">{subscriptions.filter((item) => item.active && item.status === 'active').length}</p>
              </div>
              <div className="bg-gray-50/30 p-6 rounded-2xl border border-gray-100">
                <p className="text-[12px] font-bold text-gray-400 mb-2">Unlimited Plans</p>
                <p className="text-3xl font-black text-gray-900">{subscriptions.filter((item) => item.benefit_type === 'unlimited' && item.active).length}</p>
              </div>
              <div className="bg-gray-50/30 p-6 rounded-2xl border border-gray-100">
                <p className="text-[12px] font-bold text-gray-400 mb-2">Limited Ride Credits</p>
                <p className="text-3xl font-black text-gray-900">
                  {subscriptions
                    .filter((item) => item.active && item.benefit_type !== 'unlimited')
                    .reduce((sum, item) => sum + Number(item.rides_remaining || 0), 0)}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              {subscriptions.length > 0 ? subscriptions.map((item) => (
                <div key={item.id} className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[15px] font-black text-gray-900">{item.name}</p>
                      <p className="mt-1 text-[12px] font-bold text-gray-400">{item.vehicle_type?.name || 'Vehicle plan'} • {item.transport_type}</p>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${item.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                      {item.status}
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3 text-[12px] font-bold text-gray-500">
                    <div>Price: <span className="text-gray-900">?{Number(item.amount || 0).toFixed(2)}</span></div>
                    <div>Benefit: <span className="text-gray-900">{item.benefit_type === 'unlimited' ? 'Unlimited rides' : `${item.ride_limit} rides`}</span></div>
                    <div>Used: <span className="text-gray-900">{item.rides_used}</span></div>
                    <div>Remaining: <span className="text-gray-900">{item.rides_remaining === null ? 'Unlimited' : item.rides_remaining}</span></div>
                  </div>
                  <div className="mt-3 text-[11px] font-bold text-gray-400 uppercase tracking-widest">
                    Expires {item.expiresAt ? new Date(item.expiresAt).toLocaleDateString('en-IN') : 'Never'}
                  </div>
                </div>
              )) : (
                <div className="p-12 bg-gray-50/30 rounded-3xl border border-gray-100 flex flex-col items-center justify-center text-center">
                  <p className="text-[12px] font-bold text-gray-400 uppercase tracking-widest">No subscriptions found for this user</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* WALLET MODAL */}
      {isWalletModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-[32px] w-full max-w-sm shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
             <div className="p-8 space-y-6">
                <div className="flex items-center justify-between">
                   <h3 className="text-xl font-black text-gray-950 uppercase tracking-tight">
                      {walletType === 'credit' ? 'Credit Balance' : 'Debit Balance'}
                   </h3>
                   <button onClick={() => setWalletModalOpen(false)} className="text-gray-400 hover:text-gray-900 border border-gray-100 rounded-xl p-1">
                      <X size={18} />
                   </button>
                </div>

                <div>
                   <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block px-1">Amount to {walletType}</label>
                   <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl font-black text-gray-300 pointer-events-none">?</span>
                      <input 
                        type="number" 
                        value={walletAmount}
                        onChange={(e) => setWalletAmount(e.target.value)}
                        placeholder="0.00"
                        className="w-full h-16 pl-10 pr-4 bg-gray-50 border border-gray-100 rounded-2xl text-2xl font-black outline-none focus:bg-white focus:border-indigo-200 transition-all"
                      />
                   </div>
                </div>

                <div className="flex flex-col gap-3 pt-2">
                   <button 
                     onClick={handleWalletAction}
                     disabled={isSubmitting}
                     className={`w-full py-4 rounded-2xl text-[12px] font-black uppercase tracking-widest transition-all shadow-xl flex items-center justify-center gap-2 ${
                       walletType === 'credit' ? 'bg-emerald-500 text-white hover:bg-emerald-600' : 'bg-rose-500 text-white hover:bg-rose-600'
                     } disabled:opacity-50`}
                   >
                     {isSubmitting ? <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin"></div> : `Confirm ${walletType}`}
                   </button>
                </div>
             </div>
          </div>
        </div>
      )}

      {/* BACK BUTTON */}
      <button 
         onClick={() => navigate('/taxi/admin/users')}
         className="fixed bottom-10 right-10 w-14 h-14 bg-black text-white rounded-2xl shadow-2xl flex items-center justify-center hover:scale-110 active:scale-95 transition-all group z-50">
         <ArrowLeft size={24} />
      </button>

    </div>
  );
};

const IndianRupeeIcon = ({ size, className }) => <span className={className} style={{fontSize: size}}>?</span>;
const WalletIcon = ({ size, className }) => <CreditCard size={size} className={className} />;

export default UserDetails;


