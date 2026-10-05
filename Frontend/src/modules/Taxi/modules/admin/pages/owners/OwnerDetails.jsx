import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  Car,
  ChevronRight,
  CircleUserRound,
  CreditCard,
  FileText,
  Globe2,
  Loader2,
  Mail,
  Menu,
  Phone,
} from 'lucide-react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';

import { adminService } from '../../services/adminService';
import AdminPageHeader from '../../components/ui/AdminPageHeader';

const tabs = [
  'Owner Profile',
  'Driver Details',
  'Fleet Details',
  'Payment History',
  'Withdrawal History',
  'Documents',
];

const emptyStateByTab = {
  'Driver Details': 'No driver details found for this owner.',
  'Fleet Details': 'No fleet details found for this owner.',
  'Payment History': 'No payment history found for this owner.',
  'Withdrawal History': 'No withdrawal history found for this owner.',
  Documents: 'No documents found for this owner.',
};

const formatMobile = (owner) => {
  const mobile = owner?.mobile_number || owner?.mobile || owner?.phone || '';
  if (!mobile) return '-';
  return String(mobile).startsWith('+') ? mobile : `+91${mobile}`;
};

const InfoLine = ({ icon, children }) => {
  const IconComponent = icon;

  return (
    <div className="flex items-center gap-2 text-[15px] font-medium text-gray-900">
      <IconComponent size={16} strokeWidth={1.8} className="text-gray-950" />
      <span>{children || '-'}</span>
    </div>
  );
};

const StatCard = ({ label, value, tone = 'teal' }) => {
  const toneClass =
    tone === 'rose'
      ? 'bg-rose-50 text-red-500'
      : 'bg-teal-50 text-teal-500';

  return (
    <div className="rounded border border-gray-200 bg-white px-4 py-5 shadow-sm">
      <div className={`mb-6 flex h-11 w-11 items-center justify-center rounded-full ${toneClass}`}>
        <Car size={19} strokeWidth={2.1} />
      </div>
      <p className="text-lg font-semibold leading-none text-slate-700">{value}</p>
      <p className="mt-2 text-[15px] font-semibold text-slate-400">{label}</p>
    </div>
  );
};

const OwnerDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState(location.state?.defaultTab || 'Owner Profile');
  const [owner, setOwner] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [avatarFailed, setAvatarFailed] = useState(false);

  useEffect(() => {
    const fetchOwner = async () => {
      setIsLoading(true);
      setError('');
      setAvatarFailed(false);

      try {
        const response = await adminService.getOwner(id);
        if (response.success) {
          setOwner(response.data);
        } else {
          setError(response.message || 'Unable to load owner profile');
        }
      } catch (err) {
        setError(err.message || 'Unable to load owner profile');
      } finally {
        setIsLoading(false);
      }
    };

    fetchOwner();
  }, [id]);

  const ownerName = owner?.owner_name || owner?.name || owner?.user?.name || 'Owner';
  const companyName = owner?.company_name || '-';
  const areaName = owner?.area_name || owner?.area?.name || owner?.user?.country_name || 'India';
  const profileImage = owner?.user?.profile_picture;
  const initials = useMemo(
    () =>
      ownerName
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0])
        .join('')
        .toUpperCase() || 'O',
    [ownerName],
  );

  const reportCards = [
    { label: 'Registered Fleets', value: owner?.no_of_vehicles || 0 },
    { label: 'Approved Fleets', value: 0 },
    { label: 'Fleets Awaiting Review', value: 0, tone: 'rose' },
    { label: 'Registered Drivers', value: 0 },
    { label: 'Approved Drivers', value: 0 },
    { label: 'Drivers Awaiting Review', value: 0, tone: 'rose' },
  ];

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-slate-400">
        <Loader2 size={34} className="animate-spin text-teal-500" />
        <p className="text-sm font-semibold">Loading owner profile...</p>
      </div>
    );
  }

  if (error || !owner) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-50 text-rose-500">
          <AlertCircle size={32} />
        </div>
        <p className="text-sm font-semibold text-rose-600">{error || 'Owner not found'}</p>
        <button
          type="button"
          onClick={() => navigate('/taxi/admin/owners')}
          className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
        >
          Back to Owners
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-950">
      <div className="p-6 lg:p-8">
        <AdminPageHeader module="Owner Management" page="Owner Details" title="Owner Details" backto="/taxi/admin/owners" />

        <div className="mt-6">
          <div className="rounded border border-gray-200 bg-white shadow-sm">
        <div className="grid gap-6 px-4 py-6 md:grid-cols-[1fr_1px_1fr] md:px-5">
          <div className="flex items-center gap-4">
            <div className="flex h-[102px] w-[102px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-pink-200 via-violet-100 to-fuchsia-300 text-3xl font-bold text-indigo-950">
              {profileImage && !avatarFailed ? (
                <img
                  src={profileImage}
                  alt={ownerName}
                  className="h-full w-full object-cover"
                  onError={() => setAvatarFailed(true)}
                />
              ) : (
                initials
              )}
            </div>

            <div className="space-y-3">
              <InfoLine icon={Building2}>{companyName}</InfoLine>
              <InfoLine icon={CircleUserRound}>{ownerName}</InfoLine>
              <InfoLine icon={Globe2}>{areaName}</InfoLine>
            </div>
          </div>

          <div className="hidden bg-gray-100 md:block" />

          <div className="flex flex-col justify-center gap-4 md:pl-3">
            <InfoLine icon={Phone}>{formatMobile(owner)}</InfoLine>
            <InfoLine icon={Mail}>{owner.email}</InfoLine>
          </div>
        </div>

        <div className="border-t border-gray-100 px-4">
          <div className="flex flex-wrap gap-0">
            {tabs.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`border-b-2 px-4 py-4 text-sm font-medium transition-colors ${
                  activeTab === tab
                    ? 'border-teal-500 bg-slate-50 text-gray-950'
                    : 'border-transparent text-gray-950 hover:bg-slate-50'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="relative mt-9 rounded border border-gray-200 bg-white p-7 shadow-sm">
        {activeTab === 'Owner Profile' ? (
          <>
            <h2 className="mb-5 text-base font-medium text-slate-700">General Report</h2>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
              {reportCards.map((card) => (
                <StatCard key={card.label} {...card} />
              ))}
            </div>

            <div className="mt-10">
              <h2 className="mb-4 text-base font-medium text-slate-700">Map</h2>
              <div className="flex h-64 items-center justify-center rounded border border-dashed border-gray-200 bg-gray-50 text-sm font-medium text-slate-400">
                Map location is not available for this owner yet.
              </div>
            </div>
          </>
        ) : (
          <div className="flex min-h-[320px] flex-col items-center justify-center gap-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-50 text-slate-400">
              {activeTab === 'Documents' ? <FileText size={26} /> : <CreditCard size={26} />}
            </div>
            <p className="text-sm font-semibold text-slate-400">{emptyStateByTab[activeTab]}</p>
          </div>
        )}

        <button
          type="button"
          className="absolute -right-1 top-28 flex h-14 w-14 items-center justify-center rounded-full bg-teal-500 text-white shadow-xl transition-colors hover:bg-teal-600"
        >
          <Menu size={24} />
        </button>
      </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => navigate('/taxi/admin/owners')}
        className="mt-6 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-50"
      >
        <ArrowLeft size={16} /> Back
      </button>
    </div>
  );
};

export default OwnerDetails;
