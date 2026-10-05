import React from 'react';
import { ChevronDown, Filter, LoaderCircle, MoreVertical, Search } from 'lucide-react';
import { adminService } from '../../services/adminService';

const TABS = ['All', 'Completed', 'Cancelled', 'Upcoming', 'On Trip'];

const STATUS_STYLES = {
  COMPLETED: 'bg-[#17b8a6] text-white',
  CANCELLED: 'bg-[#f26a4b] text-white',
  UPCOMING: 'bg-[#f6b44f] text-white',
  ON_TRIP: 'bg-[#4e8df6] text-white',
};

const PAYMENT_STYLES = {
  CASH: 'bg-[#17b8a6] text-white',
  ONLINE: 'bg-[#4f46e5] text-white',
};

const unwrapResults = (response) => {
  const payload = response?.data || response || {};
  return {
    results: payload?.results || [],
    paginator: payload?.paginator || {},
  };
};

const Deliveries = () => {
  const [activeTab, setActiveTab] = React.useState('All');
  const [pageSize, setPageSize] = React.useState('10');
  const [search, setSearch] = React.useState('');
  const [rows, setRows] = React.useState([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    let active = true;

    const loadDeliveries = async () => {
      setIsLoading(true);
      setError('');

      try {
        const response = await adminService.getDeliveries({
          page: 1,
          limit: Number(pageSize) || 10,
          tab: activeTab.toLowerCase(),
          search,
        });
        const data = unwrapResults(response);

        if (!active) {
          return;
        }

        setRows(data.results);
      } catch (loadError) {
        if (active) {
          setRows([]);
          setError(loadError?.message || 'Could not load deliveries.');
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    loadDeliveries();

    return () => {
      active = false;
    };
  }, [activeTab, pageSize, search]);

  return (
    <div className="min-h-screen bg-gray-50 font-['Inter',system-ui,sans-serif]">
      <div className="overflow-hidden rounded-[22px] border border-gray-200 bg-white shadow-[0_10px_32px_rgba(17,24,39,0.05)]">
        <div className="border-b border-gray-200 px-5 py-5 lg:px-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center gap-3 text-sm text-gray-500">
              <span className="font-medium">show</span>
              <div className="relative">
                <select
                  value={pageSize}
                  onChange={(event) => setPageSize(event.target.value)}
                  className="h-11 appearance-none rounded-md border border-gray-300 bg-white pl-4 pr-10 text-sm font-medium text-gray-700 outline-none transition focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="10">10</option>
                  <option value="25">25</option>
                  <option value="50">50</option>
                </select>
                <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-500" />
              </div>
              <span className="font-medium">entries</span>
            </div>

            <div className="flex flex-wrap items-center gap-5 xl:flex-nowrap">
              <div className="flex flex-wrap items-center gap-8 border-b border-gray-200 xl:min-w-[840px]">
                {TABS.map((tab) => {
                  const isActive = activeTab === tab;
                  return (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setActiveTab(tab)}
                      className={`relative pb-5 text-[14px] font-semibold tracking-tight transition ${
                        isActive ? 'text-[#4054b2]' : 'text-gray-900 hover:text-[#4054b2]'
                      }`}
                    >
                      {tab}
                      {isActive && <span className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-[#4054b2]" />}
                    </button>
                  );
                })}
              </div>

              <div className="ml-auto flex items-center gap-3">
                <div className="relative">
                  <Search size={18} strokeWidth={2.1} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search deliveries"
                    className="h-12 rounded-full border border-gray-300 bg-white pl-11 pr-4 text-sm font-medium text-gray-700 outline-none transition focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-md bg-[#f26a4b] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#eb5e3d]"
                >
                  <Filter size={16} strokeWidth={2.2} />
                  Filters
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto px-5 py-5 lg:px-6">
          <table className="min-w-full border-separate border-spacing-0">
            <thead>
              <tr className="bg-[#f6f6f8]">
                {['Request Id', 'Date', 'User Name', 'Driver Name', 'Transport Type', 'Trip Status', 'Payment Option', 'Action'].map((heading, index, array) => (
                  <th
                    key={heading}
                    className={`px-4 py-4 text-left text-[14px] font-semibold text-gray-900 ${
                      index === 0 ? 'rounded-l-[10px]' : ''
                    } ${index === array.length - 1 ? 'rounded-r-[10px]' : ''}`}
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={8} className="px-4 py-14 text-center">
                    <div className="inline-flex items-center gap-3 text-sm font-medium text-gray-500">
                      <LoaderCircle size={18} className="animate-spin" />
                      Loading deliveries
                    </div>
                  </td>
                </tr>
              )}

              {!isLoading && error && (
                <tr>
                  <td colSpan={8} className="px-4 py-14 text-center text-sm font-medium text-red-500">
                    {error}
                  </td>
                </tr>
              )}

              {!isLoading && !error && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-14 text-center text-sm font-medium text-gray-500">
                    No deliveries found.
                  </td>
                </tr>
              )}

              {!isLoading && !error && rows.map((row) => (
                <tr key={row.id} className="group">
                  <td className="border-b border-gray-200 px-4 py-5 text-[14px] font-medium text-gray-900">{row.requestId}</td>
                  <td className="border-b border-gray-200 px-4 py-5 text-[14px] font-medium text-gray-900">{row.date || '-'}</td>
                  <td className="border-b border-gray-200 px-4 py-5 text-[14px] font-medium text-gray-900">{row.userName}</td>
                  <td className="border-b border-gray-200 px-4 py-5 text-[14px] font-medium text-gray-900">{row.driverName}</td>
                  <td className="border-b border-gray-200 px-4 py-5 text-[14px] font-medium text-gray-900">{row.transportType}</td>
                  <td className="border-b border-gray-200 px-4 py-5">
                    <span className={`inline-flex rounded-md px-3 py-1 text-[11px] font-bold uppercase leading-none ${STATUS_STYLES[row.tripStatus] || 'bg-gray-200 text-gray-700'}`}>
                      {String(row.tripStatus || '').replace('_', ' ')}
                    </span>
                  </td>
                  <td className="border-b border-gray-200 px-4 py-5">
                    <span className={`inline-flex rounded-md px-3 py-1 text-[11px] font-bold uppercase leading-none ${PAYMENT_STYLES[row.paymentOption] || 'bg-gray-200 text-gray-700'}`}>
                      {row.paymentOption}
                    </span>
                  </td>
                  <td className="border-b border-gray-200 px-4 py-5">
                    <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-full text-gray-400 transition hover:bg-gray-100 hover:text-gray-700">
                      <MoreVertical size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Deliveries;
