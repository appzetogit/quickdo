import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate, useParams } from 'react-router-dom';
import { Autocomplete, GoogleMap, MarkerF, Polygon } from '@react-google-maps/api';
import {
  ArrowLeft,
  Building2,
  Car,
  ChevronRight,
  Edit2,
  Loader2,
  MapPin,
  Plus,
  Users,
  Save,
  Search,
  Trash2,
} from 'lucide-react';
import { adminService } from '../../services/adminService';
import { INDIA_CENTER, useAppGoogleMapsLoader } from '../../utils/googleMaps';

import { describeApiError } from '../../../../shared/utils/apiError';
const inputClass =
  'w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-800 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500';
const labelClass = 'mb-1.5 block text-xs font-semibold text-gray-500';

const defaultFormData = {
  name: '',
  zone_id: '',
  address: '',
  owner_name: '',
  owner_phone: '',
  latitude: '',
  longitude: '',
  status: 'active',
};

const getZoneBoundary = (zone) =>
  Array.isArray(zone?.coordinates)
    ? zone.coordinates
        .map((point) => ({
          lat: Number(point?.lat),
          lng: Number(point?.lng),
        }))
        .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng))
    : [];

const ServiceStores = ({ mode: initialMode = 'list' }) => {
  const navigate = useNavigate();
  const { id } = useParams();
  const [view, setView] = useState(initialMode);
  const [stores, setStores] = useState([]);
  const [zones, setZones] = useState([]);
  const [serviceLocations, setServiceLocations] = useState([]);
  const [rentalVehicles, setRentalVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStoreId, setSelectedStoreId] = useState(id || null);
  const [formData, setFormData] = useState(defaultFormData);
  const [zoneBoundary, setZoneBoundary] = useState([]);
  const [mapCenter, setMapCenter] = useState(INDIA_CENTER);
  const [autocomplete, setAutocomplete] = useState(null);
  const [isResolvingAddress, setIsResolvingAddress] = useState(false);
  const mapRef = useRef(null);
  const geocoderRef = useRef(null);
  const reverseGeocodeRequestRef = useRef(0);
  const { isLoaded } = useAppGoogleMapsLoader();

  const serviceLocationMap = useMemo(
    () =>
      new Map(
        serviceLocations.map((location) => [String(location._id || location.id), location]),
      ),
    [serviceLocations],
  );

  const getZoneCenter = (zone) => {
    const boundary = getZoneBoundary(zone);
    if (boundary.length > 0) {
      return boundary[0];
    }

    const serviceLocation = serviceLocationMap.get(
      String(zone?.service_location_id || ''),
    );
    const lat = Number(serviceLocation?.latitude);
    const lng = Number(serviceLocation?.longitude);

    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }

    return INDIA_CENTER;
  };

  const resetFormState = () => {
    setSelectedStoreId(null);
    setFormData(defaultFormData);
    setZoneBoundary([]);
    setMapCenter(INDIA_CENTER);
  };

  useEffect(() => {
    setView(initialMode);
    if (initialMode === 'list') {
      resetFormState();
    }
  }, [initialMode]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [storesRes, zonesRes, locationsRes, rentalVehiclesRes] = await Promise.allSettled([
        adminService.getServiceStores(),
        adminService.getZones(),
        adminService.getServiceLocations(),
        adminService.getRentalVehicleTypes(),
      ]);

      const nextStores =
        storesRes.status === 'fulfilled'
          ? storesRes.value?.data?.data?.results ||
            storesRes.value?.data?.results ||
            storesRes.value?.results ||
            []
          : [];
      const nextZones =
        zonesRes.status === 'fulfilled'
          ? zonesRes.value?.data?.data?.results ||
            zonesRes.value?.data?.results ||
            zonesRes.value?.results ||
            []
          : [];
      const nextServiceLocations =
        locationsRes.status === 'fulfilled'
          ? locationsRes.value?.data?.data ||
            locationsRes.value?.data?.results ||
            locationsRes.value?.results ||
            []
          : [];
      const nextRentalVehicles =
        rentalVehiclesRes.status === 'fulfilled'
          ? rentalVehiclesRes.value?.data?.data?.results ||
            rentalVehiclesRes.value?.data?.results ||
            rentalVehiclesRes.value?.results ||
            []
          : [];

      setStores(Array.isArray(nextStores) ? nextStores : []);
      setZones(Array.isArray(nextZones) ? nextZones : []);
      setServiceLocations(Array.isArray(nextServiceLocations) ? nextServiceLocations : []);
      setRentalVehicles(Array.isArray(nextRentalVehicles) ? nextRentalVehicles : []);

      if (id && initialMode === 'edit') {
        const storeToEdit = nextStores.find((item) => String(item._id || item.id) === String(id));
        if (storeToEdit) {
          handleEdit(
            storeToEdit,
            Array.isArray(nextZones) ? nextZones : [],
            Array.isArray(nextServiceLocations) ? nextServiceLocations : [],
          );
        }
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (id && zones.length > 0 && stores.length > 0 && initialMode === 'edit') {
      const storeToEdit = stores.find((item) => String(item._id || item.id) === String(id));
      if (storeToEdit) {
        handleEdit(storeToEdit, zones, serviceLocations);
      }
    }
  }, [id, initialMode, serviceLocations, stores, zones]);

  const selectedZone = useMemo(
    () =>
      zones.find(
        (zone) =>
          String(zone._id || zone.id) === String(formData.zone_id),
      ) || null,
    [formData.zone_id, zones],
  );

  const selectedServiceLocation = useMemo(() => {
    const locationId =
      selectedZone?.service_location_id ||
      selectedZone?.service_location_id?._id ||
      '';
    return serviceLocationMap.get(String(locationId)) || null;
  }, [selectedZone, serviceLocationMap]);

  const filteredStores = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return stores;

    return stores.filter((store) =>
      [
        store.name,
        store.owner_name,
        store.owner_phone,
        store.zone_id?.name,
        store.service_location_id?.name,
        store.address,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [searchTerm, stores]);

  const selectedStore = useMemo(
    () =>
      stores.find((item) => String(item._id || item.id) === String(selectedStoreId)) || null,
    [selectedStoreId, stores],
  );

  const selectedStoreStaff = useMemo(
    () => (Array.isArray(selectedStore?.staff) ? selectedStore.staff : []),
    [selectedStore],
  );

  const selectedStoreVehicles = useMemo(
    () =>
      rentalVehicles.filter((vehicle) =>
        Array.isArray(vehicle?.serviceStoreIds) &&
        vehicle.serviceStoreIds.some((storeId) => String(storeId) === String(selectedStoreId)),
      ),
    [rentalVehicles, selectedStoreId],
  );

  const getGeocoder = () => {
    if (!window.google?.maps?.Geocoder) {
      return null;
    }

    if (!geocoderRef.current) {
      geocoderRef.current = new window.google.maps.Geocoder();
    }

    return geocoderRef.current;
  };

  const fillAddressFromCoordinates = (lat, lng) => {
    const geocoder = getGeocoder();
    if (!geocoder) {
      return;
    }

    const requestId = reverseGeocodeRequestRef.current + 1;
    reverseGeocodeRequestRef.current = requestId;
    setIsResolvingAddress(true);

    geocoder.geocode({ location: { lat, lng } }, (results, status) => {
      if (reverseGeocodeRequestRef.current !== requestId) {
        return;
      }

      setIsResolvingAddress(false);

      if (status === 'OK' && results?.[0]?.formatted_address) {
        setFormData((current) => ({
          ...current,
          address: results[0].formatted_address,
        }));
      }
    });
  };

  const updatePinnedLocation = (lat, lng, options = {}) => {
    const nextLat = Number(lat);
    const nextLng = Number(lng);
    if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) {
      return;
    }

    setFormData((current) => ({
      ...current,
      latitude: nextLat.toFixed(6),
      longitude: nextLng.toFixed(6),
    }));
    setMapCenter({ lat: nextLat, lng: nextLng });

    if (options.address) {
      setFormData((current) => ({
        ...current,
        address: options.address,
      }));
      setIsResolvingAddress(false);
      return;
    }

    if (options.skipAddressLookup) {
      return;
    }

    fillAddressFromCoordinates(nextLat, nextLng);
  };

  const handleZoneChange = (zoneId) => {
    setFormData((current) => ({ ...current, zone_id: zoneId }));
    const zone = zones.find((item) => String(item._id || item.id) === String(zoneId));
    const nextBoundary = getZoneBoundary(zone);
    setZoneBoundary(nextBoundary);

    const center = getZoneCenter(zone);
    setMapCenter(center);
    mapRef.current?.panTo(center);
  };

  const handleEdit = (store, zoneItems = zones) => {
    setSelectedStoreId(store._id || store.id);
    const zoneId = store.zone_id?._id || store.zone_id || '';
    const zone = zoneItems.find((item) => String(item._id || item.id) === String(zoneId));
    setFormData({
      name: store.name || '',
      zone_id: zoneId,
      address: store.address || '',
      owner_name: store.owner_name || '',
      owner_phone: store.owner_phone || '',
      latitude: store.latitude ?? '',
      longitude: store.longitude ?? '',
      status: store.status || 'active',
    });
    setZoneBoundary(getZoneBoundary(zone));

    const lat = Number(store.latitude);
    const lng = Number(store.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      setMapCenter({ lat, lng });
    } else {
      setMapCenter(getZoneCenter(zone));
    }
  };

  const handlePlaceChanged = () => {
    if (!autocomplete) return;
    const place = autocomplete.getPlace();
    const lat = place.geometry?.location?.lat?.();
    const lng = place.geometry?.location?.lng?.();
    const formattedAddress =
      String(place.formatted_address || place.name || '').trim();

    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      updatePinnedLocation(lat, lng, {
        address: formattedAddress || undefined,
      });
      mapRef.current?.panTo({ lat, lng });
      mapRef.current?.setZoom(16);
    }
  };

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.zone_id) {
      alert('Store name and zone are required.');
      return;
    }

    if (!formData.latitude || !formData.longitude) {
      alert('Pin the service store on the map.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: formData.name.trim(),
        zone_id: formData.zone_id,
        address: formData.address.trim(),
        owner_name: formData.owner_name.trim(),
        owner_phone: formData.owner_phone.trim(),
        latitude: Number(formData.latitude),
        longitude: Number(formData.longitude),
        status: formData.status,
      };

      const response = selectedStoreId
        ? await adminService.updateServiceStore(selectedStoreId, payload)
        : await adminService.createServiceStore(payload);

      if (response?.data?.success || response?.success) {
        navigate('/taxi/admin/pricing/service-stores');
        resetFormState();
        fetchData();
      } else {
        alert('Failed to save service store.');
      }
    } catch (error) {
      alert(error?.response?.data?.message || 'Failed to save service store.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (storeId) => {
    if (!window.confirm('Delete this service store?')) {
      return;
    }

    try {
      const response = await adminService.deleteServiceStore(storeId);
      if (response?.data?.success || response?.success) {
        setStores((current) =>
          current.filter((item) => String(item._id || item.id) !== String(storeId)),
        );
      }
    } catch (error) {
      console.error('Delete service store error:', error);
      alert(describeApiError(error, 'Failed to delete service store.'));
    }
  };

  return (
    <div className="min-h-screen animate-in fade-in duration-500 bg-gray-50 p-6 font-sans lg:p-8">
      <AnimatePresence mode="wait">
        {view === 'list' ? (
          <motion.div
            key="list"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mx-auto max-w-7xl space-y-6"
          >
            <div>
              <div className="mb-2 flex items-center gap-1.5 text-xs text-gray-400">
                <span>Pricing</span>
                <ChevronRight size={12} />
                <span className="text-gray-700">Service Stores</span>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-xl font-semibold text-gray-900">Service Stores</h1>
                  <p className="mt-1 text-xs text-gray-400">
                    Add and manage service store pins against your operating zones.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/taxi/admin/pricing/service-stores/add')}
                  className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700"
                >
                  <Plus size={16} /> Add Store
                </button>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400">
                  Total Stores
                </p>
                <p className="mt-2 text-3xl font-black text-gray-900">{stores.length}</p>
              </div>
              <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400">
                  Covered Zones
                </p>
                <p className="mt-2 text-3xl font-black text-gray-900">
                  {new Set(stores.map((store) => String(store.zone_id?._id || store.zone_id || ''))).size}
                </p>
              </div>
              <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400">
                  Active Stores
                </p>
                <p className="mt-2 text-3xl font-black text-gray-900">
                  {stores.filter((store) => store.active !== false).length}
                </p>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-100 bg-gray-50/60 p-4">
                <div className="relative w-full max-w-sm">
                  <Search
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                  />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Search stores or zones..."
                    className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm font-medium outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="overflow-x-auto">
                {loading ? (
                  <div className="flex flex-col items-center justify-center py-20">
                    <Loader2 size={32} className="mb-2 animate-spin text-indigo-600" />
                    <p className="text-xs font-medium text-gray-400">Loading service stores...</p>
                  </div>
                ) : filteredStores.length > 0 ? (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50/60">
                        <th className="px-6 py-3.5 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">
                          Store
                        </th>
                        <th className="px-6 py-3.5 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">
                          Zone
                        </th>
                        <th className="px-6 py-3.5 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">
                          Service Location
                        </th>
                        <th className="px-6 py-3.5 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">
                          Owner
                        </th>
                        <th className="px-6 py-3.5 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">
                          Coordinates
                        </th>
                        <th className="px-6 py-3.5 text-right text-[10px] font-bold uppercase tracking-widest text-gray-400">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredStores.map((store) => (
                        <tr
                          key={store._id || store.id}
                          className="transition-colors hover:bg-gray-50/50"
                        >
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                                <Building2 size={18} />
                              </div>
                              <div>
                                <p className="font-semibold text-gray-900">{store.name}</p>
                                <p className="text-xs text-gray-400">
                                  {store.status || 'active'}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 font-medium text-gray-700">
                            {store.zone_id?.name || '-'}
                          </td>
                          <td className="px-6 py-4 font-medium text-gray-700">
                            {store.service_location_id?.name || '-'}
                          </td>
                          <td className="px-6 py-4">
                            <div className="min-w-[160px]">
                              <p className="font-medium text-gray-700">{store.owner_name || '-'}</p>
                              <p className="text-xs text-gray-400">{store.owner_phone || '-'}</p>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-xs font-semibold text-gray-500">
                            {Number.isFinite(Number(store.latitude)) &&
                            Number.isFinite(Number(store.longitude))
                              ? `${Number(store.latitude).toFixed(5)}, ${Number(store.longitude).toFixed(5)}`
                              : '-'}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  navigate(`/taxi/admin/pricing/service-stores/edit/${store._id || store.id}`)
                                }
                                className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                              >
                                <Edit2 size={15} />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDelete(store._id || store.id)}
                                className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="py-20 text-center">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-50 text-gray-200">
                      <MapPin size={30} />
                    </div>
                    <h3 className="text-sm font-semibold text-gray-900">No service stores added yet</h3>
                    <p className="mt-1 text-xs text-gray-400">
                      Create a store and pin it inside the relevant zone.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="form"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="mx-auto max-w-7xl space-y-6"
          >
            <div>
              <div className="mb-2 flex items-center gap-1.5 text-xs text-gray-400">
                <span>Pricing</span>
                <ChevronRight size={12} />
                <span>Service Stores</span>
                <ChevronRight size={12} />
                <span className="text-gray-700">{selectedStoreId ? 'Edit' : 'Create'}</span>
              </div>
              <div className="flex items-center justify-between">
                <h1 className="text-xl font-semibold text-gray-900">
                  {selectedStoreId ? 'Edit Service Store' : 'Add Service Store'}
                </h1>
                <button
                  type="button"
                  onClick={() => navigate('/taxi/admin/pricing/service-stores')}
                  className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 shadow-sm transition-colors hover:bg-gray-50"
                >
                  <ArrowLeft size={14} /> Back
                </button>
              </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
              <div className="space-y-5">
                {selectedStoreId ? (
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-400">
                        Staff
                      </p>
                      <p className="mt-2 text-2xl font-black text-gray-900">{selectedStoreStaff.length}</p>
                    </div>
                    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-400">
                        Cars
                      </p>
                      <p className="mt-2 text-2xl font-black text-gray-900">{selectedStoreVehicles.length}</p>
                    </div>
                    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-400">
                        Status
                      </p>
                      <p className="mt-2 text-sm font-bold capitalize text-gray-900">{formData.status || 'active'}</p>
                    </div>
                  </div>
                ) : null}

                <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                  <div className="mb-6 flex items-center gap-3 border-b border-gray-100 pb-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                      <Building2 size={18} />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900">Store Details</h3>
                      <p className="text-xs text-gray-400">Name the store and attach it to a zone.</p>
                    </div>
                  </div>

                  <div className="space-y-5">
                    <div>
                      <label className={labelClass}>Store Name *</label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(event) =>
                          setFormData((current) => ({ ...current, name: event.target.value }))
                        }
                        placeholder="Enter service store name"
                        className={inputClass}
                      />
                    </div>

                    <div>
                      <label className={labelClass}>Zone *</label>
                      <select
                        value={formData.zone_id}
                        onChange={(event) => handleZoneChange(event.target.value)}
                        className={inputClass}
                      >
                        <option value="">Select zone</option>
                        {zones.map((zone) => (
                          <option key={zone._id || zone.id} value={zone._id || zone.id}>
                            {zone.name || zone.zone_name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className={labelClass}>Address</label>
                      <textarea
                        value={formData.address}
                        onChange={(event) =>
                          setFormData((current) => ({ ...current, address: event.target.value }))
                        }
                        placeholder="Optional address or note"
                        rows={3}
                        className={`${inputClass} resize-none`}
                      />
                      <p className="mt-2 text-[11px] font-medium text-gray-400">
                        {isResolvingAddress
                          ? 'Fetching address from the pinned location...'
                          : 'Address auto-fills from the map pin, and you can still edit it manually.'}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className={labelClass}>Service Location</label>
                        <input
                          type="text"
                          value={selectedServiceLocation?.name || ''}
                          readOnly
                          placeholder="Auto-filled from zone"
                          className={`${inputClass} bg-gray-50 text-gray-500`}
                        />
                      </div>
                      <div>
                        <label className={labelClass}>Status</label>
                        <select
                          value={formData.status}
                          onChange={(event) =>
                            setFormData((current) => ({ ...current, status: event.target.value }))
                          }
                          className={inputClass}
                        >
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className={labelClass}>Owner Name</label>
                        <input
                          type="text"
                          value={formData.owner_name}
                          onChange={(event) =>
                            setFormData((current) => ({ ...current, owner_name: event.target.value }))
                          }
                          placeholder="Enter owner name"
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className={labelClass}>Owner Number</label>
                        <input
                          type="tel"
                          value={formData.owner_phone}
                          onChange={(event) =>
                            setFormData((current) => ({
                              ...current,
                              owner_phone: event.target.value.replace(/[^\d+]/g, '').slice(0, 15),
                            }))
                          }
                          placeholder="Enter owner mobile number"
                          inputMode="numeric"
                          maxLength={15}
                          className={inputClass}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className={labelClass}>Latitude *</label>
                        <input
                          type="number"
                          step="any"
                          value={formData.latitude}
                          onChange={(event) =>
                            setFormData((current) => ({ ...current, latitude: event.target.value }))
                          }
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className={labelClass}>Longitude *</label>
                        <input
                          type="number"
                          step="any"
                          value={formData.longitude}
                          onChange={(event) =>
                            setFormData((current) => ({ ...current, longitude: event.target.value }))
                          }
                          className={inputClass}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-60"
                  >
                    {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    {selectedStoreId ? 'Update Store' : 'Save Store'}
                  </button>
                </div>

                {selectedStoreId ? (
                  <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="mb-5 flex items-start justify-between gap-3 border-b border-gray-100 pb-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                          <Users size={18} />
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold text-gray-900">Assigned Staff</h3>
                          <p className="text-xs text-gray-400">
                            Team members linked to this service store.
                          </p>
                        </div>
                      </div>
                      <div className="rounded-full bg-gray-100 px-3 py-1 text-[11px] font-semibold text-gray-600">
                        {selectedStoreStaff.length} staff
                      </div>
                    </div>

                    {selectedStoreStaff.length > 0 ? (
                      <div className="space-y-3">
                        {selectedStoreStaff.map((member) => (
                          <div
                            key={member._id || member.id}
                            className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-gray-900">
                                  {member.name || 'Unnamed staff'}
                                </p>
                                <p className="mt-1 text-xs font-medium text-gray-500">
                                  {member.phone || '-'}
                                </p>
                              </div>
                              <span
                                className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
                                  member.active !== false && member.status !== 'inactive'
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : 'bg-rose-100 text-rose-700'
                                }`}
                              >
                                {member.status || (member.active !== false ? 'active' : 'inactive')}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center">
                        <p className="text-sm font-semibold text-gray-700">No staff assigned yet</p>
                        <p className="mt-1 text-xs text-gray-400">
                          Staff will appear here once they are added for this service center.
                        </p>
                      </div>
                    )}
                  </div>
                ) : null}

                {selectedStoreId ? (
                  <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="mb-5 flex items-start justify-between gap-3 border-b border-gray-100 pb-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
                          <Car size={18} />
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold text-gray-900">Available Cars</h3>
                          <p className="text-xs text-gray-400">
                            Rental vehicles currently assigned to this store.
                          </p>
                        </div>
                      </div>
                      <div className="rounded-full bg-gray-100 px-3 py-1 text-[11px] font-semibold text-gray-600">
                        {selectedStoreVehicles.length} vehicles
                      </div>
                    </div>

                    {selectedStoreVehicles.length > 0 ? (
                      <div className="space-y-3">
                        {selectedStoreVehicles.map((vehicle) => (
                          <div
                            key={vehicle._id || vehicle.id}
                            className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-gray-900">
                                  {vehicle.name || 'Unnamed vehicle'}
                                </p>
                                <p className="mt-1 text-xs font-medium text-gray-500">
                                  {vehicle.vehicleCategory || 'Vehicle'} · {vehicle.capacity || 0} seats · {vehicle.luggageCapacity || 0} bags
                                </p>
                              </div>
                              <span
                                className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
                                  vehicle.active !== false && vehicle.status !== 'inactive'
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : 'bg-rose-100 text-rose-700'
                                }`}
                              >
                                {vehicle.status || (vehicle.active !== false ? 'active' : 'inactive')}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center">
                        <p className="text-sm font-semibold text-gray-700">No cars assigned yet</p>
                        <p className="mt-1 text-xs text-gray-400">
                          Vehicles linked from rental vehicle types will show here.
                        </p>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>

              <div className="space-y-6">
                <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                  <div className="flex flex-col gap-3 border-b border-gray-100 px-4 py-4 md:flex-row md:items-center md:justify-between">
                    <div className="w-full md:max-w-md">
                      <div className="flex h-12 items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 shadow-sm">
                        <Search size={18} className="text-gray-400" />
                        <Autocomplete onLoad={setAutocomplete} onPlaceChanged={handlePlaceChanged}>
                          <input
                            type="text"
                            placeholder="Search and pin a service store"
                            className="w-full bg-transparent text-sm font-semibold text-gray-800 outline-none placeholder:text-gray-400"
                          />
                        </Autocomplete>
                      </div>
                    </div>

                    <div className="rounded-full bg-slate-50 px-3 py-1.5 text-[11px] font-semibold text-slate-500">
                      Click the map or drag the marker to set the exact store location.
                    </div>
                  </div>

                  <div className="h-[620px] p-2">
                    {isLoaded ? (
                      <div className="h-full w-full overflow-hidden rounded-xl">
                        <GoogleMap
                          mapContainerStyle={{ width: '100%', height: '100%' }}
                          center={mapCenter}
                          zoom={selectedZone ? 14 : 5}
                          onLoad={(map) => {
                            mapRef.current = map;
                          }}
                          onClick={(event) =>
                            updatePinnedLocation(event.latLng?.lat(), event.latLng?.lng())
                          }
                          options={{
                            mapTypeId: 'roadmap',
                            zoomControl: true,
                            mapTypeControl: true,
                            streetViewControl: false,
                            fullscreenControl: true,
                          }}
                        >
                          {zoneBoundary.length > 0 ? (
                            <Polygon
                              paths={zoneBoundary}
                              options={{
                                fillColor: '#4f46e5',
                                fillOpacity: 0.12,
                                strokeColor: '#4f46e5',
                                strokeOpacity: 0.9,
                                strokeWeight: 2,
                                clickable: false,
                              }}
                            />
                          ) : null}

                          {(formData.latitude || formData.longitude) && (
                            <MarkerF
                              position={{
                                lat: Number(formData.latitude || mapCenter.lat),
                                lng: Number(formData.longitude || mapCenter.lng),
                              }}
                              draggable
                              onDragEnd={(event) =>
                                updatePinnedLocation(event.latLng?.lat(), event.latLng?.lng())
                              }
                            />
                          )}
                        </GoogleMap>
                      </div>
                    ) : (
                      <div className="flex h-full items-center justify-center rounded-xl bg-gray-50">
                        <Loader2 size={32} className="animate-spin text-gray-300" />
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm font-medium text-amber-800 shadow-sm">
                  Pick a zone first, then pin the store inside that boundary so the admin team knows exactly where the service point lives.
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ServiceStores;
