import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  Eye,
  FileSearch,
  FileText,
  Filter,
  LayoutGrid,
  List,
  Loader2,
  Menu,
  Plus,
  Search,
  Star,
  XCircle,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import AdminPageHeader from '../../components/ui/AdminPageHeader';
import { adminService } from '../../services/adminService';

const isFleetDriver = (driver) => Boolean(driver?.owner_id || driver?.fleet_id);

const getDriverId = (driver) => String(driver?._id || driver?.id || '');

const getDriverName = (driver) => driver?.name || driver?.user_id?.name || driver?.full_name || '-';

const getServiceLocation = (driver) =>
  driver?.service_location_id?.service_location_name ||
  driver?.service_location_id?.name ||
  driver?.service_location_name ||
  driver?.service_location ||
  driver?.area_name ||
  '-';

const getTransportType = (driver) =>
  driver?.transport_type ||
  driver?.vehicle_type ||
  driver?.car_type ||
  driver?.driver_account_type ||
  '-';

const getMobile = (driver) => {
  const mobile = driver?.mobile || driver?.user_id?.mobile || driver?.phone || '';
  if (!mobile) return '-';
  return String(mobile).startsWith('+') ? mobile : `+91${mobile}`;
};

const getEmail = (driver) => driver?.email || driver?.user_id?.email || '-';

const getDeclinedReason = (driver) =>
  driver?.declined_reason ||
  driver?.declineReason ||
  driver?.rejectionReason ||
  driver?.rejected_reason ||
  driver?.reason ||
  '-';

const getDriverStatus = (driver) => {
  const rawStatus = String(driver?.status || '').trim().toLowerCase();
  const approveValue = driver?.approve;
  const normalizedApprove = String(approveValue ?? '').trim().toLowerCase();

  if (
    approveValue === true ||
    approveValue === 1 ||
    ['true', '1', 'yes', 'approved'].includes(normalizedApprove) ||
    ['approved', 'active', 'verified'].includes(rawStatus)
  ) {
    return 'approved';
  }

  if (['inactive', 'disapproved', 'rejected', 'blocked'].includes(rawStatus)) {
    return rawStatus;
  }

  return 'pending';
};

const getStatusClasses = (status) => {
  switch (status) {
    case 'approved':
      return 'bg-emerald-50 text-emerald-700';
    case 'inactive':
    case 'disapproved':
    case 'rejected':
    case 'blocked':
      return 'bg-rose-50 text-rose-700';
    default:
      return 'bg-amber-50 text-amber-700';
  }
};

const toStatusLabel = (status) =>
  String(status || 'pending')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

const BlockedFleetDrivers = () => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [drivers, setDrivers] = useState([]);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [page, setPage] = useState(1);
  const [actionDriverId, setActionDriverId] = useState('');

  const fetchData = async () => {
    setIsLoading(true);

    try {
      const response = await adminService.getDrivers(1, 100);
      const items = response?.data?.data?.results || response?.data?.results || [];
      setDrivers(
        items.filter((driver) => isFleetDriver(driver) && getDriverStatus(driver) !== 'approved'),
      );
    } catch (error) {
      console.error('Failed to fetch blocked fleet drivers:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [itemsPerPage]);

  const handleApproval = async (driver, approve) => {
    const driverId = getDriverId(driver);
    if (!driverId) {
      return;
    }

    const nextStatus = approve ? 'approved' : 'inactive';
    const confirmationMessage = approve
      ? 'Approve this fleet driver?'
      : 'Mark this fleet driver as inactive?';

    if (!window.confirm(confirmationMessage)) {
      return;
    }

    setActionDriverId(driverId);

    try {
      await adminService.updateDriverStatus(driverId, {
        approve,
        active: approve,
        status: nextStatus,
      });

      setDrivers((current) =>
        current
          .map((item) =>
            getDriverId(item) === driverId
              ? { ...item, approve, active: approve, status: nextStatus }
              : item,
          )
          .filter((item) => getDriverStatus(item) !== 'approved'),
      );
    } catch (error) {
      alert(error?.response?.data?.message || error?.message || 'Failed to update driver approval status');
    } finally {
      setActionDriverId('');
    }
  };

  const totalEntries = drivers.length;
  const totalPages = Math.max(1, Math.ceil(totalEntries / itemsPerPage));
  const safePage = Math.min(page, totalPages);
  const pagedDrivers = useMemo(() => {
    const start = (safePage - 1) * itemsPerPage;
    return drivers.slice(start, start + itemsPerPage);
  }, [drivers, itemsPerPage, safePage]);
  const showingFrom = totalEntries === 0 ? 0 : (safePage - 1) * itemsPerPage + 1;
  const showingTo = totalEntries === 0 ? 0 : Math.min(showingFrom + pagedDrivers.length - 1, totalEntries);

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-950">
      <div className="px-5 pt-3">
        <AdminPageHeader module="Fleet Management" page="Blocked Fleet Drivers" title="Blocked Fleet Drivers" />
      </div>

      <div className="px-5 pb-6">
        <div className="relative rounded border border-gray-200 bg-white shadow-sm">
          <div className="flex flex-col gap-5 px-5 py-8 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <button className="flex h-11 w-14 items-center justify-center rounded bg-teal-500 text-white transition-colors hover:bg-teal-600">
                <List size={17} />
              </button>
              <button className="flex h-11 w-14 items-center justify-center rounded bg-gray-200 text-indigo-950 transition-colors hover:bg-gray-300">
                <LayoutGrid size={16} />
              </button>

              <div className="ml-5 flex items-center gap-3 text-sm font-semibold text-slate-400">
                <span>show</span>
                <div className="relative">
                  <select
                    value={itemsPerPage}
                    onChange={(event) => setItemsPerPage(Number(event.target.value) || 10)}
                    className="h-9 w-24 appearance-none rounded border border-gray-300 bg-white px-3 text-sm text-gray-950 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  >
                    {[10, 25, 50, 100].map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={16}
                    className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-700"
                  />
                </div>
                <span>entries</span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                className="flex h-12 w-12 items-center justify-center rounded-full border border-gray-300 bg-white text-slate-500 transition-colors hover:border-indigo-500 hover:text-indigo-600"
              >
                <Search size={17} />
              </button>
              <button className="flex h-12 items-center gap-2 rounded bg-[#F26A4C] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#E85F44]">
                <Filter size={15} /> Filters
              </button>
              <button
                type="button"
                onClick={() => navigate('/taxi/admin/fleet/drivers/create')}
                className="flex h-12 items-center gap-3 rounded bg-indigo-950 px-6 text-sm font-semibold text-white transition-colors hover:bg-indigo-900"
              >
                <Plus size={16} /> Add Fleet Drivers
              </button>
            </div>
          </div>

          <div className="px-5">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-4 text-sm font-bold text-gray-950">Name</th>
                    <th className="px-3 py-4 text-sm font-bold text-gray-950">Service Locations</th>
                    <th className="px-3 py-4 text-sm font-bold text-gray-950">Email</th>
                    <th className="px-3 py-4 text-sm font-bold text-gray-950">Mobile Number</th>
                    <th className="px-3 py-4 text-sm font-bold text-gray-950">Transport Type</th>
                    <th className="px-3 py-4 text-sm font-bold text-gray-950">Document View</th>
                    <th className="px-3 py-4 text-sm font-bold text-gray-950">Status</th>
                    <th className="px-3 py-4 text-sm font-bold text-gray-950">Declined Reason</th>
                    <th className="px-3 py-4 text-sm font-bold text-gray-950">Rating</th>
                    <th className="px-3 py-4 text-sm font-bold text-gray-950">Approval</th>
                    <th className="px-3 py-4 text-sm font-bold text-gray-950">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {isLoading ? (
                    <tr>
                      <td colSpan="11" className="px-3 py-24 text-center">
                        <div className="flex flex-col items-center gap-4 text-slate-400">
                          <Loader2 size={34} className="animate-spin text-teal-500" />
                          <p className="text-sm font-semibold">Loading blocked fleet drivers...</p>
                        </div>
                      </td>
                    </tr>
                  ) : pagedDrivers.length === 0 ? (
                    <tr>
                      <td colSpan="11" className="border-b border-gray-200 px-3 py-12 text-center">
                        <div className="flex min-h-[130px] flex-col items-center justify-center text-slate-700">
                          <FileSearch size={92} strokeWidth={1.7} className="mb-2 text-indigo-950" />
                          <p className="text-xl font-medium">No Data Found</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    pagedDrivers.map((driver) => {
                      const driverId = getDriverId(driver);
                      const status = getDriverStatus(driver);
                      const isSaving = actionDriverId === driverId;

                      return (
                        <tr key={driverId} className="bg-white transition-colors hover:bg-gray-50">
                          <td className="px-3 py-5 text-sm text-gray-950">{getDriverName(driver)}</td>
                          <td className="px-3 py-5 text-sm text-gray-950">{getServiceLocation(driver)}</td>
                          <td className="px-3 py-5 text-sm text-gray-950">{getEmail(driver)}</td>
                          <td className="px-3 py-5 text-sm text-gray-950">{getMobile(driver)}</td>
                          <td className="px-3 py-5 text-sm capitalize text-gray-950">{getTransportType(driver)}</td>
                          <td className="px-3 py-5">
                            <button
                              type="button"
                              onClick={() => navigate(`/taxi/admin/drivers/${driverId}?tab=Documents`)}
                              className="text-indigo-950 transition-colors hover:text-indigo-700"
                              title="View documents"
                            >
                              <FileText size={28} fill="currentColor" strokeWidth={1.5} />
                            </button>
                          </td>
                          <td className="px-3 py-5">
                            <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getStatusClasses(status)}`}>
                              {toStatusLabel(status)}
                            </span>
                          </td>
                          <td className="px-3 py-5 text-sm text-gray-950">{getDeclinedReason(driver)}</td>
                          <td className="px-3 py-5">
                            <span className="inline-flex items-center gap-1 text-sm font-semibold text-amber-500">
                              <Star size={15} fill="currentColor" />
                              {Number(driver.rating || 0).toFixed(1)}
                            </span>
                          </td>
                          <td className="px-3 py-5">
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleApproval(driver, true)}
                                disabled={isSaving}
                                className="inline-flex items-center gap-1 rounded bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {isSaving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => handleApproval(driver, false)}
                                disabled={isSaving}
                                className="inline-flex items-center gap-1 rounded bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <XCircle size={14} />
                                Inactive
                              </button>
                            </div>
                          </td>
                          <td className="px-3 py-5">
                            <button
                              type="button"
                              onClick={() => navigate(`/taxi/admin/drivers/${driverId}`)}
                              className="inline-flex h-9 w-10 items-center justify-center rounded bg-teal-50 text-teal-500 transition-colors hover:bg-teal-100"
                              title="View driver"
                            >
                              <Eye size={17} />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <button
            type="button"
            className="absolute -right-1 top-[66%] flex h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full bg-teal-500 text-white shadow-xl transition-colors hover:bg-teal-600"
          >
            <Menu size={24} />
          </button>
        </div>

        <div className="mt-8 flex items-center justify-between">
          <p className="text-sm font-medium text-slate-400">
            Showing {showingFrom} to {showingTo} of {totalEntries} entries
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={safePage <= 1}
              className="rounded border border-gray-200 bg-white px-4 py-2 text-sm text-slate-500 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Prev
            </button>
            <button type="button" className="rounded bg-indigo-950 px-4 py-2 text-sm font-semibold text-white">
              {safePage}
            </button>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={safePage >= totalPages}
              className="rounded border border-gray-200 bg-white px-4 py-2 text-sm text-slate-500 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BlockedFleetDrivers;
