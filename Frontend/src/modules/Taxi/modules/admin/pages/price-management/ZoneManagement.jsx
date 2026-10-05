import React, { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate, useParams } from "react-router-dom";
import {
  Search,
  Plus,
  Edit2,
  Trash2,
  Navigation,
  Loader2,
  ChevronRight,
  Target,
  Zap,
  Tag,
  Save,
  ArrowLeft,
  Maximize2,
  Map as MapIcon,
  Globe,
  Info,
  Layers,
  MousePointer2,
  X,
  Shapes
} from "lucide-react";
import {
  GoogleMap,
  Circle,
  Polygon,
  Autocomplete,
} from "@react-google-maps/api";
import { useAppGoogleMapsLoader } from "../../utils/googleMaps";
import { adminService } from "../../services/adminService";
import { describeApiError } from '../../../../shared/utils/apiError';
import {
  buildCountryBoundaryUrl,
  normalizeBoundaryRings,
  isDriverAvailable,
} from "../../utils/mapUtils";

const inputClass = "w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm text-gray-800 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-colors";
const labelClass = "block text-xs font-semibold text-gray-500 mb-1.5";
const cardClass = "bg-white rounded-xl border border-gray-200 p-6 shadow-sm";
const ADMIN_LANGUAGE_OPTIONS = ['English', 'Hindi', 'Arabic', 'French', 'Spanish'];



const ZoneManagement = ({ mode: initialMode = "list" }) => {
  const navigate = useNavigate();
  const { id } = useParams();
  const [view, setView] = useState(initialMode);
  const [zones, setZones] = useState([]);
  const [serviceLocations, setServiceLocations] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [saving, setSaving] = useState(false);
  const [enablePeakZoneGlobal, setEnablePeakZoneGlobal] = useState(true);
  const [editingId, setEditingId] = useState(id || null);
  const [mapCenter, setMapCenter] = useState({ lat: 21.1458, lng: 79.0882 }); 
  const [zoom, setZoom] = useState(12);
  const [autocomplete, setAutocomplete] = useState(null);
  // Its own instance: this one adds a landmark rather than moving the map.
  const [placeAutocomplete, setPlaceAutocomplete] = useState(null);
  const [uploadingPlaceIndex, setUploadingPlaceIndex] = useState(null);
  const [countryBoundaryPaths, setCountryBoundaryPaths] = useState([]);
  const [boundaryLoading, setBoundaryLoading] = useState(false);
  const mapRef = useRef(null);
  const polygonRef = useRef(null);
  const polygonListenersRef = useRef([]);
  const circleRef = useRef(null);
  const circleListenersRef = useRef([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('English');

  // Map & Drawing States
  const [boundaryMode, setBoundaryMode] = useState('polygon');
  const [polygonCoords, setPolygonCoords] = useState([]);
  const [circleCenter, setCircleCenter] = useState(null);
  const [circleRadiusMeters, setCircleRadiusMeters] = useState('');
  const { isLoaded, loadError } = useAppGoogleMapsLoader();

  // Form State
  const [formData, setFormData] = useState({
    service_location_id: '',
    name: { English: '', Hindi: '', Arabic: '', French: '', Spanish: '' },
    unit: '',
    peak_zone_ride_count: '',
    peak_zone_radius: '',
    peak_zone_selection_duration: '',
    peak_zone_duration: '',
    peak_zone_surge_percentage: '',
    ride_surge_enabled: false,
    maximum_distance_for_regular_rides: '',
    maximum_distance_for_outstation_rides: '',
    popular_places: [],
    status: 'active'
  });

  useEffect(() => {
    setView(initialMode);
    if (initialMode === 'list') {
      resetForm();
    }
  }, [initialMode]);

  const fetchData = async () => {
    setLoading(true);
    setFetchError('');
    try {
      const [zoneRes, slRes, driverRes] = await Promise.all([
        adminService.getZones(),
        adminService.getServiceLocations(),
        adminService.getDrivers(1, 200),
      ]);

      if (zoneRes) {
        const zoneData = zoneRes.success ? (zoneRes.data?.results || zoneRes.data) : zoneRes;
        setZones(Array.isArray(zoneData) ? zoneData : []);
      }

      if (slRes) {
        const locs = slRes.success ? (slRes.data?.results || slRes.data) : slRes;
        setServiceLocations(Array.isArray(locs) ? locs : []);
      }

      if (driverRes) {
        const driverItems = driverRes.success ? (driverRes.data?.results || driverRes.data) : driverRes;
        setDrivers(Array.isArray(driverItems) ? driverItems : []);
      }

      if (id && initialMode === 'edit') {
        const zoneToEdit = Array.isArray(zoneData) && zoneData.find(z => (z._id || z.id) === id);
        if (zoneToEdit) handleEdit(zoneToEdit);
      }
    } catch (err) {
      console.error("Fetch error:", err);
      setFetchError(describeApiError(err, 'Zone data could not be loaded.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (id && zones.length > 0 && initialMode === 'edit') {
      const zoneToEdit = zones.find(z => (z._id || z.id) === id);
      if (zoneToEdit) handleEdit(zoneToEdit);
    }
  }, [id, zones]);

  const filteredZones = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return zones;
    return zones.filter(z => (z.name || z.zone_name || '').toLowerCase().includes(query));
  }, [zones, searchTerm]);

  const fitMapToPaths = (paths) => {
    if (!mapRef.current || !window.google || !Array.isArray(paths) || paths.length === 0) {
      return;
    }
    const bounds = new window.google.maps.LatLngBounds();
    let hasPoint = false;
    paths.forEach((ring) => {
      ring.forEach((point) => {
        if (Number.isFinite(point?.lat) && Number.isFinite(point?.lng)) {
          bounds.extend(point);
          hasPoint = true;
        }
      });
    });
    if (hasPoint) {
      mapRef.current.fitBounds(bounds, 40);
    }
  };

  const isDrawingRef = useRef(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const drawPointsRef = useRef([]);
  const pathMarkersRef = useRef([]);
  const initialDrawDoneRef = useRef(false);
  const boundaryModeRef = useRef(boundaryMode);

  useEffect(() => {
    boundaryModeRef.current = boundaryMode;
  }, [boundaryMode]);

  const orderPointsRadially = (pts) => {
    const points = pts
      .map(p => {
        const lat = typeof p.lat === 'function' ? p.lat() : p.lat;
        const lng = typeof p.lng === 'function' ? p.lng() : p.lng;
        return { lat, lng };
      })
      .filter(p => typeof p.lat === 'number' && typeof p.lng === 'number');

    if (points.length < 3) return points;

    const cx = points.reduce((s, p) => s + p.lng, 0) / points.length;
    const cy = points.reduce((s, p) => s + p.lat, 0) / points.length;

    return [...points].sort((a, b) =>
      Math.atan2(a.lat - cy, a.lng - cx) - Math.atan2(b.lat - cy, b.lng - cx)
    );
  };

  const renderVertexMarkers = (google, map, latLngs) => {
    pathMarkersRef.current?.forEach(m => m.setMap(null));
    pathMarkersRef.current = latLngs.map((latLng, i) => {
      const marker = new google.maps.Marker({
        position: latLng,
        map,
        draggable: true,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: "#4f46e5",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
        zIndex: 1000,
        title: `Point ${i + 1}`,
      });

      google.maps.event.addListener(marker, 'drag', () => {
        drawPointsRef.current[i] = marker.getPosition();
        const ordered = drawPointsRef.current.length >= 3
          ? orderPointsRadially(drawPointsRef.current)
          : drawPointsRef.current.map(p => ({
              lat: typeof p.lat === 'function' ? p.lat() : p.lat,
              lng: typeof p.lng === 'function' ? p.lng() : p.lng
            }));
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

        setPolygonCoords(ordered.map(p => ({
          lat: parseFloat(p.lat.toFixed(6)),
          lng: parseFloat(p.lng.toFixed(6)),
        })));

        renderVertexMarkers(google, map, drawPointsRef.current);
      });

      return marker;
    });
  };

  const renderDrawingPolygon = (google, map) => {
    const points = drawPointsRef.current;
    if (polygonRef.current) {
      polygonRef.current.setMap(null);
      polygonRef.current = null;
    }

    const ordered = points.length >= 3 
      ? orderPointsRadially(points) 
      : points.map(p => ({
          lat: typeof p.lat === 'function' ? p.lat() : p.lat,
          lng: typeof p.lng === 'function' ? p.lng() : p.lng
        }));

    if (ordered.length >= 2) {
      polygonRef.current = new google.maps.Polygon({
        paths: ordered,
        fillColor: "#4f46e5",
        fillOpacity: 0.25,
        strokeColor: "#4f46e5",
        strokeWeight: 2,
        clickable: false,
        editable: false,
        zIndex: 1,
      });
      polygonRef.current.setMap(map);
    }

    renderVertexMarkers(google, map, points);
    setPolygonCoords(ordered.map(p => ({
      lat: parseFloat(p.lat.toFixed(6)),
      lng: parseFloat(p.lng.toFixed(6)),
    })));
  };

  const drawEditablePolygon = (google, map, coords) => {
    const path = coords.map(c => {
      const lat = typeof c === 'object' ? (c.lat) : null;
      const lng = typeof c === 'object' ? (c.lng) : null;
      return new google.maps.LatLng(lat, lng);
    }).filter(Boolean);
    
    const polygon = new google.maps.Polygon({
      paths: path,
      strokeColor: "#4f46e5",
      strokeOpacity: 0.8,
      strokeWeight: 3,
      fillColor: "#4f46e5",
      fillOpacity: 0.25,
      editable: true,
      draggable: false,
      clickable: true,
      zIndex: 1000,
    });
    polygon.setMap(map);
    polygonRef.current = polygon;
    pathMarkersRef.current?.forEach(m => m.setMap(null));
    pathMarkersRef.current = [];

    let syncTimeout;
    const sync = () => {
      clearTimeout(syncTimeout);
      syncTimeout = setTimeout(() => {
        const p = polygon.getPath();
        const out = [];
        p.forEach(ll => out.push({
          lat: parseFloat(ll.lat().toFixed(6)),
          lng: parseFloat(ll.lng().toFixed(6))
        }));
        setPolygonCoords(out);
      }, 50);
    };
    
    const pp = polygon.getPath();
    google.maps.event.addListener(pp, 'set_at', sync);
    google.maps.event.addListener(pp, 'insert_at', sync);
    google.maps.event.addListener(pp, 'remove_at', sync);

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
      const bounds = new google.maps.LatLngBounds();
      path.forEach(latLng => bounds.extend(latLng));
      map.fitBounds(bounds);
    }
  };

  const drawExistingPolygon = (google, map, coords) => {
    if (!coords || coords.length < 3) return;
    if (polygonRef.current) polygonRef.current.setMap(null);
    pathMarkersRef.current?.forEach(m => m.setMap(null));
    drawEditablePolygon(google, map, coords);
  };

  const finishDrawing = () => {
    const google = window.google, map = mapRef.current;
    if (!google || !map) return false;

    const points = drawPointsRef.current;
    if (points.length < 3) {
      alert("Please click at least 3 points on the map.");
      return false;
    }

    if (polygonRef.current) {
      polygonRef.current.setMap(null);
      polygonRef.current = null;
    }
    pathMarkersRef.current?.forEach(m => m.setMap(null));
    pathMarkersRef.current = [];

    const ordered = points.length >= 3 
      ? orderPointsRadially(points) 
      : points.map(p => ({
          lat: typeof p.lat === 'function' ? p.lat() : p.lat,
          lng: typeof p.lng === 'function' ? p.lng() : p.lng
        }));
    const coords = ordered.map(p => ({
      lat: parseFloat(p.lat.toFixed(6)),
      lng: parseFloat(p.lng.toFixed(6)),
    }));
    setPolygonCoords(coords);
    drawEditablePolygon(google, map, coords);
    return true;
  };

  const toggleDrawingMode = () => {
    const google = window.google, map = mapRef.current;
    if (!google || !map) {
      alert("Map is still loading.");
      return;
    }

    if (isDrawing) {
      if (finishDrawing() === false) return;
      isDrawingRef.current = false;
      setIsDrawing(false);
      map.setOptions({ draggableCursor: null });
    } else {
      clearDrawing();
      drawPointsRef.current = [];
      isDrawingRef.current = true;
      setIsDrawing(true);
      map.setOptions({ draggableCursor: 'crosshair' });
    }
  };

  const clearDrawing = () => {
    drawPointsRef.current = [];
    if (polygonRef.current) {
      polygonRef.current.setMap(null);
      polygonRef.current = null;
    }
    if (circleRef.current) {
      circleRef.current.setMap(null);
      circleRef.current = null;
    }
    pathMarkersRef.current?.forEach(m => m.setMap(null));
    pathMarkersRef.current = [];
    setPolygonCoords([]);
    setCircleCenter(null);
    setCircleRadiusMeters('');
    initialDrawDoneRef.current = false;
    isDrawingRef.current = false;
    setIsDrawing(false);
    if (mapRef.current) {
      mapRef.current.setOptions({ draggableCursor: null });
    }
  };

  const handleMapClick = (event) => {
    const google = window.google;
    const map = mapRef.current;
    if (!google || !map) return;

    if (!isDrawingRef.current) return;

    if (boundaryModeRef.current === 'circle') {
      const lat = event.latLng.lat();
      const lng = event.latLng.lng();
      setCircleCenter({ lat, lng });
      setCircleRadiusMeters("1000");
      setIsDrawing(false);
      isDrawingRef.current = false;
      map.setOptions({ draggableCursor: null });
    } else {
      drawPointsRef.current.push(event.latLng);
      renderDrawingPolygon(google, map);
    }
  };

  const syncPolygonState = () => {
    const polygon = polygonRef.current;
    if (!polygon) {
      return polygonCoords;
    }

    const nextCoords = polygon
      .getPath()
      .getArray()
      .map((point) => ({
        lat: point.lat(),
        lng: point.lng(),
      }));

    setPolygonCoords(nextCoords);
    return nextCoords;
  };

  const syncCircleState = () => {
    const circle = circleRef.current;
    if (!circle) {
      return {
        center: circleCenter,
        radiusMeters: circleRadiusMeters,
      };
    }

    const center = circle.getCenter();
    const radius = circle.getRadius();
    const nextCenter = center
      ? {
          lat: center.lat(),
          lng: center.lng(),
        }
      : circleCenter;
    const nextRadiusMeters = Number.isFinite(radius)
      ? String(Math.round(radius))
      : circleRadiusMeters;

    setCircleCenter(nextCenter);
    setCircleRadiusMeters(nextRadiusMeters);

    return {
      center: nextCenter,
      radiusMeters: nextRadiusMeters,
    };
  };

  useEffect(() => () => {
    polygonListenersRef.current.forEach((listener) => listener?.remove?.());
    polygonListenersRef.current = [];
    if (polygonRef.current) {
      polygonRef.current.setMap(null);
      polygonRef.current = null;
    }
    pathMarkersRef.current?.forEach(m => m.setMap(null));
    pathMarkersRef.current = [];
    circleListenersRef.current.forEach((listener) => listener?.remove?.());
    circleListenersRef.current = [];
    circleRef.current = null;
  }, []);

  /**
   * Adds whatever the admin picked from the landmark search.
   *
   * Silently ignores a selection with no geometry -- that is what comes
   * back when the admin presses Enter on their own text instead of
   * choosing a suggestion, and it carries no coordinates to book to.
   */
  const onPopularPlaceChanged = () => {
    if (!placeAutocomplete) return;
    const place = placeAutocomplete.getPlace();
    if (!place?.geometry?.location) return;

    const entry = {
      name: place.name || place.formatted_address || '',
      address: place.formatted_address || '',
      image: '',
      location: {
        lat: place.geometry.location.lat(),
        lng: place.geometry.location.lng(),
      },
      active: true,
    };

    setFormData((prev) => ({
      ...prev,
      popular_places: [...(prev.popular_places || []), entry],
    }));
  };

  const updatePopularPlace = (index, patch) => {
    setFormData((prev) => ({
      ...prev,
      popular_places: (prev.popular_places || []).map((place, i) =>
        i === index ? { ...place, ...patch } : place,
      ),
    }));
  };

  const removePopularPlace = (index) => {
    setFormData((prev) => ({
      ...prev,
      popular_places: (prev.popular_places || []).filter((_, i) => i !== index),
    }));
  };

  const uploadPopularPlaceImage = async (index, file) => {
    if (!file) return;
    setUploadingPlaceIndex(index);
    const reader = new FileReader();
    reader.onloadend = async () => {
      try {
        const res = await adminService.uploadImage(reader.result);
        const url = res?.data?.url || res?.url;
        if (url) updatePopularPlace(index, { image: url });
        else alert('Upload failed. Please try again.');
      } catch (err) {
        alert(describeApiError(err, 'Could not upload the image.'));
      } finally {
        setUploadingPlaceIndex(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const onPlaceChanged = () => {
    if (autocomplete !== null) {
      const place = autocomplete.getPlace();
      if (place.geometry) {
        const loc = {
          lat: place.geometry.location.lat(),
          lng: place.geometry.location.lng()
        };
        setMapCenter(loc);
        if (place.geometry.viewport) {
          mapRef.current?.fitBounds(place.geometry.viewport);
        } else {
          mapRef.current?.panTo(loc);
          setZoom(16);
        }
      }
    }
  };

  const handleSave = async () => {
    const syncedPolygonCoords = boundaryMode === 'polygon' ? syncPolygonState() : polygonCoords;
    const syncedCircle = boundaryMode === 'circle'
      ? syncCircleState()
      : { center: circleCenter, radiusMeters: circleRadiusMeters };
    const effectiveCircleCenter = syncedCircle?.center || circleCenter;
    const effectiveCircleRadiusMeters = syncedCircle?.radiusMeters || circleRadiusMeters;

    const hasPolygon = boundaryMode === 'polygon' && syncedPolygonCoords.length >= 3;
    const hasCircle =
      boundaryMode === 'circle' &&
      Number(effectiveCircleRadiusMeters) > 0 &&
      Number.isFinite(Number(effectiveCircleCenter?.lat)) &&
      Number.isFinite(Number(effectiveCircleCenter?.lng));

    if (!formData.name.English.trim() || (!hasPolygon && !hasCircle)) {
      alert("Please add a zone name and draw a polygon or circle boundary on the map.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...formData,
        boundary_mode: boundaryMode,
        coordinates: boundaryMode === 'polygon' ? syncedPolygonCoords : undefined,
        circle_center: boundaryMode === 'circle' ? effectiveCircleCenter : undefined,
        circle_radius_meters: boundaryMode === 'circle' ? Number(effectiveCircleRadiusMeters) : undefined,
        name: formData.name.English
      };
      const res = editingId 
        ? await adminService.updateZone(editingId, payload)
        : await adminService.createZone(payload);
      if (res.success) {
        resetForm();
        navigate("/taxi/admin/pricing/zone");
        fetchData();
      } else {
        alert(res.message || "Operation failed");
      }
    } catch (err) {
      console.error("Save error:", err);
      alert(describeApiError(err, "Could not save the zone. Please try again."));
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setEditingId(null);
    setFormData({
      service_location_id: '',
      name: { English: '', Hindi: '', Arabic: '', French: '', Spanish: '' },
      unit: '',
      peak_zone_ride_count: '',
      peak_zone_radius: '',
      peak_zone_selection_duration: '',
      peak_zone_duration: '',
      peak_zone_surge_percentage: '',
      ride_surge_enabled: false,
      maximum_distance_for_regular_rides: '',
      maximum_distance_for_outstation_rides: '',
      popular_places: [],
      status: 'active'
    });
    setBoundaryMode('polygon');
    setPolygonCoords([]);
    setCircleCenter(null);
    setCircleRadiusMeters('');
    setCountryBoundaryPaths([]);

    // Clear manual drawing state/overlays:
    isDrawingRef.current = false;
    setIsDrawing(false);
    drawPointsRef.current = [];
    initialDrawDoneRef.current = false;
    if (polygonRef.current) {
      polygonRef.current.setMap(null);
      polygonRef.current = null;
    }
    pathMarkersRef.current?.forEach(m => m.setMap(null));
    pathMarkersRef.current = [];
    if (mapRef.current) {
      mapRef.current.setOptions({ draggableCursor: null });
    }
  };

  const handleStatusToggle = async (zoneId, currentIsActive) => {
    try {
      const res = await adminService.toggleZoneStatus(zoneId);
      if (res.success) {
        setZones(prev => prev.map(z => (z._id === zoneId || z.id === zoneId) ? { ...z, active: !currentIsActive } : z));
      }
    } catch (err) {
      console.error("Status update error:", err);
      // Was silent: with an expired session the toggle simply did nothing, and
      // the admin had no way to tell that from a zone that would not change.
      alert(describeApiError(err, "Could not change that zone's status."));
    }
  };

  const handleDelete = async (zoneId) => {
    if (!window.confirm("Are you sure?")) return;
    try {
      const res = await adminService.deleteZone(zoneId);
      if (res.success) {
        setZones(prev => prev.filter(z => (z._id !== zoneId && z.id !== zoneId)));
      }
    } catch (err) {
      console.error("Delete error:", err);
      alert(describeApiError(err, 'Could not delete that zone.'));
    }
  };

  const handleEdit = (zone) => {
    // Clear manual drawing state/overlays first
    isDrawingRef.current = false;
    setIsDrawing(false);
    drawPointsRef.current = [];
    initialDrawDoneRef.current = false;
    if (polygonRef.current) {
      polygonRef.current.setMap(null);
      polygonRef.current = null;
    }
    pathMarkersRef.current?.forEach(m => m.setMap(null));
    pathMarkersRef.current = [];
    if (mapRef.current) {
      mapRef.current.setOptions({ draggableCursor: null });
    }

    const zid = zone._id || zone.id;
    setEditingId(zid);
    const localizedNames = typeof zone.name === 'object' && zone.name !== null ? zone.name : {};
    let zoneName = typeof zone.name === 'string' ? zone.name : (localizedNames.English || zone.zone_name || '');
    setFormData({
      service_location_id: zone.service_location_id || '',
      name: {
        English: zoneName,
        Hindi: localizedNames.Hindi || '',
        Arabic: localizedNames.Arabic || '',
        French: localizedNames.French || '',
        Spanish: localizedNames.Spanish || '',
      },
      unit: zone.unit || '',
      peak_zone_ride_count: zone.peak_zone_ride_count || '',
      peak_zone_radius: zone.peak_zone_radius || '',
      peak_zone_selection_duration: zone.peak_zone_selection_duration || '',
      peak_zone_duration: zone.peak_zone_duration || '',
      peak_zone_surge_percentage: zone.peak_zone_surge_percentage || '',
      ride_surge_enabled: zone.ride_surge_enabled === true,
      maximum_distance_for_regular_rides: zone.maximum_distance_for_regular_rides || '',
      maximum_distance_for_outstation_rides: zone.maximum_distance_for_outstation_rides || '',
      popular_places: Array.isArray(zone.popular_places) ? zone.popular_places : [],
      status: zone.active ? 'active' : 'inactive'
    });
    let parsedCoords = [];
    if (Array.isArray(zone.coordinates)) {
      parsedCoords = zone.coordinates.map(coord => {
        if (Array.isArray(coord)) return { lat: coord[1], lng: coord[0] };
        if (coord && typeof coord === 'object') return { lat: Number(coord.lat || coord.latitude), lng: Number(coord.lng || coord.longitude) };
        return coord;
      });
    }
    if (parsedCoords.length > 0) setMapCenter(parsedCoords[0]);
    const nextBoundaryMode = zone.boundary_mode === 'circle' ? 'circle' : 'polygon';
    setBoundaryMode(nextBoundaryMode);
    setPolygonCoords(parsedCoords);
    setCircleCenter(
      zone.circle_center && Number.isFinite(Number(zone.circle_center?.lat)) && Number.isFinite(Number(zone.circle_center?.lng))
        ? {
            lat: Number(zone.circle_center.lat),
            lng: Number(zone.circle_center.lng),
          }
        : null,
    );
    setCircleRadiusMeters(
      zone.circle_radius_meters !== null && zone.circle_radius_meters !== undefined
        ? String(zone.circle_radius_meters)
        : '',
    );
  };

  const handleExplore = (zone) => {
    handleEdit(zone);
    setView('form');
  };

  const selectedServiceLocation = serviceLocations.find(l => String(l._id || l.id) === String(formData.service_location_id));
  const selectedCountry = selectedServiceLocation?.country || selectedServiceLocation?.name || '';

  useEffect(() => {
    if (view === 'list' || !selectedCountry) return;
    let cancelled = false;
    const loadCountryBoundary = async () => {
      setBoundaryLoading(true);
      try {
        const response = await fetch(buildCountryBoundaryUrl(selectedCountry));
        if (!response.ok) throw new Error();
        const payload = await response.json();
        const feature = Array.isArray(payload) ? payload[0] : null;
        const nextPaths = normalizeBoundaryRings(feature?.geojson);
        if (!cancelled) {
          setCountryBoundaryPaths(nextPaths);
          if (nextPaths.length > 0) fitMapToPaths(nextPaths);
        }
      } catch (error) {
        if (!cancelled) setCountryBoundaryPaths([]);
      } finally {
        if (!cancelled) setBoundaryLoading(false);
      }
    };
    loadCountryBoundary();
    return () => { cancelled = true; };
  }, [selectedCountry, view]);

  useEffect(() => {
    if (editingId && boundaryMode === 'polygon' && polygonCoords.length >= 3 && mapRef.current && window.google && !initialDrawDoneRef.current) {
      initialDrawDoneRef.current = true;
      setTimeout(() => {
        if (mapRef.current && window.google) {
          isDrawingRef.current = false;
          setIsDrawing(false);
          mapRef.current.setOptions({ draggableCursor: null });
          drawExistingPolygon(window.google, mapRef.current, polygonCoords);
        }
      }, 500);
    }
  }, [editingId, boundaryMode, polygonCoords.length, isLoaded]);

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-8 animate-in fade-in duration-500">
      <AnimatePresence mode="wait">
        {view === 'list' ? (
          <motion.div 
            key="list" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="max-w-7xl mx-auto space-y-6"
          >
            <div className="mb-6">
              <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
                <span>Pricing</span>
                <ChevronRight size={12} />
                <span className="text-gray-700">Zone Management</span>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-xl font-semibold text-gray-900">Zone Management</h1>
                  <p className="text-xs text-gray-400 mt-1">Configure geofenced boundaries for operational control.</p>
                </div>
                <button 
                  onClick={() => navigate("create")}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors shadow-sm"
                >
                  <Plus size={16} /> Add Market Zone
                </button>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-6 flex items-center justify-between shadow-sm">
               <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${enablePeakZoneGlobal ? 'bg-amber-50 text-amber-600' : 'bg-gray-50 text-gray-300'}`}>
                     <Zap size={20} className={enablePeakZoneGlobal ? 'animate-pulse' : ''} />
                  </div>
                  <div>
                     <h3 className="text-sm font-semibold text-gray-900">Dynamic Peak Pricing</h3>
                     <p className="text-[11px] text-gray-400">Toggle surge modifiers across all zones globally</p>
                  </div>
               </div>
               <button 
                 onClick={() => setEnablePeakZoneGlobal(!enablePeakZoneGlobal)}
                 className={`relative w-11 h-6 rounded-full transition-colors ${enablePeakZoneGlobal ? 'bg-indigo-600' : 'bg-gray-200'}`}
               >
                 <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${enablePeakZoneGlobal ? 'translate-x-5' : ''}`} />
               </button>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
              <div className="p-4 border-b border-gray-100 bg-gray-50/50">
                <div className="relative w-full max-w-sm">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input 
                    type="text" 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search zones..." 
                    className="w-full pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-all font-medium"
                  />
                </div>
              </div>

              <div className="overflow-x-auto">
                {loading ? (
                  <div className="flex flex-col items-center justify-center py-20">
                    <Loader2 className="animate-spin text-indigo-600 mb-2" size={32} />
                    <p className="text-xs text-gray-400 font-medium">Loading data...</p>
                  </div>
                ) : filteredZones.length > 0 ? (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50/50 border-b border-gray-100">
                        <th className="px-6 py-3.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest">S.No</th>
                        <th className="px-6 py-3.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest">Market Zone Identity</th>
                        <th className="px-6 py-3.5 text-center text-[10px] font-bold text-gray-400 uppercase tracking-widest">Status</th>
                        <th className="px-6 py-3.5 text-right text-[10px] font-bold text-gray-400 uppercase tracking-widest">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredZones.map((zone, idx) => (
                        <tr key={zone._id || zone.id} className="hover:bg-gray-50/50 transition-colors group">
                          <td className="px-6 py-4 whitespace-nowrap text-xs font-bold text-gray-400">{(idx + 1).toString().padStart(2, '0')}</td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600 shadow-sm border border-indigo-100/50 transition-transform group-hover:scale-105">
                                <Target size={16} />
                              </div>
                              <span className="font-semibold text-gray-900">{zone.name || zone.zone_name}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-center">
                            <button 
                               onClick={() => handleStatusToggle(zone._id || zone.id, zone.active)} 
                               className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${zone.active ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-gray-50 text-gray-400 border border-gray-200'}`}
                            >
                               {zone.active ? 'Active' : 'Inactive'}
                            </button>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right">
                            <div className="flex items-center justify-end gap-2">
                               <button onClick={() => navigate(`edit/${zone._id || zone.id}`)} className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"><Edit2 size={14} /></button>
                               <button onClick={() => handleDelete(zone._id || zone.id)} className="p-2 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"><Trash2 size={14} /></button>
                               <button
                                 onClick={() => handleExplore(zone)}
                                 title="Explore Zone"
                                 className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                               >
                                 <Globe size={14} />
                               </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="py-20 text-center">
                    <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center text-gray-200 mx-auto mb-4"><Navigation size={32} /></div>
                    <h3 className="text-sm font-semibold text-gray-900 mb-1">No Zones Configured</h3>
                    <p className="text-xs text-gray-400 max-w-xs mx-auto">Map your operational sector boundaries to initiate geofencing.</p>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div 
            key="form" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
            className="max-w-7xl mx-auto space-y-6 pb-20"
          >
            <div className="mb-6">
              <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
                <span>Pricing</span>
                <ChevronRight size={12} />
                <span>Zone Management</span>
                <ChevronRight size={12} />
                <span className="text-gray-700">{editingId ? 'Edit' : 'Create'}</span>
              </div>
              <div className="flex items-center justify-between">
                <h1 className="text-xl font-semibold text-gray-900">{editingId ? 'Edit Market Zone' : 'Add Market Zone'}</h1>
                <button 
                  onClick={() => navigate("/taxi/admin/pricing/zone")}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
                >
                  <ArrowLeft size={14} /> Back
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
              {/* Form Section */}
              <div className="xl:col-span-4 space-y-6">
                <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                   <div className="flex items-center gap-3 mb-6 pb-4 border-b border-gray-100">
                      <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600">
                        <Tag size={18} />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900">Zone Identity</h3>
                        <p className="text-xs text-gray-400">Basic identification settings</p>
                      </div>
                   </div>
                   
                   <div className="space-y-5">
                      <div>
                        <label className={labelClass}>Service Location</label>
                        <select 
                          value={formData.service_location_id}
                          onChange={(e) => {
                            const nextId = e.target.value;
                            setFormData({...formData, service_location_id: nextId});
                            const loc = serviceLocations.find(l => String(l._id || l.id) === String(nextId));
                            if (loc?.latitude) {
                              const center = { lat: Number(loc.latitude), lng: Number(loc.longitude) };
                              setMapCenter(center);
                              mapRef.current?.panTo(center);
                            }
                          }}
                          className={inputClass}
                        >
                          <option value="">Select Service Location</option>
                          {serviceLocations.map(sl => (
                            <option key={sl._id || sl.id} value={sl._id || sl.id}>{sl.name || sl.service_location_name}</option>
                          ))}
                        </select>
                      </div>

                      <div className={`rounded-[26px] border p-5 transition-all ${
                        formData.ride_surge_enabled
                          ? 'border-emerald-200 bg-[linear-gradient(135deg,rgba(236,253,245,0.92),rgba(255,255,255,1))] shadow-[0_12px_30px_rgba(15,118,110,0.08)]'
                          : 'border-slate-200 bg-white'
                      }`}>
                        <div className="flex items-start gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0 flex-1 pr-1">
                                <p className="text-[15px] font-semibold leading-6 text-slate-900">
                                  Zone Ride Surge
                                </p>
                                <p className="mt-1 max-w-[220px] text-xs leading-5 text-slate-500">
                                  Add vehicle surge for rides picked up in this zone.
                                </p>
                              </div>

                              <button
                                type="button"
                                aria-pressed={formData.ride_surge_enabled}
                                onClick={() => setFormData((prev) => ({ ...prev, ride_surge_enabled: !prev.ride_surge_enabled }))}
                                className={`relative inline-flex h-8 w-14 shrink-0 self-start rounded-full border transition-all duration-200 ${
                                  formData.ride_surge_enabled
                                    ? 'border-emerald-500 bg-emerald-500 shadow-[0_10px_24px_rgba(16,185,129,0.24)]'
                                    : 'border-slate-200 bg-slate-200'
                                }`}
                              >
                                <span
                                  className={`inline-block h-6 w-6 rounded-full bg-white shadow-[0_3px_8px_rgba(15,23,42,0.18)] transition-transform duration-200 ${
                                    formData.ride_surge_enabled ? 'translate-x-7' : 'translate-x-1'
                                  }`}
                                />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center gap-1 border-b border-gray-100 mb-4">
                          {ADMIN_LANGUAGE_OPTIONS.map(lang => (
                            <button
                              key={lang}
                              onClick={() => setActiveTab(lang)}
                              className={`px-4 py-2 text-xs font-medium transition-colors relative ${activeTab === lang ? 'text-indigo-600' : 'text-gray-400 hover:text-gray-600'}`}
                            >
                              {lang}
                              {activeTab === lang && (
                                <motion.div layoutId="activeTab" className="absolute bottom-[-1px] left-0 right-0 h-[2px] bg-indigo-600" />
                              )}
                            </button>
                          ))}
                        </div>
                        
                        <div>
                          <label className={labelClass}>Zone Name *</label>
                          <input 
                            type="text" 
                            value={formData.name[activeTab] || ''}
                            onChange={(e) => setFormData({...formData, name: { ...formData.name, [activeTab]: e.target.value }})}
                            placeholder={`Name in ${activeTab}`}
                            className={inputClass}
                          />
                        </div>
                      </div>

                      <div>
                        <label className={labelClass}>Boundary Shape</label>
                        <div className="grid grid-cols-2 gap-3">
                          {[
                            { id: 'polygon', label: 'Polygon Boundary' },
                            { id: 'circle', label: 'Circle Radius' },
                          ].map((option) => (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => {
                                setBoundaryMode(option.id);
                                clearDrawing();
                              }}
                              className={`rounded-lg border px-4 py-3 text-sm font-semibold transition-colors ${
                                boundaryMode === option.id
                                  ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                                  : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
                              }`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className={labelClass}>Popular Places</label>
                        <p className="mb-2 text-xs text-gray-400">
                          Shown as destination shortcuts in the rider app for anyone inside this
                          zone, nearest first. Search to add one &mdash; the address and
                          coordinates come with it.
                        </p>

                        <div className="mb-3 flex h-11 w-full items-center gap-2 rounded-lg border border-gray-200 bg-white px-3">
                          <Search className="text-gray-400" size={16} />
                          {isLoaded ? (
                            <Autocomplete
                              onLoad={(a) => setPlaceAutocomplete(a)}
                              onPlaceChanged={onPopularPlaceChanged}
                              className="flex-1"
                            >
                              <input
                                type="text"
                                placeholder="Search a landmark to add"
                                className="w-full bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-400"
                              />
                            </Autocomplete>
                          ) : (
                            <input
                              type="text"
                              disabled
                              placeholder="Loading map search..."
                              className="w-full bg-transparent text-sm text-gray-400 outline-none"
                            />
                          )}
                        </div>

                        {(formData.popular_places || []).length === 0 ? (
                          <p className="rounded-lg border border-dashed border-gray-200 px-4 py-6 text-center text-xs text-gray-400">
                            No places yet. The rider app simply shows its other shortcuts.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {(formData.popular_places || []).map((place, index) => (
                              <div
                                key={`${place.name}-${index}`}
                                className="flex items-start gap-3 rounded-lg border border-gray-200 p-3"
                              >
                                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-gray-100">
                                  {place.image ? (
                                    <img
                                      src={place.image}
                                      alt={place.name}
                                      className="h-full w-full object-cover"
                                    />
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center text-lg font-bold text-gray-300">
                                      {(place.name || '?').charAt(0).toUpperCase()}
                                    </div>
                                  )}
                                </div>

                                <div className="min-w-0 flex-1">
                                  <input
                                    type="text"
                                    value={place.name || ''}
                                    onChange={(e) =>
                                      updatePopularPlace(index, { name: e.target.value })
                                    }
                                    className="w-full border-0 border-b border-transparent p-0 text-sm font-semibold text-gray-800 outline-none focus:border-indigo-400"
                                  />
                                  <p className="mt-0.5 truncate text-xs text-gray-400">
                                    {place.address || '\u2014'}
                                  </p>
                                  <p className="mt-0.5 text-[11px] text-gray-300">
                                    {Number(place.location?.lat).toFixed(5)},{' '}
                                    {Number(place.location?.lng).toFixed(5)}
                                  </p>

                                  <div className="mt-2 flex items-center gap-3">
                                    <label className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-indigo-600 hover:text-indigo-700">
                                      <input
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={(e) =>
                                          uploadPopularPlaceImage(index, e.target.files?.[0])
                                        }
                                      />
                                      {uploadingPlaceIndex === index
                                        ? 'Uploading...'
                                        : place.image
                                          ? 'Replace photo'
                                          : 'Add photo'}
                                    </label>

                                    <label className="flex items-center gap-1.5 text-[11px] font-medium text-gray-500">
                                      <input
                                        type="checkbox"
                                        checked={place.active !== false}
                                        onChange={(e) =>
                                          updatePopularPlace(index, { active: e.target.checked })
                                        }
                                      />
                                      Visible
                                    </label>
                                  </div>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => removePopularPlace(index)}
                                  className="shrink-0 rounded-lg p-1.5 text-gray-300 transition hover:bg-red-50 hover:text-red-500"
                                >
                                  <Trash2 size={15} />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {boundaryMode === 'circle' ? (
                        <div>
                          <label className={labelClass}>Circle Boundary Radius (meters)</label>
                          <input
                            type="number"
                            min="1"
                            value={circleRadiusMeters}
                            onChange={(e) => setCircleRadiusMeters(e.target.value)}
                            placeholder="Enter circle radius in meters"
                            className={inputClass}
                          />
                        </div>
                      ) : null}

                   </div>
                </div>

                <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-3 shadow-sm">
                   <button 
                     disabled={saving} onClick={handleSave}
                     className="w-full py-3 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-50 flex items-center justify-center gap-2"
                   >
                     {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                     {editingId ? 'Update Zone' : 'Save'}
                   </button>
                   <button 
                     onClick={() => navigate("/taxi/admin/pricing/zone")}
                     className="w-full py-3 bg-gray-50 text-gray-600 border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-100 transition-colors"
                   >
                     Cancel
                   </button>
                </div>
              </div>

              {/* Map Section */}
              <div className="xl:col-span-8 space-y-6">
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                   <div className="flex flex-col gap-3 border-b border-gray-100 px-4 py-4 md:flex-row md:items-center md:justify-between">
                      <div className="w-full md:max-w-md">
                        <div className="flex h-12 w-full items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 shadow-sm">
                           <Search className="text-gray-400" size={18} />
                           {isLoaded ? (
                             <Autocomplete
                               onLoad={a => setAutocomplete(a)}
                               onPlaceChanged={onPlaceChanged}
                               className="flex-1"
                             >
                               <input
                                 type="text"
                                 placeholder="Search for a city or zone"
                                 className="w-full bg-transparent text-sm font-semibold text-gray-800 outline-none placeholder:text-gray-400"
                               />
                             </Autocomplete>
                           ) : (
                             <input
                               type="text"
                               placeholder={loadError ? "Google Maps failed to load" : "Loading map search..."}
                               disabled
                               className="w-full bg-transparent text-sm font-semibold text-gray-400 outline-none placeholder:text-gray-400"
                             />
                           )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-3 md:justify-end">
                        <div className="rounded-full bg-slate-50 px-3 py-1.5 text-[11px] font-semibold text-slate-500">
                          {isDrawing
                            ? boundaryMode === 'circle'
                              ? "Click anywhere on the map to place the circle center."
                              : "Click points on the map. Drag points to adjust. Click 'Finish Drawing' when done."
                            : "Click 'Start Drawing' to begin mapping your zone boundary."}
                        </div>
                        <button
                          type="button"
                          onClick={toggleDrawingMode}
                          className={`flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[11px] font-black uppercase tracking-widest text-white shadow-sm transition-all active:scale-95 ${
                            isDrawing
                              ? 'bg-rose-600 hover:bg-rose-700'
                              : 'bg-indigo-600 hover:bg-indigo-700'
                          }`}
                        >
                          <Shapes size={14} />
                          {isDrawing
                            ? boundaryMode === 'circle'
                              ? 'Cancel Placement'
                              : 'Finish Drawing'
                            : 'Start Drawing'}
                        </button>
                        <button 
                          type="button"
                          onClick={clearDrawing}
                          className="flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-[11px] font-black uppercase tracking-widest text-rose-600 shadow-sm transition-all border border-gray-200 hover:bg-rose-50 active:scale-95"
                        >
                          <X size={14} />
                          Clear Map
                        </button>
                      </div>
                    </div>

                    <div className="h-[620px] p-2">
                     {isLoaded ? (
                       <div className="w-full h-full rounded-lg overflow-hidden relative">
                         <GoogleMap
                           mapContainerStyle={{ width: '100%', height: '100%' }}
                           center={mapCenter} zoom={zoom}
                           onZoomChanged={() => {
                             if (mapRef.current) {
                               setZoom(mapRef.current.getZoom());
                             }
                           }}
                           onLoad={m => {
                             mapRef.current = m;
                             window.google.maps.event.addListener(m, 'click', (event) => {
                               handleMapClick(event);
                             });
                           }}
                           options={{
                              mapTypeId: 'roadmap',
                              disableDefaultUI: false,
                              zoomControl: true,
                              mapTypeControl: true,
                              streetViewControl: false,
                              fullscreenControl: true
                           }}
                         >
                           {boundaryMode === 'circle' && circleCenter && Number(circleRadiusMeters) > 0 ? (
                             <Circle
                               center={circleCenter}
                               radius={Number(circleRadiusMeters)}
                               options={{
                                 fillColor: '#0f766e',
                                 strokeColor: '#0f766e',
                                 strokeWeight: 2,
                                 fillOpacity: 0.18,
                                 editable: true,
                                 draggable: true,
                               }}
                               onLoad={(circle) => {
                                 circleListenersRef.current.forEach((listener) => listener?.remove?.());
                                 circleListenersRef.current = [];
                                 circleRef.current = circle;
                                 circleListenersRef.current = [
                                   circle.addListener('dragend', syncCircleState),
                                   circle.addListener('radius_changed', syncCircleState),
                                   circle.addListener('mouseup', syncCircleState),
                                 ];
                               }}
                               onUnmount={() => {
                                 circleListenersRef.current.forEach((listener) => listener?.remove?.());
                                 circleListenersRef.current = [];
                                 circleRef.current = null;
                               }}
                             />
                           ) : null}
                           {countryBoundaryPaths.map((path, index) => (
                             <Polygon
                               key={index} paths={path}
                               options={{ strokeColor: '#f43f5e', fillOpacity: 0.05, fillColor: '#f43f5e', strokeWeight: 1.5, strokeDasharray: '5,5', clickable: false }}
                             />
                           ))}
                         </GoogleMap>
                       </div>
                     ) : (
                       <div className="flex h-full items-center justify-center bg-gray-50 rounded-lg">
                          <Loader2 className="animate-spin text-gray-300" size={32} />
                       </div>
                     )}
                   </div>
                </div>

                <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-amber-800 flex items-start gap-3 shadow-sm">
                   <Info size={18} className="text-amber-500 shrink-0 mt-0.5" />
                   <p className="text-sm font-medium">
                     Avoid drawing multiple zones that overlap with each other.
                   </p>
                </div>

                <div className="bg-indigo-900 rounded-xl p-6 text-white overflow-hidden relative shadow-md">
                    <Maximize2 className="absolute -right-4 -bottom-4 text-white/10" size={120} />
                    <h4 className="text-sm font-semibold mb-2">Instructions</h4>
                    <p className="text-xs text-indigo-100 leading-relaxed">
                      Use the polygon or circle tool at the top of the map to define your zone boundary. Click to place polygon vertices and close the shape, or drop a circle and adjust its radius for a radial market boundary. The red dashed line represents the country boundary for reference.
                    </p>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ZoneManagement;
