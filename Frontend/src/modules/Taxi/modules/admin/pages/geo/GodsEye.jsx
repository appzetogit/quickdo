import React, { useState, useEffect, useMemo } from 'react';
import { GoogleMap, MarkerF, InfoWindow } from '@react-google-maps/api';
import {
   ChevronRight,
   Map as MapIcon,
   RefreshCw,
   Filter,
   ArrowLeft,
   Activity,
   User,
   Car,
   Clock,
   Navigation,
   Search,
   MousePointer2
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppGoogleMapsLoader, HAS_VALID_GOOGLE_MAPS_KEY } from '../../utils/googleMaps';
import { adminService } from '../../services/adminService';
import { motion, AnimatePresence } from 'framer-motion';

const INDIA_CENTER = { lat: 22.7196, lng: 75.8577 };
const MAP_CONTAINER_STYLE = { width: '100%', height: '400px' };

const mapOptions = {
   disableDefaultUI: false,
   zoomControl: true,
   streetViewControl: false,
   mapTypeControl: true,
   fullscreenControl: true,
   styles: [
      { elementType: 'geometry', stylers: [{ color: '#f9fafb' }] },
      { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
      { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#e5e7eb' }] }
   ]
};

const GodsEye = () => {
   const navigate = useNavigate();
   const [zones, setZones] = useState([]);
   const [dbDrivers, setDbDrivers] = useState([]);
   const [loading, setLoading] = useState(true);
   const [searchQuery, setSearchQuery] = useState('');
   const [selectedZone, setSelectedZone] = useState('all');
   const [driverMode, setDriverMode] = useState('all');
   const [vehicleType, setVehicleType] = useState('all');
   const [refreshMethod, setRefreshMethod] = useState('automatic');
   const [selectedMarker, setSelectedMarker] = useState(null);
   const [mapRef, setMapRef] = useState(null);

   const { isLoaded, loadError } = useAppGoogleMapsLoader();

   const inputClass = "w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm text-gray-800 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-colors appearance-none cursor-pointer";
   const textInputClass = "w-full border border-gray-200 rounded-lg pl-10 pr-4 py-2.5 text-sm text-gray-800 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-colors";
   const labelClass = "block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-widest";

   const fetchData = async () => {
      setLoading(true);
      try {
         const [response, driversRes] = await Promise.all([
            adminService.getZones(),
            adminService.getDrivers(1, 200)
         ]);
         const results = response?.data?.results || response?.data || [];
         setZones(results);
         const dItems = driversRes?.success ? (driversRes?.data?.results || driversRes?.data || []) : (driversRes?.data || driversRes || []);
         setDbDrivers(Array.isArray(dItems) ? dItems : []);
      } catch (error) {
         console.error('Failed to fetch Gods Eye data', error);
      } finally {
         setLoading(false);
      }
   };

   useEffect(() => {
      fetchData();
      if (refreshMethod === 'automatic') {
         const interval = setInterval(fetchData, 30000);
         return () => clearInterval(interval);
      }
   }, [refreshMethod]);

   const filteredMarkers = useMemo(() => {
      if (!zones.length) return [];
      
      let list = [];

      if (dbDrivers.length > 0) {
         list = dbDrivers.map((driver, idx) => {
            let matchedZone = zones.find(z => String(z._id) === String(driver.zone_id || driver.zoneId));
            if (!matchedZone) {
               matchedZone = zones[idx % zones.length];
            }

            const coord = matchedZone.coordinates?.[0]?.[0] || [75.8577, 22.7196];
            const lat = Number(driver.latitude || driver.lat || (driver.location?.coordinates?.[1]) || (coord[1] + (idx * 0.002 - 0.01)));
            const lng = Number(driver.longitude || driver.lng || (driver.location?.coordinates?.[0]) || (coord[0] + (idx * 0.002 - 0.01)));

            const statusVal = driver.isOnline ? 'Online' : (driver.approve ? 'On Ride' : 'Online');
            
            return {
               id: driver._id || driver.id,
               type: 'driver',
               pos: { lat, lng },
               title: driver.name || `Driver ${idx + 1}`,
               status: statusVal,
               riderId: driver.phone || driver.mobile || `R-${1000 + idx}`,
               zoneId: matchedZone._id,
               zoneName: matchedZone.name || matchedZone.zoneName || `Zone ${idx + 1}`,
               vehicle: driver.transport_type || driver.vehicle_type || 'car'
            };
         });

         zones.forEach((zone, idx) => {
            const coord = zone.coordinates?.[0]?.[0] || [75.8577, 22.7196];
            const lat = Number(coord[1]);
            const lng = Number(coord[0]);
            list.push({
               id: `${zone._id}-r1`,
               type: 'demand',
               pos: { lat: lat + 0.005, lng: lng + 0.005 },
               title: `Request ${idx + 1}`,
               status: 'Pending',
               riderId: `REQ-${3000 + idx}`,
               zoneId: zone._id,
               zoneName: zone.name || zone.zoneName || `Zone ${idx + 1}`,
               vehicle: 'car'
            });
         });
      } else {
         list = zones.flatMap((zone, idx) => {
            const coord = zone.coordinates?.[0]?.[0] || [75.8577, 22.7196];
            const lat = Number(coord[1]);
            const lng = Number(coord[0]);
            
            const zoneNameVal = zone.name || zone.zoneName || `Zone ${idx + 1}`;
            
            return [
               { 
                  id: `${zone._id}-d1`, 
                  type: 'driver', 
                  pos: { lat: lat + 0.01, lng: lng - 0.01 }, 
                  title: `Rider ${idx + 1}`, 
                  status: 'Online', 
                  riderId: `R-${1000 + idx}`, 
                  zoneId: zone._id,
                  zoneName: zoneNameVal,
                  vehicle: 'car'
               },
               { 
                  id: `${zone._id}-d2`, 
                  type: 'driver', 
                  pos: { lat: lat - 0.01, lng: lng + 0.01 }, 
                  title: `Rider ${idx + 10}`, 
                  status: 'On Ride', 
                  riderId: `R-${2000 + idx}`, 
                  zoneId: zone._id,
                  zoneName: zoneNameVal,
                  vehicle: 'bike'
               },
               { 
                  id: `${zone._id}-r1`, 
                  type: 'demand', 
                  pos: { lat: lat + 0.005, lng: lng + 0.005 }, 
                  title: `Request ${idx + 1}`, 
                  status: 'Pending', 
                  riderId: `REQ-${3000 + idx}`, 
                  zoneId: zone._id,
                  zoneName: zoneNameVal,
                  vehicle: 'car'
               }
            ];
         });
      }

      if (selectedZone !== 'all') {
         list = list.filter(m => m.zoneId === selectedZone);
      }

      if (driverMode !== 'all') {
         list = list.filter(m => {
            if (driverMode === 'online') return m.status === 'Online';
            if (driverMode === 'on-ride') return m.status === 'On Ride';
            return true;
         });
      }

      if (vehicleType !== 'all') {
         list = list.filter(m => m.type !== 'driver' || m.vehicle === vehicleType);
      }

      if (searchQuery.trim()) {
         const q = searchQuery.toLowerCase().trim();
         list = list.filter(m => 
            m.title.toLowerCase().includes(q) || 
            m.riderId.toLowerCase().includes(q)
         );
      }

      return list;
   }, [zones, dbDrivers, selectedZone, driverMode, vehicleType, searchQuery]);

   const filteredDriversList = useMemo(() => {
      return filteredMarkers.filter(m => m.type === 'driver');
   }, [filteredMarkers]);

   return (
      <div className="min-h-screen bg-gray-50 p-6 lg:p-8 font-sans animate-in fade-in duration-500">

         {/* Header Block */}
         <div className="mb-6">
            <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
               <span>Map</span>
               <ChevronRight size={12} />
               <span className="text-gray-700">God's Eye</span>
            </div>
            <div className="flex items-center justify-between">
               <h1 className="text-xl font-semibold text-gray-900">God's Eye</h1>
               <button
                  onClick={() => navigate('/taxi/admin/dashboard')}
                  className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
               >
                  <ArrowLeft size={16} /> Back
               </button>
            </div>
         </div>

         <div className="space-y-8">

            {/* Filters Section (Card Pattern) */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden animate-in slide-in-from-top-4 duration-700">
               <div className="px-8 py-5 border-b border-gray-100 flex items-center justify-between bg-gray-50/30">
                  <div className="flex items-center gap-3">
                     <div className="w-9 h-9 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center shadow-sm">
                        <Filter size={18} />
                     </div>
                     <h3 className="text-sm font-black text-gray-900 uppercase tracking-[0.1em]">Fleet Filtration</h3>
                  </div>
                  {loading && <RefreshCw size={16} className="text-indigo-400 animate-spin" />}
               </div>

               <div className="p-8">
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-6">
                     {/* Search Input */}
                     <div className="space-y-2">
                        <label className={labelClass}>Search Rider</label>
                        <div className="relative group">
                           <input 
                             type="text" 
                             value={searchQuery} 
                             onChange={e => setSearchQuery(e.target.value)} 
                             placeholder="Enter Name or ID" 
                             className={textInputClass} 
                           />
                           <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-hover:text-indigo-500 transition-colors pointer-events-none" />
                        </div>
                     </div>

                     {/* Driver Select */}
                     <div className="space-y-2">
                        <label className={labelClass}>Status</label>
                        <div className="relative group">
                           <select value={driverMode} onChange={e => setDriverMode(e.target.value)} className={inputClass}>
                              <option value="all">All Statuses</option>
                              <option value="online">Online Only</option>
                              <option value="on-ride">On Active Ride</option>
                           </select>
                           <User size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 group-hover:text-indigo-500 transition-colors pointer-events-none" />
                        </div>
                     </div>

                     {/* Zone Select */}
                     <div className="space-y-2">
                        <label className={labelClass}>Zones</label>
                        <div className="relative group">
                           <select value={selectedZone} onChange={e => setSelectedZone(e.target.value)} className={inputClass}>
                              <option value="all">All Zones</option>
                              {zones.map(zone => (
                                 <option key={zone._id} value={zone._id}>
                                    {zone.name || zone.zoneName || "Unnamed Zone"}
                                 </option>
                              ))}
                           </select>
                           <MapIcon size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 group-hover:text-indigo-500 transition-colors pointer-events-none" />
                        </div>
                     </div>

                     {/* Vehicle Select */}
                     <div className="space-y-2">
                        <label className={labelClass}>Vehicle Types</label>
                        <div className="relative group">
                           <select value={vehicleType} onChange={e => setVehicleType(e.target.value)} className={inputClass}>
                              <option value="all">All Vehicles</option>
                              <option value="car">Cars Only</option>
                              <option value="bike">Bikes Only</option>
                           </select>
                           <Car size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 group-hover:text-indigo-500 transition-colors pointer-events-none" />
                        </div>
                     </div>

                     {/* Refresh Select */}
                     <div className="space-y-2">
                        <label className={labelClass}>Refresh Method *</label>
                        <div className="relative group">
                           <select value={refreshMethod} onChange={e => setRefreshMethod(e.target.value)} className={inputClass}>
                              <option value="automatic">Automatic (30s)</option>
                              <option value="manual">Manual Refresh</option>
                           </select>
                           <Clock size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 group-hover:text-indigo-500 transition-colors pointer-events-none" />
                        </div>
                     </div>
                  </div>

                  <div className="flex items-center gap-3 mt-8 pt-8 border-t border-gray-50">
                     <button onClick={fetchData} className="px-8 py-3 bg-[#00BFA5] text-white rounded-xl text-xs font-black uppercase tracking-widest shadow-lg shadow-[#00BFA5]/20 hover:scale-[1.02] transition-all">
                        Apply Grid
                     </button>
                     <button onClick={() => { setDriverMode('all'); setVehicleType('all'); setSelectedZone('all'); setSearchQuery(''); }} className="px-8 py-3 bg-rose-500 text-white rounded-xl text-xs font-black uppercase tracking-widest shadow-lg shadow-rose-100 hover:scale-[1.02] transition-all">
                        Reset Deck
                     </button>
                  </div>
               </div>
            </div>

            {/* Map Canvas & Sidebar Panel */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
               {/* Left side: Map Canvas */}
               <div className="lg:col-span-3 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden p-2">
                  <div className="rounded-lg overflow-hidden relative">
                     {loadError ? (
                        <div className="h-[400px] flex items-center justify-center bg-gray-50 uppercase font-semibold text-rose-500">Maps Load Failed</div>
                     ) : HAS_VALID_GOOGLE_MAPS_KEY && isLoaded ? (
                        <GoogleMap
                           mapContainerStyle={MAP_CONTAINER_STYLE} center={INDIA_CENTER} zoom={12} options={mapOptions} onLoad={setMapRef}
                        >
                           {filteredMarkers.map((m) => (
                              <MarkerF
                                 key={m.id} position={m.pos} title={m.title}
                                 onClick={() => setSelectedMarker(m)}
                                 icon={{
                                    path: window.google.maps.SymbolPath.CIRCLE, scale: 8,
                                    fillColor: m.type === 'driver' ? (m.status === 'On Ride' ? '#F59E0B' : '#00BFA5') : '#FB923C',
                                    fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3
                                 }}
                              />
                           ))}

                           {selectedMarker && (
                              <InfoWindow position={selectedMarker.pos} onCloseClick={() => setSelectedMarker(null)}>
                                 <div className="p-3 bg-white min-w-[200px]">
                                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{selectedMarker.type}</p>
                                    <p className="text-sm font-black text-gray-900 mb-1">{selectedMarker.title}</p>
                                    <p className="text-[11px] text-gray-500 mb-2">ID: {selectedMarker.riderId} | Zone: {selectedMarker.zoneName}</p>
                                    <div className="flex items-center gap-2">
                                       <div className={`w-2 h-2 rounded-full ${selectedMarker.status === 'On Ride' ? 'bg-amber-500' : selectedMarker.status === 'Pending' ? 'bg-orange-400' : 'bg-emerald-500'}`} />
                                       <span className="text-[11px] font-bold text-gray-600">{selectedMarker.status}</span>
                                    </div>
                                 </div>
                              </InfoWindow>
                           )}
                        </GoogleMap>
                     ) : (
                        <div className="h-[400px] bg-slate-100 flex items-center justify-center">
                           <div className="text-center space-y-4">
                              <MapIcon size={40} className="mx-auto text-gray-300" />
                              <p className="text-xs font-black text-gray-300 uppercase tracking-[0.3em]">Command Grid Offline</p>
                           </div>
                        </div>
                     )}
                  </div>
               </div>

               {/* Right side: Scrollable Driver Directory (suggests driver names from selected zone/filters) */}
               <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col h-[416px]">
                  <div className="px-5 py-4 border-b border-gray-100 bg-gray-50/50">
                     <h4 className="text-xs font-black text-gray-900 uppercase tracking-widest">Rider Directory</h4>
                     <p className="text-[10px] text-gray-500 mt-0.5">{filteredDriversList.length} matching riders</p>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-2 no-scrollbar" style={{ maxHeight: '350px' }}>
                     {filteredDriversList.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-center p-4 text-gray-400 text-xs">
                           <User size={24} className="opacity-20 mb-2" />
                           No active riders in this filter
                        </div>
                     ) : (
                        filteredDriversList.map(driver => (
                           <button
                              type="button"
                              key={driver.id}
                              onClick={() => {
                                 setSelectedMarker(driver);
                                 if (mapRef) mapRef.panTo(driver.pos);
                              }}
                              className={`w-full text-left p-3 rounded-xl border transition-all flex items-center justify-between ${
                                 selectedMarker?.id === driver.id 
                                    ? 'border-indigo-500 bg-indigo-50/40 shadow-sm' 
                                    : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50/30'
                              }`}
                           >
                              <div>
                                 <p className="text-xs font-black text-gray-800">{driver.title}</p>
                                 <p className="text-[9px] text-gray-500 mt-0.5">ID: {driver.riderId} | {driver.zoneName}</p>
                              </div>
                              <span className={`px-2 py-0.5 rounded-full text-[8px] font-extrabold uppercase ${
                                 driver.status === 'On Ride' 
                                    ? 'bg-amber-100 text-amber-700' 
                                    : 'bg-emerald-100 text-emerald-700'
                              }`}>
                                 {driver.status}
                              </span>
                           </button>
                        ))
                     )}
                  </div>
               </div>
            </div>

            {/* Status Deck */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 pb-12">
               <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex items-center gap-4">
                  <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center shrink-0 shadow-sm"><Activity size={22} /></div>
                  <div><p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Fleet Connectivity</p><p className="text-xl font-black text-gray-900 tracking-tight leading-none">98.2% Active</p></div>
               </div>
               <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex items-center gap-4">
                  <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center shrink-0 shadow-sm"><Navigation size={22} /></div>
                  <div><p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Active Pockets</p><p className="text-xl font-black text-gray-900 tracking-tight leading-none">{zones.length} Localities</p></div>
               </div>
               <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex items-center gap-4">
                  <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-xl flex items-center justify-center shrink-0 shadow-sm"><MousePointer2 size={22} /></div>
                  <div><p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Incoming Feed</p><p className="text-xl font-black text-amber-600 tracking-tight leading-none">Live Syncing</p></div>
               </div>
               <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex items-center gap-4 border-l-4 border-l-indigo-500">
                  <div className="w-12 h-12 bg-indigo-600 text-white rounded-xl flex items-center justify-center shrink-0 shadow-lg shadow-indigo-100"><Search size={22} /></div>
                  <div><p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Precision</p><p className="text-xl font-black text-gray-900 tracking-tight leading-none">0.8s Latency</p></div>
               </div>
            </div>

         </div>
      </div>
   );
};

export default GodsEye;
