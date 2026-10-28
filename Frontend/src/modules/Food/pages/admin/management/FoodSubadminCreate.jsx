import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, ChevronRight, Loader2, LockKeyhole, MapPinned, Shield, UserRound } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { adminAPI } from '../../../../../services/api';
import { FOOD_PERMISSION_RESOURCES, getCreatableAdminTypes, normalizeFoodAdminProfile } from '../../../constants/foodAdminAccess';
import { getCurrentUser } from '@food/utils/auth';

const inputClass =
  'w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 outline-none transition-all placeholder:text-slate-400 focus:border-[#1D4ED8] focus:ring-4 focus:ring-blue-100';
const labelClass = 'mb-2 block text-xs font-black uppercase tracking-[0.18em] text-slate-500';

const initialForm = {
  name: '',
  email: '',
  phone: '',
  role: 'Operations Subadmin',
  adminLevel: 'subadmin',
  permissions: [],
  food_zone_ids: [],
  password: '',
  passwordConfirmation: '',
  active: true,
};

const PermissionCheckbox = ({ checked, label, onChange }) => (
  <button
    type="button"
    onClick={onChange}
    className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition-all ${
      checked
        ? 'border-blue-200 bg-blue-50 text-blue-900'
        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
    }`}
  >
    <span className="text-sm font-bold capitalize">{label.replace('_', ' ')}</span>
    <span
      className={`flex h-5 w-5 items-center justify-center rounded-full border ${
        checked ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-transparent'
      }`}
    >
      <Check size={12} />
    </span>
  </button>
);

export default function FoodSubadminCreate() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);
  const [form, setForm] = useState(initialForm);
  const [zones, setZones] = useState([]);
  const [permissionsCatalog, setPermissionsCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const currentUserRaw = getCurrentUser('admin');
  const currentUser = normalizeFoodAdminProfile(currentUserRaw);

  const creatableTypes = useMemo(() => {
    return getCreatableAdminTypes(currentUser);
  }, [currentUser]);

  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [zonesResponse, permissionsResponse, adminDetailResponse] = await Promise.all([
          adminAPI.getFoodAssignableZones(),
          adminAPI.getFoodPermissions(),
          isEdit ? adminAPI.getFoodAdminById(id) : Promise.resolve(null),
        ]);

        const nextZones = Array.isArray(zonesResponse?.data?.results)
          ? zonesResponse.data.results
          : zonesResponse?.data?.data || [];
        const nextPermissions = Array.isArray(permissionsResponse?.data?.results)
          ? permissionsResponse.data.results
          : permissionsResponse?.data?.data || FOOD_PERMISSION_RESOURCES;

        setZones(nextZones);
        setPermissionsCatalog(nextPermissions);

        if (isEdit && adminDetailResponse) {
          const existing = adminDetailResponse.data?.data || adminDetailResponse.data || {};
          
          // Map permissions to simple resource names
          const mappedPermissions = Array.isArray(existing.permissions)
            ? existing.permissions.map(p => {
                if (p.includes('.')) return p.split('.')[0];
                return p;
              }).filter(p => p !== '*')
            : [];

          setForm({
            name: existing.name || '',
            email: existing.email || '',
            phone: existing.phone || '',
            role: existing.role || 'Operations Subadmin',
            adminLevel: existing.adminLevel || 'subadmin',
            permissions: [...new Set(mappedPermissions)],
            food_zone_ids: Array.isArray(existing.food_zone_ids) ? existing.food_zone_ids.map(z => z._id || z.id || z) : [],
            password: '',
            passwordConfirmation: '',
            active: existing.isActive !== false,
          });
        }
      } catch (error) {
        toast.error(error?.response?.data?.message || error?.message || 'Unable to load administration setup data.');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [id, isEdit]);

  // Adjust permissions and zones when changing admin security levels
  useEffect(() => {
    if (form.adminLevel === 'food_superadmin') {
      if (form.permissions.length > 0 || form.food_zone_ids.length > 0) {
        setForm((current) => ({
          ...current,
          permissions: [],
          food_zone_ids: [],
        }));
      }
    }
  }, [form.adminLevel]);

  const handlePermissionToggle = (permission) => {
    setForm((current) => ({
      ...current,
      permissions: current.permissions.includes(permission)
        ? current.permissions.filter((item) => item !== permission)
        : [...current.permissions, permission],
    }));
  };

  const handleMultiSelect = (key, value) => {
    setForm((current) => {
      const currentValues = Array.isArray(current[key]) ? current[key] : [];
      return {
        ...current,
        [key]: currentValues.includes(value)
          ? currentValues.filter((item) => item !== value)
          : [...currentValues, value],
      };
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!form.name.trim() || !form.email.trim()) {
      toast.error('Name and email are required.');
      return;
    }

    if (!isEdit && !form.password.trim()) {
      toast.error('Password is required for new accounts.');
      return;
    }

    if (form.password || form.passwordConfirmation) {
      if (form.password !== form.passwordConfirmation) {
        toast.error('Passwords do not match.');
        return;
      }
    }

    // Map permissions back to the required read/write pattern. We will assign both read/write to keep it simple or write only.
    // In our helper, write implies read, so we will assign both 'resource.read' and 'resource.write' for toggled resources.
    const mappedPermissions = form.adminLevel === 'food_superadmin'
      ? ['*']
      : form.permissions.flatMap(resource => [
          `${resource}.read`,
          `${resource}.write`
        ]);

    const payload = {
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      role: form.adminLevel === 'food_superadmin' ? 'Food Superadmin' : form.role.trim(),
      adminLevel: form.adminLevel,
      permissions: mappedPermissions,
      food_zone_ids: form.adminLevel === 'food_superadmin' ? [] : form.food_zone_ids,
      active: form.active,
      password: form.password,
      password_confirmation: form.passwordConfirmation,
    };

    setSaving(true);
    try {
      if (isEdit) {
        await adminAPI.updateFoodAdminAccount(id, payload);
        toast.success('Food admin account updated.');
      } else {
        await adminAPI.createFoodAdminAccount(payload);
        toast.success('Food subadmin created successfully.');
      }
      navigate('/admin/food/management/admins');
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || 'Unable to save food admin.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={30} className="animate-spin text-blue-600" />
          <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">Preparing setup form</p>
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
              <span>Food Management</span>
              <ChevronRight size={12} />
              <span className="text-slate-700">{isEdit ? 'Edit Admin' : 'Create Subadmin'}</span>
            </div>
            <h1 className="text-3xl font-black tracking-tight text-slate-950">
              {isEdit ? 'Update Scoped Access' : 'Create Scoped Subadmin'}
            </h1>
            <p className="mt-2 max-w-2xl text-sm font-semibold text-slate-500">
              Assign module access first, then limit the account to the right food zones.
            </p>
          </div>

          <button
            type="button"
            onClick={() => navigate('/admin/food/management/admins')}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 transition-all hover:bg-slate-50"
          >
            <ArrowLeft size={16} />
            Back to Admins
          </button>
        </div>

        {/* Form Container */}
        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {/* Primary Details Card */}
            <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
              <div className="mb-6 flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                  <UserRound size={18} />
                </div>
                <h2 className="text-lg font-black tracking-tight text-slate-900">Administrator Details</h2>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>Full Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Rahul Sharma"
                    value={form.name}
                    onChange={(e) => setField('name', e.target.value)}
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className={labelClass}>Email Address</label>
                  <input
                    type="email"
                    required
                    disabled={isEdit}
                    placeholder="e.g. rahul@appezeto.com"
                    value={form.email}
                    onChange={(e) => setField('email', e.target.value)}
                    className={`${inputClass} disabled:bg-slate-50 disabled:text-slate-400`}
                  />
                </div>

                <div>
                  <label className={labelClass}>Phone Number</label>
                  <input
                    type="tel"
                    placeholder="e.g. 9876543210"
                    value={form.phone}
                    onChange={(e) => setField('phone', e.target.value)}
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className={labelClass}>Descriptive Role / Title</label>
                  <input
                    type="text"
                    required
                    disabled={form.adminLevel === 'food_superadmin'}
                    placeholder="e.g. Regional Support Manager"
                    value={form.adminLevel === 'food_superadmin' ? 'Food Superadmin' : form.role}
                    onChange={(e) => setField('role', e.target.value)}
                    className={`${inputClass} disabled:bg-slate-50 disabled:text-slate-400`}
                  />
                </div>
              </div>
            </div>

            {/* Permissions Allocation (Only for Subadmins) */}
            {form.adminLevel === 'subadmin' && (
              <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
                <div className="mb-6 flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                    <Shield size={18} />
                  </div>
                  <div>
                    <h2 className="text-lg font-black tracking-tight text-slate-900">Module Access Permissions</h2>
                    <p className="text-xs font-semibold text-slate-400">
                      Enable sections this subadmin is allowed to view and modify.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {permissionsCatalog.map((permission) => (
                    <PermissionCheckbox
                      key={permission}
                      label={permission}
                      checked={form.permissions.includes(permission)}
                      onChange={() => handlePermissionToggle(permission)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Sidebar / Configuration Controls */}
          <div className="space-y-6">
            {/* Account Settings & Level */}
            <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
              <label className={labelClass}>Security Level</label>
              <select
                value={form.adminLevel}
                onChange={(e) => setField('adminLevel', e.target.value)}
                disabled={isEdit}
                className="mb-6 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 outline-none focus:border-[#1D4ED8] focus:ring-4 focus:ring-blue-100 disabled:bg-slate-50"
              >
                {creatableTypes.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>

              <label className={labelClass}>Account Status</label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setField('active', true)}
                  className={`flex-1 rounded-2xl border py-3 text-center text-xs font-black uppercase tracking-wider transition-all ${
                    form.active
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  Active
                </button>
                <button
                  type="button"
                  onClick={() => setField('active', false)}
                  className={`flex-1 rounded-2xl border py-3 text-center text-xs font-black uppercase tracking-wider transition-all ${
                    !form.active
                      ? 'border-red-200 bg-red-50 text-red-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  Disabled
                </button>
              </div>
            </div>

            {/* Zone Scoping (Only for Subadmins) */}
            {form.adminLevel === 'subadmin' && (
              <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
                <div className="mb-4 flex items-center gap-2">
                  <MapPinned size={18} className="text-slate-400" />
                  <h3 className="text-sm font-black text-slate-900">Food Zones Scope</h3>
                </div>

                <div className="max-h-60 space-y-2 overflow-y-auto pr-1">
                  {zones.length === 0 ? (
                    <p className="text-xs font-semibold text-slate-400">No active food zones available.</p>
                  ) : (
                    zones.map((zone) => {
                      const id = zone.id || zone._id;
                      const isChecked = form.food_zone_ids.includes(id);

                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => handleMultiSelect('food_zone_ids', id)}
                          className={`flex w-full items-center justify-between rounded-xl border px-3.5 py-2.5 text-left transition-all ${
                            isChecked
                              ? 'border-blue-200 bg-blue-50 text-blue-900'
                              : 'border-slate-150 bg-white text-slate-600 hover:border-slate-300'
                          }`}
                        >
                          <span className="text-xs font-bold">{zone.name || zone.zoneName}</span>
                          <span
                            className={`flex h-4 w-4 items-center justify-center rounded border ${
                              isChecked ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-transparent'
                            }`}
                          >
                            <Check size={10} />
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* Authentication Credentials Card */}
            <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <LockKeyhole size={18} className="text-slate-400" />
                <h3 className="text-sm font-black text-slate-900">
                  {isEdit ? 'Update Password (Optional)' : 'Security Password'}
                </h3>
              </div>

              <div className="space-y-4">
                <div>
                  <input
                    type="password"
                    required={!isEdit}
                    placeholder="New password"
                    value={form.password}
                    onChange={(e) => setField('password', e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <input
                    type="password"
                    required={!isEdit}
                    placeholder="Confirm new password"
                    value={form.passwordConfirmation}
                    onChange={(e) => setField('passwordConfirmation', e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col gap-3">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 py-4 text-sm font-black text-white shadow-lg shadow-blue-200 transition-all hover:bg-blue-700 hover:shadow-blue-300 disabled:opacity-55"
              >
                {saving && <Loader2 size={16} className="animate-spin" />}
                {isEdit ? 'Save Administration Context' : 'Create Scoped Subadmin'}
              </button>

              <button
                type="button"
                onClick={() => navigate('/admin/food/management/admins')}
                className="w-full rounded-2xl border border-slate-200 bg-white py-3.5 text-center text-sm font-black text-slate-500 transition-all hover:bg-slate-50"
              >
                Cancel Changes
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
