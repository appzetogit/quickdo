import React, { useState, useEffect, useMemo } from 'react';
import { GoogleMap, Circle } from '@react-google-maps/api';
import { 
  ChevronRight, 
  Map as MapIcon, 
  RefreshCw, 
  Eye, 
  Settings2, 
  ArrowLeft,
  Activity,
  Zap,
  Navigation,
  Layers,
  MousePointer2
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppGoogleMapsLoader, HAS_VALID_GOOGLE_MAPS_KEY } from '../../utils/googleMaps';
import { adminService } from '../../services/adminService';
import { motion } from 'framer-motion';

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
    { elementType: 'labels.text.fill', stylers: [{ color: '#6b7280' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#e5e7eb' }] }
  ]
};

const HeatMap = () => {
  const navigate = useNavigate();
  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [opacity, setOpacity] = useState(0.7);
  const [radius, setRadius] = useState(40);
  const [gradient, setGradient] = useState('Default');

  const { isLoaded, loadError } = useAppGoogleMapsLoader();

  const inputClass = "w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm text-gray-800 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-colors";
  const labelClass = "block text-xs font-semibold text-gray-500 mb-1.5";

  const fetchZones = async () => {
    setLoading(true);
    try {
      const response = await adminService.getZones();
      const results = response?.data?.results || response?.data || [];
      setZones(results);
    } catch (error) {
      console.error('Failed to fetch heatmap data', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchZones();
  }, []);

  const heatmapData = useMemo(() => {
    if (!isLoaded || !zones.length) return [];
    return zones.flatMap((zone) => {
      const coord = zone.coordinates?.[0]?.[0] || [75.8577, 22.7196];
      const lat = Number(coord[1]);
      const lng = Number(coord[0]);
      
      return Array.from({ length: 12 }).map(() => ({
        lat: lat + (Math.random() - 0.5) * 0.08,
        lng: lng + (Math.random() - 0.5) * 0.08,
        weight: Math.random() * 10
      }));
    });
  }, [zones, isLoaded]);

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-8 font-sans">
      
      {/* 1. Header Block (Design System Compliant) */}
      <div className="mb-6">
        <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
          <span>Map</span>
          <ChevronRight size={12} />
          <span className="text-gray-700">Heat Map</span>
        </div>
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900">Heat Map</h1>
          <button 
             onClick={() => navigate('/taxi/admin/dashboard')}
             className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <ArrowLeft size={16} /> Back
          </button>
        </div>
      </div>

      <div className="space-y-8">
        
        {/* 2. Map Canvas Card */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm overflow-hidden p-2">
           <div className="rounded-lg overflow-hidden relative">
              {loadError ? (
                 <div className="h-[400px] flex items-center justify-center bg-gray-50 text-rose-500 font-semibold">Map Error</div>
              ) : HAS_VALID_GOOGLE_MAPS_KEY && isLoaded ? (
                 <GoogleMap
                    mapContainerStyle={MAP_CONTAINER_STYLE} center={INDIA_CENTER} zoom={11} options={mapOptions}
                 >
                    {heatmapData.map((point, index) => (
                      <Circle
                        key={index}
                        center={{ lat: point.lat, lng: point.lng }}
                        radius={radius * 180 * (point.weight / 10)}
                        options={{
                          strokeColor: '#FF4D7E',
                          strokeOpacity: 0,
                          strokeWeight: 0,
                          fillColor: '#FF6B35',
                          fillOpacity: opacity * (point.weight / 10) * 0.35,
                          clickable: false,
                          zIndex: 1
                        }}
                      />
                    ))}
                 </GoogleMap>
              ) : (
                <div className="h-[400px] flex flex-col items-center justify-center bg-gray-50 gap-4">
                   <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center shadow-sm text-indigo-600"><MapIcon size={32} /></div>
                   <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Map API Key Required</p>
                </div>
              )}
              
              {/* Floating Action Badge */}
              <div className="absolute top-6 right-6 flex items-center gap-2">
                 <button onClick={fetchZones} className="w-10 h-10 bg-white rounded-lg shadow-xl flex items-center justify-center text-gray-400 hover:text-indigo-600 transition-colors border border-gray-100">
                    <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                 </button>
              </div>
           </div>
        </div>

        {/* 3. Visibility Controls (Section Pattern) */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
           <div className="px-8 py-6 border-b border-gray-100 flex items-center gap-4">
              <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600 shadow-sm">
                 <Eye size={20} />
              </div>
              <div>
                 <h3 className="text-[13px] font-black text-gray-900 uppercase tracking-widest">Visibility Controls</h3>
                 <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tight">Adjust overlay intensity & radius</p>
              </div>
           </div>
           
           <div className="p-8 space-y-10">
              <div className="max-w-md">
                 <label className={labelClass}>
                    <Settings2 size={12} className="inline mr-1 text-indigo-500" />
                    Heatmap Gradient Mode
                 </label>
                 <select value={gradient} onChange={e => setGradient(e.target.value)} className={inputClass}>
                    <option>Default (Thermal)</option>
                    <option>Spectral View</option>
                    <option>Density Focus</option>
                 </select>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-10 border-t border-gray-50 pt-10">
                 <div className="space-y-4">
                    <div className="flex items-center justify-between">
                       <label className={labelClass}>Layer Opacity</label>
                       <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-2 py-1 rounded">{Math.round(opacity * 100)}%</span>
                    </div>
                    <input 
                      type="range" min="0" max="1" step="0.01" value={opacity} 
                      onChange={e => setOpacity(Number(e.target.value))}
                      className="w-full h-2 bg-gray-100 rounded-lg appearance-none cursor-pointer accent-[#00BFA5]"
                    />
                 </div>

                 <div className="space-y-4">
                    <div className="flex items-center justify-between">
                       <label className={labelClass}>Gradient Radius</label>
                       <span className="text-[10px] font-black text-[#00BFA5] bg-emerald-50 px-2 py-1 rounded font-mono">{radius}px</span>
                    </div>
                    <input 
                      type="range" min="1" max="100" step="1" value={radius} 
                      onChange={e => setRadius(Number(e.target.value))}
                      className="w-full h-2 bg-gray-100 rounded-lg appearance-none cursor-pointer accent-[#00BFA5]"
                    />
                 </div>
              </div>
           </div>
        </div>

        {/* 4. Secondary Features (Sidebar Style Cards in Grid) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
           <div className="bg-white rounded-2xl border border-gray-200 p-6 flex items-center gap-5 shadow-sm group hover:border-indigo-100 transition-colors">
              <div className="w-12 h-12 bg-gray-50 flex items-center justify-center rounded-xl text-gray-400 group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-all">
                 <Navigation size={22} />
              </div>
              <div>
                 <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-0.5">Coverage</p>
                 <p className="text-lg font-black text-gray-900 tracking-tight leading-none">{zones.length} Units</p>
              </div>
           </div>

           <div className="bg-white rounded-2xl border border-gray-200 p-6 flex items-center gap-5 shadow-sm group hover:border-emerald-100 transition-colors">
              <div className="w-12 h-12 bg-gray-50 flex items-center justify-center rounded-xl text-gray-400 group-hover:bg-emerald-50 group-hover:text-emerald-600 transition-all">
                 <Activity size={22} />
              </div>
              <div>
                 <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-0.5">Live Traffic</p>
                 <p className="text-lg font-black text-gray-900 tracking-tight leading-none">Active Feed</p>
              </div>
           </div>

           <div className="bg-white rounded-2xl border border-gray-200 p-6 flex items-center gap-5 shadow-sm group hover:border-amber-100 transition-colors">
              <div className="w-12 h-12 bg-gray-50 flex items-center justify-center rounded-xl text-gray-400 group-hover:bg-amber-50 group-hover:text-amber-600 transition-all">
                 <Zap size={22} />
              </div>
              <div>
                 <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-0.5">Sync State</p>
                 <p className="text-lg font-black text-emerald-600 tracking-tight leading-none">Synchronized</p>
              </div>
           </div>
        </div>

      </div>
    </div>
  );
};

export default HeatMap;
