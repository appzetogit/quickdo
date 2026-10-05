import React, { forwardRef } from 'react';
import { GoogleMap, MarkerF, PolylineF } from '@react-google-maps/api';

export const InvoiceTemplate = forwardRef(({ details, ride, appName, appLogo, mapImageUrl }, ref) => {
  if (!details || !ride) return null;

  return (
    <>
      <style>{`
        .invoice-pdf-container *,
        .invoice-pdf-container *::before,
        .invoice-pdf-container *::after {
          border-color: #e5e7eb !important;
          outline-color: transparent !important;
          box-shadow: none !important;
          text-decoration-color: transparent !important;
          caret-color: transparent !important;
          column-rule-color: transparent !important;
        }
      `}</style>
      <div
        ref={ref}
        className="w-[794px] min-h-[1123px] absolute top-[-9999px] left-[-9999px] font-sans invoice-pdf-container"
        style={{ boxSizing: 'border-box', backgroundColor: '#ffffff', color: '#111827' }}
      >
      {/* PAGE 1: Payment Summary */}
      <div className="w-full h-[1123px] flex flex-col p-12 box-border relative page-break-after" style={{ backgroundColor: '#ffffff' }}>
        <div className="flex justify-between items-start mb-10">
          <h1 className="text-[28px] font-bold tracking-tight" style={{ color: '#000000' }}>Payment Summary</h1>
          <div className="flex flex-col items-end">
            <img src={appLogo} alt={appName} className="h-8 object-contain" crossOrigin="anonymous" />
          </div>
        </div>

        <div className="flex justify-between mb-8">
          <div className="space-y-2">
            <div className="text-lg" style={{ color: '#6b7280' }}>Ride ID</div>
            <div className="text-lg" style={{ color: '#6b7280' }}>Time of Ride</div>
          </div>
          <div className="text-right space-y-2">
            <div className="text-lg" style={{ color: '#000000' }}>{details.rideCode}</div>
            <div className="text-lg" style={{ color: '#000000' }}>{details.timeSource ? new Date(details.timeSource).toLocaleString('en-IN', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true }) : '--'}</div>
          </div>
        </div>

        <div className="w-full text-center mb-8 pb-4">
          <div className="text-xl mb-1" style={{ color: '#1f2937' }}>Total</div>
          <div className="text-[42px] font-medium tracking-tight" style={{ color: '#000000' }}>₹ {details.fare.toFixed(2)}</div>
        </div>

        <div className="flex mb-8 bg-[#f9fafb] rounded-xl overflow-hidden" style={{ border: '1px solid #f3f4f6' }}>
          <div className="w-[60%] h-[180px] relative">
            <img src={mapImageUrl} className="w-full h-full object-cover" alt="Map View" crossOrigin="anonymous" />
          </div>
          <div className="w-[40%] flex flex-col justify-center items-center p-4 bg-[#ffffff]" style={{ borderLeft: '1px solid #f3f4f6' }}>
            <div className="text-center mb-6">
              <div className="text-xl font-bold" style={{ color: '#111827' }}>{details.distance}</div>
              <div className="text-[11px] uppercase tracking-widest mt-1" style={{ color: '#6b7280' }}>Distance</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-bold" style={{ color: '#111827' }}>{details.duration}</div>
              <div className="text-[11px] uppercase tracking-widest mt-1" style={{ color: '#6b7280' }}>Duration</div>
            </div>
          </div>
        </div>

        <div className="mb-10 pl-2 space-y-6 relative" style={{ borderLeft: '3px solid #f3f4f6' }}>
          <div className="relative pl-6">
            <div className="absolute left-[-11px] top-1 w-[18px] h-[18px] rounded-full" style={{ backgroundColor: '#22c55e', border: '4px solid #ffffff' }}></div>
            <p className="text-[15px]" style={{ color: '#1f2937' }}>{details.pickup}</p>
          </div>
          <div className="relative pl-6">
            <div className="absolute left-[-11px] top-1 w-[18px] h-[18px] rounded-full" style={{ backgroundColor: '#ef4444', border: '4px solid #ffffff' }}></div>
            <p className="text-[15px]" style={{ color: '#1f2937' }}>{details.drop}</p>
          </div>
        </div>

        <div className="p-6 rounded-xl" style={{ backgroundColor: '#f9fafb', border: '1px solid #f3f4f6' }}>
          <h2 className="text-xl font-bold mb-6" style={{ color: '#000000' }}>Bill Details</h2>
          <div className="space-y-4">
            <div className="flex justify-between text-base">
              <span style={{ color: '#4b5563' }}>Ride Charge</span>
              <span style={{ color: '#000000' }}>₹ {details.baseFare.toFixed(2)}</span>
            </div>
            {details.waitingChargeAmount > 0 && (
              <div className="flex justify-between text-base">
                <span style={{ color: '#4b5563' }}>Wait time charge</span>
                <span style={{ color: '#000000' }}>₹ {details.waitingChargeAmount.toFixed(2)}</span>
              </div>
            )}
            {details.timeChargeAmount > 0 && (
              <div className="flex justify-between text-base">
                <span style={{ color: '#4b5563' }}>Ride time charge</span>
                <span style={{ color: '#000000' }}>₹ {details.timeChargeAmount.toFixed(2)}</span>
              </div>
            )}
            {details.distanceChargeAmount > 0 && (
              <div className="flex justify-between text-base">
                <span style={{ color: '#4b5563' }}>Extra distance charge</span>
                <span style={{ color: '#000000' }}>₹ {details.distanceChargeAmount.toFixed(2)}</span>
              </div>
            )}
            {details.additionalCharge > 0 && (
              <div className="flex justify-between text-base">
                <span style={{ color: '#4b5563' }}>Additional charge</span>
                <span style={{ color: '#000000' }}>₹ {details.additionalCharge.toFixed(2)}</span>
              </div>
            )}
            {details.adminExtraChargeAmount > 0 && (
              <div className="flex justify-between text-base">
                <span style={{ color: '#4b5563' }}>Booking Fees & Convenience Charges</span>
                <span style={{ color: '#000000' }}>₹ {details.adminExtraChargeAmount.toFixed(2)}</span>
              </div>
            )}
            {details.promoDiscountAmount > 0 && (
              <div className="flex justify-between text-base">
                <span style={{ color: '#16a34a' }}>Discount</span>
                <span style={{ color: '#16a34a' }}>-₹ {details.promoDiscountAmount.toFixed(2)}</span>
              </div>
            )}
            <div className="pt-4 mt-2 flex justify-between items-end" style={{ borderTop: '1px solid #e5e7eb' }}>
              <div>
                <div className="text-xl font-bold" style={{ color: '#000000' }}>Total Amount</div>
                <div className="text-[11px] mt-1" style={{ color: '#9ca3af' }}>(Inclusive of Taxes)</div>
              </div>
              <div className="text-2xl font-medium" style={{ color: '#000000' }}>₹ {details.fare.toFixed(2)}</div>
            </div>
          </div>
        </div>

        <div className="mt-8 p-6 rounded-xl" style={{ backgroundColor: '#f9fafb', border: '1px solid #f3f4f6' }}>
          <h2 className="text-xl font-bold mb-4" style={{ color: '#000000' }}>You Paid Using</h2>
          <div className="flex justify-between text-base">
            <span style={{ color: '#000000' }}>{details.paymentMethod}</span>
            <span style={{ color: '#000000' }}>₹ {details.fare.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* PAGE 2: Tax Invoice */}
      <div className="w-full h-[1123px] flex flex-col p-12 box-border relative page-break-after" style={{ backgroundColor: '#ffffff' }}>
        <div className="flex justify-between items-start mb-10">
          <div>
            <h1 className="text-[28px] font-bold tracking-tight mb-2" style={{ color: '#000000' }}>Tax Invoice</h1>
            <div style={{ color: '#6b7280' }}>{details.rideCode}</div>
          </div>
          <img src={appLogo} alt={appName} className="h-8 object-contain" crossOrigin="anonymous" />
        </div>

        <div className="flex justify-between mb-8 pb-8" style={{ borderBottom: '1px solid #f3f4f6' }}>
          <div className="space-y-4">
            <div style={{ color: '#4b5563' }}>Invoice No.</div>
            <div style={{ color: '#4b5563' }}>Invoice Date</div>
            <div style={{ color: '#4b5563' }}>State</div>
            <div style={{ color: '#4b5563' }}>Tax Category</div>
            <div className="mt-6 pt-6" style={{ color: '#4b5563', borderTop: '1px solid #f9fafb' }}>Place of Supply</div>
            <div style={{ color: '#4b5563' }}>GST Number</div>
            <div style={{ color: '#4b5563' }}>Vehicle Number</div>
            <div style={{ color: '#4b5563' }}>Captain Name</div>
          </div>
          <div className="text-right space-y-4 font-medium" style={{ color: '#111827' }}>
            <div>INV-{details.shortRideCode}</div>
            <div>{details.timeSource ? new Date(details.timeSource).toLocaleString('en-IN', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true }) : '--'}</div>
            <div>Local</div>
            <div className="max-w-[300px]">Other local transportation services of passengers n.e.c. (996419)</div>
            <div className="mt-6 pt-6" style={{ borderTop: '1px solid #f9fafb' }}>Local</div>
            <div>N/A</div>
            <div>{details.plate}</div>
            <div>{details.driverName}</div>
          </div>
        </div>

        <div className="mb-10 pb-8" style={{ borderBottom: '1px solid #f3f4f6' }}>
          <div className="flex justify-between">
            <div style={{ color: '#4b5563' }}>Customer Name</div>
            <div className="font-medium" style={{ color: '#111827' }}>{ride?.user?.name || 'Customer'}</div>
          </div>
          <div className="mt-4">
            <div className="mb-1" style={{ color: '#4b5563' }}>Customer Pick Up Address</div>
            <div className="text-sm max-w-[400px] leading-relaxed" style={{ color: '#9ca3af' }}>{details.pickup}</div>
          </div>
        </div>

        <h2 className="text-xl font-bold mb-6" style={{ color: '#000000' }}>Bill Details</h2>
        <div className="space-y-4 mb-10 pb-6" style={{ borderBottom: '1px solid #e5e7eb' }}>
          <div className="flex justify-between text-base">
            <span style={{ color: '#4b5563' }}>Ride Fare (Base + Distance + Time)</span>
            <span style={{ color: '#000000' }}>₹ {(details.baseFare + details.distanceChargeAmount + details.timeChargeAmount).toFixed(2)}</span>
          </div>
          {details.waitingChargeAmount > 0 && (
            <div className="flex justify-between text-base">
              <span style={{ color: '#4b5563' }}>Wait Time Charge</span>
              <span style={{ color: '#000000' }}>₹ {details.waitingChargeAmount.toFixed(2)}</span>
            </div>
          )}
          {details.additionalCharge > 0 && (
            <div className="flex justify-between text-base">
              <span style={{ color: '#4b5563' }}>Additional Charge</span>
              <span style={{ color: '#000000' }}>₹ {details.additionalCharge.toFixed(2)}</span>
            </div>
          )}
          {details.promoDiscountAmount > 0 && (
            <div className="flex justify-between text-base">
              <span style={{ color: '#16a34a' }}>Discount Applied</span>
              <span style={{ color: '#16a34a' }}>-₹ {details.promoDiscountAmount.toFixed(2)}</span>
            </div>
          )}
        </div>

        <div className="flex justify-between items-end mb-16">
          <div>
            <div className="text-2xl font-bold" style={{ color: '#000000' }}>Ride Charge</div>
          </div>
          <div className="text-[28px] font-medium" style={{ color: '#000000' }}>₹ {(details.baseFare + details.distanceChargeAmount + details.timeChargeAmount + details.waitingChargeAmount + details.additionalCharge - details.promoDiscountAmount).toFixed(2)}</div>
        </div>

        <div className="mt-auto pt-6 text-center text-xs leading-relaxed max-w-[600px] mx-auto" style={{ borderTop: '1px solid #f3f4f6', color: '#9ca3af' }}>
          This document is issued by Transport Service Provider and not by {appName}. {appName} acts only as an Electronic Commerce Operator for the transportation services.
        </div>
      </div>

      {/* PAGE 3: Tax Invoice (App) */}
      {details.adminExtraChargeAmount > 0 && (
        <div className="w-full h-[1123px] flex flex-col p-12 box-border relative" style={{ backgroundColor: '#ffffff' }}>
          <div className="flex justify-between items-start mb-8">
            <div>
              <h1 className="text-[28px] font-bold tracking-tight mb-2" style={{ color: '#000000' }}>Tax Invoice</h1>
              <div style={{ color: '#6b7280' }}>{details.rideCode}</div>
            </div>
            <img src={appLogo} alt={appName} className="h-8 object-contain" crossOrigin="anonymous" />
          </div>

          <div className="flex justify-between items-start mb-6 pb-6" style={{ borderBottom: '1px solid #f3f4f6' }}>
          <div>
            <h3 className="text-lg font-bold mb-2" style={{ color: '#000000' }}>{appName} Technologies</h3>
            <div className="text-sm max-w-[250px] leading-relaxed" style={{ color: '#6b7280' }}>
              Registered Office Address
            </div>
            
            <h3 className="text-lg font-bold mt-6 mb-2" style={{ color: '#000000' }}>{ride?.user?.name || 'Customer'}</h3>
            <div className="text-sm max-w-[250px] leading-relaxed" style={{ color: '#6b7280' }}>
              {details.pickup}
            </div>
          </div>
          <div>
            <img src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=INV-${details.shortRideCode}`} alt="QR Code" width="120" height="120" crossOrigin="anonymous" />
          </div>
        </div>

        <div className="flex justify-between mb-6 pb-6" style={{ borderBottom: '1px solid #f3f4f6' }}>
          <div className="space-y-4">
            <div style={{ color: '#4b5563' }}>Invoice No.</div>
            <div style={{ color: '#4b5563' }}>Invoice Date</div>
            <div style={{ color: '#4b5563' }}>Tax Category</div>
            <div style={{ color: '#4b5563' }}>Place of Supply</div>
            <div style={{ color: '#4b5563' }}>GST</div>
          </div>
          <div className="text-right space-y-4 font-medium" style={{ color: '#111827' }}>
            <div>APP-{details.shortRideCode}</div>
            <div>{details.timeSource ? new Date(details.timeSource).toLocaleString('en-IN', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true }) : '--'}</div>
            <div>Other services n.e.c. (999799)</div>
            <div>Local</div>
            <div>N/A</div>
          </div>
        </div>

        <h2 className="text-xl font-bold mb-6" style={{ color: '#000000' }}>Bill Details</h2>
        <div className="space-y-4 mb-6 pb-6" style={{ borderBottom: '1px solid #e5e7eb' }}>
          <div className="flex justify-between text-base">
            <span style={{ color: '#4b5563' }}>Booking Fee</span>
            <span style={{ color: '#000000' }}>₹ {(details.adminExtraChargeAmount * 0.1).toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-base">
            <span style={{ color: '#4b5563' }}>Convenience Charges</span>
            <span style={{ color: '#000000' }}>₹ {(details.adminExtraChargeAmount * 0.9).toFixed(2)}</span>
          </div>
          {details.promoDiscountAmount > 0 && (
            <div className="flex justify-between text-base">
              <span style={{ color: '#4b5563' }}>Discount</span>
              <span style={{ color: '#16a34a' }}>-₹ {details.promoDiscountAmount.toFixed(2)}</span>
            </div>
          )}
        </div>

        <div className="flex justify-between items-center font-bold text-lg mb-6 pb-6" style={{ borderBottom: '1px solid #f3f4f6', color: '#000000' }}>
           <span>Sub Total</span>
           <span>₹ {Math.max(details.adminExtraChargeAmount - details.promoDiscountAmount, 0).toFixed(2)}</span>
        </div>

        <div className="space-y-4 mb-6 pb-6" style={{ borderBottom: '1px solid #e5e7eb' }}>
          <div className="flex justify-between text-base">
            <span style={{ color: '#4b5563' }}>CGST (9%)</span>
            <span style={{ color: '#000000' }}>₹ {(Math.max(details.adminExtraChargeAmount - details.promoDiscountAmount, 0) * 0.09).toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-base">
            <span style={{ color: '#4b5563' }}>SGST (9%)</span>
            <span style={{ color: '#000000' }}>₹ {(Math.max(details.adminExtraChargeAmount - details.promoDiscountAmount, 0) * 0.09).toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-base">
            <span style={{ color: '#4b5563' }}>IGST (0%)</span>
            <span style={{ color: '#000000' }}>₹ 0.00</span>
          </div>
        </div>

        <div className="flex justify-between items-end mb-16">
          <div>
            <div className="text-2xl font-bold" style={{ color: '#000000' }}>Final Amount</div>
            <div className="text-[11px] mt-1" style={{ color: '#9ca3af' }}>(Inclusive of Taxes)</div>
          </div>
          <div className="text-[28px] font-medium" style={{ color: '#000000' }}>₹ {(Math.max(details.adminExtraChargeAmount - details.promoDiscountAmount, 0) * 1.18).toFixed(2)}</div>
        </div>

        <div className="mt-auto pt-6 text-center space-y-2" style={{ borderTop: '1px solid #f3f4f6' }}>
          <div className="text-xs leading-relaxed" style={{ color: '#9ca3af' }}>
            This is a system generated invoice and hence no signature required
          </div>
          <div className="text-sm font-medium" style={{ color: '#111827' }}>
            Thank you {ride?.user?.name || 'Customer'}
          </div>
        </div>
      </div>
      )}
    </div>
    </>
  );
});

InvoiceTemplate.displayName = 'InvoiceTemplate';
