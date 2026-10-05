import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
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
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import AdminPageHeader from '../../components/ui/AdminPageHeader';

const BASE = `${globalThis.__LEGACY_BACKEND_ORIGIN__}/api/v1/taxi/admin`;

const isApproved = (driver) => driver?.approve === true || driver?.approve === 1 || driver?.status === 'approved';

const getDriverName = (driver) => driver?.name || driver?.user_id?.name || driver?.full_name || '-';

const getServiceLocation = (driver) =>
  driver?.service_location_id?.service_location_name ||
  driver?.service_location_id?.name ||
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
  const mobile = driver?.mobile || driver?.user_id?.mobile || '';
  if (!mobile) return '-';
  return String(mobile).startsWith('+') ? mobile : `+91${mobile}`;
};

const getEmail = (driver) => driver?.email || driver?.user_id?.email || '-';

const FleetDrivers = () => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [drivers, setDrivers] = useState([]);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);

      try {
        const token = (localStorage.getItem('admin_accessToken') || localStorage.getItem('adminToken')) || '';
        const response = await fetch(`${BASE}/drivers?page=1&limit=100`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const json = await response.json();

        if (response.ok && json.success) {
          const allDrivers = json.data?.results || [];
          const fleetDrivers = allDrivers.filter((driver) => isApproved(driver) && (driver.owner_id || driver.fleet_id));
          setDrivers(fleetDrivers);
        }
      } catch (error) {
        console.error('Failed to fetch fleet drivers:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [itemsPerPage]);

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
        <AdminPageHeader module="Fleet Management" page="Fleet Drivers" title="Fleet Drivers" />
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
              <button className="flex h-12 items-center gap-2 rounded bg-red-500 px-5 text-sm font-semibold text-white transition-colors hover:bg-red-600">
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
                    <th className="px-3 py-4 text-sm font-bold text-gray-950">Approved Status</th>
                    <th className="px-3 py-4 text-sm font-bold text-gray-950">Rating</th>
                    <th className="px-3 py-4 text-sm font-bold text-gray-950">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {isLoading ? (
                    <tr>
                      <td colSpan="9" className="px-3 py-24 text-center">
                        <div className="flex flex-col items-center gap-4 text-slate-400">
                          <Loader2 size={34} className="animate-spin text-teal-500" />
                          <p className="text-sm font-semibold">Loading approved drivers...</p>
                        </div>
                      </td>
                    </tr>
                  ) : pagedDrivers.length === 0 ? (
                    <tr>
                      <td colSpan="9" className="border-b border-gray-200 px-3 py-12 text-center">
                        <div className="flex min-h-[130px] flex-col items-center justify-center text-slate-700">
                          <FileSearch size={92} strokeWidth={1.7} className="mb-2 text-indigo-950" />
                          <p className="text-xl font-medium">No Data Found</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    pagedDrivers.map((driver) => (
                      <tr key={driver._id} className="bg-white transition-colors hover:bg-gray-50">
                        <td className="px-3 py-5 text-sm text-gray-950">{getDriverName(driver)}</td>
                        <td className="px-3 py-5 text-sm text-gray-950">{getServiceLocation(driver)}</td>
                        <td className="px-3 py-5 text-sm text-gray-950">{getEmail(driver)}</td>
                        <td className="px-3 py-5 text-sm text-gray-950">{getMobile(driver)}</td>
                        <td className="px-3 py-5 text-sm capitalize text-gray-950">{getTransportType(driver)}</td>
                        <td className="px-3 py-5">
                          <button className="text-indigo-950 transition-colors hover:text-indigo-700">
                            <FileText size={28} fill="currentColor" strokeWidth={1.5} />
                          </button>
                        </td>
                        <td className="px-3 py-5">
                          <span className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                            Approved
                          </span>
                        </td>
                        <td className="px-3 py-5">
                          <span className="inline-flex items-center gap-1 text-sm font-semibold text-amber-500">
                            <Star size={15} fill="currentColor" />
                            {Number(driver.rating || 0).toFixed(1)}
                          </span>
                        </td>
                        <td className="px-3 py-5">
                          <button
                            type="button"
                            onClick={() => navigate(`/taxi/admin/drivers/${driver._id}`)}
                            className="inline-flex h-9 w-10 items-center justify-center rounded bg-teal-50 text-teal-500 transition-colors hover:bg-teal-100"
                            title="View driver"
                          >
                            <Eye size={17} />
                          </button>
                        </td>
                      </tr>
                    ))
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

export default FleetDrivers;

