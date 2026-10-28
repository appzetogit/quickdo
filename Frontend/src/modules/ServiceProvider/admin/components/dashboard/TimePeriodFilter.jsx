import React from 'react';
import { FiCalendar, FiDownload } from 'react-icons/fi';
import { toast } from 'react-hot-toast';

const TimePeriodFilter = ({ selectedPeriod, onPeriodChange, onExport, customDates, onCustomDateChange }) => {
  const periods = [
    { key: 'today', label: 'Today' },
    { key: 'week', label: 'This Week' },
    { key: 'month', label: 'This Month' },
    { key: 'year', label: 'This Year' },
  ];

  return (
    <div className="w-full">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Left group: calendar + segmented control */}
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">
          <button
            type="button"
            onClick={() => onPeriodChange(selectedPeriod === 'custom' ? 'month' : 'custom')}
            className={`h-10 w-10 rounded-xl border shadow-sm flex items-center justify-center transition-all ${
              selectedPeriod === 'custom'
                ? 'bg-primary-600 border-primary-600 text-white shadow-md scale-105'
                : 'bg-white border-gray-200 text-gray-700 hover:border-primary-300'
            }`}
            aria-label="Custom Range"
          >
            <FiCalendar className="w-5 h-5" />
          </button>

          <div className="flex items-center bg-gray-100/80 backdrop-blur-sm rounded-2xl p-1.5 shadow-inner">
            {periods.map((p) => {
              const active = selectedPeriod === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => onPeriodChange(p.key)}
                  className={`px-4 py-2 rounded-xl text-sm font-bold whitespace-nowrap transition-all duration-200 ${
                    active
                      ? 'bg-white text-primary-700 shadow-md transform scale-100'
                      : 'text-gray-500 hover:text-gray-700 hover:bg-white/40'
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          {selectedPeriod === 'custom' && (
            <div className="flex items-center gap-2 bg-white border border-primary-100 rounded-2xl p-1.5 px-4 shadow-sm animate-in fade-in slide-in-from-left-4 duration-500">
              <input
                type="date"
                value={customDates?.start || ''}
                max={customDates?.end || ''}
                onChange={(e) => {
                  const newStart = e.target.value;
                  if (newStart && customDates?.end && new Date(newStart) > new Date(customDates.end)) {
                    toast.error("From Date cannot be after To Date");
                    return;
                  }
                  onCustomDateChange({ ...customDates, start: newStart });
                }}
                className="border-0 bg-transparent text-sm font-semibold focus:ring-0 text-gray-700 py-1 w-36 cursor-pointer"
              />
              <span className="text-gray-400 font-bold text-xs uppercase tracking-widest">to</span>
              <input
                type="date"
                value={customDates?.end || ''}
                min={customDates?.start || ''}
                onChange={(e) => {
                  const newEnd = e.target.value;
                  if (newEnd && customDates?.start && new Date(newEnd) < new Date(customDates.start)) {
                    toast.error("To Date cannot be before From Date");
                    return;
                  }
                  onCustomDateChange({ ...customDates, end: newEnd });
                }}
                className="border-0 bg-transparent text-sm font-semibold focus:ring-0 text-gray-700 py-1 w-36 cursor-pointer"
              />
            </div>
          )}
        </div>

        {/* Right: Export */}
        {/* <button
          type="button"
          onClick={onExport}
          className="h-10 px-6 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 active:scale-[0.95] transition-all whitespace-nowrap"
        >
          <FiDownload className="w-4 h-4" />
          <span>Export CSV</span>
        </button> */}
      </div>
    </div>
  );
};

export default TimePeriodFilter;



