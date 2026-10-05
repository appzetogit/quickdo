import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronRight,
  Crown,
  FileSearch,
  Loader2,
  Pencil,
  Plus,
  Search,
  Shield,
  Trash2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { adminAPI } from '../../../../../services/api';

const inputClass =
  'w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 outline-none transition-all placeholder:text-slate-400 focus:border-[#1D4ED8] focus:ring-4 focus:ring-blue-100';

const ScopeBadgeList = ({ items = [], emptyLabel }) => {
  if (!items.length) {
    return <span className="text-xs font-semibold text-slate-400">{emptyLabel}</span>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span
          key={item._id || item.id}
          className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-[11px] font-black uppercase tracking-wide text-blue-700"
        >
          {item.name || item.zoneName || item}
        </span>
      ))}
    </div>
  );
};

export default function FoodSubadmins() {
  const navigate = useNavigate();
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [deletingId, setDeletingId] = useState('');

  const loadAdmins = async () => {
    setLoading(true);
    try {
      const response = await adminAPI.getFoodAdmins();
      setAdmins(Array.isArray(response?.data?.results) ? response.data.results : response?.data?.data?.results || []);
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || 'Unable to load food admins.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAdmins();
  }, []);

  const filteredAdmins = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) {
      return admins;
    }

    return admins.filter((item) =>
      [
        item.name,
        item.email,
        item.phone,
        item.adminLevel,
        item.role,
        ...(item.food_zone_ids || []).map((zone) => zone.name || zone.zoneName || zone),
      ].some((value) => String(value || '').toLowerCase().includes(query)),
    );
  }, [admins, searchTerm]);

  const stats = useMemo(() => {
    const superadmins = admins.filter((item) => item.adminLevel === 'food_superadmin' || item.adminLevel === 'platform_superadmin').length;
    const subadmins = admins.filter((item) => item.adminLevel === 'subadmin').length;
    const activeAdmins = admins.filter((item) => item.isActive !== false).length;

    return { superadmins, subadmins, activeAdmins };
  }, [admins]);

  const handleDelete = async (admin) => {
    if (!window.confirm(`Delete food admin ${admin.name || 'this account'}?`)) {
      return;
    }

    const id = admin.id || admin._id;
    setDeletingId(String(id));
    try {
      await adminAPI.deleteFoodAdminAccount(id);
      toast.success('Food admin removed.');
      await loadAdmins();
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || 'Unable to delete food admin.');
    } finally {
      setDeletingId('');
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={30} className="animate-spin text-blue-600" />
          <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">Loading food admins</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,_#EFF6FF_0%,_#F8FAFC_32%)] p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header Section */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.22em] text-slate-400">
              <span>Home Section</span>
              <ChevronRight size={12} />
              <span className="text-slate-700">Food Subadmin Management</span>
            </div>
            <h1 className="text-3xl font-black tracking-tight text-slate-950">Food Administrators</h1>
            <p className="mt-1 text-sm font-semibold text-slate-500">
              Manage food subadmins, assign zones, and control module permissions.
            </p>
          </div>

          <button
            type="button"
            onClick={() => navigate('/admin/food/management/admins/create')}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3.5 text-sm font-black text-white shadow-lg shadow-blue-200 transition-all hover:bg-blue-700 hover:shadow-blue-300"
          >
            <Plus size={18} />
            Create Subadmin
          </button>
        </div>

        {/* Stats Blocks */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
            <span className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Food Superadmins</span>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-black text-slate-900">{stats.superadmins}</span>
              <span className="text-xs font-bold text-slate-400">accounts</span>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
            <span className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Food Subadmins</span>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-black text-slate-900">{stats.subadmins}</span>
              <span className="text-xs font-bold text-slate-400">delegated access</span>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
            <span className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Active Status</span>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-black text-emerald-600">{stats.activeAdmins}</span>
              <span className="text-xs font-bold text-slate-400">online / authorized</span>
            </div>
          </div>
        </div>

        {/* Filters and Search */}
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="text"
              placeholder="Search by name, email, phone, zone, or level..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className={`${inputClass} pl-11`}
            />
          </div>
        </div>

        {/* Admins Table / List */}
        <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
          {filteredAdmins.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 text-slate-400">
                <FileSearch size={22} />
              </div>
              <h3 className="mt-4 text-sm font-black text-slate-900">No administrators found</h3>
              <p className="mt-1 text-xs font-semibold text-slate-400">
                Try searching for another keyword or create a new subadmin account.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/75 text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                    <th className="px-6 py-4">Account Profile</th>
                    <th className="px-6 py-4">Security Level</th>
                    <th className="px-6 py-4">Assigned Zones</th>
                    <th className="px-6 py-4">Access Rights</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredAdmins.map((item) => {
                    const id = item.id || item._id;
                    const isSuper = item.adminLevel === 'food_superadmin' || item.adminLevel === 'platform_superadmin';
                    const isDeleting = deletingId === String(id);

                    return (
                      <tr key={id} className="hover:bg-slate-50/50">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 font-bold text-slate-700">
                              {(item.name || 'A').charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div className="text-sm font-bold text-slate-900">{item.name}</div>
                              <div className="text-xs font-semibold text-slate-400">{item.email}</div>
                              {item.phone && <div className="text-xs text-slate-400">{item.phone}</div>}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          {isSuper ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-extrabold text-amber-700">
                              <Crown size={12} />
                              Superadmin
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
                              <Shield size={12} />
                              Subadmin
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          {isSuper ? (
                            <span className="text-xs font-bold text-slate-400">All zones (Global)</span>
                          ) : (
                            <ScopeBadgeList items={item.food_zone_ids} emptyLabel="No zones assigned" />
                          )}
                        </td>
                        <td className="px-6 py-4">
                          {isSuper ? (
                            <span className="text-xs font-bold text-slate-400">Unrestricted</span>
                          ) : (
                            <ScopeBadgeList items={item.permissions} emptyLabel="No permissions" />
                          )}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => navigate(`/admin/food/management/admins/edit/${id}`)}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-all hover:bg-slate-50 hover:text-slate-900"
                            >
                              <Pencil size={15} />
                            </button>

                            {!isSuper && (
                              <button
                                type="button"
                                disabled={isDeleting}
                                onClick={() => handleDelete(item)}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-red-100 bg-white text-red-600 transition-all hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                              >
                                {isDeleting ? (
                                  <Loader2 size={15} className="animate-spin" />
                                ) : (
                                  <Trash2 size={15} />
                                )}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
