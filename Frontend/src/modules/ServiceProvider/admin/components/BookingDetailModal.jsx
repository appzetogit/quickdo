import React, { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import Modal from '../pages/UserCategories/components/Modal';
import { adminBookingService } from '@sp/services/adminBookingService';

/**
 * Admin booking detail (plan §3.4–3.5): summary, add-ons, preferred-provider
 * offer, quote, and the before/after work-photo gallery. The API always returns
 * workPhotos as { before, after } (old flat arrays come back as 'after').
 */
const normalizePhotos = (wp) => {
  if (Array.isArray(wp)) return { before: [], after: wp.map((url) => (typeof url === 'string' ? { url } : url)) };
  return { before: wp?.before || [], after: wp?.after || [] };
};

const PhotoGrid = ({ title, photos }) => (
  <div>
    <h4 className="text-sm font-semibold text-gray-700 mb-2">{title} <span className="text-gray-400 font-normal">({photos.length})</span></h4>
    {photos.length === 0 ? (
      <p className="text-xs text-gray-400">No photos</p>
    ) : (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {photos.map((p, i) => (
          <a key={`${p.url}-${i}`} href={p.url} target="_blank" rel="noreferrer" className="block group">
            <img src={p.url} alt={`${title} ${i + 1}`} loading="lazy"
              className="w-full h-32 object-cover rounded-lg border border-gray-200 group-hover:opacity-90" />
            <div className="text-[10px] text-gray-500 mt-1 leading-tight">
              {p.uploadedAt ? new Date(p.uploadedAt).toLocaleString() : 'time unknown'}
              {typeof p.lat === 'number' && typeof p.lng === 'number' && (
                <span> · {p.lat.toFixed(4)}, {p.lng.toFixed(4)}</span>
              )}
            </div>
          </a>
        ))}
      </div>
    )}
  </div>
);

const Row = ({ label, children }) => (
  <div className="flex justify-between gap-4 text-sm py-1">
    <span className="text-gray-500">{label}</span>
    <span className="text-gray-900 text-right">{children}</span>
  </div>
);

const BookingDetailModal = ({ bookingId, onClose }) => {
  const [booking, setBooking] = useState(null);

  useEffect(() => {
    if (!bookingId) return undefined;
    let alive = true;
    setBooking(null);
    adminBookingService.getBookingById(bookingId)
      .then((res) => { if (alive) setBooking(res.data || null); })
      .catch((err) => toast.error(err?.message || 'Failed to load booking'));
    return () => { alive = false; };
  }, [bookingId]);

  const photos = normalizePhotos(booking?.workPhotos);
  const provider = booking?.workerId?.name || booking?.vendorId?.businessName || booking?.vendorId?.name;

  return (
    <Modal isOpen={!!bookingId} onClose={onClose} title={booking ? `Booking #${booking.bookingNumber}` : 'Booking'} size="lg">
      {!booking ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <Row label="Service">{booking.serviceName} ({booking.serviceCategory})</Row>
              <Row label="Customer">{booking.userId?.name || '—'} {booking.userId?.phone ? `· ${booking.userId.phone}` : ''}</Row>
              <Row label="Provider">{provider || 'Not assigned'}</Row>
              <Row label="Status">{booking.status?.replace(/_/g, ' ')}</Row>
              <Row label="Scheduled">{booking.scheduledDate ? new Date(booking.scheduledDate).toLocaleDateString() : '—'} {booking.scheduledTime || ''}</Row>
              {booking.isConsultancyRequest && <Row label="Quote request">{booking.acceptedQuoteId ? 'Quote accepted' : 'Collecting quotes'}</Row>}
              {booking.preferredOffer?.status && (
                <Row label="Preferred provider">{booking.preferredOffer.status.replace(/_/g, ' ')}</Row>
              )}
            </div>
            <div>
              <Row label="Base price">₹{booking.basePrice ?? 0}</Row>
              {booking.addOns?.length > 0 && booking.addOns.map((a, i) => (
                <Row key={`${a.name}-${i}`} label={`Add-on: ${a.name} × ${a.quantity}`}>₹{a.total}</Row>
              ))}
              {booking.extraChargesTotal > 0 && <Row label="Extra charges">₹{booking.extraChargesTotal}</Row>}
              <Row label="Tax">₹{booking.tax ?? 0}</Row>
              <Row label="Visiting charges">₹{booking.visitingCharges ?? 0}</Row>
              <Row label="Total"><strong>₹{booking.finalAmount ?? 0}</strong></Row>
              <Row label="Payment">{booking.paymentMethod || '—'} / {booking.paymentStatus || '—'}</Row>
              {booking.invoiceNumber && <Row label="Invoice">{booking.invoiceNumber}</Row>}
            </div>
          </div>

          {booking.requirementText && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-1">Customer requirement</h4>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{booking.requirementText}</p>
            </div>
          )}

          <div className="pt-4 border-t border-gray-200 space-y-5">
            <h3 className="text-base font-bold text-gray-900">Work photos</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <PhotoGrid title="Before" photos={photos.before} />
              <PhotoGrid title="After" photos={photos.after} />
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
};

export default BookingDetailModal;
