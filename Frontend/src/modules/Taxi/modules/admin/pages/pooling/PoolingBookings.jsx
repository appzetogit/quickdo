import React, { useEffect, useState } from 'react';
import {
  CalendarDays,
  Search,
  ChevronRight,
  MoreVertical,
  User,
  MapPin,
  Clock,
  IndianRupee,
  CheckCircle2,
  XCircle,
  AlertCircle
} from 'lucide-react';
import { adminService } from '../../services/adminService';
import toast from 'react-hot-toast';

const PoolingBookings = () => {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const loadBookings = async () => {
    setLoading(true);
    try {
      const response = await adminService.getPoolingBookings();
      setBookings(response.data || []);
    } catch (error) {
      toast.error('Failed to load pooling bookings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBookings();
  }, []);

  const handleStatusChange = async (id, status) => {
    try {
      await adminService.updatePoolingBookingStatus(id, status);
      toast.success(`Booking ${status} successfully`);
      loadBookings();
    } catch (error) {
      toast.error('Failed to update booking status');
    }
  };

  const filteredBookings = bookings.filter(b => 
    b.bookingId?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    b.user?.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    b.route?.routeName?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusStyle = (status) => {
    switch (status) {
      case 'confirmed': return 'bg-emerald-50 text-emerald-600 border-emerald-100';
      case 'completed': return 'bg-indigo-50 text-indigo-600 border-indigo-100';
      case 'cancelled': return 'bg-rose-50 text-rose-600 border-rose-100';
      default: return 'bg-slate-50 text-slate-600 border-slate-100';
    }
  };

  return (
    <div className="min-h-screen bg-slate-50/50 p-6 lg:p-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">
          <span>Car Pooling</span>
          <ChevronRight size={12} />
          <span className="text-indigo-600">Bookings</span>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-black text-slate-900">Pooling Bookings</h1>
            <p className="text-sm font-medium text-slate-500">Monitor and manage all car pooling reservations</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadBookings}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-600 transition hover:bg-slate-50"
            >
              Refresh Data
            </button>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="Search by ID, User, or Route..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-12 pr-4 text-sm font-medium outline-none transition-all focus:border-indigo-500 focus:ring-4 focus:ring-indigo-50"
          />
        </div>
      </div>

      {/* Bookings Table */}
      <div className="overflow-hidden rounded-[32px] border border-slate-100 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-50 bg-slate-50/30">
                <th className="px-6 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Booking ID</th>
                <th className="px-6 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Customer</th>
                <th className="px-6 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Route & Date</th>
                <th className="px-6 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Details</th>
                <th className="px-6 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Fare</th>
                <th className="px-6 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Status</th>
                <th className="px-6 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? (
                <tr>
                  <td colSpan="7" className="px-6 py-12 text-center">
                    <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent"></div>
                  </td>
                </tr>
              ) : filteredBookings.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-6 py-20 text-center">
                    <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-slate-50 text-slate-300">
                      <CalendarDays size={32} />
                    </div>
                    <p className="text-sm font-black text-slate-900 uppercase tracking-tight">No Bookings Found</p>
                    <p className="mt-1 text-xs font-medium text-slate-400">Your car pooling booking requests will appear here.</p>
                  </td>
                </tr>
              ) : (
                filteredBookings.map((booking) => (
                  <tr key={booking._id} className="group transition hover:bg-slate-50/50">
                    <td className="px-6 py-5">
                      <span className="text-xs font-black text-indigo-600 uppercase">#{booking.bookingId || booking._id.slice(-8)}</span>
                    </td>
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 font-bold text-xs">
                          {booking.user?.name?.charAt(0) || 'U'}
                        </div>
                        <div>
                          <p className="text-sm font-black text-slate-900">{booking.user?.name || 'Unknown'}</p>
                          <p className="text-[11px] font-bold text-slate-400">{booking.user?.phone || 'No phone'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <div className="flex items-start gap-2">
                        <MapPin size={14} className="mt-0.5 text-slate-400" />
                        <div>
                          <p className="text-sm font-bold text-slate-900">{booking.route?.routeName || 'N/A'}</p>
                          <p className="text-[11px] font-medium text-slate-500">
                            {new Date(booking.travelDate).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600">
                          <Clock size={12} />
                          <span>{booking.scheduleId || 'Standard'}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600">
                          <User size={12} />
                          <span>{booking.seatsBooked} Seats</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-1 font-black text-slate-900">
                        <IndianRupee size={12} className="text-slate-400" />
                        <span>{booking.fare}</span>
                      </div>
                      <p className={`text-[10px] font-black uppercase tracking-wide ${
                        booking.paymentStatus === 'paid' ? 'text-emerald-500' : 'text-amber-500'
                      }`}>
                        {booking.paymentStatus}
                      </p>
                    </td>
                    <td className="px-6 py-5">
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${getStatusStyle(booking.bookingStatus)}`}>
                        {booking.bookingStatus}
                      </span>
                    </td>
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                        {booking.bookingStatus === 'confirmed' && (
                          <>
                            <button 
                              onClick={() => handleStatusChange(booking._id, 'completed')}
                              className="rounded-lg bg-emerald-50 p-2 text-emerald-600 transition hover:bg-emerald-600 hover:text-white"
                              title="Complete Booking"
                            >
                              <CheckCircle2 size={16} />
                            </button>
                            <button 
                              onClick={() => handleStatusChange(booking._id, 'cancelled')}
                              className="rounded-lg bg-rose-50 p-2 text-rose-600 transition hover:bg-rose-600 hover:text-white"
                              title="Cancel Booking"
                            >
                              <XCircle size={16} />
                            </button>
                          </>
                        )}
                        <button className="rounded-lg bg-slate-50 p-2 text-slate-400 transition hover:bg-slate-200">
                          <MoreVertical size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default PoolingBookings;
