import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Car,
  ChevronRight,
  Trash2,
  Edit2,
  ArrowLeft,
  Upload,
  Info,
  Save,
  Activity,
  X,
  CheckCircle2,
  Package,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../../../shared/api/axiosInstance';
import { useTaxiTransportTypes } from '../../../../shared/hooks/useTaxiTransportTypes';

import CarIcon from '../../../../assets/icons/car.png';
import BikeIcon from '../../../../assets/icons/bike.png';
import AutoIcon from '../../../../assets/icons/auto.png';
import TruckIcon from '../../../../assets/icons/truck.png';
import EhcvIcon from '../../../../assets/icons/ehcv.png';
import HcvIcon from '../../../../assets/icons/hcv.png';
import LcvIcon from '../../../../assets/icons/LCV.png';
import McvIcon from '../../../../assets/icons/mcv.png';
import LuxuryIcon from '../../../../assets/icons/Luxury.png';
import PremiumIcon from '../../../../assets/icons/Premium.png';
import SuvIcon from '../../../../assets/icons/SUV.png';
import MapBackground from '../../../../assets/map_image.png';
import trucksImg from '@/assets/images/delivery/trucks.png';
import bikeImg from '@/assets/images/delivery/bike.png';
import moversImg from '@/assets/images/delivery/movers.png';

const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition-all focus:border-primary-orange/40 focus:ring-2 focus:ring-primary-orange/10';
const labelClass = 'mb-2 block text-[12px] font-bold text-slate-700';

const iconMap = {
  car: CarIcon,
  bike: BikeIcon,
  auto: AutoIcon,
  truck: TruckIcon,
  ehcb: EhcvIcon,
  HCV: HcvIcon,
  LCV: LcvIcon,
  MCV: McvIcon,
  Luxary: LuxuryIcon,
  premium: PremiumIcon,
  suv: SuvIcon,
};

const ICON_TYPE_ALIASES = {
  motor_bike: 'bike',
  motorbike: 'bike',
  mini_truck: 'truck',
  'mini truck': 'truck',
  pooling_truck: 'truck',
  'pooling truck': 'truck',
  loader: 'truck',
  hcv: 'HCV',
  lcv: 'LCV',
  mcv: 'MCV',
  luxary: 'Luxary',
};

const normalizeIconType = (value = '') => {
  const raw = String(value || '').trim();
  if (!raw) return 'car';
  const lower = raw.toLowerCase();
  if (ICON_TYPE_ALIASES[lower]) return ICON_TYPE_ALIASES[lower];
  const exactKey = Object.keys(iconMap).find((key) => key.toLowerCase() === lower);
  return exactKey || 'car';
};

const OBJECT_ID_PATTERN = /^[a-fA-F0-9]{24}$/;

const normalizeTransportType = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'delivery') return 'delivery';
  if (normalized === 'pooling') return 'pooling';
  if (normalized === 'both' || normalized === 'all') return 'both';
  return 'taxi';
};

const normalizeTaxiMode = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'delivery') return 'delivery';
  if (normalized === 'pooling') return 'pooling';
  if (normalized === 'both' || normalized === 'all') return 'both';
  return 'taxi';
};

const sanitizeObjectIdList = (items = []) =>
  (Array.isArray(items) ? items : [])
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object') {
        return String(item._id || item.id || '').trim();
      }
      return '';
    })
    .filter((item, index, array) => OBJECT_ID_PATTERN.test(item) && array.indexOf(item) === index);

const defaultFormData = {
  name: '',
  short_description: '',
  description: '',
  transport_type: 'taxi',
  dispatch_type: 'normal',
  bid_step_amount: 10,
  bid_step_count: 4,
  bid_max_increase: 0,
  icon_types: 'car',
  image: '',
  map_icon: '',
  capacity: 0,
  size: '',
  is_taxi: 'taxi',
  is_accept_share_ride: 0,
  delivery_category: '',
  delivery_distance_pricing: {
    enabled: false,
    base_price: '',
    free_distance: '',
    distance_price: '',
    free_time: '',
    time_price: '',
  },
  status: 1,
  active: true,
  supported_other_vehicle_types: [],
  // Empty = offered under every module. Never default this to "all module
  // ids": an admin who adds a module later would then have to revisit every
  // vehicle to include it.
  app_modules: [],
  vehicle_preference: [],
};

const DELIVERY_CATEGORY_OPTIONS = [
  {
    id: 'trucks',
    title: 'Trucks',
    image: trucksImg,
    description: 'Heavy goods, loaders, and cargo-style delivery vehicles.',
  },
  {
    id: '2wheeler',
    title: '2 Wheeler',
    image: bikeImg,
    description: 'Fast lightweight parcel bikes and two-wheel delivery options.',
  },
  {
    id: 'movers',
    title: 'Packers & Movers',
    image: moversImg,
    description: 'Home shifting, helper-based, and larger move services.',
  },
];

const TRANSPORT_TYPE_OPTIONS = [
  { id: 'taxi', name: 'taxi', display_name: 'Ride' },
  { id: 'delivery', name: 'delivery', display_name: 'Delivery' },
  { id: 'both', name: 'both', display_name: 'Both' },
];

const unwrap = (response) => response?.data?.data || response?.data || response;

const normalizeDeliveryDistancePricing = (value = {}) => ({
  enabled: Boolean(value?.enabled),
  base_price: String(value?.base_price ?? ''),
  free_distance: String(value?.free_distance ?? ''),
  distance_price: String(value?.distance_price ?? ''),
  free_time: String(value?.free_time ?? ''),
  time_price: String(value?.time_price ?? ''),
});

const normalizeVehicle = (item = {}) => ({
  ...item,
  id: String(item?._id || item?.id || ''),
});

const fileToDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const StatusToggle = ({ active, onToggle }) => (
  <button
    type="button"
    onClick={(e) => {
      e.stopPropagation();
      onToggle();
    }}
    className={`relative h-6 w-12 rounded-full transition-all ${active ? 'bg-emerald-500' : 'bg-slate-300'}`}
  >
    <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-all ${active ? 'left-7' : 'left-1'}`} />
  </button>
);

const VehicleMultiSelect = ({
  label,
  options,
  value,
  onChange,
  placeholder = 'Select options',
}) => {
  const selectedItems = options.filter((item) => value.includes(String(item.id || item._id)));

  const handleSelect = (event) => {
    const nextValue = event.target.value;
    if (!nextValue || value.includes(nextValue)) {
      return;
    }
    onChange([...value, nextValue]);
  };

  const removeItem = (id) => onChange(value.filter((item) => item !== id));

  return (
    <div>
      <label className={labelClass}>{label}</label>
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="mb-3 flex flex-wrap gap-2">
          {selectedItems.length ? selectedItems.map((item) => (
            <span
              key={String(item.id || item._id)}
              className="inline-flex items-center gap-2 rounded-full bg-slate-700 px-3 py-1.5 text-[12px] font-semibold text-white"
            >
              {item.name}
              <button
                type="button"
                onClick={() => removeItem(String(item.id || item._id))}
                className="opacity-80 transition hover:opacity-100"
              >
                <X size={12} />
              </button>
            </span>
          )) : (
            <p className="text-[12px] text-slate-400">{placeholder}</p>
          )}
        </div>
        <select value="" onChange={handleSelect} className={inputClass}>
          <option value="">Add option</option>
          {options
            .filter((item) => !value.includes(String(item.id || item._id)))
            .map((item) => (
              <option key={String(item.id || item._id)} value={String(item.id || item._id)}>
                {item.name}
              </option>
            ))}
        </select>
      </div>
    </div>
  );
};

const VehicleType = ({ mode: propMode }) => {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditor = propMode === 'create' || propMode === 'edit';
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [pagination, setPagination] = useState({ total: 0, current_page: 1 });
  // The modules an admin has actually created, not a hardcoded list, so a
  // new module appears here the moment it exists.
  const [appModules, setAppModules] = useState([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [formData, setFormData] = useState({ ...defaultFormData, transport_type: '' });
  const { transportTypes } = useTaxiTransportTypes();
  const transportTypeOptions = useMemo(() => {
    const normalized = new Map();

    [...TRANSPORT_TYPE_OPTIONS, ...(Array.isArray(transportTypes) ? transportTypes : [])].forEach((item) => {
      const value = normalizeTransportType(item?.name || item?.transport_type || item?.id || '');
      if (!value) return;

      normalized.set(value, {
        id: item?.id || item?._id || value,
        name: value,
        display_name:
          value === 'both'
            ? 'Taxi & Delivery'
            : value === 'taxi'
              ? 'Taxi'
              : (item?.display_name || item?.label || value.charAt(0).toUpperCase() + value.slice(1)),
      });
    });

    return Array.from(normalized.values());
  }, [transportTypes]);

  useEffect(() => {
    let mounted = true;

    const loadData = async () => {
      setLoading(true);
      setErrorMessage('');

      try {
        const [vehicleResponse] = await Promise.all([
          api.get('/admin/types/vehicle-types'),
        ]);

        if (!mounted) {
          return;
        }

        const vehiclePayload = unwrap(vehicleResponse);
        const vehicleResults = Array.isArray(vehiclePayload?.results)
          ? vehiclePayload.results
          : Array.isArray(vehiclePayload)
            ? vehiclePayload
            : [];
        const normalizedVehicles = vehicleResults.map(normalizeVehicle);
        setVehicles(normalizedVehicles);
        setPagination(vehiclePayload?.paginator || { total: normalizedVehicles.length, current_page: 1 });

        if (id) {
          const selectedVehicle = normalizedVehicles.find((item) => String(item.id) === String(id));
          if (selectedVehicle) {
            setFormData({
              name: selectedVehicle.name || '',
              short_description: selectedVehicle.short_description || '',
              description: selectedVehicle.description || '',
              transport_type: selectedVehicle.transport_type || 'taxi',
              dispatch_type: selectedVehicle.dispatch_type || selectedVehicle.trip_dispatch_type || 'normal',
              bid_step_amount: Number(selectedVehicle.bid_step_amount ?? 10),
              bid_step_count: Number(selectedVehicle.bid_step_count ?? 4),
              bid_max_increase: Number(selectedVehicle.bid_max_increase ?? 0),
              icon_types: normalizeIconType(selectedVehicle.icon_types || selectedVehicle.icon_types_for),
              image: selectedVehicle.image || '',
              map_icon: selectedVehicle.map_icon || selectedVehicle.icon || selectedVehicle.image || '',
              capacity: Number(selectedVehicle.capacity || 0),
              size: String(selectedVehicle.size || ''),
              is_taxi: selectedVehicle.is_taxi || 'taxi',
              is_accept_share_ride: Number(selectedVehicle.is_accept_share_ride || 0),
              delivery_category: String(selectedVehicle.delivery_category || ''),
              delivery_distance_pricing: normalizeDeliveryDistancePricing(selectedVehicle.delivery_distance_pricing),
              status: Number(selectedVehicle.status ?? (selectedVehicle.active !== false ? 1 : 0)),
              active: selectedVehicle.active !== false && Number(selectedVehicle.status ?? 1) !== 0,
              app_modules: Array.isArray(selectedVehicle.app_modules)
                ? selectedVehicle.app_modules.map((item) => String(item?._id || item))
                : [],
              supported_other_vehicle_types: Array.isArray(selectedVehicle.supported_other_vehicle_types)
                ? selectedVehicle.supported_other_vehicle_types.map((item) => String(item?._id || item))
                : typeof selectedVehicle.supported_vehicles === 'string' && selectedVehicle.supported_vehicles
                  ? selectedVehicle.supported_vehicles.split(',').map((item) => item.trim()).filter(Boolean)
                  : [],
              vehicle_preference: Array.isArray(selectedVehicle.vehicle_preference)
                ? selectedVehicle.vehicle_preference.map((item) => String(item?._id || item))
                : [],
            });
          }
        } else if (propMode === 'create') {
          setFormData(defaultFormData);
        }
      } catch (error) {
        if (mounted) {
          setErrorMessage(error.message || 'Could not load vehicle types.');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadData();

    return () => {
      mounted = false;
    };
  }, [id, propMode]);

  const previewImage = useMemo(() => {
    if (formData.image && typeof formData.image === 'string') {
      return formData.image;
    }
    return '';
  }, [formData.image]);

  const mapIconPreview = useMemo(() => {
    if (formData.map_icon && typeof formData.map_icon === 'string') {
      return formData.map_icon;
    }
    return iconMap[formData.icon_types] || CarIcon;
  }, [formData.icon_types, formData.map_icon]);

  // The modules an admin has actually created, so a new one appears in the
  // picker the moment it exists rather than needing a code change.
  useEffect(() => {
    let cancelled = false;
    api
      .get('/admin/common/app-modules', { params: { per_page: 100 } })
      .then((response) => {
        if (cancelled) return;
        const payload = unwrap(response);
        const rows = Array.isArray(payload?.results)
          ? payload.results
          : Array.isArray(payload)
            ? payload
            : [];
        setAppModules(
          rows.map((row) => ({
            id: String(row._id || row.id),
            name: row.name || 'Module',
          })),
        );
      })
      // A module list that fails to load must not block saving a vehicle:
      // the picker stays empty, which means "every module".
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const availableSupportVehicles = useMemo(
    () => vehicles.filter((item) => String(item.id) !== String(id)),
    [id, vehicles],
  );

  const showsDeliveryCategorySelector = useMemo(
    () => ['delivery', 'both'].includes(normalizeTransportType(formData.transport_type)),
    [formData.transport_type],
  );

  const updateForm = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleImageChange = async (event, field = 'image') => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const dataUrl = await fileToDataUrl(file);
    updateForm(field, dataUrl);
    event.target.value = '';
  };

  const handleSave = async () => {
    setIsSaving(true);
    setErrorMessage('');

    try {
      if (showsDeliveryCategorySelector && !formData.delivery_category) {
        throw new Error('Choose a delivery category for this delivery-enabled vehicle type.');
      }

      const payload = {
        name: formData.name.trim(),
        short_description: formData.short_description.trim(),
        description: formData.description.trim(),
        transport_type: normalizeTransportType(formData.transport_type),
        dispatch_type: formData.dispatch_type,
        bid_step_amount: Number(formData.bid_step_amount || 10),
        bid_step_count: Number(formData.bid_step_count || 4),
        bid_max_increase: Number(formData.bid_max_increase || 0),
        icon_types: normalizeIconType(formData.icon_types),
        image: formData.image || '',
        icon: formData.map_icon || '',
        map_icon: formData.map_icon || '',
        capacity: Number(formData.capacity || 0),
        size: formData.size,
        is_taxi: normalizeTaxiMode(formData.is_taxi || formData.transport_type),
        is_accept_share_ride: Number(formData.is_accept_share_ride || 0),
        delivery_category: showsDeliveryCategorySelector ? formData.delivery_category : '',
        delivery_distance_pricing: showsDeliveryCategorySelector
          ? {
              enabled: Boolean(formData.delivery_distance_pricing?.enabled),
              base_price: Number(formData.delivery_distance_pricing?.base_price || 0),
              free_distance: Number(formData.delivery_distance_pricing?.free_distance || 0),
              distance_price: Number(formData.delivery_distance_pricing?.distance_price || 0),
              free_time: Number(formData.delivery_distance_pricing?.free_time || 0),
              time_price: Number(formData.delivery_distance_pricing?.time_price || 0),
            }
          : {
              enabled: false,
              base_price: 0,
              free_distance: 0,
              distance_price: 0,
              free_time: 0,
              time_price: 0,
            },
        status: formData.active ? 1 : 0,
        active: formData.active,
        app_modules: sanitizeObjectIdList(formData.app_modules),
        supported_other_vehicle_types: sanitizeObjectIdList(formData.supported_other_vehicle_types),
        vehicle_preference: sanitizeObjectIdList(formData.vehicle_preference),
      };

      if (id) {
        await api.patch(`/admin/types/vehicle-types/${id}`, payload);
      } else {
        await api.post('/admin/types/vehicle-types', payload);
      }

      navigate('/taxi/admin/pricing/vehicle-type');
    } catch (error) {
      setErrorMessage(error?.response?.data?.message || error.message || 'Could not save vehicle type.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (vehicleId) => {
    if (!window.confirm('Delete this vehicle type?')) {
      return;
    }

    try {
      await api.delete(`/admin/types/vehicle-types/${vehicleId}`);
      setVehicles((prev) => prev.filter((item) => String(item.id) !== String(vehicleId)));
    } catch (error) {
      setErrorMessage(error.message || 'Could not delete vehicle type.');
    }
  };

  if (!isEditor) {
    return (
      <div className="min-h-screen bg-[#f6f7fb] p-6 lg:p-8">
        <div className="mb-6">
          <div className="mb-2 flex items-center gap-1.5 text-xs text-slate-400">
            <span>Pricing</span>
            <ChevronRight size={12} />
            <span className="text-slate-700">Vehicle Type</span>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Vehicle Type</h1>
              <p className="mt-1 text-sm text-slate-500">Manage the ride and delivery vehicle catalog.</p>
            </div>
            <button
              onClick={() => navigate('/taxi/admin/pricing/vehicle-type/create')}
              className="inline-flex items-center gap-2 rounded-xl bg-[#ff6b4a] px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-primary-orange/20 transition hover:bg-[#f55a37]"
            >
              <Plus size={18} />
              Add Vehicle
            </button>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-5 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-orange/5 text-primary-orange/50">
                <Car size={20} />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Total Types</p>
                <p className="text-2xl font-bold text-slate-900">{vehicles.length}</p>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-500">
                <Activity size={20} />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Active</p>
                <p className="text-2xl font-bold text-slate-900">{vehicles.filter((item) => item.active !== false).length}</p>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-500">
                <Package size={20} />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Delivery Types</p>
                <p className="text-2xl font-bold text-slate-900">{vehicles.filter((item) => ['delivery', 'both'].includes(String(item.transport_type || '').toLowerCase())).length}</p>
              </div>
            </div>
          </div>
        </div>

        {errorMessage ? (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
            {errorMessage}
          </div>
        ) : null}

        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">Vehicle</th>
                  <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">Transport</th>
                  <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">Dispatch</th>
                  <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">Active</th>
                  <th className="px-6 py-4 text-right text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="5" className="px-6 py-20 text-center text-sm text-slate-400">Loading vehicle types...</td>
                  </tr>
                ) : !vehicles.length ? (
                  <tr>
                    <td colSpan="5" className="px-6 py-20 text-center text-sm text-slate-400">No vehicle types found.</td>
                  </tr>
                ) : vehicles.map((vehicle) => (
                  <tr key={vehicle.id} className="border-t border-slate-100">
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-4">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50">
                          <img src={vehicle.image || vehicle.map_icon || vehicle.icon || iconMap[normalizeIconType(vehicle.icon_types)] || CarIcon} alt={vehicle.name} className="h-10 w-10 object-contain" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{vehicle.name}</p>
                          <p className="text-xs text-slate-500">{vehicle.short_description || vehicle.description || 'No description added'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                        String(vehicle.transport_type || '').toLowerCase() === 'delivery'
                          ? 'bg-primary-orange/5 text-accent-orange'
                          : String(vehicle.transport_type || '').toLowerCase() === 'both'
                            ? 'bg-emerald-50 text-emerald-600'
                            : 'bg-blue-50 text-blue-600'
                      }`}>
                        {vehicle.transport_type}
                      </span>
                    </td>
                    <td className="px-6 py-5 text-sm font-medium text-slate-700">{vehicle.trip_dispatch_type || vehicle.dispatch_type || 'normal'}</td>
                    <td className="px-6 py-5">
                      <StatusToggle active={vehicle.active !== false} onToggle={() => {}} />
                    </td>
                    <td className="px-6 py-5">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => navigate(`/taxi/admin/pricing/vehicle-type/edit/${vehicle.id}`)}
                          className="rounded-xl p-2 text-slate-400 transition hover:bg-blue-50 hover:text-blue-600"
                        >
                          <Edit2 size={15} />
                        </button>
                        <button
                          onClick={() => handleDelete(vehicle.id)}
                          className="rounded-xl p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f6f7fb] p-6 lg:p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="mb-2 flex items-center gap-1.5 text-xs text-slate-400">
            <span>Pricing</span>
            <ChevronRight size={12} />
            <span className="text-slate-700">Vehicle Type</span>
            <ChevronRight size={12} />
            <span className="text-slate-700">{id ? 'Edit' : 'Create'}</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">{id ? 'Edit Vehicle Type' : 'Create Vehicle Type'}</h1>
          <p className="mt-1 text-sm text-slate-500">Update the live vehicle catalog with real transport, icon, dispatch, and compatibility data.</p>
        </div>
        <button
          onClick={() => navigate('/taxi/admin/pricing/vehicle-type')}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
        >
          <ArrowLeft size={16} />
          Back
        </button>
      </div>

      {errorMessage ? (
        <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
          {errorMessage}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
        <div className="grid grid-cols-1 gap-8 p-6 lg:grid-cols-2 lg:p-8">
          <div>
            <label className={labelClass}>Transport Type *</label>
            <select
              value={formData.transport_type}
              onChange={(e) => {
                const nextTransportType = e.target.value;
                updateForm('transport_type', nextTransportType);
                if (!['delivery', 'both'].includes(normalizeTransportType(nextTransportType))) {
                  updateForm('delivery_category', '');
                  updateForm('delivery_distance_pricing', normalizeDeliveryDistancePricing());
                }
              }}
              className={inputClass}
            >
               <option value="">Select Transport Type</option>
               {transportTypeOptions.map((t) => (
                 <option key={t.id || t._id || t.name} value={t.name}>{t.display_name}</option>
               ))}
            </select>
            <p className="mt-2 text-xs text-slate-500">
              Choose `Both` for vehicle types like bikes that can handle ride and parcel flows.
            </p>
          </div>

          <div>
            <label className={labelClass}>Icon Type *</label>
            <select value={formData.icon_types} onChange={(e) => updateForm('icon_types', e.target.value)} className={inputClass}>
              {Object.keys(iconMap).map((key) => (
                <option key={key} value={key}>{key}</option>
              ))}
            </select>
          </div>

          {showsDeliveryCategorySelector ? (
            <div className="lg:col-span-2">
              <label className={labelClass}>Delivery Category *</label>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {DELIVERY_CATEGORY_OPTIONS.map((option) => {
                  const selected = formData.delivery_category === option.id;

                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => updateForm('delivery_category', option.id)}
                      className={`rounded-[24px] border p-4 text-left transition-all ${
                        selected
                          ? 'border-[#0047AB] bg-[#EEF4FF] shadow-md'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
                      }`}
                    >
                      <div className="rounded-[20px] bg-slate-50 p-3">
                        <img src={option.image} alt={option.title} className="mx-auto h-24 w-full object-contain" />
                      </div>
                      <div className="mt-4 flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-black text-slate-900">{option.title}</p>
                          <p className="mt-1 text-xs font-medium leading-5 text-slate-500">{option.description}</p>
                        </div>
                        <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                          selected ? 'border-[#0047AB] bg-[#0047AB] text-white' : 'border-slate-300 bg-white'
                        }`}>
                          {selected ? <CheckCircle2 size={12} /> : null}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                This decides which delivery card this vehicle type appears under in the user parcel flow.
              </p>
            </div>
          ) : null}

          {showsDeliveryCategorySelector ? (
            <div className="lg:col-span-2 rounded-[28px] border border-slate-200 bg-slate-50/70 p-5">
              <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <label className={labelClass}>Delivery Distance Based Charges</label>
                  <p className="text-xs text-slate-500">
                    Enable quick parcel pricing defaults for this delivery-enabled vehicle type.
                  </p>
                </div>
                <label className="inline-flex items-center gap-3 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={Boolean(formData.delivery_distance_pricing?.enabled)}
                    onChange={(e) => updateForm('delivery_distance_pricing', {
                      ...formData.delivery_distance_pricing,
                      enabled: e.target.checked,
                    })}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  Enable distance based charges
                </label>
              </div>

              <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
                <div>
                  <label className={labelClass}>Base Price</label>
                  <input
                    type="number"
                    min="0"
                    value={formData.delivery_distance_pricing?.base_price ?? ''}
                    onChange={(e) => updateForm('delivery_distance_pricing', {
                      ...formData.delivery_distance_pricing,
                      base_price: e.target.value,
                    })}
                    className={inputClass}
                    placeholder="45"
                    disabled={!formData.delivery_distance_pricing?.enabled}
                  />
                </div>

                <div>
                  <label className={labelClass}>Free Distance (KM)</label>
                  <input
                    type="number"
                    min="0"
                    value={formData.delivery_distance_pricing?.free_distance ?? ''}
                    onChange={(e) => updateForm('delivery_distance_pricing', {
                      ...formData.delivery_distance_pricing,
                      free_distance: e.target.value,
                    })}
                    className={inputClass}
                    placeholder="2"
                    disabled={!formData.delivery_distance_pricing?.enabled}
                  />
                </div>

                <div>
                  <label className={labelClass}>Distance Price</label>
                  <input
                    type="number"
                    min="0"
                    value={formData.delivery_distance_pricing?.distance_price ?? ''}
                    onChange={(e) => updateForm('delivery_distance_pricing', {
                      ...formData.delivery_distance_pricing,
                      distance_price: e.target.value,
                    })}
                    className={inputClass}
                    placeholder="12"
                    disabled={!formData.delivery_distance_pricing?.enabled}
                  />
                </div>

                <div>
                  <label className={labelClass}>Free Time (Min)</label>
                  <input
                    type="number"
                    min="0"
                    value={formData.delivery_distance_pricing?.free_time ?? ''}
                    onChange={(e) => updateForm('delivery_distance_pricing', {
                      ...formData.delivery_distance_pricing,
                      free_time: e.target.value,
                    })}
                    className={inputClass}
                    placeholder="0"
                    disabled={!formData.delivery_distance_pricing?.enabled}
                  />
                </div>

                <div>
                  <label className={labelClass}>Time Price</label>
                  <input
                    type="number"
                    min="0"
                    value={formData.delivery_distance_pricing?.time_price ?? ''}
                    onChange={(e) => updateForm('delivery_distance_pricing', {
                      ...formData.delivery_distance_pricing,
                      time_price: e.target.value,
                    })}
                    className={inputClass}
                    placeholder="0"
                    disabled={!formData.delivery_distance_pricing?.enabled}
                  />
                </div>
              </div>

              <p className="mt-3 text-xs text-slate-500">
                This section only appears when the vehicle supports `Delivery` or `Both`.
              </p>
            </div>
          ) : null}

          <div>
            <label className={labelClass}>Preview Image</label>
            <div className="rounded-2xl border border-dashed border-slate-300 p-4">
              <div className="group relative flex min-h-[320px] items-center justify-center overflow-hidden rounded-2xl bg-slate-50">
                {previewImage ? (
                  <>
                    <img src={previewImage} alt="Vehicle preview" className="max-h-[280px] w-full object-contain p-4" />
                    <button
                      type="button"
                      onClick={() => updateForm('image', '')}
                      className="absolute right-3 top-3 rounded-xl bg-white p-2 text-red-500 shadow-sm transition hover:bg-red-500 hover:text-white"
                    >
                      <Trash2 size={16} />
                    </button>
                  </>
                ) : (
                  <label className="flex cursor-pointer flex-col items-center gap-3">
                    <input type="file" accept="image/*" className="hidden" onChange={(event) => handleImageChange(event, 'image')} />
                    <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-primary-orange/50 shadow-sm">
                      <Upload size={20} />
                    </span>
                    <span className="text-sm font-semibold text-slate-700">Upload preview image</span>
                    <span className="text-xs text-slate-400">This shows in the user vehicle selection card</span>
                  </label>
                )}
              </div>
            </div>
            <div className="mt-4 rounded-[24px] border border-primary-orange/10 bg-gradient-to-r from-white via-primary-orange/5/30 to-white p-3 shadow-sm">
              <p className="mb-2 text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">User Card Preview</p>
              <div className="flex items-center gap-3 rounded-[20px] border border-primary-orange/80 bg-white px-3 py-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-100">
                  <img
                    src={previewImage || mapIconPreview}
                    alt="User card vehicle preview"
                    className="h-10 w-10 object-contain"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-black text-slate-900">{formData.name || 'Taxi'}</p>
                    <span className="rounded bg-primary-orange/50 px-1.5 py-0.5 text-[7px] font-black text-white">FASTEST</span>
                  </div>
                  <p className="truncate text-[11px] font-bold text-slate-500">{formData.short_description || formData.description || 'Closest driver 940 m away'}</p>
                </div>
                <p className="text-sm font-black text-slate-900">₹31</p>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-800">Live Map Icon Preview</p>
                  <p className="text-[11px] font-medium text-slate-500">This uploaded icon is saved to the DB and used on app maps.</p>
                </div>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-white px-3 py-2 text-[11px] font-bold text-slate-700 shadow-sm transition hover:text-primary-orange/50">
                  <Upload size={14} />
                  Change
                  <input type="file" accept="image/*" className="hidden" onChange={(event) => handleImageChange(event, 'map_icon')} />
                </label>
              </div>
              <div className="relative h-[228px] overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <img src={MapBackground} alt="Map preview" className="absolute inset-0 h-full w-full object-cover opacity-25" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <img src={mapIconPreview} alt="Icon preview" className="h-16 w-16 object-contain drop-shadow-xl" />
                </div>
              </div>
              {formData.map_icon ? (
                <button
                  type="button"
                  onClick={() => updateForm('map_icon', '')}
                  className="mt-3 text-[11px] font-bold text-red-500 transition hover:text-red-600"
                >
                  Remove uploaded map icon and use the selected icon type fallback
                </button>
              ) : null}
            </div>

          <div>
            <label className={labelClass}>Maximum Weight / Capacity *</label>
            <input
              type="number"
              value={formData.capacity}
                onChange={(e) => updateForm('capacity', e.target.value)}
                className={inputClass}
              placeholder="12"
            />
          </div>

          <div>
            <label className={labelClass}>Short Description *</label>
            <input
                type="text"
                value={formData.short_description}
                onChange={(e) => updateForm('short_description', e.target.value)}
                className={inputClass}
                placeholder="Normal Delivery"
              />
            </div>
          </div>

          <div>
            <label className={labelClass}>Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => updateForm('name', e.target.value)}
              className={inputClass}
              placeholder="Parcel"
            />
          </div>

          <div>
            <label className={labelClass}>Trip Dispatch Type *</label>
            <select value={formData.dispatch_type} onChange={(e) => updateForm('dispatch_type', e.target.value)} className={inputClass}>
              <option value="normal">Normal</option>
              <option value="bidding">Bidding</option>
              <option value="both">Both</option>
            </select>
          </div>

          {['bidding', 'both'].includes(formData.dispatch_type) && (
            <div className="md:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-700">Fare boost offered to riders</p>
              <p className="mt-1 text-xs text-slate-500">
                While a rider waits for a captain, the app offers these buttons to raise the fare
                and search again. Set them per vehicle &mdash; &#8377;10 moves nobody on a &#8377;900 fare.
              </p>
              <div className="mt-3 grid gap-4 md:grid-cols-3">
                <div>
                  <label className={labelClass}>Step amount (&#8377;)</label>
                  <input
                    type="number"
                    min="1"
                    value={formData.bid_step_amount}
                    onChange={(e) => updateForm('bid_step_amount', e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>How many buttons</label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={formData.bid_step_count}
                    onChange={(e) => updateForm('bid_step_count', e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Maximum extra (&#8377;)</label>
                  <input
                    type="number"
                    min="0"
                    value={formData.bid_max_increase}
                    onChange={(e) => updateForm('bid_max_increase', e.target.value)}
                    className={inputClass}
                  />
                  <p className="mt-1 text-xs text-slate-400">0 = the buttons&#39; own total</p>
                </div>
              </div>
              <p className="mt-3 text-xs font-medium text-slate-600">
                Rider sees:{' '}
                {Array.from(
                  { length: Math.min(10, Math.max(1, Number(formData.bid_step_count || 4))) },
                  (unused, index) =>
                    `+\u20B9${(index + 1) * Math.max(1, Number(formData.bid_step_amount || 10))}`,
                ).join('  ')}
              </p>
            </div>
          )}

          <div>
            <label className={labelClass}>Size *</label>
            <input
              type="text"
              value={formData.size}
              onChange={(e) => updateForm('size', e.target.value)}
              className={inputClass}
              placeholder="2"
            />
          </div>

          <div>
            <label className={labelClass}>Operational Scope *</label>
            <select value={formData.is_taxi} onChange={(e) => updateForm('is_taxi', e.target.value)} className={inputClass}>
              <option value="">Select Scope</option>
              {transportTypeOptions.map(t => (
                <option key={t.id || t._id} value={t.name}>{t.display_name}</option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-2">
            <label className={labelClass}>Description *</label>
            <textarea
              rows="4"
              value={formData.description}
              onChange={(e) => updateForm('description', e.target.value)}
              className={inputClass}
              placeholder="Parcel Delivery"
            />
          </div>

          <div className="lg:col-span-2">
            <VehicleMultiSelect
              label="App Modules"
              options={appModules}
              value={formData.app_modules}
              onChange={(next) => updateForm('app_modules', next)}
              placeholder="Offered under every module"
            />
            <p className="mt-1.5 text-xs text-slate-500">
              Which home-screen modules offer this vehicle. Pick none to offer
              it under all of them — so Bike Taxi can show only Scooty,
              Motorcycle and EV Scooty.
            </p>
          </div>

          <div className="lg:col-span-2">
            <VehicleMultiSelect
              label="Supported Other Vehicle Types"
              options={availableSupportVehicles}
              value={formData.supported_other_vehicle_types}
              onChange={(next) => updateForm('supported_other_vehicle_types', next)}
              placeholder="No supporting vehicle types selected"
            />
          </div>

        </div>

        <div className="grid grid-cols-1 gap-4 border-t border-slate-100 bg-slate-50/50 p-6 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="space-y-3">
            <div className="flex items-start gap-3 rounded-2xl bg-amber-50 px-4 py-3">
              <Info size={16} className="mt-0.5 shrink-0 text-amber-600" />
              <p className="text-sm text-amber-800">
                This form is fully dynamic from your DB. Transport type, icon type, and supported vehicles all save to the real vehicle catalog.
              </p>
            </div>
            <label className="flex items-center gap-3 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={formData.is_accept_share_ride === 1}
                onChange={(e) => updateForm('is_accept_share_ride', e.target.checked ? 1 : 0)}
                className="h-4 w-4 rounded border-slate-300"
              />
              Accept share ride
            </label>
            <label className="flex items-center gap-3 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={formData.active}
                onChange={(e) => {
                  updateForm('active', e.target.checked);
                  updateForm('status', e.target.checked ? 1 : 0);
                }}
                className="h-4 w-4 rounded border-slate-300"
              />
              Active vehicle type
            </label>
          </div>

          <div className="flex flex-col gap-3 lg:items-end">
            <button
              onClick={handleSave}
              disabled={isSaving || loading}
              className="inline-flex min-w-[180px] items-center justify-center gap-2 rounded-xl bg-[#2e3c78] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#24305f] disabled:opacity-60"
            >
              <Save size={16} />
              {isSaving ? 'Saving...' : id ? 'Update' : 'Create'}
            </button>
            <button
              onClick={() => navigate('/taxi/admin/pricing/vehicle-type')}
              className="text-sm font-medium text-slate-500 transition hover:text-slate-700"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {!loading && formData.active ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="fixed bottom-8 right-8 flex h-14 w-14 items-center justify-center rounded-full bg-[#14b8a6] text-white shadow-2xl"
          >
            <CheckCircle2 size={24} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
};

export default VehicleType;
