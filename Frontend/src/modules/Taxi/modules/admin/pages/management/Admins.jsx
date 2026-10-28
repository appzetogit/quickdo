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
import { adminService } from '../../services/adminService';

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
          key={item.id}
          className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-[11px] font-black uppercase tracking-wide text-blue-700"
        >
          {item.name}
        </span>
      ))}
    </div>
  );
};

const Admins = () => {
  const navigate = useNavigate();
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [deletingId, setDeletingId] = useState('');

  const loadAdmins = async () => {
    setLoading(true);
    try {
      const response = await adminService.getAdmins();
      setAdmins(Array.isArray(response?.data?.results) ? response.data.results : []);
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || 'Unable to load admins.');
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
        item.role,
        item.admin_type,
        ...(item.service_locations || []).map((location) => location.name),
        ...(item.zones || []).map((zone) => zone.name),
      ].some((value) => String(value || '').toLowerCase().includes(query)),
    );
  }, [admins, searchTerm]);

  const stats = useMemo(() => {
    const superadmins = admins.filter((item) => item.admin_type === 'superadmin').length;
    const subadmins = admins.filter((item) => item.admin_type === 'subadmin').length;
    const activeAdmins = admins.filter((item) => item.active !== false).length;

    return { superadmins, subadmins, activeAdmins };
  }, [admins]);

  const handleDelete = async (admin) => {
    if (!window.confirm(`Delete ${admin.name || 'this admin'}?`)) {
      return;
    }

    setDeletingId(String(admin.id || admin._id || ''));
    try {
      await adminService.deleteAdminAccount(admin.id || admin._id);
      toast.success('Admin removed.');
      await loadAdmins();
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || 'Unable to delete admin.');
    } finally {
      setDeletingId('');
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#E0F2FE,_#F8FAFC_42%)] p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.22em] text-slate-400">
              <span>Admin Management</span>
              <ChevronRight size={12} />
              <span className="text-slate-700">Subadmins</span>
            </div>
            <h1 className="text-3xl font-black tracking-tight text-slate-950">Scoped Admin Control</h1>
            <p className="mt-2 max-w-2xl text-sm font-semibold text-slate-500">
              Create subadmins, assign sidebar permissions, and lock them to specific service locations and zones.
            </p>
          </div>

          <button
            type="button"
            onClick={() => navigate('/taxi/admin/management/admins/create')}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#1D4ED8] px-5 py-3 text-sm font-black text-white shadow-lg shadow-blue-200 transition-all hover:-translate-y-0.5 hover:bg-[#1E40AF]"
          >
            <Plus size={18} />
            Add Subadmin
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {[
            {
              label: 'Superadmins',
              value: stats.superadmins,
              icon: Crown,
              tone: 'from-amber-500/15 to-primary-orange/50/5 text-amber-700 border-amber-100',
            },
            {
              label: 'Subadmins',
              value: stats.subadmins,
              icon: Shield,
              tone: 'from-blue-500/15 to-cyan-500/5 text-blue-700 border-blue-100',
            },
            {
              label: 'Active Accounts',
              value: stats.activeAdmins,
              icon: Crown,
              tone: 'from-emerald-500/15 to-teal-500/5 text-emerald-700 border-emerald-100',
            },
          ].map((card) => (
            <div
              key={card.label}
              className={`rounded-[28px] border bg-gradient-to-br ${card.tone} p-5 shadow-sm`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">{card.label}</p>
                  <p className="mt-2 text-3xl font-black text-slate-950">{card.value}</p>
                </div>
                <div className="rounded-2xl bg-white/80 p-3 shadow-sm">
                  <card.icon size={20} />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-xl shadow-slate-200/60">
          <div className="flex flex-col gap-4 border-b border-slate-100 bg-slate-50/80 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full max-w-md">
              <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search by name, email, role, location, or zone"
                className={`${inputClass} pl-11`}
              />
            </div>
            <div className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">
              {filteredAdmins.length} visible accounts
            </div>
          </div>

          <div className="overflow-x-auto">
            {loading ? (
              <div className="flex flex-col items-center justify-center gap-3 px-6 py-24">
                <Loader2 size={30} className="animate-spin text-blue-600" />
                <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">Loading admin matrix</p>
              </div>
            ) : filteredAdmins.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 px-6 py-24 text-center">
                <div className="rounded-3xl border border-slate-100 bg-slate-50 p-5 text-slate-300">
                  <FileSearch size={34} strokeWidth={1.5} />
                </div>
                <p className="text-sm font-bold text-slate-900">No admin accounts matched your search.</p>
                <p className="max-w-md text-xs font-semibold text-slate-500">
                  Create a new subadmin and assign their sidebar permissions, service locations, and zones here.
                </p>
              </div>
            ) : (
              <table className="min-w-full text-left">
                <thead className="bg-white">
                  <tr className="border-b border-slate-100 text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">
                    <th className="px-6 py-4">Admin</th>
                    <th className="px-6 py-4">Type</th>
                    <th className="px-6 py-4">Permissions</th>
                    <th className="px-6 py-4">Service Locations</th>
                    <th className="px-6 py-4">Zones</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredAdmins.map((admin) => {
                    const isSuperadmin = admin.admin_type === 'superadmin';
                    const isDeleting = deletingId === String(admin.id || admin._id || '');

                    return (
                      <tr key={admin.id || admin._id} className="align-top transition-colors hover:bg-slate-50/80">
                        <td className="px-6 py-5">
                          <div className="flex items-start gap-3">
                            <div className={`rounded-2xl p-3 ${isSuperadmin ? 'bg-amber-50 text-amber-600' : 'bg-blue-50 text-blue-600'}`}>
                              {isSuperadmin ? <Crown size={18} /> : <Shield size={18} />}
                            </div>
                            <div>
                              <p className="text-sm font-black text-slate-950">{admin.name || '-'}</p>
                              <p className="mt-1 text-xs font-semibold text-slate-500">{admin.email || '-'}</p>
                              <p className="mt-1 text-xs font-semibold text-slate-400">{admin.phone || 'No phone'}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-5">
                          <span
                            className={`inline-flex rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${
                              isSuperadmin
                                ? 'bg-amber-50 text-amber-700'
                                : 'bg-blue-50 text-blue-700'
                            }`}
                          >
                            {isSuperadmin ? 'Superadmin' : admin.role || 'Subadmin'}
                          </span>
                        </td>
                        <td className="px-6 py-5">
                          <p className="text-sm font-bold text-slate-900">
                            {isSuperadmin ? 'Full sidebar access' : `${(admin.permissions || []).length} modules`}
                          </p>
                          <p className="mt-1 text-xs font-semibold text-slate-500">
                            {isSuperadmin ? 'Every menu, every API scope.' : (admin.permissions || []).slice(0, 3).join(', ') || 'No modules'}
                          </p>
                        </td>
                        <td className="px-6 py-5">
                          <ScopeBadgeList
                            items={admin.service_locations || []}
                            emptyLabel={isSuperadmin ? 'All service locations' : 'No service location scope'}
                          />
                        </td>
                        <td className="px-6 py-5">
                          <ScopeBadgeList
                            items={admin.zones || []}
                            emptyLabel={isSuperadmin ? 'All zones' : 'All zones in assigned service locations'}
                          />
                        </td>
                        <td className="px-6 py-5">
                          <span
                            className={`inline-flex rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${
                              admin.active !== false
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-rose-50 text-rose-700'
                            }`}
                          >
                            {admin.active !== false ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-6 py-5">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => navigate(`/taxi/admin/management/admins/edit/${admin.id || admin._id}`)}
                              className="rounded-2xl border border-slate-200 p-2.5 text-slate-500 transition-all hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                            >
                              <Pencil size={15} />
                            </button>
                            {!isSuperadmin && (
                              <button
                                type="button"
                                disabled={isDeleting}
                                onClick={() => handleDelete(admin)}
                                className="rounded-2xl border border-slate-200 p-2.5 text-slate-500 transition-all hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {isDeleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Admins;
