import React, { useState, useEffect } from 'react';
import {
  ChevronRight,
  CheckCircle2,
  Edit2,
  Eye,
  FileText,
  Filter,
  Key,
  Lock,
  MoreVertical,
  Plus,
  Search,
  Star,
  Trash2,
  XCircle,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { adminService } from '../../services/adminService';
import { adminAPI } from '@food/api';
import { useDriverPaths } from './driverPaths';

const ACTION_MENU_WIDTH = 238;
const ACTION_MENU_GAP = 8;
const ACTION_MENU_MAX_HEIGHT = 300;

const PendingDrivers = () => {
  const navigate = useNavigate();
  const driverPaths = useDriverPaths();
  const [searchTerm, setSearchTerm] = useState('');
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingDrivers, setPendingDrivers] = useState([]);
  const [error, setError] = useState('');
  const [activeMenu, setActiveMenu] = useState(null);
  const [menuPosition, setMenuPosition] = useState(null);
  const [passwordModal, setPasswordModal] = useState({ isOpen: false, driverId: null, password: '', isSubmitting: false });
  const [page, setPage] = useState(1);
  const [paginator, setPaginator] = useState(null);
  /*
   * Riders who signed up in the delivery app. They are food delivery partners
   * until approved -- the unified taxi driver is created on approval (see
   * ensureUnifiedDriverForPartner) -- so this taxi list never shows them, and an
   * admin looking here sees "no pending drivers" while one is waiting. Listed
   * as a pointer to where they are approved, not approved from here: approving
   * the taxi half alone would leave the food half pending and the rider would
   * never be offered an order.
   */
  const [pendingRiders, setPendingRiders] = useState([]);

  useEffect(() => {
    let cancelled = false;
    adminAPI
      .getDeliveryPartnerJoinRequests({ status: 'pending', limit: 50 })
      .then((res) => {
        const rows = res?.data?.data?.requests || res?.data?.requests || [];
        if (!cancelled) setPendingRiders(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const openActionMenu = (driverId, anchorEl) => {
    const rect = anchorEl.getBoundingClientRect();
    const viewportPadding = 12;
    const menuHeight = ACTION_MENU_MAX_HEIGHT;
    const spaceBelow = window.innerHeight - rect.bottom - ACTION_MENU_GAP;
    const spaceAbove = rect.top - ACTION_MENU_GAP;
    const openUp = spaceBelow < 220 && spaceAbove > spaceBelow;

    const left = Math.min(
      Math.max(viewportPadding, rect.right - ACTION_MENU_WIDTH),
      window.innerWidth - ACTION_MENU_WIDTH - viewportPadding,
    );

    const position = {
      left,
      ...(openUp
        ? {
            bottom: Math.max(viewportPadding, window.innerHeight - rect.top + ACTION_MENU_GAP),
          }
        : {
            top: Math.min(
              rect.bottom + ACTION_MENU_GAP,
              window.innerHeight - menuHeight - viewportPadding,
            ),
          }),
    };

    setMenuPosition(position);
    setActiveMenu(driverId);
  };

  const closeMenu = () => {
    setActiveMenu(null);
    setMenuPosition(null);
  };

  const handleAction = async (action, driverId) => {
    const confirmMsg = action === 'delete' ? 'Are you sure you want to delete this pending request?' : 'Are you sure you want to APPROVE this driver?';
    if (action !== 'view' && action !== 'edit' && action !== 'password' && !window.confirm(confirmMsg)) return;

    if (action === 'view') {
      navigate(`${driverPaths.drivers}/${driverId}`, { state: { from: `${driverPaths.drivers}/pending` } });
      return;
    }
    if (action === 'edit') {
      navigate(`${driverPaths.drivers}/edit/${driverId}`, { state: { from: `${driverPaths.drivers}/pending` } });
      return;
    }

    try {
      if (action === 'password') {
        setPasswordModal(prev => ({ ...prev, isSubmitting: true }));
      }

      if (action === 'approve') {
        await adminService.updateDriverStatus(driverId, { approve: true, status: 'approved' });
      } else if (action === 'delete') {
        await adminService.deleteDriver(driverId);
      } else if (action === 'password') {
        await adminService.updateDriverPassword(driverId, passwordModal.password);
      }

      if (action !== 'view' && action !== 'edit') {
        alert(`${action.charAt(0).toUpperCase() + action.slice(1)} successful`);
        if (action === 'password') {
          setPasswordModal({ isOpen: false, driverId: null, password: '', isSubmitting: false });
        }
        if (action === 'delete' || action === 'approve') {
          await fetchPendingDrivers();
        }
      }
    } catch (err) {
      alert(err?.message || `Network error during ${action}`);
      if (action === 'password') setPasswordModal(prev => ({ ...prev, isSubmitting: false }));
    } finally {
      closeMenu();
    }
  };

  const isDriverApproved = (driver) => {
    if (!driver) return false;

    const approveRaw = driver.approve ?? '';
    const approveNormalized = String(approveRaw).toLowerCase();
    const status = String(driver.status || '').toLowerCase();

    return (
      approveRaw === true ||
      approveRaw === 1 ||
      ['true', '1', 'yes', 'approved'].includes(approveNormalized) ||
      ['approved', 'active', 'verified'].includes(status)
    );
  };

  const fetchPendingDrivers = async ({ nextPage = page, nextLimit = itemsPerPage, nextSearch = searchTerm } = {}) => {
    setIsLoading(true);
    setError('');
    try {
      const responseData = await adminService.getDrivers(nextPage, nextLimit, {
        approve: false,
        search: String(nextSearch || '').trim(),
      });
      const driversList = responseData.data?.results || [];
      
      const pending = driversList
        .filter((d) => String(d?.onboarding_role || '').toLowerCase() !== 'owner')
        .map((d) => ({
          id: d._id,
          name: d.name || 'Unknown',
          serviceLocation: d.service_location_name || d.city || 'India',
          phone: d.phone || d.mobile || 'N/A',
          transport: d.transport_type || d.register_for || d.transport_type || 'N/A',
          docs: 'View Docs',
          status: (String(d.status || '').toUpperCase() || 'PENDING'),
          reason: d.rejectionReason || d.rejected_reason || '-',
          rating: d.rating || 0.0,
          registeredAt: d.createdAt || null,
        }));

      setPendingDrivers(pending);
      setPaginator(responseData.data?.paginator || null);
    } catch (err) {
      setError(err?.message || 'Failed to fetch pending drivers');
    } finally {
      setIsLoading(false);
    }
  };


  useEffect(() => {
    fetchPendingDrivers({ nextPage: 1, nextLimit: itemsPerPage, nextSearch: searchTerm });
    setPage(1);
  }, [itemsPerPage]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      fetchPendingDrivers({ nextPage: 1, nextLimit: itemsPerPage, nextSearch: searchTerm });
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [searchTerm]);

  useEffect(() => {
    fetchPendingDrivers({ nextPage: page, nextLimit: itemsPerPage, nextSearch: searchTerm });
  }, [page]);

  useEffect(() => {
    if (!activeMenu) return undefined;

    const handleOutsideMotion = () => closeMenu();
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') closeMenu();
    };

    window.addEventListener('scroll', handleOutsideMotion, true);
    window.addEventListener('resize', handleOutsideMotion);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('scroll', handleOutsideMotion, true);
      window.removeEventListener('resize', handleOutsideMotion);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeMenu]);

  const formatDate = (value) => {
    if (!value) return 'N/A';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'N/A';
    return date.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const inputClass = "w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm text-gray-800 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-colors";
  const labelClass = "block text-xs font-semibold text-gray-500 mb-1.5";
  const totalPages = Math.max(1, Number(paginator?.last_page || 1));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const totalEntries = Number(paginator?.total || 0);
  const perPage = Number(paginator?.per_page || itemsPerPage);
  const startIndex = (safePage - 1) * perPage;
  const showingFrom = totalEntries === 0 ? 0 : startIndex + 1;
  const showingTo = totalEntries === 0 ? 0 : Math.min(startIndex + pendingDrivers.length, totalEntries);

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-8 font-sans text-gray-900">
      {error && (
        <div className="mb-4 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600">
          {error}
        </div>
      )}
      
      <div className="mb-6">
        <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
          <span>Drivers</span>
          <ChevronRight size={12} />
          <span className="text-gray-700">Pending Drivers</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-semibold text-gray-900">Pending Drivers</h1>
          <button
            onClick={() => navigate(`${driverPaths.drivers}/create`)}
            className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors"
          >
            <Plus size={16} /> Add Drivers
          </button>
        </div>
      </div>

      {pendingRiders.length > 0 && (
        <div className="mb-6 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 md:flex-row md:items-center md:justify-between">
          <div className="text-sm text-amber-900">
            <p className="font-semibold">
              {pendingRiders.length} delivery rider {pendingRiders.length === 1 ? 'application is' : 'applications are'} waiting for approval
            </p>
            <p className="mt-0.5 text-amber-800">
              {pendingRiders.slice(0, 3).map((r) => r.name || r.phone).filter(Boolean).join(', ')}
              {pendingRiders.length > 3 ? ` and ${pendingRiders.length - 3} more` : ''} signed up in the delivery app. Approve
              them under Food &rsaquo; Delivery Partners; they appear here once approved.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/admin/food/delivery-partners/join-request')}
            className="shrink-0 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700"
          >
            Review rider applications
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-4 items-end">
          <div>
            <label className={labelClass}>
              <Search size={12} className="inline mr-1 text-gray-400" />
              Search
            </label>
            <input
              className={inputClass}
              placeholder="Search by name, phone, or location"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className={labelClass}>Show</label>
            <select
              value={itemsPerPage}
              onChange={(e) => setItemsPerPage(parseInt(e.target.value, 10))}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-colors"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
          </div>
          <button className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-primary-orange/50 rounded-lg hover:bg-accent-orange transition-colors">
            <Filter size={16} /> Filters
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-visible">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-500">
                <th className="px-6 py-4">Name</th>
                <th className="px-4 py-4">Service Location</th>
                <th className="px-4 py-4">Mobile Number</th>
                <th className="px-4 py-4">Transport Type</th>
                <th className="px-4 py-4 text-center">Document View</th>
                <th className="px-4 py-4 text-center">Approved Status</th>
                <th className="px-4 py-4 text-center">Declined Reason</th>
                <th className="px-4 py-4 text-center">Rating</th>
                <th className="px-4 py-4 text-center">Registered at</th>
                <th className="px-6 py-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-sm text-gray-700">
              {isLoading ? (
                <tr>
                  <td colSpan="10" className="px-6 py-12 text-center text-gray-400">Loading pending drivers...</td>
                </tr>
              ) : pendingDrivers.length === 0 ? (
                <tr>
                  <td colSpan="10" className="px-6 py-12 text-center text-gray-400">No pending drivers found.</td>
                </tr>
              ) : (
                pendingDrivers.map((driver) => (
                  <tr key={driver.id} className="hover:bg-gray-50/60 transition-colors">
                    <td className="px-6 py-4 text-gray-900">{driver.name}</td>
                    <td className="px-4 py-4">{driver.serviceLocation}</td>
                    <td className="px-4 py-4 font-medium text-gray-800">{driver.phone}</td>
                    <td className="px-4 py-4">{driver.transport}</td>
                    <td className="px-4 py-4 text-center">
                      <button
                        onClick={() => navigate(`${driverPaths.drivers}/${driver.id}?tab=Documents`, { state: { from: `${driverPaths.drivers}/pending` } })}
                        className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-gray-200 text-indigo-600 hover:bg-indigo-50 transition-colors"
                      >
                        <FileText size={16} />
                      </button>
                    </td>
                    <td className="px-4 py-4 text-center">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-100 text-rose-600">
                        {driver.status || 'PENDING'}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-center text-gray-400 italic">{driver.reason}</td>
                    <td className="px-4 py-4 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {[1, 2, 3, 4, 5].map((i) => (
                          <Star
                            key={i}
                            size={14}
                            className={i <= Math.round(driver.rating || 0) ? 'text-yellow-400' : 'text-gray-300'}
                          />
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-center text-gray-600">{formatDate(driver.registeredAt)}</td>
                    <td className="px-6 py-4 text-right">
                      <div className="relative inline-block">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (activeMenu === driver.id) {
                              closeMenu();
                              return;
                            }
                            openActionMenu(driver.id, e.currentTarget);
                          }}
                          className="w-9 h-9 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                        >
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

        <div className="p-4 flex items-center justify-between text-xs text-gray-500 border-t border-gray-100 bg-gray-50/50">
          <span>Showing {showingFrom} to {showingTo} of {totalEntries} entries</span>
          <div className="flex items-center gap-2">
            <button
              className="px-3 py-1.5 text-xs font-semibold text-gray-500 hover:text-gray-900 disabled:opacity-60"
              disabled={safePage <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Prev
            </button>
            <button className="px-3 py-1.5 rounded-md bg-indigo-600 text-white text-xs font-semibold">{safePage}</button>
            <button
              className="px-3 py-1.5 text-xs font-semibold text-gray-500 hover:text-gray-900 disabled:opacity-60"
              disabled={safePage >= totalPages}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* PASSWORD MODAL */}
      <AnimatePresence>
        {passwordModal.isOpen && (
          <div className="fixed inset-0 z-[10000] flex items-center justify-center p-6 bg-black/50 backdrop-blur-sm">
             <div className="bg-white rounded-[32px] w-full max-w-sm shadow-2xl overflow-hidden border border-gray-100 p-8 space-y-6">
                <div className="flex items-center justify-between">
                   <div>
                     <h3 className="text-xl font-black text-gray-950 uppercase tracking-tight">Security Update</h3>
                     <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Update Driver Password</p>
                   </div>
                   <button onClick={() => setPasswordModal({ isOpen: false, driverId: null, password: '', isSubmitting: false })} className="text-gray-400 hover:text-gray-900 transition-colors">
                      <XCircle size={24} />
                   </button>
                </div>
                <div className="space-y-4">
                   <div className="relative group">
                      <div className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-indigo-600 transition-colors">
                         <Lock size={18} />
                      </div>
                      <input 
                        type="text" 
                        placeholder="New password"
                        className="w-full pl-14 pr-4 py-4 bg-gray-50 border border-gray-100 rounded-2xl text-[14px] font-bold text-gray-900 outline-none focus:bg-white focus:border-indigo-200 transition-all shadow-inner"
                        value={passwordModal.password}
                        onChange={(e) => setPasswordModal(prev => ({ ...prev, password: e.target.value }))}
                      />
                   </div>
                </div>
                <button 
                  onClick={() => handleAction('password', passwordModal.driverId)}
                  disabled={passwordModal.isSubmitting || !passwordModal.password}
                  className="w-full py-4 bg-gray-950 text-white rounded-2xl text-[12px] font-black uppercase tracking-widest hover:translate-y-[-2px] transition-all shadow-xl disabled:opacity-50"
                >
                  {passwordModal.isSubmitting ? 'Updating...' : 'COMMIT NEW PASSWORD'}
                </button>
             </div>
          </div>
        )}
      </AnimatePresence>

      {activeMenu && menuPosition && createPortal(
        <>
          <div className="fixed inset-0 z-[9998] bg-transparent" onClick={closeMenu} />
          <div
            className="fixed z-[9999] bg-white border border-gray-200 shadow-2xl rounded-xl p-2 text-left overflow-y-auto"
            style={{
              width: ACTION_MENU_WIDTH,
              maxHeight: `min(${ACTION_MENU_MAX_HEIGHT}px, calc(100vh - 24px))`,
              ...menuPosition,
            }}
          >
            <button onClick={() => handleAction('approve', activeMenu)} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-emerald-50 text-emerald-600 rounded-lg transition-colors text-sm font-semibold">
              <CheckCircle2 size={16} /> Approve
            </button>
            <button onClick={() => handleAction('edit', activeMenu)} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-amber-50 text-amber-500 rounded-lg transition-colors text-sm font-semibold">
              <Edit2 size={16} /> Edit
            </button>
            <button
              onClick={() => {
                closeMenu();
                setPasswordModal({ isOpen: true, driverId: activeMenu, password: '', isSubmitting: false });
              }}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 text-gray-600 rounded-lg transition-colors text-sm font-semibold"
            >
              
            </button>
            <button onClick={() => handleAction('view', activeMenu)} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-indigo-50 text-indigo-600 rounded-lg transition-colors text-sm font-semibold">
              <Eye size={16} /> View Profile
            </button>
            <div className="h-px bg-gray-50 my-1 mx-2" />
            <button onClick={() => handleAction('delete', activeMenu)} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-rose-50 text-rose-500 rounded-lg transition-colors text-sm font-semibold">
              <Trash2 size={16} /> Delete
            </button>
          </div>
        </>,
        document.body,
      )}

    </div>
  );
};

export default PendingDrivers;

