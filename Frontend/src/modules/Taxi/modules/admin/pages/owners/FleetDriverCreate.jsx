import React, { useEffect, useState } from 'react';
import { ChevronRight, Loader2, Menu, Upload } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { adminService } from '../../services/adminService';
import AdminPageHeader from '../../components/ui/AdminPageHeader';

const inputClass =
  'h-[46px] w-full rounded border border-gray-300 bg-white px-4 text-sm text-gray-950 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500';

const labelClass = 'mb-2 block text-sm font-semibold text-gray-950';

const initialFormData = {
  service_location_id: '',
  owner_id: '',
  country: '',
  name: '',
  mobile: '',
  email: '',
  password: '',
  password_confirmation: '',
  gender: '',
  profile_picture: '',
};

const getOptionName = (item) =>
  item?.name ||
  item?.service_location_name ||
  item?.company_name ||
  item?.owner_name ||
  item?.email ||
  'Option';

const FleetDriverCreate = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState(initialFormData);
  const [areas, setAreas] = useState([]);
  const [owners, setOwners] = useState([]);
  const [countries, setCountries] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [profileName, setProfileName] = useState('');

  useEffect(() => {
    const fetchOptions = async () => {
      setIsLoading(true);

      try {
        const [locationsResponse, ownersResponse, countriesResponse] = await Promise.all([
          adminService.getServiceLocations(),
          adminService.getOwners(),
          adminService.getCountries(),
        ]);

        if (locationsResponse.success) {
          const locations = Array.isArray(locationsResponse.data)
            ? locationsResponse.data
            : locationsResponse.data?.results || [];
          setAreas(locations);
        }

        if (ownersResponse.success) {
          setOwners(ownersResponse.data?.results || []);
        }

        if (countriesResponse.success) {
          setCountries(countriesResponse.data?.results || countriesResponse.results || []);
        }
      } catch (error) {
        console.error('Fleet driver form setup failed:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchOptions();
  }, []);

  const setField = (name, value) => {
    setFormData((current) => ({ ...current, [name]: value }));
  };

  const handleAreaChange = (event) => {
    const areaId = event.target.value;
    const selectedArea = areas.find((area) => String(area._id) === String(areaId));
    setFormData((current) => ({
      ...current,
      service_location_id: areaId,
      country: selectedArea?.country?._id || selectedArea?.country || current.country,
    }));
  };

  const handleProfileChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setProfileName(file.name);
    const reader = new FileReader();
    reader.onloadend = () => setField('profile_picture', reader.result);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (submitting) return;

    if (formData.password !== formData.password_confirmation) {
      alert('Passwords do not match');
      return;
    }

    setSubmitting(true);

    try {
      const response = await adminService.createDriver({
        name: formData.name,
        mobile: formData.mobile,
        phone: formData.mobile,
        email: formData.email,
        password: formData.password,
        gender: formData.gender,
        owner_id: formData.owner_id,
        service_location_id: formData.service_location_id,
        country: formData.country,
        profile_picture: formData.profile_picture,
        transport_type: 'taxi',
        vehicle_type: 'car',
        approve: true,
        status: 'approved',
      });

      if (response.success) {
        navigate('/taxi/admin/fleet/drivers');
        return;
      }

      alert(response.message || 'Failed to create fleet driver');
    } catch (error) {
      alert(error.message || 'Failed to create fleet driver');
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 text-slate-400">
        <Loader2 size={34} className="animate-spin text-teal-500" />
        <p className="text-sm font-semibold">Preparing fleet driver form...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-950">
      <div className="px-5 pt-3">
        <AdminPageHeader
          module="Fleet Management"
          page="Fleet Drivers"
          title="Create Fleet Driver"
          backto="/taxi/admin/fleet/drivers"
        />
      </div>

      <div className="relative px-5">
        <form onSubmit={handleSubmit} className="rounded border border-gray-200 bg-white px-4 py-7 shadow-sm md:px-5">
          <div className="grid grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-2">
            <div>
              <label className={labelClass}>
                Select Area <span className="text-red-500">*</span>
              </label>
              <select
                required
                value={formData.service_location_id}
                onChange={handleAreaChange}
                className={inputClass}
              >
                <option value=""></option>
                {areas.map((area) => (
                  <option key={area._id} value={area._id}>
                    {getOptionName(area)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass}>
                Owner <span className="text-red-500">*</span>
              </label>
              <select
                required
                value={formData.owner_id}
                onChange={(event) => setField('owner_id', event.target.value)}
                className={inputClass}
              >
                <option value=""></option>
                {owners.map((owner) => (
                  <option key={owner._id || owner.id} value={owner._id || owner.id}>
                    {owner.company_name || owner.owner_name || owner.name || owner.email}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass}>
                Country <span className="text-red-500">*</span>
              </label>
              <select
                required
                value={formData.country}
                onChange={(event) => setField('country', event.target.value)}
                className={inputClass}
              >
                <option value=""></option>
                {countries.map((country) => (
                  <option key={country._id || country.id || country.name} value={country._id || country.id || country.name}>
                    {country.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass}>
                Name <span className="text-red-500">*</span>
              </label>
              <input
                required
                type="text"
                value={formData.name}
                onChange={(event) => setField('name', event.target.value)}
                placeholder="Enter Name"
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>
                Enter Mobile Number <span className="text-red-500">*</span>
              </label>
              <input
                required
                type="tel"
                value={formData.mobile}
                onChange={(event) => setField('mobile', event.target.value)}
                placeholder="Enter Mobile Number"
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>
                Email <span className="text-red-500">*</span>
              </label>
              <input
                required
                type="email"
                value={formData.email}
                onChange={(event) => setField('email', event.target.value)}
                placeholder="Enter Email"
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>
                Password <span className="text-red-500">*</span>
              </label>
              <input
                required
                type="password"
                value={formData.password}
                onChange={(event) => setField('password', event.target.value)}
                placeholder="Enter Password"
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>
                Confirm Password <span className="text-red-500">*</span>
              </label>
              <input
                required
                type="password"
                value={formData.password_confirmation}
                onChange={(event) => setField('password_confirmation', event.target.value)}
                placeholder="Confirm Password"
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>
                Gender <span className="text-red-500">*</span>
              </label>
              <select
                required
                value={formData.gender}
                onChange={(event) => setField('gender', event.target.value)}
                className={inputClass}
              >
                <option value="">Select</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>

          <div className="mt-6 max-w-md">
            <label className={labelClass}>Profile</label>
            <label className="flex h-40 cursor-pointer flex-col items-center justify-center rounded border-2 border-dashed border-gray-300 bg-white text-sm font-semibold text-slate-400 transition-colors hover:border-teal-400 hover:text-teal-500">
              <Upload size={26} className="mb-2" />
              <span>{profileName || 'Upload Profile'}</span>
              <input type="file" accept="image/*" onChange={handleProfileChange} className="hidden" />
            </label>
          </div>

          <div className="mt-7 flex justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex h-11 items-center justify-center rounded bg-indigo-600 px-8 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {submitting ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 size={16} className="animate-spin" />
                  Save
                </span>
              ) : (
                'Save'
              )}
            </button>
          </div>

        </form>

        <button
          type="button"
          className="absolute right-2 top-48 flex h-14 w-14 items-center justify-center rounded-full bg-teal-500 text-white shadow-xl transition-colors hover:bg-teal-600"
        >
          <Menu size={24} />
        </button>
      </div>
    </div>
  );
};

export default FleetDriverCreate;
