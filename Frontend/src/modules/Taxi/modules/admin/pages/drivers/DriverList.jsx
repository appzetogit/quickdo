import React, { useState, useEffect } from 'react';
import {
  Search,
  MoreVertical,
  FileText,
  Star,
  Plus,
  Eye,
  Edit2,
  Key,
  XCircle,
  Trash2,
  Lock,
  Loader2,
  ChevronRight,
  Filter,
  List,
  LayoutGrid
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { adminService } from '../../services/adminService';
import { useDriverPaths } from './driverPaths';

const ACTION_MENU_WIDTH = 176;
const ACTION_MENU_GAP = 8;
const ACTION_MENU_MAX_HEIGHT = 260;

const DriverList = ({ mode = 'approved' }) => {
  const navigate = useNavigate();
  const driverPaths = useDriverPaths();
  const [searchTerm, setSearchTerm] = useState('');
  const [activeMenu, setActiveMenu] = useState(null);
  const [menuPosition, setMenuPosition] = useState(null);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [passwordModal, setPasswordModal] = useState({ isOpen: false, driverId: null, password: '', isSubmitting: false });
  const [drivers, setDrivers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [paginator, setPaginator] = useState(null);

  const fetchDrivers = async ({ nextPage = page, nextLimit = itemsPerPage, nextSearch = searchTerm } = {}) => {
    setIsLoading(true);
    setError('');
    try {
      const responseData = await adminService.getDrivers(nextPage, nextLimit, {
        ...(mode === 'active' ? { isOnline: true } : { approve: true }),
        search: String(nextSearch || '').trim(),
      });
      const driversList = responseData.data?.results || [];
      if (responseData.success) {
        const approved = driversList.map((d) => ({
          id: d._id,
          name: d.name || 'Unknown',
          serviceLocation: d.service_location_name || d.city || d.service_location?.name || 'India',
          phone: d.phone || d.mobile || 'N/A',
          transportType: d.transport_type || d.register_for || d.vehicle_type || 'All - Bike',
          rating: Number(d.rating_count || d.ratingCount || 0) > 0
            ? Number(d.rating || d.average_rating || d.avg_rating || 0)
            : 0,
          isOnline: Boolean(d.isOnline),
          registeredAt: d.createdAt || null,
          status: mode === 'active' ? 'Online' : (d.approve ? 'Approved' : (d.status || 'Approved')),
        }));
        setDrivers(approved);
        setPaginator(responseData.data?.paginator || null);
      } else {
        setError(responseData.message || 'Failed to fetch drivers');
      }
    } catch (err) {
      setError(err.message || 'Network error occurred.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDrivers({ nextPage: 1, nextLimit: itemsPerPage, nextSearch: searchTerm });
    setPage(1);
  }, [itemsPerPage]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      fetchDrivers({ nextPage: 1, nextLimit: itemsPerPage, nextSearch: searchTerm });
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [searchTerm]);

  useEffect(() => {
    fetchDrivers({ nextPage: page, nextLimit: itemsPerPage, nextSearch: searchTerm });
  }, [page]);

  const closeMenu = () => {
    setActiveMenu(null);
    setMenuPosition(null);
  };

  const toggleMenu = (e, userId) => {
    e.stopPropagation();
    if (activeMenu === userId) {
      closeMenu();
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const viewportPadding = 12;
    const spaceBelow = window.innerHeight - rect.bottom - ACTION_MENU_GAP;
    const spaceAbove = rect.top - ACTION_MENU_GAP;
    const openUp = spaceBelow < 200 && spaceAbove > spaceBelow;

    const left = Math.min(
      Math.max(viewportPadding, rect.right - ACTION_MENU_WIDTH),
      window.innerWidth - ACTION_MENU_WIDTH - viewportPadding,
    );

    setMenuPosition({
      left,
      ...(openUp
        ? { bottom: Math.max(viewportPadding, window.innerHeight - rect.top + ACTION_MENU_GAP) }
        : {
            top: Math.max(
              viewportPadding,
              Math.min(
                rect.bottom + ACTION_MENU_GAP,
                window.innerHeight - ACTION_MENU_MAX_HEIGHT - viewportPadding,
              ),
            ),
          }),
    });
    setActiveMenu(userId);
  };

  useEffect(() => {
    if (!activeMenu) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') closeMenu();
    };

    const handleReset = () => closeMenu();

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleReset, true);
    window.addEventListener('resize', handleReset);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleReset, true);
      window.removeEventListener('resize', handleReset);
    };
  }, [activeMenu]);

  const handleAction = async (action, driverId) => {
    const confirmMsg = action === 'delete' ? 'Are you sure you want to delete this driver?' : 'Are you sure you want to disapprove this driver?';
    if (action !== 'password' && !window.confirm(confirmMsg)) return;

    try {
      let resData;
      if (action === 'delete') {
        resData = await adminService.deleteDriver(driverId);
      } else if (action === 'disapprove') {
        resData = await adminService.updateDriverStatus(driverId, { approve: false, status: 'disapproved', active: false });
      } else if (action === 'password') {
        setPasswordModal(prev => ({ ...prev, isSubmitting: true }));
        resData = await adminService.updateDriverPassword(driverId, passwordModal.password);
      }

      if (resData.success) {
        alert(`${action.charAt(0).toUpperCase() + action.slice(1)} successful`);
        if (action === 'delete' || action === 'disapprove') {
          setDrivers(prev => prev.filter(d => d.id !== driverId));
        }
        if (action === 'password') {
          setPasswordModal({ isOpen: false, driverId: null, password: '', isSubmitting: false });
        }
      } else {
        alert(resData.message || `Failed to ${action}`);
        if (action === 'password') setPasswordModal(prev => ({ ...prev, isSubmitting: false }));
      }
    } catch (err) {
      alert(err.message || `Network error during ${action}`);
      if (action === 'password') setPasswordModal(prev => ({ ...prev, isSubmitting: false }));
    }
  };

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

  const totalPages = Math.max(1, Number(paginator?.last_page || 1));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const totalEntries = Number(paginator?.total || 0);
  const perPage = Number(paginator?.per_page || itemsPerPage);
  const startIndex = (safePage - 1) * perPage;
  const showingFrom = totalEntries === 0 ? 0 : startIndex + 1;
  const showingTo = totalEntries === 0 ? 0 : Math.min(startIndex + drivers.length, totalEntries);

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-8">
      {error && (
        <div className="mb-4 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">
          {error}
        </div>
      )}
      <div className="mb-6">
        <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
          <span>Drivers</span>
          <ChevronRight size={12} />
          <span className="text-gray-700">{mode === 'active' ? 'Active Drivers' : 'Approved Drivers'}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-semibold text-gray-900">{mode === 'active' ? 'Active Drivers' : 'Approved Drivers'}</h1>
          {mode !== 'active' ? (
            <button
              onClick={() => navigate(`${driverPaths.drivers}/create`)}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
            >
              <Plus size={15} /> Add Drivers
            </button>
          ) : null}
        </div>
      </div>

      {/* Table Card */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-visible">
        <div className="p-4 border-b border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button className="w-10 h-10 bg-teal-500 text-white rounded-lg flex items-center justify-center shadow-sm">
              <List size={18} />
            </button>
            <button className="w-10 h-10 bg-gray-100 text-gray-400 rounded-lg flex items-center justify-center hover:bg-indigo-50 transition-all">
              <LayoutGrid size={18} />
            </button>
            <div className="flex items-center gap-2 text-xs text-gray-500 ml-4">
              <span>Show</span>
              <select
                value={itemsPerPage}
                onChange={(e) => setItemsPerPage(e.target.value)}
                className="border border-gray-200 rounded px-2 py-1 text-xs bg-white"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
              </select>
              <span>entries</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button className="w-10 h-10 rounded-full border border-gray-200 bg-white text-gray-400 flex items-center justify-center shadow-sm">
              <Search size={16} />
            </button>
            <button className="bg-primary-orange/50 text-white px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 shadow-sm uppercase tracking-wide">
              <Filter size={14} /> Filters
            </button>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search drivers..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg w-56 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
              />
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Service Location</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Mobile Number</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Transport Type</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Document View</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Approved Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Rating</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Registered at</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                <tr>
                  <td colSpan="9" className="py-16 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <Loader2 className="w-7 h-7 text-indigo-600 animate-spin" />
                      <p className="text-sm text-gray-400">Loading drivers...</p>
                    </div>
                  </td>
                </tr>
              ) : drivers.length === 0 ? (
                <tr>
                  <td colSpan="9" className="px-6 py-16 text-center text-sm text-gray-400">No drivers found.</td>
                </tr>
              ) : (
                drivers.map((driver) => (
                  <tr key={driver.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">{driver.name}</td>
                    <td className="px-4 py-4 text-sm text-gray-500">{driver.serviceLocation}</td>
                    <td className="px-4 py-4 text-sm text-gray-500">{driver.phone}</td>
                    <td className="px-4 py-4 text-sm text-gray-500">{driver.transportType}</td>
                    <td className="px-4 py-4">
                      <button
                        onClick={() => navigate(`${driverPaths.drivers}/${driver.id}?tab=Documents`)}
                        className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                      >
                        <FileText size={16} />
                      </button>
                    </td>
                    <td className="px-4 py-4">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700">
                        {driver.status}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-0.5">
                        {[1, 2, 3, 4, 5].map((s) => (
                          <Star key={s} size={13} className={s <= driver.rating ? "fill-amber-400 text-amber-400" : "text-gray-200"} />
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-xs text-gray-400 whitespace-nowrap">{formatDate(driver.registeredAt)}</td>
                    <td className="px-4 py-4 text-center">
                      <div className="relative inline-block">
                        <button 
                          onClick={(e) => toggleMenu(e, driver.id)}
                          className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
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

        {/* Footer */}
        {!isLoading && drivers.length > 0 && (
          <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
            <span>Showing {showingFrom} to {showingTo} of {totalEntries} entries</span>
            <div className="flex items-center gap-1">
              <button
                className="px-3 py-1.5 border border-gray-200 rounded text-xs text-gray-400 disabled:opacity-60"
                disabled={safePage <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                Prev
              </button>
              <button className="w-7 h-7 rounded bg-indigo-600 text-white text-xs font-medium">{safePage}</button>
              <button
                className="px-3 py-1.5 border border-gray-200 rounded text-xs text-gray-400 disabled:opacity-60"
                disabled={safePage >= totalPages}
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {activeMenu && menuPosition && createPortal(
        <>
          <div className="fixed inset-0 z-[9998] bg-transparent" onClick={closeMenu} />
          <div
            className="fixed z-[9999] bg-white rounded-lg shadow-2xl border border-gray-200 py-1 overflow-y-auto"
            style={{
              width: ACTION_MENU_WIDTH,
              maxHeight: `min(${ACTION_MENU_MAX_HEIGHT}px, calc(100vh - 24px))`,
              ...menuPosition,
            }}
          >
            <button
              onClick={() => {
                closeMenu();
                handleAction('disapprove', activeMenu);
              }}
              className="w-full text-left px-3 py-2 text-xs text-red-500 hover:bg-red-50 flex items-center gap-2"
            >
              <XCircle size={13} /> Disapprove
            </button>
            <button
              onClick={() => {
                closeMenu();
                navigate(`${driverPaths.drivers}/edit/${activeMenu}`);
              }}
              className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2"
            >
              <Edit2 size={13} className="text-gray-400" /> Edit
            </button>
            <button
              onClick={() => {
                closeMenu();
                setPasswordModal({ isOpen: true, driverId: activeMenu, password: '', isSubmitting: false });
              }}
              className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2"
            >
              <Key size={13} className="text-gray-400" /> Update Password
            </button>
            <button
              onClick={() => {
                closeMenu();
                navigate(`${driverPaths.drivers}/${activeMenu}`);
              }}
              className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2"
            >
              <Eye size={13} className="text-gray-400" /> View Profile
            </button>
            <div className="h-px bg-gray-100 my-1" />
            <button
              onClick={() => {
                closeMenu();
                handleAction('delete', activeMenu);
              }}
              className="w-full text-left px-3 py-2 text-xs text-red-600 hover:bg-red-50 flex items-center gap-2"
            >
              <Trash2 size={13} /> Delete
            </button>
          </div>
        </>,
        document.body,
      )}

      {/* Password Modal */}
      {passwordModal.isOpen && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-6 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-xl w-full max-w-sm shadow-xl border border-gray-200">
            <div className="p-6 space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-gray-900">Update Password</h3>
                  <p className="text-xs text-gray-400 mt-0.5">Set a new password for this driver</p>
                </div>
                <button 
                  onClick={() => setPasswordModal({ isOpen: false, driverId: null, password: '', isSubmitting: false })}
                  className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <XCircle size={18} />
                </button>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">New Password</label>
                <div className="relative">
                  <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input 
                    type="text" 
                    placeholder="Enter new password"
                    autoFocus
                    className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-200 rounded-lg bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                    value={passwordModal.password}
                    onChange={(e) => setPasswordModal(prev => ({ ...prev, password: e.target.value }))}
                  />
                </div>
                <p className="text-[10px] text-gray-400 mt-1.5">Minimum 8 characters required.</p>
              </div>

              <button 
                onClick={() => {
                  if (passwordModal.password.length < 4) { alert('Password too short'); return; }
                  handleAction('password', passwordModal.driverId);
                }}
                disabled={passwordModal.isSubmitting || !passwordModal.password}
                className="w-full py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {passwordModal.isSubmitting ? <Loader2 className="animate-spin" size={15} /> : <Key size={15} />}
                Update Password
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DriverList;
