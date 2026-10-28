import React from 'react';

const ActivityTabs = ({ tabs, activeTab, onChange }) => {
  return (
    <div className="border-b border-slate-200 bg-white px-5 py-3">
      <div className="inline-flex max-w-full gap-2 overflow-x-auto no-scrollbar rounded-full border border-slate-200 bg-slate-50 p-1">
        {tabs.map((tab, index) => (
          <button
            key={`${String(tab || '').trim() || 'tab'}-${index}`}
            type="button"
            onClick={() => onChange(tab)}
            className={`shrink-0 rounded-full px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors active:scale-[0.99] ${
              activeTab === tab
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>
    </div>
  );
};

export default ActivityTabs;
