import { useEffect, useRef, useState } from "react"
import { Crosshair, Loader2, MapPin, Search } from "lucide-react"
import { getGoogleMapsApiKey } from "@food/utils/googleMapsApiKey"

/** The address fields we fill from a Google place or an OpenStreetMap result. */
const fromGooglePlace = (place) => {
  const get = (type, short = false) => {
    const c = (place?.address_components || []).find((x) => x.types.includes(type))
    return c ? (short ? c.short_name : c.long_name) : ""
  }
  const street = [get("street_number"), get("route")].filter(Boolean).join(" ")
  return {
    addressLine1: [place?.name, street].filter(Boolean).join(", ") || place?.formatted_address || "",
    area: get("sublocality_level_1") || get("sublocality") || get("neighborhood"),
    city: get("locality") || get("administrative_area_level_2"),
    state: get("administrative_area_level_1"),
    pincode: get("postal_code"),
  }
}
const fromOsm = (r) => {
  const a = r?.address || {}
  return {
    addressLine1: String(r?.display_name || "").split(",").slice(0, 2).join(",").trim(),
    area: a.suburb || a.neighbourhood || a.quarter || "",
    city: a.city || a.town || a.village || a.county || "",
    state: a.state || "",
    pincode: a.postcode || "",
  }
}

/**
 * Drop a pin on the store's front door.
 *
 * Search the address (Google, with OpenStreetMap as a fallback), click the
 * map or drag the pin; "Use my location" centres it on the device. The chosen
 * zone's boundary is drawn so the pin can be placed inside it.
 * The pin is what riders navigate to and what the admin checks against the
 * front photo, so it is asked for precisely rather than guessed from the
 * typed address.
 */

let mapsPromise = null
const loadMaps = async () => {
  if (window.google?.maps?.Map) return true
  if (mapsPromise) return mapsPromise
  mapsPromise = (async () => {
    const key = await getGoogleMapsApiKey()
    if (!key) return false
    await new Promise((resolve, reject) => {
      const existing = Array.from(document.scripts).find((s) => s.src.includes("maps.googleapis.com/maps/api/js"))
      if (existing) {
        if (window.google?.maps?.Map) return resolve()
        existing.addEventListener("load", resolve, { once: true })
        existing.addEventListener("error", reject, { once: true })
        return
      }
      const script = document.createElement("script")
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places`
      script.async = true
      script.onload = resolve
      script.onerror = reject
      document.head.appendChild(script)
    })
    return Boolean(window.google?.maps?.Map)
  })().catch(() => {
    mapsPromise = null
    return false
  })
  return mapsPromise
}

const INDIA = { lat: 22.9734, lng: 78.6569 }

export default function MapPinPicker({ value, onChange, onAddress, zone }) {
  const holder = useRef(null)
  const mapRef = useRef(null)
  const markerRef = useRef(null)
  const zoneShapeRef = useRef(null)
  const searchRef = useRef(null)
  const [status, setStatus] = useState("loading")
  const [locating, setLocating] = useState(false)
  const [query, setQuery] = useState("")
  const [osmResults, setOsmResults] = useState([])
  const [googleSearch, setGoogleSearch] = useState(false)

  const placePin = (point, zoom = 18) => {
    onChange(point)
    mapRef.current?.setCenter(point)
    mapRef.current?.setZoom(zoom)
  }

  const hasPin = Number.isFinite(value?.lat) && Number.isFinite(value?.lng)

  useEffect(() => {
    let cancelled = false
    loadMaps().then((ok) => {
      if (cancelled) return
      if (!ok || !holder.current) {
        setStatus("unavailable")
        return
      }
      const start = hasPin ? { lat: value.lat, lng: value.lng } : INDIA
      const map = new window.google.maps.Map(holder.current, {
        center: start,
        zoom: hasPin ? 17 : 5,
        streetViewControl: false,
        mapTypeControl: false,
        // Full screen lets the owner place the pin precisely on a phone.
        fullscreenControl: true,
      })
      const marker = new window.google.maps.Marker({
        map,
        position: hasPin ? start : null,
        draggable: true,
      })
      const set = (latLng) => {
        marker.setPosition(latLng)
        onChange({ lat: Number(latLng.lat().toFixed(6)), lng: Number(latLng.lng().toFixed(6)) })
      }
      map.addListener("click", (e) => set(e.latLng))
      marker.addListener("dragend", (e) => set(e.latLng))
      mapRef.current = map
      markerRef.current = marker
      // Google address search, when the Places library is available.
      if (window.google.maps.places?.Autocomplete && searchRef.current) {
        const ac = new window.google.maps.places.Autocomplete(searchRef.current, {
          componentRestrictions: { country: "in" },
          fields: ["address_components", "geometry", "name", "formatted_address"],
        })
        ac.addListener("place_changed", () => {
          const place = ac.getPlace()
          const loc = place?.geometry?.location
          if (!loc) return
          placePin({ lat: Number(loc.lat().toFixed(6)), lng: Number(loc.lng().toFixed(6)) })
          onAddress?.(fromGooglePlace(place))
          setQuery(place.formatted_address || place.name || "")
        })
        setGoogleSearch(true)
      }
      setStatus("ready")
    })
    return () => {
      cancelled = true
    }
    // Built once; later value changes move the pin below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // OpenStreetMap suggestions when Google search is not available.
  useEffect(() => {
    if (googleSearch) return undefined
    const q = query.trim()
    if (q.length < 3) {
      setOsmResults([])
      return undefined
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&countrycodes=in&q=${encodeURIComponent(q)}`,
          { headers: { Accept: "application/json" } },
        )
        const rows = await res.json()
        setOsmResults(Array.isArray(rows) ? rows : [])
      } catch {
        setOsmResults([])
      }
    }, 400)
    return () => clearTimeout(t)
  }, [query, googleSearch])

  // The chosen zone's boundary, so the pin goes inside it.
  useEffect(() => {
    if (status !== "ready" || !mapRef.current) return
    zoneShapeRef.current?.setMap(null)
    zoneShapeRef.current = null
    const ring = Array.isArray(zone?.coordinates) ? zone.coordinates : []
    const path = ring
      .map((p) => ({ lat: Number(p.latitude ?? p.lat), lng: Number(p.longitude ?? p.lng) }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    if (path.length < 3) return
    zoneShapeRef.current = new window.google.maps.Polygon({
      map: mapRef.current,
      paths: path,
      strokeColor: "#059669",
      strokeWeight: 2,
      fillColor: "#10b981",
      fillOpacity: 0.08,
      clickable: false,
    })
    if (!hasPin) {
      const bounds = new window.google.maps.LatLngBounds()
      path.forEach((p) => bounds.extend(p))
      mapRef.current.fitBounds(bounds)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, zone])

  useEffect(() => {
    if (status !== "ready" || !hasPin || !markerRef.current) return
    const current = markerRef.current.getPosition()
    if (!current || current.lat() !== value.lat || current.lng() !== value.lng) {
      markerRef.current.setPosition(value)
    }
  }, [status, hasPin, value])

  const useMyLocation = () => {
    if (!navigator.geolocation) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const point = { lat: Number(pos.coords.latitude.toFixed(6)), lng: Number(pos.coords.longitude.toFixed(6)) }
        onChange(point)
        mapRef.current?.setCenter(point)
        mapRef.current?.setZoom(18)
        setLocating(false)
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your store's address"
          className="h-11 w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 text-sm"
          autoComplete="off"
        />
        {!googleSearch && osmResults.length > 0 && (
          <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
            {osmResults.map((r) => (
              <li key={r.place_id}>
                <button
                  type="button"
                  onClick={() => {
                    placePin({ lat: Number(Number(r.lat).toFixed(6)), lng: Number(Number(r.lon).toFixed(6)) })
                    onAddress?.(fromOsm(r))
                    setQuery(r.display_name || "")
                    setOsmResults([])
                  }}
                  className="block w-full truncate px-3 py-2 text-left text-sm hover:bg-slate-50"
                >
                  {r.display_name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="relative overflow-hidden rounded-xl border border-slate-300">
        <div ref={holder} className="h-[55vh] min-h-[320px] max-h-[560px] w-full bg-slate-100" />
        {status === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading map
          </div>
        )}
        {status === "unavailable" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-4 text-center text-sm text-slate-600">
            <MapPin className="h-5 w-5" />
            The map could not load. Use &ldquo;Use my location&rdquo; while standing at the store.
          </div>
        )}
        <button
          type="button"
          onClick={useMyLocation}
          className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 shadow ring-1 ring-slate-200"
        >
          {locating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Crosshair className="h-3.5 w-3.5" />}
          Use my location
        </button>
      </div>
      <p className="text-xs text-slate-500">
        {hasPin
          ? `Pinned at ${value.lat}, ${value.lng}. Drag the pin to the entrance if it is off.`
          : "Tap the map at your store's entrance, or use your location while at the store."}
      </p>
    </div>
  )
}
