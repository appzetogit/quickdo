import { useState, useEffect, useRef, useCallback } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { MapPin, ArrowLeft, Save, X, Hand, Shapes, Search } from "lucide-react"
import { adminAPI } from "@food/api"
import { getGoogleMapsApiKey } from "@food/utils/googleMapsApiKey"
import { currentAdminBase } from "@food/components/admin/AdminSidebar"

/*
 * These screens serve the food, quick-commerce and medical panels. A hardcoded
 * /admin/food path sent the medical panel's Add/Edit/View into FOOD zone setup,
 * so a "medical" zone was drawn and saved as a food zone, and every save landed
 * back in food. The base follows the panel the admin is in.
 */
const zoneSetupBase = () => `${currentAdminBase(window.location.pathname)}/zone-setup`

const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

const MIN_POINTS = 3;


const waitFor = async (predicate, timeoutMs = 8000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await new Promise(r => setTimeout(r, 100));
  }
  return predicate();
};


export default function AddZone() {
  const navigate = useNavigate()
  const { id } = useParams()
  const isEditMode = !!id && !window.location.pathname.includes('/view/')
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const mapClickListenerRef = useRef(null)
  const drawPointsRef = useRef([])
  const isDrawingRef = useRef(false)
  const polygonRef = useRef(null)
  const circleRef = useRef(null)
  const circleListenersRef = useRef([])
  const markersRef = useRef([])
  const pathMarkersRef = useRef([])
  
  const [googleMapsApiKey, setGoogleMapsApiKey] = useState("")
  const [mapLoading, setMapLoading] = useState(true)
  const [loading, setLoading] = useState(false)
  
  // Form state
  const [formData, setFormData] = useState({
    country: "India",
    zoneName: "",
    unit: "kilometer",
  })
  
  const [coordinates, setCoordinates] = useState([])
  const [boundaryMode, setBoundaryMode] = useState("polygon")
  const boundaryModeRef = useRef("polygon")
  useEffect(() => { boundaryModeRef.current = boundaryMode; }, [boundaryMode])
  const [circleCenter, setCircleCenter] = useState(null)
  const [circleRadiusMeters, setCircleRadiusMeters] = useState("")
  const [isDrawing, setIsDrawing] = useState(false)
  const [locationSearch, setLocationSearch] = useState("")
  const [existingZones, setExistingZones] = useState([])
  const autocompleteInputRef = useRef(null)
  const autocompleteRef = useRef(null)
  const autocompleteServiceRef = useRef(null)
  const placesServiceRef = useRef(null)
  const suggestionsDebounceRef = useRef(null)
  const existingZonesPolygonsRef = useRef([])
  const mapsScriptLoadedRef = useRef(false)
  const [searchSuggestions, setSearchSuggestions] = useState([])
  const [showSuggestions, setShowSuggestions] = useState(false)

  useEffect(() => {
    fetchExistingZones()
    loadGoogleMaps()
    if (isEditMode && id) {
      fetchZone()
    }
  }, [id, isEditMode])

  useEffect(() => {
    return () => {
      if (suggestionsDebounceRef.current) {
        clearTimeout(suggestionsDebounceRef.current)
        suggestionsDebounceRef.current = null
      }
    }
  }, [])

  // Center map on India when country is selected
  useEffect(() => {
    if (formData.country === "India" && mapInstanceRef.current) {
      const indiaCenter = { lat: 20.5937, lng: 78.9629 }
      mapInstanceRef.current.setCenter(indiaCenter)
      mapInstanceRef.current.setZoom(5)
    }
  }, [formData.country])
  const ensurePlacesSdkLoaded = useCallback(async () => {
    if (window.google?.maps?.places?.Autocomplete) {
      mapsScriptLoadedRef.current = true
      return true
    }

    const apiKey = await getGoogleMapsApiKey()
    if (!apiKey) return false

    window.gm_authFailure = () => {}

    const scripts = Array.from(document.getElementsByTagName("script"))
    const mapsScript = scripts.find((s) => s.src?.includes("maps.googleapis.com/maps/api/js"))

    if (mapsScript && !mapsScript.src.includes("libraries=places")) {
      mapsScript.remove()
    } else if (mapsScript && mapsScript.src.includes("libraries=places")) {
      for (let i = 0; i < 60; i++) {
        if (window.google?.maps?.places?.Autocomplete) return true
        await new Promise((r) => setTimeout(r, 100))
      }
    }

    return new Promise((resolve) => {
      const oldScript = document.getElementById("google-maps-sdk")
      if (oldScript) oldScript.remove()

      const script = document.createElement("script")
      script.id = "google-maps-sdk"
      script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,geometry&v=weekly`
      script.async = true
      script.defer = true
      script.onload = () => {
        setTimeout(() => {
          const ok = !!window.google?.maps?.places?.Autocomplete
          mapsScriptLoadedRef.current = ok
          resolve(ok)
        }, 250)
      }
      script.onerror = () => resolve(false)
      document.head.appendChild(script)
    })
  }, [])

  // Initialize Places Autocomplete when map is loaded
  useEffect(() => {
    let cancelled = false

    const initAutocomplete = async () => {
      if (mapLoading || !mapInstanceRef.current || !autocompleteInputRef.current || autocompleteRef.current) return

      const loaded = await ensurePlacesSdkLoaded()
      if (!loaded || cancelled || !window.google?.maps?.places?.Autocomplete || !autocompleteInputRef.current) return

      const autocomplete = new window.google.maps.places.Autocomplete(autocompleteInputRef.current, {
        types: ["geocode", "establishment"],
        componentRestrictions: { country: "in" }
      })

      if (window.google?.maps?.places?.AutocompleteService) {
        autocompleteServiceRef.current = new window.google.maps.places.AutocompleteService()
      }
      if (window.google?.maps?.places?.PlacesService) {
        const host = mapInstanceRef.current || document.createElement("div")
        placesServiceRef.current = new window.google.maps.places.PlacesService(host)
      }

      autocomplete.addListener("place_changed", () => {
        const place = autocomplete.getPlace()
        if (place.geometry && place.geometry.location && mapInstanceRef.current) {
          const location = place.geometry.location
          mapInstanceRef.current.setCenter(location)
          mapInstanceRef.current.setZoom(15)
          setLocationSearch(place.formatted_address || place.name || "")
          setShowSuggestions(false)
          setSearchSuggestions([])
        }
      })

      autocompleteRef.current = autocomplete

      const pacContainerFix = () => {
        const applyFix = () => {
          const containers = document.querySelectorAll(".pac-container")
          containers.forEach((container) => {
            container.style.zIndex = "999999"
            container.style.pointerEvents = "auto"
            container.style.visibility = "visible"
            container.style.display = "block"
          })
        }
        applyFix()
        setTimeout(applyFix, 120)
        setTimeout(applyFix, 300)
      }

      autocompleteInputRef.current.addEventListener("focus", pacContainerFix)
      autocompleteInputRef.current.addEventListener("input", pacContainerFix)
    }

    initAutocomplete()
    return () => {
      cancelled = true
    }
  }, [mapLoading, ensurePlacesSdkLoaded])

  const fetchSearchSuggestions = useCallback((query) => {
    const q = String(query || "").trim()
    if (!q || !autocompleteServiceRef.current || !window.google?.maps?.places?.PlacesServiceStatus) {
      setSearchSuggestions([])
      return
    }
    autocompleteServiceRef.current.getPlacePredictions(
      {
        input: q,
        componentRestrictions: { country: "in" },
        types: ["geocode"]
      },
      (predictions = [], status) => {
        const ok = status === window.google.maps.places.PlacesServiceStatus.OK
        setSearchSuggestions(ok ? predictions.slice(0, 6) : [])
      }
    )
  }, [])

  const handleLocationSearchChange = (value) => {
    setLocationSearch(value)
    setShowSuggestions(true)
    if (suggestionsDebounceRef.current) {
      clearTimeout(suggestionsDebounceRef.current)
      suggestionsDebounceRef.current = null
    }
    suggestionsDebounceRef.current = setTimeout(() => {
      fetchSearchSuggestions(value)
    }, 180)
  }

  const handleSuggestionSelect = (suggestion) => {
    if (!suggestion?.place_id || !placesServiceRef.current) return
    placesServiceRef.current.getDetails(
      {
        placeId: suggestion.place_id,
        fields: ["geometry", "formatted_address", "name"]
      },
      (place, status) => {
        if (
          status === window.google?.maps?.places?.PlacesServiceStatus?.OK &&
          place?.geometry?.location &&
          mapInstanceRef.current
        ) {
          const location = place.geometry.location
          mapInstanceRef.current.setCenter(location)
          mapInstanceRef.current.setZoom(15)
          setLocationSearch(place.formatted_address || place.name || "")
          setShowSuggestions(false)
          setSearchSuggestions([])
        }
      }
    )
  }

  const initialDrawDoneRef = useRef(false);

  // Draw existing polygon when in edit mode and coordinates are loaded
  useEffect(() => {
    if (isEditMode && coordinates.length >= 3 && mapInstanceRef.current && window.google && !mapLoading && !initialDrawDoneRef.current) {
      initialDrawDoneRef.current = true;
      debugLog("Drawing existing polygon in edit mode, coordinates:", coordinates.length)
      setTimeout(() => {
        if (mapInstanceRef.current && window.google) {
          // Ensure drawing mode is off when editing existing polygon
          isDrawingRef.current = false
          setIsDrawing(false)
          mapInstanceRef.current.setOptions({ draggableCursor: null })
          existingZonesPolygonsRef.current.forEach(p => p?.setOptions?.({ clickable: true }))
          debugLog("Drawing mode disabled, polygon is editable")
          drawExistingPolygon(window.google, mapInstanceRef.current, coordinates)
        }
      }, 500)
    }
  }, [isEditMode, coordinates.length, mapLoading])


  const fetchExistingZones = async () => {
    try {
      const response = await adminAPI.getZones({ limit: 1000 })
      if (response.data?.success && response.data.data?.zones) {
        // Filter out the current zone if in edit mode
        const zones = isEditMode && id 
          ? response.data.data.zones.filter(zone => zone._id !== id)
          : response.data.data.zones
        setExistingZones(zones)
      }
    } catch (error) {
      debugError("Error fetching existing zones:", error)
      setExistingZones([])
    }
  }

  const fetchZone = async () => {
    try {
      setLoading(true)
      const response = await adminAPI.getZoneById(id)
      if (response.data?.success && response.data.data?.zone) {
        const zoneData = response.data.data.zone
        setFormData({
          country: zoneData.country || "India",
          zoneName: zoneData.name || zoneData.zoneName || "",
          unit: zoneData.unit || "kilometer",
        })
        
        const nextBoundaryMode = zoneData.boundary_mode === 'circle' ? 'circle' : 'polygon';
        setBoundaryMode(nextBoundaryMode);
        
        if (nextBoundaryMode === 'polygon' && zoneData.coordinates && zoneData.coordinates.length > 0) {
          setCoordinates(zoneData.coordinates)
        }
        
        if (nextBoundaryMode === 'circle' && zoneData.circle_center) {
          setCircleCenter(zoneData.circle_center);
          setCircleRadiusMeters(zoneData.circle_radius_meters ? String(zoneData.circle_radius_meters) : "1000");
        }
      }
    } catch (error) {
      debugError("Error fetching zone:", error)
      alert("Failed to load zone")
      navigate(`${zoneSetupBase()}`)
    } finally {
      setLoading(false)
    }
  }

  const loadGoogleMaps = async () => {
    try {
      const apiKey = await getGoogleMapsApiKey()
      setGoogleMapsApiKey(apiKey || "loaded")
      if (!apiKey) { setMapLoading(false); return; }

      const existingScript = Array.from(document.getElementsByTagName("script"))
        .find(s => s.src?.includes("maps.googleapis.com/maps/api/js"));

      if (!window.google?.maps && !existingScript) {
        await new Promise((resolve) => {
          const script = document.createElement("script");
          script.id = "google-maps-sdk";
          script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,geometry&v=weekly`;
          script.async = true; script.defer = true;
          script.onload = () => resolve(true);
          script.onerror = () => resolve(false);
          document.head.appendChild(script);
        });
      }

      const ready = await waitFor(() => !!window.google?.maps);
      if (!ready) { setMapLoading(false); return; }
      initializeMap(window.google);
    } catch (error) {
      debugError("Error loading Google Maps:", error)
      setMapLoading(false)
    }
  }

  const renderVertexMarkers = (google, map, latLngs) => {
    pathMarkersRef.current?.forEach(m => m.setMap(null));
    pathMarkersRef.current = latLngs.map((latLng, i) => {
      const marker = new google.maps.Marker({
        position: latLng,
        map,
        draggable: true,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: "#9333ea",
                fillOpacity: 1, strokeColor: "#ffffff", strokeWeight: 2 },
        zIndex: 1000,
        title: `Point ${i + 1}`,
      });

      google.maps.event.addListener(marker, 'drag', () => {
        drawPointsRef.current[i] = marker.getPosition();
        const ordered = drawPointsRef.current.length >= 3
          ? orderPointsRadially(drawPointsRef.current)
          : drawPointsRef.current.map(p => ({ lat: typeof p.lat === 'function' ? p.lat() : p.lat, lng: typeof p.lng === 'function' ? p.lng() : p.lng }));
        if (polygonRef.current) {
          polygonRef.current.setPaths(ordered);
        }
      });

      google.maps.event.addListener(marker, 'dragend', () => {
        drawPointsRef.current[i] = marker.getPosition();
        if (drawPointsRef.current.length >= 3) {
          const sortedCoords = orderPointsRadially(drawPointsRef.current);
          drawPointsRef.current = sortedCoords.map(c => new google.maps.LatLng(c.lat, c.lng));
        }

        const ordered = drawPointsRef.current.map(p => ({
          lat: typeof p.lat === 'function' ? p.lat() : p.lat,
          lng: typeof p.lng === 'function' ? p.lng() : p.lng
        }));

        setCoordinates(ordered.map(p => ({
          latitude: parseFloat(p.lat.toFixed(6)),
          longitude: parseFloat(p.lng.toFixed(6)),
        })));

        // Re-render markers to match the new sorted order and indices
        renderVertexMarkers(google, map, drawPointsRef.current);
      });

      return marker;
    });
  };

  const renderDrawingPolygon = (google, map) => {
    const points = drawPointsRef.current;
    if (polygonRef.current) { polygonRef.current.setMap(null); polygonRef.current = null; }

    const ordered = points.length >= 3 
      ? orderPointsRadially(points) 
      : points.map(p => ({ lat: typeof p.lat === 'function' ? p.lat() : p.lat, lng: typeof p.lng === 'function' ? p.lng() : p.lng }));

    if (ordered.length >= 2) {
      polygonRef.current = new google.maps.Polygon({
        paths: ordered, fillColor: "#9333ea", fillOpacity: 0.35,
        strokeColor: "#9333ea", strokeWeight: 2,
        clickable: false, editable: false, zIndex: 1,
      });
      polygonRef.current.setMap(map);
    }

    renderVertexMarkers(google, map, points);
    setCoordinates(ordered.map(p => ({
      latitude: parseFloat(p.lat.toFixed(6)),
      longitude: parseFloat(p.lng.toFixed(6)),
    })));
  };

  const orderPointsRadially = (pts) => {
    const points = pts
      .map(p => ({
        lat: typeof p.lat === 'function' ? p.lat() : p.lat,
        lng: typeof p.lng === 'function' ? p.lng() : p.lng,
      }))
      .filter(p => typeof p.lat === 'number' && typeof p.lng === 'number');

    if (points.length < 3) return points;

    const cx = points.reduce((s, p) => s + p.lng, 0) / points.length;
    const cy = points.reduce((s, p) => s + p.lat, 0) / points.length;

    return [...points].sort((a, b) =>
      Math.atan2(a.lat - cy, a.lng - cx) - Math.atan2(b.lat - cy, b.lng - cx)
    );
  };

  const initializeMap = (google) => {
    if (!mapRef.current) return

    // Initial location (India center)
    const initialLocation = { lat: 20.5937, lng: 78.9629 }

    // Create map
    const map = new google.maps.Map(mapRef.current, {
      center: initialLocation,
      zoom: 5,
      mapTypeControl: true,
      mapTypeControlOptions: {
        style: google.maps.MapTypeControlStyle.HORIZONTAL_BAR,
        position: google.maps.ControlPosition.TOP_RIGHT,
        mapTypeIds: [google.maps.MapTypeId.ROADMAP, google.maps.MapTypeId.SATELLITE]
      },
      zoomControl: true,
      streetViewControl: false,
      fullscreenControl: true,
      scrollwheel: true, // Enable mouse wheel zoom
      gestureHandling: 'greedy', // Allow zoom with mouse wheel and touch gestures
      disableDoubleClickZoom: false, // Allow double-click zoom
      clickableIcons: false, // POI labels must NOT capture clicks while drawing
    })

    mapInstanceRef.current = map

    if (mapClickListenerRef.current) {
      google.maps.event.removeListener(mapClickListenerRef.current)
    }

    mapClickListenerRef.current = google.maps.event.addListener(map, 'click', (event) => {
      if (!isDrawingRef.current) return;
      if (boundaryModeRef.current === 'circle') {
        const lat = event.latLng.lat();
        const lng = event.latLng.lng();
        setCircleCenter({ lat, lng });
        setCircleRadiusMeters("1000");
        setIsDrawing(false);
        isDrawingRef.current = false;
        map.setOptions({ draggableCursor: null });
        drawEditableCircle(google, map, { lat, lng }, 1000);
      } else {
        drawPointsRef.current.push(event.latLng);
        renderDrawingPolygon(google, map);
      }
    });

    setMapLoading(false)

    // Existing zones will be drawn by useEffect when data is ready

    // If in edit mode and coordinates are already loaded, draw the polygon/circle
    if (isEditMode) {
      setTimeout(() => {
        if (mapInstanceRef.current && window.google) {
          if (boundaryModeRef.current === 'polygon' && coordinates.length >= 3) {
            drawExistingPolygon(window.google, mapInstanceRef.current, coordinates)
          } else if (boundaryModeRef.current === 'circle' && circleCenter) {
            drawEditableCircle(window.google, mapInstanceRef.current, circleCenter, circleRadiusMeters)
          }
        }
      }, 500) // Small delay to ensure map is fully loaded
    }
  }

  // Draw existing zones on the map
  const drawExistingZonesOnMap = (google, map) => {
    if (!existingZones || existingZones.length === 0) return

    // Clear previous existing zone polygons
    existingZonesPolygonsRef.current.forEach(polygon => {
      if (polygon) polygon.setMap(null)
    })
    existingZonesPolygonsRef.current = []

    existingZones.forEach((zone, index) => {
      if (zone.boundary_mode === 'circle' && zone.circle_center) {
        const circle = new google.maps.Circle({
          center: { lat: Number(zone.circle_center.lat), lng: Number(zone.circle_center.lng) },
          radius: Number(zone.circle_radius_meters) || 1000,
          strokeColor: "#3b82f6",
          strokeOpacity: 0.6,
          strokeWeight: 2,
          fillColor: "#3b82f6",
          fillOpacity: 0.15,
          editable: false,
          draggable: false,
          clickable: true,
          zIndex: 0
        })
        circle.setMap(map)
        existingZonesPolygonsRef.current.push(circle)
        
        const infoWindow = new google.maps.InfoWindow({
          content: `
            <div style="padding: 8px;">
              <strong>${zone.name || zone.zoneName || 'Unnamed Zone'}</strong><br/>
              <small>Country: ${zone.country || 'N/A'}</small>
            </div>
          `
        })
        circle.addListener('click', (e) => {
          infoWindow.setPosition(e.latLng || circle.getCenter())
          infoWindow.open(map)
        })
        return;
      }

      if (!zone.coordinates || zone.coordinates.length < 3) return

      // Convert coordinates to LatLng array
      const path = zone.coordinates.map(coord => {
        const lat = typeof coord === 'object' ? (coord.latitude || coord.lat) : null
        const lng = typeof coord === 'object' ? (coord.longitude || coord.lng) : null
        if (lat === null || lng === null) return null
        return new google.maps.LatLng(lat, lng)
      }).filter(Boolean)

      if (path.length < 3) return

      // Create polygon for existing zone with different color (gray/blue)
      const polygon = new google.maps.Polygon({
        paths: path,
        strokeColor: "#3b82f6", // Blue color for existing zones
        strokeOpacity: 0.6,
        strokeWeight: 2,
        fillColor: "#3b82f6",
        fillOpacity: 0.15, // Lighter opacity so new zone stands out
        editable: false, // Not editable
        draggable: false,
        clickable: true,
        zIndex: 0 // Lower z-index so new zone appears on top
      })

      polygon.setMap(map)
      existingZonesPolygonsRef.current.push(polygon)

      // Add info window on click
      const infoWindow = new google.maps.InfoWindow({
        content: `
          <div style="padding: 8px;">
            <strong>${zone.name || zone.zoneName || 'Unnamed Zone'}</strong><br/>
            <small>Country: ${zone.country || 'N/A'}</small>
          </div>
        `
      })

      polygon.addListener('click', () => {
        infoWindow.setPosition(polygon.getPath().getAt(0))
        infoWindow.open(map)
      })
    })
  }

  // Redraw existing zones when zones data changes or map is ready
  useEffect(() => {
    if (!mapLoading && mapInstanceRef.current && existingZones.length > 0 && window.google) {
      drawExistingZonesOnMap(window.google, mapInstanceRef.current)
    }
  }, [existingZones, mapLoading])

  const drawEditablePolygon = (google, map, coords) => {
    const path = coords.map(c => {
      const lat = typeof c === 'object' ? (c.latitude || c.lat) : null
      const lng = typeof c === 'object' ? (c.longitude || c.lng) : null
      return new google.maps.LatLng(lat, lng)
    }).filter(Boolean)
    const polygon = new google.maps.Polygon({
      paths: path,
      strokeColor: "#9333ea",
      strokeOpacity: 0.8,
      strokeWeight: 3,
      fillColor: "#9333ea",
      fillOpacity: 0.35,
      editable: true,
      draggable: false,
      clickable: true,
      zIndex: 1000,
    });
    polygon.setMap(map);
    polygonRef.current = polygon;
    pathMarkersRef.current?.forEach(m => m.setMap(null));
    pathMarkersRef.current = []; // IMPORTANT: no circle markers — they block the drag handles

    let syncTimeout;
    const sync = () => {
      clearTimeout(syncTimeout);
      syncTimeout = setTimeout(() => {
        const p = polygon.getPath();
        const out = [];
        p.forEach(ll => out.push({ latitude: parseFloat(ll.lat().toFixed(6)), longitude: parseFloat(ll.lng().toFixed(6)) }));
        setCoordinates(out);
      }, 50);
    };
    const pp = polygon.getPath();
    google.maps.event.addListener(pp, 'set_at', sync);
    google.maps.event.addListener(pp, 'insert_at', sync);
    google.maps.event.addListener(pp, 'remove_at', sync);

    // Bind rightclick event to delete vertex
    google.maps.event.addListener(polygon, 'rightclick', (event) => {
      if (event.vertex !== undefined) {
        const p = polygon.getPath();
        if (p.getLength() > 3) {
          p.removeAt(event.vertex);
        } else {
          alert("A polygon must have at least 3 vertices.");
        }
      }
    });

    if (path.length > 0) {
      const bounds = new google.maps.LatLngBounds()
      path.forEach(latLng => bounds.extend(latLng))
      map.fitBounds(bounds)
    }
  };

  const drawExistingPolygon = (google, map, coords) => {
    if (!coords || coords.length < 3) return;
    if (polygonRef.current) polygonRef.current.setMap(null);
    pathMarkersRef.current?.forEach(m => m.setMap(null));
    drawEditablePolygon(google, map, coords);
  };

  const syncCircleState = useCallback(() => {
    if (!circleRef.current) return;
    const center = circleRef.current.getCenter();
    const radius = circleRef.current.getRadius();
    if (center) setCircleCenter({ lat: center.lat(), lng: center.lng() });
    if (Number.isFinite(radius)) setCircleRadiusMeters(String(Math.round(radius)));
  }, []);

  const drawEditableCircle = (google, map, center, radiusMeters) => {
    if (circleRef.current) { circleRef.current.setMap(null); circleRef.current = null; }
    circleListenersRef.current.forEach(l => google.maps.event.removeListener(l));
    circleListenersRef.current = [];
    
    const circle = new google.maps.Circle({
      center,
      radius: Number(radiusMeters) || 1000,
      fillColor: '#0f766e',
      strokeColor: '#0f766e',
      strokeWeight: 2,
      fillOpacity: 0.18,
      editable: true,
      draggable: true,
      zIndex: 1000
    });
    circle.setMap(map);
    circleRef.current = circle;
    
    circleListenersRef.current = [
      google.maps.event.addListener(circle, 'radius_changed', syncCircleState),
      google.maps.event.addListener(circle, 'center_changed', syncCircleState),
      google.maps.event.addListener(circle, 'dragend', syncCircleState)
    ];
    
    map.fitBounds(circle.getBounds());
  };

  const finishDrawing = () => {
    const google = window.google, map = mapInstanceRef.current;
    if (!google || !map) return false;

    const points = drawPointsRef.current;
    if (points.length < MIN_POINTS) {
      alert(`Please click at least ${MIN_POINTS} points on the map.`);
      return false;
    }

    if (polygonRef.current) { polygonRef.current.setMap(null); polygonRef.current = null; }
    pathMarkersRef.current?.forEach(m => m.setMap(null));
    pathMarkersRef.current = [];

    const ordered = points.length >= 3 
      ? orderPointsRadially(points) 
      : points.map(p => ({ lat: typeof p.lat === 'function' ? p.lat() : p.lat, lng: typeof p.lng === 'function' ? p.lng() : p.lng }));
    const coords = ordered.map(p => ({
      latitude: parseFloat(p.lat.toFixed(6)),
      longitude: parseFloat(p.lng.toFixed(6)),
    }));
    setCoordinates(coords);
    drawEditablePolygon(google, map, coords);
    return true;
  };

  const toggleDrawingMode = () => {
    const google = window.google, map = mapInstanceRef.current;
    if (!google || !map) { alert("Map is still loading."); return; }

    if (isDrawing) {
      if (finishDrawing() === false) return;
      isDrawingRef.current = false;
      setIsDrawing(false);
      map.setOptions({ draggableCursor: null });
      existingZonesPolygonsRef.current.forEach(p => p?.setOptions?.({ clickable: true }));
    } else {
      clearDrawing();
      drawPointsRef.current = [];
      isDrawingRef.current = true;
      setIsDrawing(true);
      map.setOptions({ draggableCursor: 'crosshair' });
      existingZonesPolygonsRef.current.forEach(p => p?.setOptions?.({ clickable: false }));
    }
  };

  const clearDrawing = () => {
    drawPointsRef.current = [];
    if (polygonRef.current) { polygonRef.current.setMap(null); polygonRef.current = null; }
    pathMarkersRef.current?.forEach(m => m.setMap(null));
    pathMarkersRef.current = [];
    if (circleRef.current) { circleRef.current.setMap(null); circleRef.current = null; }
    if (window.google) {
      circleListenersRef.current.forEach(l => window.google.maps.event.removeListener(l));
    }
    circleListenersRef.current = [];
    setCoordinates([]);
    setCircleCenter(null);
    setCircleRadiusMeters("");
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!formData.zoneName) {
      alert("Please enter a zone name")
      return
    }

    if (!formData.country) {
      alert("Please select a country")
      return
    }

    if (boundaryMode === 'polygon' && coordinates.length < 3) {
      alert("Please draw at least 3 points on the map to create a zone")
      return
    }

    if (boundaryMode === 'circle' && (!circleCenter || !circleRadiusMeters)) {
      alert("Please draw a circle on the map to create a zone")
      return
    }

    try {
      setLoading(true)

      // Ensure coordinates have correct format
      const validCoordinates = coordinates.map(coord => {
        if (typeof coord === 'object' && coord.latitude !== undefined && coord.longitude !== undefined) {
          return {
            latitude: parseFloat(coord.latitude),
            longitude: parseFloat(coord.longitude)
          }
        }
        return coord
      })

      const zoneData = {
        name: formData.zoneName,
        zoneName: formData.zoneName,
        country: formData.country,
        unit: formData.unit || "kilometer",
        boundary_mode: boundaryMode,
        coordinates: validCoordinates,
        isActive: true
      }
      
      if (boundaryMode === 'circle') {
        zoneData.circle_center = circleCenter;
        zoneData.circle_radius_meters = Number(circleRadiusMeters);
      }

      debugLog("Sending zone data:", zoneData)

      if (isEditMode && id) {
        // Update existing zone
        const response = await adminAPI.updateZone(id, zoneData)
        debugLog("Zone updated successfully:", response)
        alert("Zone updated successfully!")
      } else {
        // Create new zone
        const response = await adminAPI.createZone(zoneData)
        debugLog("Zone created successfully:", response)
        alert("Zone created successfully!")
      }
      navigate(`${zoneSetupBase()}`)
    } catch (error) {
      debugError("Error creating zone:", error)
      
      // Handle different types of errors
      let errorMessage = "Failed to create zone. Please try again."
      
      if (error.code === 'ERR_NETWORK' || error.message === 'Network Error' || !error.response) {
        // Network error - backend not running or CORS issue
        errorMessage = "Cannot connect to server. Please make sure the backend server is running."
        debugError("Network error: Backend server might not be running")
      } else if (error.response) {
        // API error with response
        errorMessage = error.response.data?.message || 
                      error.response.data?.error || 
                      error.message || 
                      `Server error: ${error.response.status}`
        debugError("API error:", error.response.data)
        debugError("Error status:", error.response.status)
      } else {
        // Other errors
        errorMessage = error.message || errorMessage
      }
      
      alert(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-4 lg:p-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={() => navigate(`${zoneSetupBase()}`)}
            className="p-2 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-500 flex items-center justify-center">
              <MapPin className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">
                {isEditMode ? "Edit Zone" : "Add New Zone"}
              </h1>
              <p className="text-sm text-slate-600">
                {isEditMode ? "Update delivery zone for customer" : "Create a delivery zone for customer"}
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left Panel - Form */}
            <div className="space-y-6">
              <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
                <h2 className="text-lg font-semibold text-slate-900 mb-4">Zone Details</h2>
                
                <div className="space-y-4">
                  {/* Country Selection */}
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      Country <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={formData.country}
                      onChange={(e) => handleInputChange("country", e.target.value)}
                      className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    >
                      <option value="India">India</option>
                    </select>
                  </div>

                  {/* Zone Name */}
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      Create Zone name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.zoneName}
                      onChange={(e) => handleInputChange("zoneName", e.target.value)}
                      placeholder="Enter zone name"
                      className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>

                  {/* Select Unit */}
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      Select Unit <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={formData.unit}
                      onChange={(e) => handleInputChange("unit", e.target.value)}
                      className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    >
                      <option value="kilometer">Kilometers (km)</option>
                      <option value="miles">Miles (mi)</option>
                    </select>
                  </div>

                  {/* Boundary Shape Selection */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Boundary Shape</label>
                    <div className="flex bg-slate-100 p-1 rounded-lg">
                      <button
                        type="button"
                        onClick={() => {
                          setBoundaryMode('polygon')
                          clearDrawing()
                        }}
                        className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                          boundaryMode === 'polygon'
                            ? 'bg-white text-blue-600 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Polygon Boundary
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setBoundaryMode('circle')
                          clearDrawing()
                        }}
                        className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                          boundaryMode === 'circle'
                            ? 'bg-white text-blue-600 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Circle Radius
                      </button>
                    </div>
                  </div>

                  {boundaryMode === 'circle' && (
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Circle Boundary Radius (meters)
                      </label>
                      <input
                        type="number"
                        min="10"
                        value={circleRadiusMeters}
                        onChange={(e) => {
                          setCircleRadiusMeters(e.target.value);
                          if (circleRef.current) {
                            circleRef.current.setRadius(Number(e.target.value) || 1000);
                          }
                        }}
                        className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="e.g., 1000"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Right Panel - Map */}
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-slate-900">Draw Zone on Map</h2>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleDrawingMode}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                      isDrawing
                        ? "bg-red-600 text-white hover:bg-red-700"
                        : "bg-blue-600 text-white hover:bg-blue-700"
                    }`}
                  >
                    <Shapes className="w-4 h-4" />
                    <span>{isDrawing ? "Finish Drawing" : "Start Drawing"}</span>
                  </button>
                  {(coordinates.length > 0 || circleCenter) && (
                    <button
                      type="button"
                      onClick={clearDrawing}
                      className="flex items-center gap-2 px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700 transition-colors"
                    >
                      <X className="w-4 h-4" />
                      <span>Clear</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="mb-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    ref={autocompleteInputRef}
                    type="text"
                    placeholder="Search location on map..."
                    value={locationSearch}
                    onChange={(e) => handleLocationSearchChange(e.target.value)}
                    onFocus={() => setShowSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 120)}
                    className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {showSuggestions && searchSuggestions.length > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-1 max-h-60 overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg z-[999999]">
                      {searchSuggestions.map((suggestion) => (
                        <button
                          key={suggestion.place_id}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => handleSuggestionSelect(suggestion)}
                          className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
                        >
                          {suggestion.description}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {isDrawing && boundaryMode === 'polygon' && (
                  <p className="text-xs text-slate-600 mt-2">
                    Click on the map to add points (minimum {MIN_POINTS}), then click <b>Finish Drawing</b>.
                  </p>
                )}
                {isDrawing && boundaryMode === 'circle' && (
                  <p className="text-xs text-slate-600 mt-2">
                    Click on the map to place the center of the circle.
                  </p>
                )}
                {!isDrawing && boundaryMode === 'polygon' && coordinates.length > 0 && (
                  <p className="text-xs text-slate-600 mt-2">
                    Points drawn: <strong>{coordinates.length}</strong>
                  </p>
                )}
                {!isDrawing && boundaryMode === 'circle' && circleCenter && (
                  <p className="text-xs text-slate-600 mt-2">
                    Circle center set. You can drag to move it or use handles to resize.
                  </p>
                )}
              </div>

              <div className="relative" style={{ height: "600px" }}>
                <div ref={mapRef} className="w-full h-full rounded-lg" />
                
                {mapLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-100 rounded-lg">
                    <div className="text-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
                      <p className="text-slate-600">Loading map...</p>
                    </div>
                  </div>
                )}

                {!googleMapsApiKey && !mapLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-100 rounded-lg">
                    <div className="text-center p-6">
                      <MapPin className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                      <p className="text-sm text-slate-600">Google Maps API key not found</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-3 mt-6">
            <button
              type="button"
              onClick={() => navigate(`${zoneSetupBase()}`)}
              className="px-6 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                loading || 
                (boundaryMode === 'polygon' ? coordinates.length < 3 : !circleCenter) || 
                !formData.zoneName || 
                !formData.country
              }
              className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>Save Zone</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}



