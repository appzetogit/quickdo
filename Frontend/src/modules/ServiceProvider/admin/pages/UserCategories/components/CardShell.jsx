import React from "react";

const CardShell = ({ icon: Icon, title, subtitle, className = '', children }) => {
  const hasBg = className.includes('bg-');
  const hasBorder = className.includes('border-');
  const defaultClasses = `${hasBg ? '' : 'bg-gradient-to-br from-white to-gray-50'} ${hasBorder ? '' : 'border border-gray-200'} rounded-xl p-4 shadow-sm`;

  return (
    <div className={`${defaultClasses} ${className}`}>
      {(Icon || title) ? (
        <div className="flex items-center gap-2.5 mb-4 pb-3 border-b border-gray-200">
          {Icon ? (
            <div
              className="p-2 rounded-lg shadow-sm flex items-center justify-center shrink-0"
              style={{
                width: '32px',
                height: '32px',
                minWidth: '32px',
                minHeight: '32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'linear-gradient(to bottom right, #2874F0, #1e5fd4)',
              }}
            >
              <Icon
                className="text-white w-4 h-4"
                style={{
                  display: 'block',
                  color: '#ffffff',
                  fill: 'none',
                  stroke: 'currentColor',
                  strokeWidth: '2'
                }}
              />
            </div>
          ) : null}
          <div className="flex-1">
            <div className="text-lg font-bold text-gray-900 leading-tight">{title}</div>
            {subtitle ? <div className="text-[11px] font-medium text-gray-500 mt-0.5 uppercase tracking-wider">{subtitle}</div> : null}
          </div>
        </div>
      ) : null}
      <div className="space-y-4">{children}</div>
    </div>
  );
};

export default CardShell;

