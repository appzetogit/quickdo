import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { GoogleMap, MarkerF } from '@react-google-maps/api';
import { HAS_VALID_GOOGLE_MAPS_KEY, useAppGoogleMapsLoader } from '../admin/utils/googleMaps';
import { API_BASE_URL } from '../../shared/api/runtimeConfig';

/**
 * /track-trip/:token -- the page behind a shared trip link (SOW plan §4.8).
 *
 * No sign-in. Reads GET /public/trip/:token every 10 seconds, which gives only
 * the live status and position, the driver's first name and the vehicle
 * number. SafetyToolkit.jsx and the SOS text messages link here.
 */
const POLL_MS = 10000;
const mapStyle = { width: '100%', height: '100%' };

const TrackTrip = () => {
  const { token } = useParams();
  const [trip, setTrip] = useState(null);
  const [error, setError] = useState('');
  const { isLoaded } = useAppGoogleMapsLoader();

  useEffect(() => {
    let active = true;
    let timer = null;

    const load = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/public/trip/${encodeURIComponent(token || '')}`, {
          headers: { Accept: 'application/json' },
        });
        const body = await response.json().catch(() => ({}));
        if (!active) return;
        if (!response.ok) {
          setError(body?.message || (response.status === 410 ? 'This tracking link has expired.' : 'Tracking link not found.'));
          setTrip(null);
          return;
        }
        setError('');
        setTrip(body?.data || null);
        // Keep following only while the trip is live.
        if (body?.data?.isLive) timer = setTimeout(load, POLL_MS);
      } catch {
        if (!active) return;
        setError('Could not load the trip. Retrying...');
        timer = setTimeout(load, POLL_MS);
      }
    };

    load();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [token]);

  const position = trip?.location ? { lat: Number(trip.location.lat), lng: Number(trip.location.lng) } : null;
  const updatedAt = trip?.location?.updatedAt ? new Date(trip.location.updatedAt) : null;

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-lg flex-col bg-slate-50 font-sans">
      <header className="bg-white px-4 py-4 shadow-sm">
        <h1 className="text-[18px] font-black text-slate-900">Live trip</h1>
        <p className="text-[12px] text-slate-500">Shared with you to follow this ride.</p>
      </header>

      {error ? (
        <div className="m-4 rounded-2xl border border-rose-100 bg-white p-6 text-center">
          <p className="text-[15px] font-semibold text-slate-800">{error}</p>
        </div>
      ) : !trip ? (
        <div className="m-4 rounded-2xl bg-white p-6 text-center text-[14px] text-slate-500">Loading...</div>
      ) : (
        <>
          <div className="relative h-[55dvh] bg-slate-200">
            {position && HAS_VALID_GOOGLE_MAPS_KEY && isLoaded ? (
              <GoogleMap mapContainerStyle={mapStyle} center={position} zoom={15} options={{ disableDefaultUI: true, zoomControl: true }}>
                <MarkerF position={position} />
              </GoogleMap>
            ) : (
              <div className="flex h-full items-center justify-center px-6 text-center text-[13px] text-slate-500">
                {position ? 'Map unavailable. Use the link below.' : 'The location is shown while the trip is in progress.'}
              </div>
            )}
          </div>

          <section className="m-4 space-y-3 rounded-2xl bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-[15px] font-bold text-slate-900">{trip.statusLabel || trip.status}</span>
              {trip.isLive && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">Live</span>}
            </div>
            {trip.driver && (
              <p className="text-[13px] text-slate-600">
                Driver <span className="font-semibold text-slate-900">{trip.driver.firstName || '-'}</span>
                {trip.driver.vehicleNumber ? <> · <span className="font-semibold text-slate-900">{trip.driver.vehicleNumber}</span></> : null}
                {trip.driver.vehicle ? <> · {trip.driver.vehicle}</> : null}
              </p>
            )}
            {trip.stopsTotal > 0 && (
              <p className="text-[13px] text-slate-600">Stops reached: {trip.stopsReached} of {trip.stopsTotal}</p>
            )}
            {updatedAt && (
              <p className="text-[11px] text-slate-400">Position updated {updatedAt.toLocaleTimeString()}</p>
            )}
            {position && (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${position.lat},${position.lng}`}
                target="_blank"
                rel="noreferrer"
                className="block rounded-xl bg-slate-900 py-3 text-center text-[13px] font-semibold text-white"
              >
                Open in Google Maps
              </a>
            )}
          </section>
        </>
      )}
    </div>
  );
};

export default TrackTrip;
