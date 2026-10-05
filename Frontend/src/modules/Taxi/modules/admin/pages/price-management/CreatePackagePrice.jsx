import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, Loader2, Plus, Trash2, MapPin } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { adminService } from '../../services/adminService';
import { Autocomplete } from '@react-google-maps/api';
import { useAppGoogleMapsLoader, HAS_VALID_GOOGLE_MAPS_KEY } from '../../utils/googleMaps';

const inputClass = 'w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-teal-500';
const labelClass = 'mb-2 block text-[13px] font-semibold text-slate-800';
const selectWrapClass = 'relative';

const createVehiclePriceRow = () => ({
  id: `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  vehicle_type: '',
  base_price: '',
  free_distance: '',
  distance_price: '',
  free_time: '',
  time_price: '',
  admin_commision_type: '1',
  admin_commision: '0',
  admin_commission_type_from_driver: '1',
  admin_commission_from_driver: '0',
  admin_commission_type_for_owner: '1',
  admin_commission_for_owner: '0',
  service_tax: '0',
  cancellation_fee: '',
  active: 1,
});

const initialFormState = {
  service_location_id: '',
  package_type_id: '',
  package_destination: '',
  package_availability: 'available',
  status: 'active',
  active: 1,
  package_vehicle_prices: [createVehiclePriceRow()],
};

const CreatePackagePrice = ({ mode = 'create' }) => {
  const { packageId } = useParams();
  const navigate = useNavigate();
  const isEdit = mode === 'edit';

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [serviceLocations, setServiceLocations] = useState([]);
  const [packageTypes, setPackageTypes] = useState([]);
  const [vehicleTypes, setVehicleTypes] = useState([]);
  const [formData, setFormData] = useState(initialFormState);
  const [autocomplete, setAutocomplete] = useState(null);

  const { isLoaded } = useAppGoogleMapsLoader();

  const vehicleLabelMap = useMemo(
    () =>
      vehicleTypes.reduce((acc, item) => {
        acc[String(item._id || item.id)] = item.name || 'Vehicle';
        return acc;
      }, {}),
    [vehicleTypes]
  );

  useEffect(() => {
    const bootstrap = async () => {
      try {
        setLoading(isEdit);
        const [locationsRes, packagesRes, vehiclesRes] = await Promise.all([
          adminService.getServiceLocations(),
          adminService.getRentalPackageTypes(),
          adminService.getVehicleTypes(),
        ]);

        const locations = locationsRes?.data?.locations || locationsRes?.data?.results || locationsRes?.results || [];
        const packages =
          packagesRes?.data?.rental_packages?.results ||
          packagesRes?.data?.rental_packages ||
          packagesRes?.rental_packages?.results ||
          packagesRes?.rental_packages ||
          packagesRes?.results ||
          [];
        const vehicles = vehiclesRes?.data?.vehicle_types || vehiclesRes?.data?.results || vehiclesRes?.results || [];

        setServiceLocations(Array.isArray(locations) ? locations : []);
        setPackageTypes(Array.isArray(packages) ? packages : []);
        setVehicleTypes(Array.isArray(vehicles) ? vehicles : []);

        if (isEdit && packageId) {
          const response = await adminService.getSetPrices({ scope: 'package' });
          const items = response?.data?.paginator?.data || response?.paginator?.data || response?.data?.results || [];
          const selected = (Array.isArray(items) ? items : []).find((item) => String(item.id || item._id) === String(packageId));

          if (!selected) {
            toast.error('Package pricing not found');
            navigate('/taxi/admin/pricing/package-pricing');
            return;
          }

          setFormData({
            service_location_id: selected.service_location?._id || selected.service_location?.id || '',
            package_type_id: selected.package_type?._id || selected.package_type?.id || selected.package_type_id || '',
            package_destination: selected.package_destination || '',
            package_availability: selected.package_availability || 'available',
            status: selected.status || 'active',
            active: Number(selected.active ?? 1),
            package_vehicle_prices: Array.isArray(selected.package_vehicle_prices) && selected.package_vehicle_prices.length
              ? selected.package_vehicle_prices.map((row, index) => ({
                  id: row.id || `row-${index}`,
                  vehicle_type: row.vehicle_type?._id || row.vehicle_type?.id || row.vehicle_type || '',
                  base_price: String(row.base_price ?? ''),
                  free_distance: String(row.free_distance ?? ''),
                  distance_price: String(row.distance_price ?? ''),
                  free_time: String(row.free_time ?? ''),
                  time_price: String(row.time_price ?? ''),
                  admin_commision_type: String(row.admin_commision_type ?? 1),
                  admin_commision: String(row.admin_commision ?? 0),
                  admin_commission_type_from_driver: String(row.admin_commission_type_from_driver ?? 1),
                  admin_commission_from_driver: String(row.admin_commission_from_driver ?? 0),
                  admin_commission_type_for_owner: String(row.admin_commission_type_for_owner ?? 1),
                  admin_commission_for_owner: String(row.admin_commission_for_owner ?? 0),
                  service_tax: String(row.service_tax ?? 0),
                  cancellation_fee: String(row.cancellation_fee ?? ''),
                  active: Number(row.active ?? 1),
                }))
              : [createVehiclePriceRow()],
          });
        }
      } catch (error) {
        toast.error('Failed to load package pricing form');
      } finally {
        setLoading(false);
      }
    };

    bootstrap();
  }, [isEdit, packageId, navigate]);

  const updateTopLevel = (field, value) => {
    setFormData((current) => ({ ...current, [field]: value }));
  };

  const updateRow = (rowId, field, value) => {
    setFormData((current) => ({
      ...current,
      package_vehicle_prices: current.package_vehicle_prices.map((row) =>
        row.id === rowId ? { ...row, [field]: value } : row
      ),
    }));
  };

  const addRow = () => {
    setFormData((current) => ({
      ...current,
      package_vehicle_prices: [...current.package_vehicle_prices, createVehiclePriceRow()],
    }));
  };

  const removeRow = (rowId) => {
    setFormData((current) => ({
      ...current,
      package_vehicle_prices:
        current.package_vehicle_prices.length > 1
          ? current.package_vehicle_prices.filter((row) => row.id !== rowId)
          : current.package_vehicle_prices,
    }));
  };

  const handlePlaceChanged = () => {
    if (autocomplete) {
      const place = autocomplete.getPlace();
      if (place && (place.formatted_address || place.name)) {
        updateTopLevel('package_destination', place.formatted_address || place.name);
      }
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!formData.package_type_id) return toast.error('Choose a package type');
    if (!formData.package_destination.trim()) return toast.error('Add a destination');
    if (!formData.package_vehicle_prices.every((row) => row.vehicle_type && row.base_price !== '')) {
      return toast.error('Each vehicle row needs a vehicle and base price');
    }

    const payload = {
      pricing_scope: 'package',
      transport_type: 'rental',
      service_location_id: formData.service_location_id || null,
      package_type_id: formData.package_type_id,
      package_destination: formData.package_destination.trim(),
      package_availability: formData.package_availability,
      status: formData.status,
      active: Number(formData.active ?? 1),
      package_vehicle_prices: formData.package_vehicle_prices.map(({ id, ...row }) => ({
        ...row,
        active: Number(row.active ?? 1),
      })),
    };

    try {
      setSaving(true);
      if (isEdit && packageId) {
        await adminService.updateSetPrice(packageId, payload);
        toast.success('Package pricing updated');
      } else {
        await adminService.createSetPrice(payload);
        toast.success('Package pricing created');
      }
      navigate('/taxi/admin/pricing/package-pricing');
    } catch (error) {
      toast.error('Failed to save package pricing');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8F9FD] p-6 lg:p-8 font-sans">
      <div className="flex flex-col gap-4 border-b border-gray-100 pb-4 mb-8 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-sm font-bold text-[#1E293B] uppercase tracking-[0.15em]">{isEdit ? 'EDIT PACKAGE PRICING' : 'CREATE PACKAGE PRICING'}</h1>
          <p className="mt-2 text-sm text-slate-500">Use a simple package form and set a different price block for each vehicle.</p>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-slate-400 font-medium tracking-tight">
          <span className="hover:text-slate-600 transition-colors cursor-pointer" onClick={() => navigate('/taxi/admin/pricing/package-pricing')}>Package Pricing</span>
          <ChevronRight size={10} className="text-slate-300" />
          <span className="text-slate-800 font-bold">{isEdit ? 'Edit' : 'Create'}</span>
        </div>
      </div>

      <div className="relative rounded-[28px] border border-gray-100 bg-white shadow-sm">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-[28px] bg-white/80">
            <Loader2 className="h-8 w-8 animate-spin text-teal-600" />
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-5 lg:p-10">
          <div className="mb-8 flex items-center justify-between">
            <button
              type="button"
              onClick={() => navigate('/taxi/admin/pricing/package-pricing')}
              className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500 transition hover:text-slate-800"
            >
              <ArrowLeft size={16} />
              Back to Package Pricing
            </button>
            <button type="button" className="text-sm font-semibold text-teal-600 underline underline-offset-4">
              How It Works
            </button>
          </div>

          <div className="grid grid-cols-1 gap-6 border-b border-dashed border-gray-200 pb-8 md:grid-cols-2">
            <div>
              <label className={labelClass}>Package Type <span className="text-rose-500">*</span></label>
              <div className={selectWrapClass}>
                <select
                  value={formData.package_type_id}
                  onChange={(event) => updateTopLevel('package_type_id', event.target.value)}
                  className={`${inputClass} appearance-none`}
                  required
                >
                  <option value="">Select package type</option>
                  {packageTypes.map((item) => (
                    <option key={item._id || item.id} value={item._id || item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <ChevronDown size={16} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>
            </div>

            <div>
              <label className={labelClass}>Destination <span className="text-rose-500">*</span></label>
              {isLoaded && HAS_VALID_GOOGLE_MAPS_KEY ? (
                <Autocomplete
                  onLoad={(a) => setAutocomplete(a)}
                  onPlaceChanged={handlePlaceChanged}
                  options={{
                    componentRestrictions: { country: 'in' },
                    types: ['(cities)'],
                  }}
                >
                  <div className="relative">
                    <input
                      type="text"
                      value={formData.package_destination}
                      onChange={(event) => updateTopLevel('package_destination', event.target.value)}
                      className={`${inputClass} pl-10`}
                      placeholder="Search destination city (India)"
                      required
                    />
                    <MapPin size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  </div>
                </Autocomplete>
              ) : (
                <input
                  value={formData.package_destination}
                  onChange={(event) => updateTopLevel('package_destination', event.target.value)}
                  className={inputClass}
                  placeholder="Enter destination"
                  required
                />
              )}
            </div>

            <div>
              <label className={labelClass}>Available In</label>
              <div className={selectWrapClass}>
                <select
                  value={formData.service_location_id}
                  onChange={(event) => updateTopLevel('service_location_id', event.target.value)}
                  className={`${inputClass} appearance-none`}
                >
                  <option value="">All service locations</option>
                  {serviceLocations.map((item) => (
                    <option key={item._id || item.id} value={item._id || item.id}>
                      {item.name || item.service_location_name}
                    </option>
                  ))}
                </select>
                <ChevronDown size={16} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Availability</label>
                <div className={selectWrapClass}>
                  <select
                    value={formData.package_availability}
                    onChange={(event) => updateTopLevel('package_availability', event.target.value)}
                    className={`${inputClass} appearance-none`}
                  >
                    <option value="available">Available</option>
                    <option value="unavailable">Unavailable</option>
                  </select>
                  <ChevronDown size={16} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" />
                </div>
              </div>
              <div>
                <label className={labelClass}>Status</label>
                <div className={selectWrapClass}>
                  <select
                    value={formData.active}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      updateTopLevel('active', next);
                      updateTopLevel('status', next === 1 ? 'active' : 'inactive');
                    }}
                    className={`${inputClass} appearance-none`}
                  >
                    <option value={1}>Active</option>
                    <option value={0}>Inactive</option>
                  </select>
                  <ChevronDown size={16} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900">Vehicle-wise Pricing</h2>
                <p className="mt-1 text-sm text-slate-500">Each vehicle can have its own package amount and commission setup.</p>
              </div>
              <button
                type="button"
                onClick={addRow}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-4 py-2.5 text-sm font-bold text-teal-700 transition hover:bg-teal-100"
              >
                <Plus size={16} />
                Add Vehicle Price
              </button>
            </div>

            {formData.package_vehicle_prices.map((row, index) => (
              <div key={row.id} className="rounded-3xl border border-gray-200 bg-[#FCFCFD] p-5 lg:p-7">
                <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-600">Vehicle Pricing {index + 1}</p>
                    <p className="mt-1 text-sm text-slate-500">{vehicleLabelMap[row.vehicle_type] || 'Choose vehicle and fill its package pricing'}</p>
                  </div>
                  {formData.package_vehicle_prices.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeRow(row.id)}
                      className="inline-flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-100"
                    >
                      <Trash2 size={14} />
                      Remove
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
                  <div>
                    <label className={labelClass}>Vehicle Type <span className="text-rose-500">*</span></label>
                    <div className={selectWrapClass}>
                      <select
                        value={row.vehicle_type}
                        onChange={(event) => updateRow(row.id, 'vehicle_type', event.target.value)}
                        className={`${inputClass} appearance-none`}
                        required
                      >
                        <option value="">Select vehicle type</option>
                        {vehicleTypes.map((item) => (
                          <option key={item._id || item.id} value={item._id || item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={16} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" />
                    </div>
                  </div>

                  <div>
                    <label className={labelClass}>Base Price Inclusive of tax <span className="text-rose-500">*</span></label>
                    <input type="number" value={row.base_price} onChange={(event) => updateRow(row.id, 'base_price', event.target.value)} className={inputClass} placeholder="Enter Base Price Inclusive of tax" required />
                  </div>

                  <div>
                    <label className={labelClass}>Free Distance (Kilometers) <span className="text-rose-500">*</span></label>
                    <input type="number" value={row.free_distance} onChange={(event) => updateRow(row.id, 'free_distance', event.target.value)} className={inputClass} placeholder="Enter Free Distance" required />
                  </div>

                  <div>
                    <label className={labelClass}>Distance Price <span className="text-rose-500">*</span></label>
                    <input type="number" value={row.distance_price} onChange={(event) => updateRow(row.id, 'distance_price', event.target.value)} className={inputClass} placeholder="Enter Price Per Distance" required />
                  </div>

                  <div>
                    <label className={labelClass}>Free Time in Minute</label>
                    <input type="number" value={row.free_time} onChange={(event) => updateRow(row.id, 'free_time', event.target.value)} className={inputClass} placeholder="Enter Free minute" />
                  </div>

                  <div>
                    <label className={labelClass}>Time Price in Minute <span className="text-rose-500">*</span></label>
                    <input type="number" value={row.time_price} onChange={(event) => updateRow(row.id, 'time_price', event.target.value)} className={inputClass} placeholder="Enter Time Price" required />
                  </div>

                  <div>
                    <label className={labelClass}>Platform Fee Type <span className="text-rose-500">*</span></label>
                    <div className={selectWrapClass}>
                      {/* Fixed is 0, not 2 -- the server reads 1 as percentage and 0 as fixed. */}
                      <select value={row.admin_commision_type} onChange={(event) => updateRow(row.id, 'admin_commision_type', event.target.value)} className={`${inputClass} appearance-none`} required>
                        <option value="1">Percentage</option>
                        <option value="0">Fixed</option>
                      </select>
                      <ChevronDown size={16} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" />
                    </div>
                  </div>

                  <div>
                    <label className={labelClass}>Platform Fee <span className="text-rose-500">*</span></label>
                    <input type="number" value={row.admin_commision} onChange={(event) => updateRow(row.id, 'admin_commision', event.target.value)} className={inputClass} placeholder="0" required />
                  </div>

                  <div>
                    <label className={labelClass}>Admin Commission Type From Driver <span className="text-rose-500">*</span></label>
                    <div className={selectWrapClass}>
                      <select value={row.admin_commission_type_from_driver} onChange={(event) => updateRow(row.id, 'admin_commission_type_from_driver', event.target.value)} className={`${inputClass} appearance-none`} required>
                        <option value="1">Percentage</option>
                        <option value="2">Fixed</option>
                      </select>
                      <ChevronDown size={16} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" />
                    </div>
                  </div>

                  <div>
                    <label className={labelClass}>Admin Commission From Driver <span className="text-rose-500">*</span></label>
                    <input type="number" value={row.admin_commission_from_driver} onChange={(event) => updateRow(row.id, 'admin_commission_from_driver', event.target.value)} className={inputClass} placeholder="0" required />
                  </div>

                  <div>
                    <label className={labelClass}>Admin Commission Type From Owner <span className="text-rose-500">*</span></label>
                    <div className={selectWrapClass}>
                      <select value={row.admin_commission_type_for_owner} onChange={(event) => updateRow(row.id, 'admin_commission_type_for_owner', event.target.value)} className={`${inputClass} appearance-none`} required>
                        <option value="1">Percentage</option>
                        <option value="2">Fixed</option>
                      </select>
                      <ChevronDown size={16} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" />
                    </div>
                  </div>

                  <div>
                    <label className={labelClass}>Admin Commission From Owner <span className="text-rose-500">*</span></label>
                    <input type="number" value={row.admin_commission_for_owner} onChange={(event) => updateRow(row.id, 'admin_commission_for_owner', event.target.value)} className={inputClass} placeholder="0" required />
                  </div>

                  <div>
                    <label className={labelClass}>Service Tax (%) <span className="text-rose-500">*</span></label>
                    <input type="number" value={row.service_tax} onChange={(event) => updateRow(row.id, 'service_tax', event.target.value)} className={inputClass} placeholder="0" required />
                  </div>

                  <div>
                    <label className={labelClass}>Cancellation Fee <span className="text-rose-500">*</span></label>
                    <input type="number" value={row.cancellation_fee} onChange={(event) => updateRow(row.id, 'cancellation_fee', event.target.value)} className={inputClass} placeholder="Cancellation Fee" required />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#0F766E] px-8 py-3 text-sm font-bold text-white transition hover:bg-[#115E59] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : null}
              {isEdit ? 'Update Package Pricing' : 'Save Package Pricing'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreatePackagePrice;
