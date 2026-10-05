import React, { useEffect, useMemo, useState } from 'react';
import { GoogleMap, MarkerF } from '@react-google-maps/api';
import {
  ArrowLeft,
  Calendar,
  CircleUserRound,
  ChevronRight,
  Download,
  Eye,
  PencilLine,
  Mail,
  MapPin,
  Phone,
} from 'lucide-react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { adminService } from '../../services/adminService';
import { DELHI_CENTER, HAS_VALID_GOOGLE_MAPS_KEY, useAppGoogleMapsLoader } from '../../utils/googleMaps';
import { API_BASE_URL } from '../../../../shared/api/runtimeConfig';
import BikeIcon from '@/assets/icons/bike.png';
import CarIcon from '@/assets/icons/car.png';
import AutoIcon from '@/assets/icons/auto.png';
import TruckIcon from '@/assets/icons/truck.png';
import EhcvIcon from '@/assets/icons/ehcv.png';
import HcvIcon from '@/assets/icons/hcv.png';
import LcvIcon from '@/assets/icons/LCV.png';
import McvIcon from '@/assets/icons/mcv.png';
import LuxuryIcon from '@/assets/icons/Luxury.png';
import PremiumIcon from '@/assets/icons/Premium.png';
import SuvIcon from '@/assets/icons/SUV.png';
import { useDriverPaths } from './driverPaths';

const mapContainerStyle = { width: '100%', height: '100%' };

const getMapIconForVehicle = (iconType = '') => {
  const raw = String(iconType || '').trim();
  if (/^(https?:|data:image\/|blob:|\/uploads\/|\/images\/|\/[^/])/.test(raw)) {
    return raw;
  }

  const value = raw.toLowerCase();

  if (value.includes('bike')) return BikeIcon;
  if (value.includes('auto')) return AutoIcon;
  if (value.includes('ehc')) return EhcvIcon;
  if (value.includes('hcv')) return HcvIcon;
  if (value.includes('lcv')) return LcvIcon;
  if (value.includes('mcv')) return McvIcon;
  if (value.includes('truck')) return TruckIcon;
  if (value.includes('lux')) return LuxuryIcon;
  if (value.includes('premium')) return PremiumIcon;
  if (value.includes('suv')) return SuvIcon;

  return CarIcon;
};

const getDocumentImages = (doc = {}) => {
  const rawImages = Array.isArray(doc?.images) && doc.images.length
    ? doc.images
    : [
        doc?.imageUrl,
        doc?.previewUrl,
        doc?.secureUrl,
        doc?.image,
        doc?.url,
        doc?.fileUrl,
        doc?.document,
        doc?.file,
      ];

  return [...new Set(rawImages.filter(Boolean).map((value) => String(value).trim()))];
};

const getDocumentReviewStatus = (doc = {}) =>
  String(
    doc?.status ??
    doc?.verificationStatus ??
    doc?.approvalStatus ??
    doc?.reviewStatus ??
    '',
  ).trim().toLowerCase();

const getDocumentReason = (doc = {}) =>
  String(
    doc?.comment ??
    doc?.remarks ??
    doc?.reason ??
    doc?.admin_comment ??
    doc?.rejection_reason ??
    '',
  ).trim();

const toTimestamp = (value) => {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
};

const formatDateTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const humanizeDocumentKey = (value = '') =>
  String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();

const formatServiceCategories = (value) => {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];

  const normalized = [...new Set(
    rawValues
      .map((item) => String(item || '').trim().toLowerCase())
      .filter(Boolean),
  )];

  if (!normalized.length) {
    return 'Not set';
  }

  return normalized
    .map((item) => item.charAt(0).toUpperCase() + item.slice(1))
    .join(', ');
};

const getDocumentFileNames = (doc = {}, imageUrls = []) => {
  const rawNames = [];

  if (Array.isArray(doc?.fileNames)) {
    rawNames.push(...doc.fileNames);
  }

  rawNames.push(
    doc?.fileName,
    doc?.filename,
    doc?.originalFilename,
    doc?.originalName,
  );

  imageUrls.forEach((url, index) => {
    try {
      const pathname = new URL(url).pathname;
      const lastSegment = pathname.split('/').filter(Boolean).pop() || '';
      if (lastSegment) {
        rawNames.push(decodeURIComponent(lastSegment));
      }
    } catch {
      const lastSegment = String(url).split('/').filter(Boolean).pop() || '';
      if (lastSegment) {
        rawNames.push(lastSegment);
      }
    }

    if (!rawNames[index]) {
      rawNames.push(`document-${index + 1}`);
    }
  });

  const normalizedNames = [...new Set(rawNames.filter(Boolean).map((value) => String(value).trim()))];

  if (normalizedNames.length > 0) {
    return normalizedNames;
  }

  return [doc?.fileName, doc?.filename, doc?.originalFilename, doc?.originalName, doc?.name, doc?.label]
    .filter(Boolean)
    .map((value) => String(value).trim())
    .filter(Boolean)
    .slice(0, 1);
};

const normalizeDocumentEntry = (doc = {}, fallbackKey = '') => {
  if (typeof doc === 'string') {
    return {
      sourceKey: fallbackKey,
      name: fallbackKey || 'Document',
      fileNames: getDocumentFileNames({}, [doc]),
      identify_number: '',
      expiry_date: '',
      status: '',
      comment: '',
      images: [doc].filter(Boolean),
    };
  }

  const images = getDocumentImages(doc);
  const fileNames = getDocumentFileNames(doc, images);

  return {
    sourceKey: doc?.key || doc?.documentKey || doc?.type || fallbackKey || doc?.name || '',
    name:
      doc?.name ||
      doc?.label ||
      humanizeDocumentKey(doc?.key || doc?.documentKey || doc?.type || fallbackKey) ||
      doc?.fileName ||
      'Document',
    fileNames,
    identify_number: doc?.identify_number ?? doc?.identifyNumber ?? doc?.number ?? doc?.id_number ?? '',
    expiry_date: doc?.expiry_date ?? doc?.expiryDate ?? doc?.expiry ?? '',
    status: getDocumentReviewStatus(doc),
    comment: getDocumentReason(doc),
    images,
    uploadedAt: doc?.uploadedAt ?? doc?.updatedAt ?? doc?.createdAt ?? null,
    reviewedAt: doc?.reviewedAt ?? null,
    reverificationRequestedAt: doc?.reverificationRequestedAt ?? null,
  };
};

const DriverDetails = () => {
  const navigate = useNavigate();
  const driverPaths = useDriverPaths();
  const location = useLocation();
  const { id } = useParams();
  const [activeTab, setActiveTab] = useState('Driver Profile');
  const [profile, setProfile] = useState(null);
  const [walletForm, setWalletForm] = useState({ amount: '', operation: 'credit', isSubmitting: false });
  const [walletHistory, setWalletHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [documentActionKey, setDocumentActionKey] = useState('');

  const tabs = [
    'Driver Profile',
    'Request List',
    'Payment History',
    'Withdrawal History',
    'Review History',
    'Documents',
    'Subscription',
  ];

  const fetchProfile = async () => {
    setIsLoading(true);
    setError('');
    setAvatarFailed(false);
    try {
      const token = (localStorage.getItem('admin_accessToken') || localStorage.getItem('adminToken'));
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const [res, walletRes] = await Promise.all([
        fetch(
          `${API_BASE_URL}/admin/drivers/${id}/profile?t=${Date.now()}`,
          {
            headers,
            cache: 'no-store',
          },
        ),
        adminService.getDriverWalletHistory(id).catch(() => null),
      ]);
      const data = await res.json();
      if (res.ok && data.success) {
        setProfile(data.data);
        const walletPayload = walletRes?.data?.data || walletRes?.data || walletRes || {};
        setWalletHistory(Array.isArray(walletPayload?.results) ? walletPayload.results : []);
      } else {
        setError(data.message || 'Unable to load driver profile');
      }
    } catch (err) {
      setError('Unable to load driver profile');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, [id]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tab = params.get('tab');
    if (tab && tabs.includes(tab)) {
      setActiveTab(tab);
    }
  }, [location.search]);

  const mapCenter = useMemo(() => {
    if (!profile?.location?.lat || !profile?.location?.lng) return DELHI_CENTER;
    return { lat: profile.location.lat, lng: profile.location.lng };
  }, [profile]);
  const shouldLoadMap = activeTab === 'Driver Profile';
  const { isLoaded, loadError } = useAppGoogleMapsLoader();
  const vehicleMapIconUrl = useMemo(
    () => getMapIconForVehicle(profile?.vehicleIconType || profile?.vehicle_image || profile?.vehicle?.type),
    [profile],
  );
  const vehicleMarkerIcon = useMemo(() => {
    if (!isLoaded || !globalThis.google?.maps || !vehicleMapIconUrl) {
      return undefined;
    }

    return {
      url: vehicleMapIconUrl,
      scaledSize: new globalThis.google.maps.Size(42, 42),
      anchor: new globalThis.google.maps.Point(21, 21),
    };
  }, [isLoaded, vehicleMapIconUrl]);

  const stats = profile?.stats || {};
  const earnings = profile?.earnings || {};
  const wallet = profile?.wallet || {};
  const requests = profile?.requests || [];
  const withdrawals = profile?.withdrawals || [];
  const normalizedBackRoute = typeof location.state?.from === 'string' ? location.state.from.trim() : '';
  const backRoute = normalizedBackRoute.startsWith('/taxi/admin/')
    ? normalizedBackRoute
    : `${driverPaths.drivers}/pending`;
  const onboardingVehicle = profile?.onboarding?.vehicle || {};
  const vehicleFieldSummary = useMemo(() => ([
    {
      label: 'Operating City',
      value:
        onboardingVehicle.locationName ||
        profile?.service_location?.name ||
        profile?.service_location?.service_location_name ||
        profile?.city ||
        'Not set',
    },
    {
      label: 'Service Categories',
      value: formatServiceCategories(
        onboardingVehicle.serviceCategories ||
        profile?.service_categories ||
        profile?.serviceCategories ||
        profile?.registerFor ||
        profile?.register_for ||
        profile?.transport_type,
      ),
    },
    {
      label: 'Vehicle Type',
      value:
        onboardingVehicle.vehicleType ||
        profile?.vehicle?.type ||
        profile?.vehicle_type ||
        profile?.car_type ||
        'Not set',
    },
    {
      label: 'Brand / Make',
      value: onboardingVehicle.make || profile?.vehicle?.make || profile?.vehicle_make || profile?.car_make || 'Not set',
    },
    {
      label: 'Model',
      value: onboardingVehicle.model || profile?.vehicle?.model || profile?.vehicle_model || profile?.car_model || 'Not set',
    },
    {
      label: 'Year',
      value: onboardingVehicle.year || profile?.vehicle?.year || profile?.vehicle_year || profile?.car_year || 'Not set',
    },
    {
      label: 'Plate Number',
      value: onboardingVehicle.number || profile?.vehicle?.number || profile?.vehicle_number || profile?.car_number || 'Not set',
    },
    {
      label: 'Exterior Color',
      value: onboardingVehicle.color || profile?.vehicle?.color || profile?.vehicle_color || profile?.car_color || 'Not set',
    },
  ]), [onboardingVehicle, profile]);
  const documents = useMemo(() => {
    const candidateSources = [
      profile?.documents,
      profile?.onboarding?.documents,
      profile?.user_snapshot?.documents,
      profile?.owner_snapshot?.documents,
    ].filter(Boolean);

    const normalized = candidateSources.flatMap((raw) => {
      if (Array.isArray(raw)) {
        return raw.map((doc) => normalizeDocumentEntry(doc));
      }

      if (!raw || typeof raw !== 'object') {
        return [];
      }

      return Object.entries(raw).flatMap(([key, value]) => {
        if (!value) return [];
        return Array.isArray(value)
          ? value.map((doc) => normalizeDocumentEntry(doc, key))
          : [normalizeDocumentEntry(value, key)];
      });
    });

    return normalized.filter(
      (doc, index, items) =>
        (doc.images.length > 0 || doc.name || doc.sourceKey) &&
        items.findIndex(
          (item) =>
            item.sourceKey === doc.sourceKey &&
            item.name === doc.name &&
            JSON.stringify(item.images) === JSON.stringify(doc.images),
        ) === index,
    ).map((doc) => {
      const uploadedAtTime = Math.max(
        toTimestamp(doc.uploadedAt),
        toTimestamp(doc.reverificationRequestedAt),
      );
      const reviewedAtTime = toTimestamp(doc.reviewedAt);

      return {
        ...doc,
        isReuploaded:
          String(doc.status || '').toLowerCase() === 'pending' &&
          uploadedAtTime > 0 &&
          reviewedAtTime > 0 &&
          uploadedAtTime >= reviewedAtTime,
      };
    });
  }, [profile]);
  const chart = profile?.chart || { months: [], earnings: [], trips: { completed: [], cancelled: [] } };
  const profileImage = String(profile?.image || '').trim();

  const acceptanceRate = requests.length
    ? Math.round((stats.completed_trips / requests.length) * 100)
    : 0;
  const cancellationRate = requests.length
    ? Math.round((stats.cancelled_trips / requests.length) * 100)
    : 0;

  if (isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin"></div>
          <p className="text-sm text-gray-500">Loading driver profile...</p>
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-sm font-semibold text-rose-600">{error || 'Driver not found'}</p>
          <button
            onClick={() => navigate(-1)}
            className="px-4 py-2 text-sm text-white bg-indigo-600 rounded-lg"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-8 font-sans text-gray-900">
      <div className="mb-6">
        <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
          <span>Drivers</span>
          <ChevronRight size={12} />
          <span className="text-gray-700">Driver Profile</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-semibold text-gray-900">Driver Profile</h1>
          <button
            onClick={() => navigate(backRoute)}
            className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <ArrowLeft size={16} /> Back
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr_280px] gap-6 items-center">
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-full overflow-hidden bg-gray-100 border border-gray-200">
              {profileImage && !avatarFailed ? (
                <img
                  src={profileImage}
                  alt={profile.name}
                  className="w-full h-full object-cover"
                  onError={() => setAvatarFailed(true)}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-slate-100 text-slate-400">
                  <CircleUserRound size={42} strokeWidth={1.75} />
                </div>
              )}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{profile.name}</h2>
              <p className="text-sm text-gray-500">{profile.city || 'India'}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-gray-600">
            <div className="flex items-center gap-2">
              <Phone size={14} className="text-gray-400" />
              <span>{profile.phone || profile.mobile || 'N/A'}</span>
            </div>
            <div className="flex items-center gap-2">
              <Mail size={14} className="text-gray-400" />
              <span>{profile.email || 'N/A'}</span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar size={14} className="text-gray-400" />
              <span>{profile.joined_at}</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-xl overflow-hidden bg-gray-100 border border-gray-200">
              <img
                src={profile.vehicle_image}
                alt="Vehicle"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="text-sm text-gray-600">
              <p className="text-gray-900 font-semibold">{profile.vehicle?.type || 'Vehicle'}</p>
              <p>{profile.vehicle?.make}</p>
              <p>{profile.vehicle?.model}</p>
              <p>{profile.vehicle?.number}</p>
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-start gap-4">
          <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${profile.isOnline ? 'bg-sky-50 text-sky-700' : 'bg-gray-100 text-gray-500'}`}>
            <span className={`h-2 w-2 rounded-full ${profile.isOnline ? 'bg-sky-500' : 'bg-gray-400'}`} />
            {profile.isOnline ? 'Driver Online' : 'Driver Offline'}
          </span>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-2 flex flex-wrap gap-2 mb-6">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors ${
              activeTab === tab
                ? 'bg-indigo-600 text-white'
                : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab !== 'Driver Profile' ? (
        <>
          {activeTab === 'Request List' && (
            <div className="space-y-6">
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="border border-gray-100 rounded-lg p-4">
                    <p className="text-sm text-gray-500">Completed Rides</p>
                    <p className="text-2xl font-semibold text-gray-900">{stats.completed_trips || 0}</p>
                  </div>
                  <div className="border border-gray-100 rounded-lg p-4">
                    <p className="text-sm text-gray-500">Acceptance Rate</p>
                    <p className="text-2xl font-semibold text-gray-900">{acceptanceRate}%</p>
                  </div>
                  <div className="border border-gray-100 rounded-lg p-4">
                    <p className="text-sm text-gray-500">Cancellation Rate</p>
                    <p className="text-2xl font-semibold text-gray-900">{cancellationRate}%</p>
                  </div>
                  <div className="border border-gray-100 rounded-lg p-4">
                    <p className="text-sm text-gray-500">Cancelled Rides</p>
                    <p className="text-2xl font-semibold text-gray-900">{stats.cancelled_trips || 0}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100 text-xs text-gray-500">
                        <th className="px-6 py-3">Request Id</th>
                        <th className="px-4 py-3">Date</th>
                        <th className="px-4 py-3">User Name</th>
                        <th className="px-4 py-3">Driver Name</th>
                        <th className="px-4 py-3">Trip Status</th>
                        <th className="px-4 py-3">Paid</th>
                        <th className="px-4 py-3">Payment Option</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-sm text-gray-700">
                      {requests.length === 0 ? (
                        <tr>
                          <td colSpan="7" className="px-6 py-12 text-center text-gray-400">No data found.</td>
                        </tr>
                      ) : (
                        requests.map((item) => (
                          <tr key={item.request_id}>
                            <td className="px-6 py-3">{item.request_id.slice(-8).toUpperCase()}</td>
                            <td className="px-4 py-3">
                              {item.date ? new Date(item.date).toLocaleString('en-IN') : 'N/A'}
                            </td>
                            <td className="px-4 py-3">{item.user_name}</td>
                            <td className="px-4 py-3">{item.driver_name}</td>
                            <td className="px-4 py-3 capitalize">{item.trip_status}</td>
                            <td className="px-4 py-3">{item.paid ? 'Yes' : 'No'}</td>
                            <td className="px-4 py-3 capitalize">{item.payment_option}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'Payment History' && (
            <div className="space-y-6">
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="border border-gray-100 rounded-lg p-4">
                    <p className="text-sm text-gray-500">Total Credited</p>
                    <p className="text-2xl font-semibold text-gray-900">? {wallet.total_credits || 0}</p>
                  </div>
                  <div className="border border-gray-100 rounded-lg p-4">
                    <p className="text-sm text-gray-500">Total Debited</p>
                    <p className="text-2xl font-semibold text-gray-900">? {wallet.total_debits || 0}</p>
                  </div>
                  <div className="border border-gray-100 rounded-lg p-4">
                    <p className="text-sm text-gray-500">Available Balance</p>
                    <p className="text-2xl font-semibold text-gray-900">? {wallet.balance || 0}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <h3 className="text-sm font-semibold text-gray-900 mb-4">Credit or Debit wallet</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1.5">Amount *</label>
                    <input
                      type="number"
                      min="0"
                      className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm text-gray-800 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-colors"
                      placeholder="Enter Amount"
                      value={walletForm.amount}
                      onChange={(e) => setWalletForm((prev) => ({ ...prev, amount: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1.5">Operation *</label>
                    <select
                      className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm text-gray-800 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-colors"
                      value={walletForm.operation}
                      onChange={(e) => setWalletForm((prev) => ({ ...prev, operation: e.target.value }))}
                    >
                      <option value="credit">Credit</option>
                      <option value="debit">Debit</option>
                    </select>
                  </div>
                </div>
                <div className="mt-4">
                  <button
                    type="button"
                    disabled={walletForm.isSubmitting || !walletForm.amount}
                    onClick={async () => {
                      setWalletForm((prev) => ({ ...prev, isSubmitting: true }));
                      try {
                        const token = (localStorage.getItem('admin_accessToken') || localStorage.getItem('adminToken'));
                        await fetch(
                          `${API_BASE_URL}/admin/wallet/drivers/${id}/adjust`,
                          {
                            method: 'POST',
                            headers: {
                              ...(token ? { Authorization: `Bearer ${token}` } : {}),
                              'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                              amount: Number(walletForm.amount),
                              operation: walletForm.operation,
                            }),
                          },
                        );
                        setWalletForm({ amount: '', operation: 'credit', isSubmitting: false });
                        await fetchProfile();
                      } catch (err) {
                        setWalletForm((prev) => ({ ...prev, isSubmitting: false }));
                      }
                    }}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
                  >
                    {walletForm.isSubmitting ? 'Saving...' : 'Submit'}
                  </button>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-900">Wallet Transactions</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100 text-xs text-gray-500">
                        <th className="px-6 py-3">Date</th>
                        <th className="px-4 py-3">Type</th>
                        <th className="px-4 py-3">Amount</th>
                        <th className="px-4 py-3">Description</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-sm text-gray-700">
                      {walletHistory.length === 0 ? (
                        <tr>
                          <td colSpan="4" className="px-6 py-12 text-center text-gray-400">No wallet transactions found.</td>
                        </tr>
                      ) : (
                        walletHistory.map((item) => (
                          <tr key={item._id}>
                            <td className="px-6 py-3">{item.createdAt ? new Date(item.createdAt).toLocaleString('en-IN') : 'N/A'}</td>
                            <td className="px-4 py-3 capitalize">{String(item.type || '').replace(/_/g, ' ') || 'N/A'}</td>
                            <td className={`px-4 py-3 font-semibold ${Number(item.amount || 0) < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                              ? {Math.abs(Number(item.amount || 0))}
                            </td>
                            <td className="px-4 py-3">{item.description || '-'}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'Withdrawal History' && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100 text-xs text-gray-500">
                      <th className="px-6 py-3">Date</th>
                      <th className="px-4 py-3">Name</th>
                      <th className="px-4 py-3">Mobile Number</th>
                      <th className="px-4 py-3">Requested Amount</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-sm text-gray-700">
                    {withdrawals.length === 0 ? (
                      <tr>
                        <td colSpan="6" className="px-6 py-12 text-center text-gray-400">No data found.</td>
                      </tr>
                    ) : (
                      withdrawals.map((item) => (
                        <tr key={item._id}>
                          <td className="px-6 py-3">{item.date ? new Date(item.date).toLocaleString('en-IN') : 'N/A'}</td>
                          <td className="px-4 py-3">{item.name}</td>
                          <td className="px-4 py-3">{item.mobile}</td>
                          <td className="px-4 py-3">? {item.requested_amount}</td>
                          <td className="px-4 py-3 capitalize">{item.status}</td>
                          <td className="px-4 py-3">-</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'Review History' && (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-500">
              No reviews found.
            </div>
          )}

          {activeTab === 'Documents' && (
            <div className="space-y-6">
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-gray-900">Vehicle Onboarding Details</h3>
                    <p className="mt-1 text-sm text-gray-500">
                      These values mirror the fields collected from the driver on the vehicle setup step.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate(`${driverPaths.drivers}/edit/${id}`, { state: { from: location.pathname + location.search } })}
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    <PencilLine size={15} />
                    Edit Driver Fields
                  </button>
                </div>

                <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                  {vehicleFieldSummary.map((item) => (
                    <div key={item.label} className="rounded-xl border border-gray-100 bg-gray-50/70 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{item.label}</p>
                      <p className="mt-2 text-sm font-semibold text-gray-900">{item.value || 'Not set'}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100 text-xs text-gray-500">
                      <th className="px-6 py-3">Document Name</th>
                      <th className="px-4 py-3">Identify Number</th>
                      <th className="px-4 py-3">Expiry Date</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Comment</th>
                      <th className="px-4 py-3">Document</th>
                      <th className="px-4 py-3">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-sm text-gray-700">
                    {documents.length === 0 ? (
                      <tr>
                        <td colSpan="7" className="px-6 py-12 text-center text-gray-400">No documents found.</td>
                      </tr>
                    ) : (
                      documents.map((doc, idx) => (
                        <tr key={`${doc.name}-${idx}`}>
                          <td className="px-6 py-3">
                            <div className="font-semibold text-gray-900">{doc.name}</div>
                          </td>
                          <td className="px-4 py-3">{doc.identify_number}</td>
                          <td className="px-4 py-3">{doc.expiry_date}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              String(doc.status || '').toLowerCase() === 'approved' 
                                ? 'bg-emerald-100 text-emerald-800' 
                                : String(doc.status || '').toLowerCase() === 'rejected' || String(doc.status || '').toLowerCase() === 'declined'
                                ? 'bg-rose-100 text-rose-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}>
                              {doc.status || 'Pending'}
                            </span>
                            {doc.isReuploaded ? (
                              <div className="mt-1 text-[10px] font-bold uppercase tracking-widest text-blue-600">
                                Re-uploaded for review
                              </div>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 max-w-[200px]">
                            <div className="text-xs text-gray-600 line-clamp-2" title={doc.comment}>
                              {doc.comment || '-'}
                            </div>
                            {['rejected', 'declined'].includes(String(doc.status || '').toLowerCase()) && doc.comment ? (
                              <div className="mt-1 text-[11px] font-semibold text-rose-600">
                                Rejection reason: {doc.comment}
                              </div>
                            ) : null}
                            {(doc.uploadedAt || doc.reviewedAt) ? (
                              <div className="mt-1 space-y-0.5 text-[10px] text-gray-400">
                                {doc.uploadedAt ? <div>Uploaded: {formatDateTime(doc.uploadedAt)}</div> : null}
                                {doc.reviewedAt ? <div>Reviewed: {formatDateTime(doc.reviewedAt)}</div> : null}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-4 py-3">
                            {doc.images?.length ? (
                              <div className="space-y-2">
                                <div className="text-sm font-bold text-gray-900">
                                  {doc.name || 'Uploaded document'}
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  {doc.images.map((url, i) => (
                                    <button
                                      key={`view-${i}`}
                                      type="button"
                                      onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
                                      className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-indigo-600 bg-indigo-50 rounded-md hover:bg-indigo-100 transition-colors inline-flex items-center gap-1"
                                    >
                                      <Eye size={10} /> View
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ) : (
                              <span className="text-xs font-medium text-slate-400">No file</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={async () => {
                                  if (!doc.sourceKey) return;
                                  const confirmApprove = window.confirm(`Are you sure you want to approve "${doc.name}"?`);
                                  if (!confirmApprove) return;

                                  try {
                                    setDocumentActionKey(`${doc.sourceKey}:approve`);
                                    const token = (localStorage.getItem('admin_accessToken') || localStorage.getItem('adminToken'));
                                    const nextDocuments = {
                                      ...(profile?.documents || {}),
                                      [doc.sourceKey]: {
                                        ...(profile?.documents?.[doc.sourceKey] || {}),
                                        key: doc.sourceKey,
                                        name: doc.name,
                                        fileName: doc.fileNames?.[0] || doc.name || doc.sourceKey,
                                        previewUrl: doc.images?.[0] || profile?.documents?.[doc.sourceKey]?.previewUrl || '',
                                        secureUrl: doc.images?.[0] || profile?.documents?.[doc.sourceKey]?.secureUrl || '',
                                        images: doc.images || profile?.documents?.[doc.sourceKey]?.images || [],
                                        fileNames: doc.fileNames || profile?.documents?.[doc.sourceKey]?.fileNames || [],
                                        identify_number: doc.identify_number || profile?.documents?.[doc.sourceKey]?.identify_number || '',
                                        expiry_date: doc.expiry_date || profile?.documents?.[doc.sourceKey]?.expiry_date || '',
                                        status: 'approved',
                                        comment: '',
                                        remarks: '',
                                        reason: '',
                                        admin_comment: '',
                                        rejection_reason: '',
                                        reviewedAt: new Date().toISOString(),
                                        reverificationRequestedAt: null,
                                      },
                                    };

                                    const response = await fetch(
                                      `${API_BASE_URL}/admin/drivers/${id}`,
                                      {
                                        method: 'PATCH',
                                        headers: {
                                          ...(token ? { Authorization: `Bearer ${token}` } : {}),
                                          'Content-Type': 'application/json',
                                        },
                                        body: JSON.stringify({ documents: nextDocuments }),
                                      },
                                    );
                                    const data = await response.json();
                                    if (!response.ok || !data?.success) throw new Error(data?.message || 'Unable to approve');
                                    await fetchProfile();
                                  } catch (err) {
                                    window.alert(err?.message || 'Unable to approve');
                                  } finally {
                                    setDocumentActionKey('');
                                  }
                                }}
                                disabled={
                                  documentActionKey.length > 0 ||
                                  !doc.images?.length ||
                                  String(doc.status || '').toLowerCase() === 'approved'
                                }
                                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                                  documentActionKey === `${doc.sourceKey}:approve`
                                    ? 'bg-emerald-100 text-emerald-500'
                                    : !doc.images?.length || String(doc.status || '').toLowerCase() === 'approved' || documentActionKey.length > 0
                                      ? 'bg-slate-100 text-slate-300 cursor-not-allowed'
                                      : 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100'
                                }`}
                              >
                                {documentActionKey === `${doc.sourceKey}:approve` ? 'Saving...' : 'Approve'}
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  if (!doc.sourceKey) return;
                                  const note = window.prompt(`Reason for rejecting "${doc.name}"`, doc.comment || '');
                                  if (note === null) return;

                                  try {
                                    setDocumentActionKey(`${doc.sourceKey}:reject`);
                                    const token = (localStorage.getItem('admin_accessToken') || localStorage.getItem('adminToken'));
                                    const nextDocuments = {
                                      ...(profile?.documents || {}),
                                      [doc.sourceKey]: {
                                        ...(profile?.documents?.[doc.sourceKey] || {}),
                                        key: doc.sourceKey,
                                        name: doc.name,
                                        fileName: doc.fileNames?.[0] || doc.name || doc.sourceKey,
                                        previewUrl: doc.images?.[0] || profile?.documents?.[doc.sourceKey]?.previewUrl || '',
                                        secureUrl: doc.images?.[0] || profile?.documents?.[doc.sourceKey]?.secureUrl || '',
                                        images: doc.images || profile?.documents?.[doc.sourceKey]?.images || [],
                                        fileNames: doc.fileNames || profile?.documents?.[doc.sourceKey]?.fileNames || [],
                                        identify_number: doc.identify_number || profile?.documents?.[doc.sourceKey]?.identify_number || '',
                                        expiry_date: doc.expiry_date || profile?.documents?.[doc.sourceKey]?.expiry_date || '',
                                        status: 'rejected',
                                        comment: String(note || '').trim(),
                                        remarks: String(note || '').trim(),
                                        reason: String(note || '').trim(),
                                        admin_comment: String(note || '').trim(),
                                        rejection_reason: String(note || '').trim(),
                                        reviewedAt: new Date().toISOString(),
                                        reverificationRequestedAt: null,
                                      },
                                    };

                                    const response = await fetch(
                                      `${API_BASE_URL}/admin/drivers/${id}`,
                                      {
                                        method: 'PATCH',
                                        headers: {
                                          ...(token ? { Authorization: `Bearer ${token}` } : {}),
                                          'Content-Type': 'application/json',
                                        },
                                        body: JSON.stringify({ documents: nextDocuments }),
                                      },
                                    );
                                    const data = await response.json();

                                    if (!response.ok || !data?.success) {
                                      throw new Error(data?.message || 'Unable to reject document');
                                    }

                                    await fetchProfile();
                                  } catch (err) {
                                    window.alert(err?.message || 'Unable to reject document');
                                  } finally {
                                    setDocumentActionKey('');
                                  }
                                }}
                                disabled={
                                  documentActionKey.length > 0 ||
                                  !doc.images?.length ||
                                  ['rejected', 'declined'].includes(String(doc.status || '').toLowerCase())
                                }
                                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                                  documentActionKey === `${doc.sourceKey}:reject`
                                    ? 'bg-rose-100 text-rose-500'
                                    : !doc.images?.length || ['rejected', 'declined'].includes(String(doc.status || '').toLowerCase()) || documentActionKey.length > 0
                                      ? 'bg-slate-100 text-slate-300 cursor-not-allowed'
                                      : 'text-rose-600 bg-rose-50 hover:bg-rose-100'
                                }`}
                              >
                                {documentActionKey === `${doc.sourceKey}:reject` ? 'Saving...' : 'Decline'}
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
            </div>
          )}

          {activeTab === 'Subscription' && (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-500">
              No subscription data available.
            </div>
          )}
        </>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
            <h3 className="text-base font-semibold text-gray-900 mb-4">Wallet Overview</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="border border-gray-100 rounded-lg p-4">
                <p className="text-sm text-gray-500">Wallet Balance</p>
                <p className="text-2xl font-semibold text-gray-900">Rs. {wallet.balance || 0}</p>
              </div>
              <div className="border border-gray-100 rounded-lg p-4">
                <p className="text-sm text-gray-500">Cash Limit</p>
                <p className="text-2xl font-semibold text-gray-900">Rs. {wallet.cash_limit || 0}</p>
              </div>
              <div className="border border-gray-100 rounded-lg p-4">
                <p className="text-sm text-gray-500">Total Credited</p>
                <p className="text-2xl font-semibold text-gray-900">Rs. {wallet.total_credits || 0}</p>
              </div>
              <div className="border border-gray-100 rounded-lg p-4">
                <p className="text-sm text-gray-500">Total Debited</p>
                <p className="text-2xl font-semibold text-gray-900">Rs. {wallet.total_debits || 0}</p>
              </div>
              <div className="border border-gray-100 rounded-lg p-4">
                <p className="text-sm text-gray-500">Wallet Status</p>
                <p className={`text-2xl font-semibold ${wallet.is_blocked ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {wallet.is_blocked ? 'Blocked' : 'Active'}
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6"> 
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="text-base font-semibold text-gray-900 mb-4">Driver Location</h3>
              <div className="h-80 rounded-xl overflow-hidden border border-gray-100">
                {loadError ? (
                  <div className="h-full flex items-center justify-center text-sm text-gray-500 bg-gray-50">
                    Map unavailable.
                  </div>
                ) : !profile?.location ? (
                  <div className="h-full flex items-center justify-center text-sm text-gray-500 bg-gray-50">
                    Live driver location is not available yet.
                  </div>
                ) : shouldLoadMap && HAS_VALID_GOOGLE_MAPS_KEY && isLoaded ? (
                  <GoogleMap
                    mapContainerStyle={mapContainerStyle}
                    center={mapCenter}
                    zoom={13}
                    options={{ streetViewControl: false, mapTypeControl: true, fullscreenControl: true }}
                  >
                    <MarkerF position={mapCenter} icon={vehicleMarkerIcon} />
                  </GoogleMap>
                ) : (
                  <div className="h-full flex items-center justify-center text-sm text-gray-500 bg-gray-50">
                    {HAS_VALID_GOOGLE_MAPS_KEY ? 'Loading map...' : 'Configure `VITE_GOOGLE_MAPS_API_KEY` to show map.'}
                  </div>
                )}
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 text-xs text-gray-500">
                <span>
                  {profile?.vehicle?.type || 'Vehicle'} marker
                </span>
                {profile?.location ? (
                  <span>
                    {Number(profile.location.lat).toFixed(4)}, {Number(profile.location.lng).toFixed(4)}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="text-base font-semibold text-gray-900 mb-4">Earnings</h3>
              <div className="h-52 rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4">
                <div className="relative h-full">
                  <ChartGrid height={170} />
                  <svg viewBox="0 0 400 170" className="absolute inset-0 w-full h-full">
                    <polyline
                      fill="none"
                      stroke="#10b981"
                      strokeWidth="2.5"
                      points={buildLinePoints(chart.earnings || [], 400, 170)}
                    />
                  </svg>
                </div>
                <div className="mt-3 grid grid-cols-4 text-xs text-gray-400">
                  {(chart.months || []).map((m) => (
                    <span key={m} className="text-center">{m}</span>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
                <div className="border border-gray-100 rounded-lg p-3">
                  <p className="text-xs text-gray-500">Today Earnings</p>
                  <p className="text-lg font-semibold">? {earnings.today_earnings || 0}</p>
                </div>
                <div className="border border-gray-100 rounded-lg p-3">
                  <p className="text-xs text-gray-500">Admin Commission</p>
                  <p className="text-lg font-semibold">? {earnings.admin_commission || 0}</p>
                </div>
                <div className="border border-gray-100 rounded-lg p-3">
                  <p className="text-xs text-gray-500">Drivers Earnings</p>
                  <p className="text-lg font-semibold">? {earnings.driver_earnings || 0}</p>
                </div>
                <div className="border border-gray-100 rounded-lg p-3">
                  <p className="text-xs text-gray-500">By Cash</p>
                  <p className="text-lg font-semibold">? {earnings.by_cash || 0}</p>
                </div>
                <div className="border border-gray-100 rounded-lg p-3">
                  <p className="text-xs text-gray-500">By Wallet</p>
                  <p className="text-lg font-semibold">? {earnings.by_wallet || 0}</p>
                </div>
                <div className="border border-gray-100 rounded-lg p-3">
                  <p className="text-xs text-gray-500">By Card/Online</p>
                  <p className="text-lg font-semibold">? {earnings.by_card || 0}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-base font-semibold text-gray-900 mb-4">Trips</h3>
            <div className="h-52 rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4">
              <div className="relative h-full">
                <ChartGrid height={170} />
                <svg viewBox="0 0 400 170" className="absolute inset-0 w-full h-full">
                  <polyline
                    fill="none"
                    stroke="#10b981"
                    strokeWidth="2.5"
                    points={buildLinePoints(chart.trips?.completed || [], 400, 170)}
                  />
                  <polyline
                    fill="none"
                    stroke="#f97316"
                    strokeWidth="2.5"
                    points={buildLinePoints(chart.trips?.cancelled || [], 400, 170)}
                  />
                </svg>
              </div>
              <div className="mt-3 grid grid-cols-4 text-xs text-gray-400">
                {(chart.months || []).map((m) => (
                  <span key={m} className="text-center">{m}</span>
                ))}
              </div>
              <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  Completed
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-primary-orange/50"></span>
                  Cancelled
                </span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 mt-4">
              <div className="border border-gray-100 rounded-lg p-3">
                <p className="text-xs text-gray-500">Completed Trips</p>
                <p className="text-lg font-semibold">{stats.completed_trips || 0}</p>
              </div>
              <div className="border border-gray-100 rounded-lg p-3">
                <p className="text-xs text-gray-500">Cancelled Trips</p>
                <p className="text-lg font-semibold">{stats.cancelled_trips || 0}</p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default DriverDetails;
  const buildLinePoints = (values, width, height, padding = 16) => {
    if (!values.length) return '';
    const maxValue = Math.max(...values, 1);
    const stepX = (width - padding * 2) / (values.length - 1 || 1);
    return values
      .map((value, index) => {
        const x = padding + index * stepX;
        const y = height - padding - (Number(value) / maxValue) * (height - padding * 2);
        return `${x},${y}`;
      })
      .join(' ');
  };

  const ChartGrid = ({ height = 180 }) => (
    <svg viewBox={`0 0 400 ${height}`} className="w-full h-full">
      {[0, 1, 2, 3].map((i) => (
        <line
          key={i}
          x1="24"
          x2="376"
          y1={24 + i * ((height - 48) / 3)}
          y2={24 + i * ((height - 48) / 3)}
          stroke="#e5e7eb"
          strokeDasharray="4 4"
        />
      ))}
    </svg>
  );




