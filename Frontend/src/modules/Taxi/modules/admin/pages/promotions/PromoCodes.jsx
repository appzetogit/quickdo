import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Filter,
  ChevronRight,
  Trash2,
  Loader2,
  Ticket,
  MapPin,
  Users,
  Zap,
  Percent,
  ArrowLeft,
  Save,
  IndianRupee,
  Calendar,
  ShieldCheck,
  Hash,
  Pencil,
  Search,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { adminService } from '../../services/adminService';
import { BACKEND_ORIGIN } from '../../../../shared/api/runtimeConfig';

const API_ORIGIN = String(globalThis.__LEGACY_BACKEND_ORIGIN__ || BACKEND_ORIGIN || 'https://k9rides.onrender.com').replace(/\/+$/, '');
const ADMIN_API_BASE = API_ORIGIN + '/api/v1/admin';
const TAXI_ADMIN_API_BASE = API_ORIGIN + '/api/v1/taxi/admin';
const BASE = ADMIN_API_BASE + '/promos';
const BOOTSTRAP_URL = ADMIN_API_BASE + '/promotions/bootstrap';
const LIST_PATH = '/taxi/admin/promotions/promo-codes';
const CREATE_PATH = '/taxi/admin/promotions/promo-codes/create';
const Motion = motion;
const PROMO_TRANSPORT_OPTIONS = [
  { value: 'all', label: 'All Modules' },
  { value: 'self_drive', label: 'Self Drive' },
  { value: 'bus', label: 'Bus' },
  { value: 'taxi', label: 'Taxi' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'pooling', label: 'Pooling' },
];
const PROMO_AUDIENCE_OPTIONS = [
  { value: 'all', label: 'All Users' },
  { value: 'specific_user', label: 'Specific User' },
  { value: 'new_users', label: 'New Users Only' },
];

const inputClass =
  'w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm text-gray-800 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-colors disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed';
const labelClass = 'block text-xs font-semibold text-gray-500 mb-1.5';

const createInitialFormData = () => ({
  service_location_id: '',
  service_location_ids: [],
  transport_type: '',
  audience_type: 'all',
  user_id: '',
  code: '',
  minimum_trip_amount: '',
  maximum_discount_amount: '',
  cumulative_max_discount_amount: '',
  discount_percentage: '',
  from: '',
  to: '',
  uses_per_user: '1',
  max_uses_total: '',
  active: true,
});

const createInitialFilters = () => ({
  service_location_id: '',
  transport_type: '',
  active: '',
});

const getPromoLocationIds = (promo) => {
  if (Array.isArray(promo?.service_location_ids) && promo.service_location_ids.length > 0) {
    return promo.service_location_ids.map((value) => String(value));
  }

  if (promo?.service_location_id) {
    return [String(promo.service_location_id)];
  }

  return [];
};

const getPromoLocationLabel = (promo) => {
  const names = Array.isArray(promo?.service_location_names) ? promo.service_location_names.filter(Boolean) : [];
  if (names.length > 0) {
    return names.join(', ');
  }

  return promo?.service_location_name || '-';
};

const getPromoAudienceType = (promo) => {
  const normalized = String(promo?.audience_type || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (PROMO_AUDIENCE_OPTIONS.some((option) => option.value === normalized)) {
    return normalized;
  }

  return promo?.user_specific === true ? 'specific_user' : 'all';
};

const getPromoAudienceLabel = (promo) =>
  PROMO_AUDIENCE_OPTIONS.find((option) => option.value === getPromoAudienceType(promo))?.label || 'All Users';

const getUserRecordId = (user) => String(user?._id || user?.id || user?.user_id || '').trim();

const getLocationRecordId = (locationItem) => String(locationItem?._id || locationItem?.id || '').trim();

const getLocationOptionLabel = (locationItem) =>
  String(locationItem?.service_location_name || locationItem?.name || locationItem?.city || 'Unnamed location').trim();

const getUserOptionLabel = (user) => {
  const name = String(user?.name || '').trim();
  const phone = String(user?.phone || user?.mobile || user?.phone_number || '').trim();
  if (name && phone) {
    return `${name} (${phone})`;
  }
  if (name) {
    return name;
  }
  if (phone) {
    return phone;
  }
  return `User ${getUserRecordId(user).slice(-6) || ''}`.trim();
};

const dedupeUsersById = (users = []) => {
  const seen = new Set();
  return users.filter((user) => {
    const id = getUserRecordId(user);
    if (!id || seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
};

const extractPaginatedResults = (payload) => {
  if (Array.isArray(payload)) {
    return payload;
  }

  const candidates = [
    payload?.data?.results,
    payload?.results,
    payload?.data?.users,
    payload?.users,
    payload?.data?.paginator?.data,
    payload?.paginator?.data,
    payload?.data,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
};

const extractServiceLocations = (payload) => {
  const candidates = [
    payload?.data?.service_locations,
    payload?.service_locations,
    payload?.data?.locations,
    payload?.locations,
    payload?.data?.results,
    payload?.results,
    payload?.data,
    payload,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
};

const extractPaginator = (payload) => payload?.data?.paginator || payload?.paginator || null;

const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  const contentType = response.headers.get('content-type') || '';

  if (!contentType.includes('application/json')) {
    const text = await response.text();
    throw new Error(`Expected JSON from ${url}, got ${response.status} ${contentType || 'unknown'}: ${text.slice(0, 80)}`);
  }

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.message || `Request failed with status ${response.status}`);
  }

  return payload;
};

const normalizeTransportType = (value) => {
  const normalized = String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (normalized === 'texi') return 'taxi';
  if (normalized === 'selfdrive') return 'self_drive';
  return normalized;
};

const getTransportTypeLabel = (value) => {
  const normalized = normalizeTransportType(value);
  return PROMO_TRANSPORT_OPTIONS.find((item) => item.value === normalized)?.label || value || '-';
};

const HeaderBlock = ({ isCreateRoute, isEditRoute, onBack }) => {
  const title = isEditRoute ? 'Edit Promo Code' : isCreateRoute ? 'Create Promo Code' : 'Promo Code';
  return (
    <div className="mb-6">
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
        <span>Promotions</span>
        <ChevronRight size={12} />
        <span className="text-gray-700">{title}</span>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
        {isCreateRoute || isEditRoute ? (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <ArrowLeft size={16} /> Back
        </button>
      ) : null}
      </div>
    </div>
  );
};

const SectionCard = ({ icon: Icon, title, description, children }) => (
  <div className="bg-white rounded-xl border border-gray-200 p-6">
    <div className="flex items-center gap-3 mb-6 pb-4 border-b border-gray-100">
      <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600">
        <Icon size={18} />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        <p className="text-xs text-gray-400">{description}</p>
      </div>
    </div>
    {children}
  </div>
);

const FieldLabel = ({ icon: Icon, children, required = false }) => (
  <label className={labelClass}>
    <Icon size={12} className="inline mr-1 text-gray-400" />
    {children}
    {required ? ' *' : ''}
  </label>
);

const formatDate = (dateString) => {
  if (!dateString) return '-';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    return date.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch (err) {
    return dateString;
  }
};

const getStatusInfo = (promo) => {
  if (!promo.active) return { label: 'Disabled', color: 'bg-rose-50 text-rose-700' };
  const now = new Date();
  const from = new Date(promo.from);
  const to = new Date(promo.to);

  if (now < from) return { label: 'Scheduled', color: 'bg-indigo-50 text-indigo-700' };
  if (now > to) return { label: 'Expired', color: 'bg-amber-50 text-amber-700' };
  return { label: 'Active', color: 'bg-emerald-50 text-emerald-700' };
};

const PromoCodes = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();
  const isCreateRoute = location.pathname.includes('/create');
  const isEditRoute = location.pathname.includes('/edit/');
  const isFormView = isCreateRoute || isEditRoute;

  const [promos, setPromos] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [locations, setLocations] = useState([]);
  const [usersList, setUsersList] = useState([]);
  const [formData, setFormData] = useState(createInitialFormData);
  const [filters, setFilters] = useState(createInitialFilters);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [serviceLocationSearch, setServiceLocationSearch] = useState('');

  const token = (localStorage.getItem('admin_accessToken') || localStorage.getItem('adminToken')) || '';

  const filteredServiceLocations = useMemo(() => {
    const searchTerm = serviceLocationSearch.trim().toLowerCase();
    if (!searchTerm) {
      return locations;
    }

    return locations.filter((locationItem) =>
      getLocationOptionLabel(locationItem).toLowerCase().includes(searchTerm)
    );
  }, [locations, serviceLocationSearch]);

  const fetchAllUsersForDropdown = useCallback(async () => {
    const pageSize = 500;
    const maxPages = 20;
    const collectedUsers = [];

    for (let nextPage = 1; nextPage <= maxPages; nextPage += 1) {
      let response;
      try {
        response = await adminService.getUsers(nextPage, pageSize, '');
      } catch (error) {
        console.error(`Failed to load users page ${nextPage} for promo dropdown`, error);
        break;
      }

      if (!response?.success) {
        break;
      }

      const batch = extractPaginatedResults(response);
      collectedUsers.push(...batch);

      const paginator = extractPaginator(response);
      const lastPage = Math.max(1, Number(paginator?.last_page || 1));
      if (nextPage >= lastPage || batch.length === 0) {
        break;
      }
    }

    return dedupeUsersById(collectedUsers);
  }, []);

  const fetchServiceLocationsForPromo = useCallback(async () => {
    const headers = { Authorization: `Bearer ${token}` };
    const endpoints = [
      `${ADMIN_API_BASE}/promos/service-locations`,
      `${TAXI_ADMIN_API_BASE}/service-locations`,
      `${TAXI_ADMIN_API_BASE}/promos/service-locations`,
    ];

    for (const endpoint of endpoints) {
      try {
        const payload = await fetchJson(endpoint, { headers });
        const nextLocations = payload?.success ? extractServiceLocations(payload) : [];
        if (nextLocations.length > 0) {
          return nextLocations;
        }
      } catch (error) {
        console.error(`Failed to load service locations from ${endpoint}`, error);
      }
    }

    return [];
  }, [token]);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    let hasBootstrapLocations = false;
    try {
      try {
        const bootstrapData = await fetchJson(BOOTSTRAP_URL, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (bootstrapData.success) {
          setPromos(bootstrapData.data?.promo_codes || []);
          const bootstrapLocations = extractServiceLocations(bootstrapData);
          if (bootstrapLocations.length > 0) {
            setLocations(bootstrapLocations);
            hasBootstrapLocations = true;
          }
          const bootstrapUsers = dedupeUsersById(
            extractPaginatedResults(bootstrapData?.data?.users || bootstrapData?.data?.user_list || bootstrapData)
          );
          if (bootstrapUsers.length > 0) {
            setUsersList(bootstrapUsers);
          }
        }
      } catch (error) {
        console.error('Failed to load promotions bootstrap', error);
      }

      if (!hasBootstrapLocations) {
        const nextLocations = await fetchServiceLocationsForPromo();
        if (nextLocations.length > 0) {
          setLocations(nextLocations);
        }
      }

      const [promosResult, usersResult] = await Promise.allSettled([
        fetchJson(BASE, { headers: { Authorization: `Bearer ${token}` } }),
        fetchAllUsersForDropdown(),
      ]);

      if (promosResult.status === 'fulfilled') {
        const pData = promosResult.value;
        if (pData?.success) {
          setPromos(pData.data?.results || []);
        }
      } else {
        console.error('Failed to load promo codes list', promosResult.reason);
      }

      if (usersResult.status === 'fulfilled') {
        const allUsers = usersResult.value;
        if (Array.isArray(allUsers) && allUsers.length > 0) {
          setUsersList(allUsers);
        }
      } else {
        console.error('Failed to load users for promo dropdown', usersResult.reason);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, [fetchAllUsersForDropdown, fetchServiceLocationsForPromo, token]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (isEditRoute && id && promos.length > 0) {
      const promo = promos.find((p) => String(p._id) === String(id));
      if (promo) {
        setFormData({
          service_location_id: promo.service_location_id || '',
          service_location_ids: getPromoLocationIds(promo),
          transport_type: promo.transport_type || '',
          audience_type: getPromoAudienceType(promo),
          user_id: promo.user_id || '',
          code: promo.code || '',
          minimum_trip_amount: promo.minimum_trip_amount || '',
          maximum_discount_amount: promo.maximum_discount_amount || '',
          cumulative_max_discount_amount: promo.cumulative_max_discount_amount || '',
          discount_percentage: promo.discount_percentage || '',
          from: promo.from ? new Date(promo.from).toISOString().split('T')[0] : '',
          to: promo.to ? new Date(promo.to).toISOString().split('T')[0] : '',
          uses_per_user: promo.uses_per_user || '1',
          // 0 is the stored 'unlimited'; shown as blank so the placeholder explains it.
          max_uses_total: promo.max_uses_total ? String(promo.max_uses_total) : '',
          active: promo.active !== false,
        });
      }
    } else if (!isFormView) {
      setFormData(createInitialFormData());
    }
  }, [isEditRoute, isFormView, id, promos]);

  const handleFieldChange = (key, value) => {
    setFormData((current) => ({ ...current, [key]: value }));
  };

  const updateServiceLocationIds = (selectedIds) => {
    const normalizedIds = Array.from(new Set(selectedIds.map(String).filter(Boolean)));
    setFormData((current) => ({
      ...current,
      service_location_ids: normalizedIds,
      service_location_id: normalizedIds[0] || '',
    }));
  };

  const toggleServiceLocation = (locationId) => {
    updateServiceLocationIds(
      formData.service_location_ids.includes(locationId)
        ? formData.service_location_ids.filter((selectedId) => selectedId !== locationId)
        : [...formData.service_location_ids, locationId]
    );
  };

  const selectVisibleServiceLocations = () => {
    updateServiceLocationIds([
      ...formData.service_location_ids,
      ...filteredServiceLocations.map(getLocationRecordId).filter(Boolean),
    ]);
  };

  const clearServiceLocations = () => {
    updateServiceLocationIds([]);
  };

  const handleAudienceTypeChange = (value) => {
    setFormData((current) => ({
      ...current,
      audience_type: value,
      user_id: value === 'specific_user' ? current.user_id : '',
    }));
  };

  const handleFilterChange = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const clearFilters = () => {
    setFilters(createInitialFilters());
  };

  const handleSave = async (e) => {
    e.preventDefault();

    if (formData.service_location_ids.length === 0) {
      alert('Please select at least one service location');
      return;
    }

    if (new Date(formData.to) < new Date(formData.from)) {
      alert('To Date cannot be earlier than From Date');
      return;
    }

    setSubmitting(true);

    try {
      const payload = {
        ...formData,
        transport_type: normalizeTransportType(formData.transport_type),
        service_location_id: formData.service_location_ids[0] || formData.service_location_id,
        service_location_ids: formData.service_location_ids,
        user_specific: formData.audience_type === 'specific_user',
        user_id: formData.audience_type === 'specific_user' ? formData.user_id : '',
      };

      const url = isEditRoute ? `${BASE}/${id}` : BASE;
      const method = isEditRoute ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (data.success) {
        setFormData(createInitialFormData());
        await fetchData();
        navigate(LIST_PATH);
      } else {
        alert(data.message || `Failed to ${isEditRoute ? 'update' : 'create'} promo`);
      }
    } catch (error) {
      console.error(error);
      alert('Network Error');
    } finally {
      setSubmitting(false);
    }
  };

  const filteredPromos = promos.filter((promo) => {
    const matchesLocation =
      !filters.service_location_id ||
      getPromoLocationIds(promo).includes(String(filters.service_location_id));
    const matchesTransport =
      !filters.transport_type ||
      normalizeTransportType(promo.transport_type || 'all') === normalizeTransportType(filters.transport_type);
    
    const statusInfo = getStatusInfo(promo);
    const matchesStatus =
      filters.active === '' ||
      (filters.active === 'true' ? statusInfo.label === 'Active' : 
       filters.active === 'false' ? statusInfo.label === 'Disabled' :
       filters.active === 'expired' ? statusInfo.label === 'Expired' :
       filters.active === 'scheduled' ? statusInfo.label === 'Scheduled' : true);

    return matchesLocation && matchesTransport && matchesStatus;
  });

  const handleDelete = async (promoId) => {
    if (!window.confirm('Are you sure you want to delete this promo code?')) return;
    try {
      const res = await fetch(`${BASE}/${promoId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        await fetchData();
      } else {
        alert(data.message || 'Failed to delete');
      }
    } catch (err) {
      console.error(err);
      alert('Network Error');
    }
  };

  const handleToggleStatus = async (promoId) => {
    try {
      const res = await fetch(`${BASE}/${promoId}/toggle`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        await fetchData();
      } else {
        alert(data.message || 'Failed to update promo status');
      }
    } catch (err) {
      console.error(err);
      alert('Network Error');
    }
  };

  return (
    <div className="min-h-full bg-gray-50 text-gray-900">
      <HeaderBlock
        isCreateRoute={isCreateRoute}
        isEditRoute={isEditRoute}
        onBack={() => navigate(LIST_PATH)}
      />

      <AnimatePresence mode="wait">
        {!isFormView ? (
          <Motion.div
            key="list"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-6"
          >
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-3 text-sm text-gray-500">
                  <span className="font-medium text-gray-600">Promo codes management</span>
                  <span className="hidden sm:inline text-gray-300">|</span>
                  <span>Total: {filteredPromos.length}</span>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => setIsFilterOpen((current) => !current)}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <Filter size={16} /> {isFilterOpen ? 'Hide Filters' : 'Filters'}
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate(CREATE_PATH)}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm text-white bg-indigo-600 border border-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors"
                  >
                    <Plus size={16} /> Add Promo Code
                  </button>
                </div>
              </div>

              {isFilterOpen ? (
                <div className="mt-5 grid grid-cols-1 gap-4 border-t border-gray-100 pt-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <div>
                    <label className={labelClass}>Service Location</label>
                    <select
                      value={filters.service_location_id}
                      onChange={(event) => handleFilterChange('service_location_id', event.target.value)}
                      className={inputClass}
                    >
                      <option value="">All service locations</option>
                      {locations.map((locationItem) => {
                        const locationId = getLocationRecordId(locationItem);
                        return (
                          <option key={locationId} value={locationId}>
                            {getLocationOptionLabel(locationItem)}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <div>
                    <label className={labelClass}>Transport Type</label>
                    <select
                      value={filters.transport_type}
                      onChange={(event) => handleFilterChange('transport_type', event.target.value)}
                      className={inputClass}
                    >
                      <option value="">All transport types</option>
                      {PROMO_TRANSPORT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className={labelClass}>Status</label>
                    <select
                      value={filters.active}
                      onChange={(event) => handleFilterChange('active', event.target.value)}
                      className={inputClass}
                    >
                      <option value="">All statuses</option>
                      <option value="true">Active</option>
                      <option value="false">Disabled</option>
                      <option value="expired">Expired</option>
                      <option value="scheduled">Scheduled</option>
                    </select>
                  </div>

                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 md:w-auto"
                    >
                      Reset
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-gray-50">
                    <tr className="text-xs font-semibold text-gray-500">
                      <th className="px-6 py-4">Code</th>
                      <th className="px-6 py-4">Transport Type</th>
                      <th className="px-6 py-4">Audience</th>
                      <th className="px-6 py-4">Service Location</th>
                      <th className="px-6 py-4">From - To Date</th>
                      <th className="px-6 py-4">Status</th>
                      <th className="px-6 py-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {isLoading ? (
                      <tr>
                        <td colSpan="7" className="px-6 py-16 text-center text-sm text-gray-400">
                          Accessing Promotions Vault...
                        </td>
                      </tr>
                    ) : filteredPromos.length === 0 ? (
                      <tr>
                        <td colSpan="7" className="px-6 py-16 text-center">
                          <div className="flex flex-col items-center gap-3 text-gray-400">
                            <Ticket size={44} strokeWidth={1.5} />
                            <p className="text-sm font-medium">No promo codes found.</p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      filteredPromos.map((promo) => (
                        <tr key={promo._id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-4">
                            <span className="inline-flex rounded-lg bg-indigo-50 px-3 py-1.5 text-sm font-semibold text-indigo-700">
                              {promo.code}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-700">{getTransportTypeLabel(promo.transport_type)}</td>
                          <td className="px-6 py-4 text-sm text-gray-600">{getPromoAudienceLabel(promo)}</td>
                          <td className="px-6 py-4 text-sm text-gray-600">{getPromoLocationLabel(promo)}</td>
                          <td className="px-6 py-4 text-sm text-gray-600">
                            {formatDate(promo.from)} to {formatDate(promo.to)}
                          </td>
                          <td className="px-6 py-4">
                            {(() => {
                              const status = getStatusInfo(promo);
                              return (
                                <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${status.color}`}>
                                  {status.label}
                                </span>
                              );
                            })()}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => handleToggleStatus(promo._id)}
                                className={`inline-flex rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                                  promo.active !== false
                                    ? 'border-amber-200 text-amber-700 hover:bg-amber-50'
                                    : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                                }`}
                              >
                                {promo.active !== false ? 'Deactivate' : 'Activate'}
                              </button>
                              <button
                                type="button"
                                onClick={() => navigate(`/taxi/admin/promotions/promo-codes/edit/${promo._id}`)}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
                              >
                                <Pencil size={16} />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDelete(promo._id)}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-rose-600 transition-colors"
                              >
                                <Trash2 size={16} />
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
          </Motion.div>
        ) : (
          <Motion.form
            key="form"
            onSubmit={handleSave}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_280px]"
          >
            <div className="space-y-6">
              <SectionCard
                icon={Ticket}
                title={isEditRoute ? 'Edit Promo Configuration' : 'Promo Configuration'}
                description={isEditRoute ? 'Update the details and date range for this promo code.' : 'Create and target a redemption incentive without changing backend fields.'}
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <FieldLabel icon={MapPin} required>
                      Service Locations
                    </FieldLabel>
                    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
                      <div className="flex flex-col gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2">
                        <div className="relative">
                          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                          <input
                            type="search"
                            value={serviceLocationSearch}
                            onChange={(event) => setServiceLocationSearch(event.target.value)}
                            placeholder="Search service locations"
                            className="h-9 w-full rounded-md border border-gray-200 bg-white pl-9 pr-3 text-sm text-gray-800 outline-none transition-colors placeholder:text-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                          />
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs font-semibold text-gray-500">
                            {formData.service_location_ids.length} selected
                            {serviceLocationSearch.trim() ? ` • ${filteredServiceLocations.length} shown` : ` • ${locations.length} total`}
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={selectVisibleServiceLocations}
                              className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 disabled:text-gray-300"
                              disabled={filteredServiceLocations.length === 0}
                            >
                              Select visible
                            </button>
                            <span className="h-3 w-px bg-gray-200" />
                            <button
                              type="button"
                              onClick={clearServiceLocations}
                              className="text-xs font-semibold text-gray-500 hover:text-gray-700 disabled:text-gray-300"
                              disabled={formData.service_location_ids.length === 0}
                            >
                              Clear
                            </button>
                          </div>
                        </div>
                      </div>
                      <div className="max-h-48 overflow-y-auto p-2">
                        {locations.length === 0 ? (
                          <div className="rounded-md border border-dashed border-gray-200 px-3 py-6 text-center text-sm text-gray-400">
                            No service locations found.
                          </div>
                        ) : filteredServiceLocations.length === 0 ? (
                          <div className="rounded-md border border-dashed border-gray-200 px-3 py-6 text-center text-sm text-gray-400">
                            No matching service locations.
                          </div>
                        ) : (
                          filteredServiceLocations.map((locationItem) => {
                            const locationId = getLocationRecordId(locationItem);
                            const isSelected = formData.service_location_ids.includes(locationId);

                            return (
                              <button
                                key={locationId}
                                type="button"
                                onClick={() => toggleServiceLocation(locationId)}
                                className={`mb-2 flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors last:mb-0 ${
                                  isSelected
                                    ? 'border-indigo-200 bg-indigo-50 text-indigo-900'
                                    : 'border-gray-100 bg-white text-gray-700 hover:border-gray-200 hover:bg-gray-50'
                                }`}
                              >
                                <span
                                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                                    isSelected ? 'border-indigo-600 bg-indigo-600' : 'border-gray-300 bg-white'
                                  }`}
                                >
                                  {isSelected ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                                  {getLocationOptionLabel(locationItem)}
                                </span>
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-gray-400">Choose one or more service locations for this promo.</p>
                  </div>

                  <div>
                    <FieldLabel icon={Zap} required>
                      Transport Type
                    </FieldLabel>
                    <select
                      required
                      value={formData.transport_type}
                      onChange={(e) => handleFieldChange('transport_type', e.target.value)}
                      className={inputClass}
                    >
                      <option value="">Select</option>
                      {PROMO_TRANSPORT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <FieldLabel icon={Users} required>
                      Audience
                    </FieldLabel>
                    <select
                      required
                      value={formData.audience_type}
                      onChange={(e) => handleAudienceTypeChange(e.target.value)}
                      className={inputClass}
                    >
                      {PROMO_AUDIENCE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    {formData.audience_type === 'specific_user' ? (
                      <>
                        <FieldLabel icon={Users} required>
                          User
                        </FieldLabel>
                        <select
                          required
                          value={formData.user_id}
                          onChange={(e) => handleFieldChange('user_id', e.target.value)}
                          className={inputClass}
                        >
                          <option value="">Select User</option>
                          {usersList.map((user) => (
                          <option key={getUserRecordId(user)} value={getUserRecordId(user)}>
                            {getUserOptionLabel(user)}
                          </option>
                        ))}
                        </select>
                      </>
                    ) : (
                      <>
                        <FieldLabel icon={ShieldCheck}>Audience Rules</FieldLabel>
                        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">
                          {formData.audience_type === 'new_users'
                            ? 'This promo will only be shown to users who have not created any taxi ride yet.'
                            : 'This promo will be available to all eligible users in the selected service locations.'}
                        </div>
                      </>
                    )}
                  </div>

                  <div>
                    <FieldLabel icon={Ticket} required>
                      Code
                    </FieldLabel>
                    <input
                      type="text"
                      placeholder="Enter Code"
                      required
                      value={formData.code}
                      onChange={(e) => handleFieldChange('code', e.target.value.toUpperCase())}
                      className={inputClass}
                    />
                  </div>

                  <div>
                    <FieldLabel icon={IndianRupee} required>
                      Minimum Trip Amount
                    </FieldLabel>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Enter Minimum Trip Amount"
                      required
                      value={formData.minimum_trip_amount}
                      onChange={(e) => handleFieldChange('minimum_trip_amount', e.target.value)}
                      className={inputClass}
                    />
                  </div>

                  <div>
                    <FieldLabel icon={IndianRupee} required>
                      Maximum Discount Amount
                    </FieldLabel>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Enter Maximum Discount Amount"
                      required
                      value={formData.maximum_discount_amount}
                      onChange={(e) => handleFieldChange('maximum_discount_amount', e.target.value)}
                      className={inputClass}
                    />
                  </div>

                  <div>
                    <FieldLabel icon={IndianRupee} required>
                      Cumulative Maximum Discount Amount
                    </FieldLabel>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Enter Cumulative Maximum Discount Amount"
                      required
                      value={formData.cumulative_max_discount_amount}
                      onChange={(e) => handleFieldChange('cumulative_max_discount_amount', e.target.value)}
                      className={inputClass}
                    />
                  </div>

                  <div>
                    <FieldLabel icon={Percent} required>
                      Discount Percentage
                    </FieldLabel>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Enter Discount Percentage"
                      required
                      value={formData.discount_percentage}
                      onChange={(e) => handleFieldChange('discount_percentage', e.target.value)}
                      className={inputClass}
                    />
                  </div>

                  <div>
                    <FieldLabel icon={Calendar} required>
                      From Date
                    </FieldLabel>
                    <input
                      type="date"
                      required
                      value={formData.from}
                      onChange={(e) => handleFieldChange('from', e.target.value)}
                      className={inputClass}
                    />
                  </div>

                  <div>
                    <FieldLabel icon={Calendar} required>
                      To Date
                    </FieldLabel>
                    <input
                      type="date"
                      required
                      value={formData.to}
                      onChange={(e) => handleFieldChange('to', e.target.value)}
                      className={inputClass}
                    />
                  </div>

                  <div className="md:col-span-2">
                    <FieldLabel icon={Hash} required>
                      How many times the user can use Same promo code?
                    </FieldLabel>
                    <input
                      type="number"
                      min="1"
                      placeholder="Enter how many times the user can use same promo code"
                      required
                      value={formData.uses_per_user}
                      onChange={(e) => handleFieldChange('uses_per_user', e.target.value)}
                      className={inputClass}
                    />
                  </div>

                  <div className="md:col-span-2">
                    <FieldLabel icon={Users}>
                      Total uses across all users
                    </FieldLabel>
                    <input
                      type="number"
                      min="0"
                      placeholder="Leave blank for unlimited"
                      value={formData.max_uses_total}
                      onChange={(e) => handleFieldChange('max_uses_total', e.target.value)}
                      className={inputClass}
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      The whole promo stops once this many rides have used it, whoever used them.
                      Blank or 0 means no limit.
                    </p>
                  </div>

                  <div className="md:col-span-2">
                    <FieldLabel icon={ShieldCheck}>Promo Status</FieldLabel>
                    <label className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3">
                      <input
                        type="checkbox"
                        checked={formData.active}
                        onChange={(e) => handleFieldChange('active', e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <div>
                        <p className="text-sm font-medium text-gray-800">Promo is active</p>
                        <p className="text-xs text-gray-400">Uncheck to save this promo in deactivated state.</p>
                      </div>
                    </label>
                  </div>
                </div>
              </SectionCard>
            </div>

            <div className="space-y-6">
              <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-3">
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-3 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
                >
                  {submitting ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                  {isEditRoute ? 'Update Promo Code' : 'Save Promo Code'}
                </button>
                <button
                  type="button"
                  onClick={() => navigate(LIST_PATH)}
                  className="w-full py-3 bg-gray-50 text-gray-600 border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-100 transition-colors"
                >
                  Cancel
                </button>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <h3 className="text-sm font-semibold text-gray-900 mb-2">How It Works</h3>
                <p className="text-xs leading-5 text-gray-500">
                  Service location, transport module, discount limits, end-of-day expiry, status control, and uses-per-user sab fields active hain.
                </p>
              </div>
            </div>
          </Motion.form>
        )}
      </AnimatePresence>
    </div>
  );
};

export default PromoCodes;
