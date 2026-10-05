import { useJsApiLoader } from '@react-google-maps/api';
import { getGoogleMapsApiKeySync } from '@food/utils/googleMapsApiKey';

/**
 * Google Maps for the taxi panels.
 *
 * The key comes from the same place the food admin panel gets it: the runtime
 * config at /api/v1/env/public, which serves what an admin saved under
 * Integration settings -> Map. Both panels write the one `map_apis` block on the
 * server, so there is a single key and a single reader.
 *
 * Why the key is read per render rather than once at import:
 *
 * This module is reachable from the entry chunk, and ES modules evaluate before
 * any of the entry file's own statements run. Reading the key at module scope
 * therefore happened before index.jsx could resolve the runtime config, so the
 * panel captured the empty build-time value and froze it. useJsApiLoader makes
 * that permanent -- it calls load() from an effect with an empty dependency
 * list, so it runs once with whatever key existed at the first render of the
 * first map component and never retries. Loading with an empty key is what
 * produced the watermarked "For development purposes only" map and Google's
 * "This page can't load Google Maps correctly" dialog.
 *
 * refresh() re-reads on every hook call and updates the exported bindings.
 * Those are `let`, so the ~20 components importing HAS_VALID_GOOGLE_MAPS_KEY see
 * the corrected value through the module's live binding: the hook runs at the
 * top of a component, before its JSX is evaluated. A component that reads the
 * flag without calling the hook would still see the import-time value, but every
 * map screen calls the hook to render at all.
 */

const isUsableKey = (value) =>
  typeof value === 'string' &&
  value.trim() !== '' &&
  value !== 'your-google-maps-browser-key';

export let GOOGLE_MAPS_API_KEY = '';
export let HAS_VALID_GOOGLE_MAPS_KEY = false;

const refresh = () => {
  GOOGLE_MAPS_API_KEY = getGoogleMapsApiKeySync() || '';
  HAS_VALID_GOOGLE_MAPS_KEY = isUsableKey(GOOGLE_MAPS_API_KEY);
  return GOOGLE_MAPS_API_KEY;
};

// Best effort at import: correct when the runtime config already resolved, and
// harmlessly empty when it has not. Every hook call re-reads.
refresh();

export const INDIA_CENTER = { lat: 22.7196, lng: 75.8577 };
export const DELHI_CENTER = { lat: 28.6139, lng: 77.209 };
export const GOOGLE_MAPS_LOADER_ID = 'Quick Drop-google-maps';
export const GOOGLE_MAPS_LIBRARIES = ['drawing', 'places', 'visualization'];

export const getLatLng = (source, fallback = INDIA_CENTER) => {
  const lat = Number(source?.lat ?? source?.latitude);
  const lng = Number(source?.lng ?? source?.longitude ?? source?.lon);

  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng };
  }

  return fallback;
};

/** Current key, re-read from the runtime config. For static-map URLs. */
export const getGoogleMapsKey = () => refresh();

export const useAppGoogleMapsLoader = () => {
  const apiKey = refresh();

  return useJsApiLoader({
    id: GOOGLE_MAPS_LOADER_ID,
    googleMapsApiKey: HAS_VALID_GOOGLE_MAPS_KEY ? apiKey : '',
    libraries: GOOGLE_MAPS_LIBRARIES,
    version: '3.55'
  });
};
