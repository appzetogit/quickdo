import { useEffect, useRef, useState } from "react"
import { Crosshair, Loader2, MapPin } from "lucide-react"
import { getGoogleMapsApiKey } from "@food/utils/googleMapsApiKey"

/**
 * Drop a pin on the store's front door.
 *
 * Click the map or drag the pin; "Use my location" centres it on the device.
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

export default function MapPinPicker({ value, onChange }) {
  const holder = useRef(null)
  const mapRef = useRef(null)
  const markerRef = useRef(null)
  const [status, setStatus] = useState("loading")
  const [locating, setLocating] = useState(false)

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
        fullscreenControl: false,
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
      setStatus("ready")
    })
    return () => {
      cancelled = true
    }
    // Built once; later value changes move the pin below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      <div className="relative overflow-hidden rounded-xl border border-slate-300">
        <div ref={holder} className="h-64 w-full bg-slate-100" />
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
