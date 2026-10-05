import { useState, useEffect, useCallback, useRef } from 'react'
import { zoneAPI } from '@food/api'
const debugLog = (...args) => console.log("[useZone Hook]", ...args)
const debugWarn = (...args) => console.warn("[useZone Hook]", ...args)
const debugError = (...args) => console.error("[useZone Hook]", ...args)

// ---- Cross-hook caching & in-flight de-dupe (module-level) ----
// Multiple screens/components call useZone(location). Without shared caching,
// we spam /food/zones/detect with the same coords.
const ZONE_CACHE_TTL_MS = 30 * 1000
const zoneCache = new Map() // key -> { ts, payload }
const zoneInFlight = new Map() // key -> Promise<payload>

const roundCoord = (v, digits = 5) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  const p = 10 ** digits
  return Math.round(n * p) / p
}

const zoneKeyFromCoords = (lat, lng) => {
  const rLat = roundCoord(lat, 5)
  const rLng = roundCoord(lng, 5)
  if (rLat === null || rLng === null) return null
  return `${rLat},${rLng}`
}

const applyZonePayload = (data, { setZoneId, setZone, setZoneStatus, persistToStorage = true }) => {
  if (data?.status === 'IN_SERVICE' && data.zoneId) {
    setZoneId(data.zoneId)
    setZone(data.zone || null)
    setZoneStatus('IN_SERVICE')
    if (persistToStorage) {
      localStorage.setItem('userZoneId', data.zoneId)
      localStorage.setItem('userZone', JSON.stringify(data.zone))
    }
  } else {
    setZoneId(null)
    setZone(null)
    setZoneStatus('OUT_OF_SERVICE')
    if (persistToStorage) {
      localStorage.removeItem('userZoneId')
      localStorage.removeItem('userZone')
    }
  }
}


/**
 * Hook to detect and manage user's zone based on location
 * Automatically detects zone when location is available
 */
export function useZone(location, options = {}) {
  const {
    persistToStorage = true,
    usePersistedFallback = true,
  } = options
  const [zoneId, setZoneId] = useState(null)
  const [zoneStatus, setZoneStatus] = useState('loading') // 'loading' | 'IN_SERVICE' | 'OUT_OF_SERVICE'
  const [zone, setZone] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const prevCoordsRef = useRef({ latitude: null, longitude: null })
  const debounceTimerRef = useRef(null)

  // Failsafe: prevent infinite loading state if location or network issues occur
  useEffect(() => {
    if (zoneStatus === 'loading') {
      const failsafe = setTimeout(() => {
        debugWarn("Failsafe triggered: zoneStatus stuck in 'loading' for 5s, forcing OUT_OF_SERVICE");
        setZoneStatus('OUT_OF_SERVICE');
      }, 5000);
      return () => clearTimeout(failsafe);
    }
  }, [zoneStatus]);

  // Detect zone when location is available
  const detectZone = useCallback(async (lat, lng) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setZoneStatus("OUT_OF_SERVICE");
      setZoneId(null);
      setZone(null);
      return;
    }

    try {
      setLoading(true)
      setError(null)

      const key = zoneKeyFromCoords(lat, lng)
      const now = Date.now()
      if (key) {
        const cached = zoneCache.get(key)
        if (cached && now - cached.ts < ZONE_CACHE_TTL_MS) {
          applyZonePayload(cached.payload, { setZoneId, setZone, setZoneStatus, persistToStorage })
          return
        }
      }

      const promise = (() => {
        if (key && zoneInFlight.has(key)) return zoneInFlight.get(key)
        const p = zoneAPI
          .detectZone(lat, lng)
          .then((response) => {
            if (!response?.data?.success) {
              throw new Error(response?.data?.message || 'Failed to detect zone')
            }
            return response.data.data
          })
          .finally(() => {
            if (key) zoneInFlight.delete(key)
          })
        if (key) zoneInFlight.set(key, p)
        return p
      })()

      const data = await promise
      if (key) zoneCache.set(key, { ts: now, payload: data })
      applyZonePayload(data, { setZoneId, setZone, setZoneStatus, persistToStorage })
    } catch (err) {
      debugError("Error detecting zone:", err);
      setError(
        err.response?.data?.message || err.message || "Failed to detect zone",
      );

      // Try to use cached zone if available
      const cachedZoneId = usePersistedFallback ? localStorage.getItem("userZoneId") : null;
      if (cachedZoneId) {
        const cachedZone = localStorage.getItem("userZone");
        setZoneId(cachedZoneId);
        setZone(cachedZone ? JSON.parse(cachedZone) : null);
        setZoneStatus("IN_SERVICE");
      } else {
        // Fallback to out of service so the app doesn't hang in a loading state
        setZoneStatus("OUT_OF_SERVICE");
        setZoneId(null);
        setZone(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        debugLog("Unmounting: clearing debounce timer");
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [])

  // Auto-detect zone when location changes
  useEffect(() => {
    const lat = roundCoord(location?.latitude, 6)
    const lng = roundCoord(location?.longitude, 6)
    debugLog("useEffect running. location coords:", lat, lng, "prevCoordsRef:", prevCoordsRef.current);

    // Check if coordinates have changed significantly (threshold: ~10 meters)
    const coordThreshold = 0.0001; // approximately 10 meters
    const coordsChanged =
      !prevCoordsRef.current.latitude ||
      !prevCoordsRef.current.longitude ||
      Math.abs(prevCoordsRef.current.latitude - (lat || 0)) > coordThreshold ||
      Math.abs(prevCoordsRef.current.longitude - (lng || 0)) > coordThreshold;

    debugLog("coordsChanged evaluated to:", coordsChanged, "zoneStatus is:", zoneStatus);

    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      // Detect zone if coordinates changed significantly OR if we are still in loading state
      if (coordsChanged || zoneStatus === 'loading') {
        prevCoordsRef.current = { latitude: lat, longitude: lng }
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
        }
        debugLog("Scheduling detectZone in 350ms");
        debounceTimerRef.current = setTimeout(() => {
          debugLog("Debounce timeout fired! Executing detectZone");
          debounceTimerRef.current = null;
          detectZone(lat, lng)
        }, 350)
      } else {
        debugLog("Coords did not change significantly and not loading. Skipping scheduling.");
      }
    } else {
      // Try to use cached zone if location not available
      const cachedZoneId = usePersistedFallback ? localStorage.getItem("userZoneId") : null;
      debugLog("Coords not finite. Cached zone ID:", cachedZoneId);
      if (cachedZoneId) {
        const cachedZone = localStorage.getItem("userZone");
        setZoneId(cachedZoneId);
        setZone(cachedZone ? JSON.parse(cachedZone) : null);
        setZoneStatus("IN_SERVICE");
      } else {
        setZoneStatus("OUT_OF_SERVICE");
        setZoneId(null);
        setZone(null);
      }
    }
  }, [location?.latitude, location?.longitude, detectZone, zoneStatus])

  // Manual refresh zone
  const refreshZone = useCallback(() => {
    const lat = location?.latitude;
    const lng = location?.longitude;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      detectZone(lat, lng);
    }
  }, [location?.latitude, location?.longitude, detectZone]);

  return {
    zoneId,
    zone,
    zoneStatus,
    loading,
    error,
    isInService: zoneStatus === "IN_SERVICE",
    isOutOfService: zoneStatus === "OUT_OF_SERVICE",
    refreshZone,
  };
}
