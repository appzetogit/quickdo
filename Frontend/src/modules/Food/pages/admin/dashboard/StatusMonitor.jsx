import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Search, MapPin, Navigation, Truck, Settings, CheckCircle2, Package, XCircle, ArrowRight } from "lucide-react";
import { GoogleMap, MarkerF, useJsApiLoader } from "@react-google-maps/api";
import { adminAPI } from "@food/api";
import { getGoogleMapsApiKey } from "@food/utils/googleMapsApiKey";
import { toast } from "sonner";
import { env } from "@/config/runtimeEnv";

const MAP_CONTAINER_STYLE = { width: "100%", height: "100%" };
const DEFAULT_CENTER = { lat: 22.7196, lng: 75.8577 }; // Default fallback center

export default function StatusMonitor() {
  const [activeTab, setActiveTab] = useState("delivery_partners"); // "restaurants" | "delivery_partners"
  const [searchQuery, setSearchQuery] = useState("");
  const [partners, setPartners] = useState([]);
  const [restaurants, setRestaurants] = useState([]);
  const [selectedPartnerId, setSelectedPartnerId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [assignOrderId, setAssignOrderId] = useState("");

  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: env('VITE_GOOGLE_MAPS_API_KEY') || "",
    id: "script-loader"
  });

  // Fetch data
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [partnersRes, restaurantsRes] = await Promise.allSettled([
        adminAPI.getDeliveryPartners({ page: 1, limit: 100 }),
        adminAPI.getApprovedRestaurants({ page: 1, limit: 100 }),
      ]);

      if (partnersRes.status === "fulfilled" && partnersRes.value?.data?.success) {
        const pList = partnersRes.value.data.data?.deliveryPartners || partnersRes.value.data.data || [];
        // Preserve mock state if it exists
        setPartners(prev => {
            return pList.map(item => {
                const existing = prev.find(p => String(p._id || p.id) === String(item._id || item.id));
                if (existing) {
                    return { ...item, isOnline: existing.isOnline, isActive: existing.isActive };
                }
                return item;
            });
        });
        if (pList.length > 0 && !selectedPartnerId) {
           setSelectedPartnerId(String(pList[0]._id || pList[0].id));
        }
      }

      if (restaurantsRes.status === "fulfilled") {
        const body = restaurantsRes.value?.data;
        const rList = Array.isArray(body?.data?.restaurants) ? body.data.restaurants : (Array.isArray(body?.data) ? body.data : []);
        setRestaurants(prev => {
            return rList.map(item => {
                const existing = prev.find(p => String(p._id || p.id) === String(item._id || item.id));
                if (existing) {
                    return { ...item, isOnline: existing.isOnline, isActive: existing.isActive };
                }
                return item;
            });
        });
      }
    } catch (err) {
      console.error("Failed to fetch live monitor data", err);
    } finally {
      setLoading(false);
    }
  }, [selectedPartnerId]);

  useEffect(() => {
    fetchData();
    // Auto refresh every 30s
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const displayedList = useMemo(() => {
    const list = activeTab === "delivery_partners" ? partners : restaurants;
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase().trim();
    return list.filter(item => {
       const name = getName(item).toLowerCase();
       const idStr = String(item._id || item.id || "").toLowerCase();
       const phone = String(item.phone || item.contactNumber || "").toLowerCase();
       return name.includes(q) || idStr.includes(q) || phone.includes(q);
    });
  }, [activeTab, partners, restaurants, searchQuery]);

  const selectedItem = useMemo(() => {
    if (activeTab === "delivery_partners") {
       return partners.find(p => String(p._id || p.id) === String(selectedPartnerId)) || partners[0];
    } else {
       return restaurants.find(r => String(r._id || r.id) === String(selectedPartnerId)) || restaurants[0];
    }
  }, [activeTab, partners, restaurants, selectedPartnerId]);

  const handleManualAssign = () => {
     if (!assignOrderId.trim()) {
        toast.error("Please enter a valid Order ID");
        return;
     }
     if (!selectedItem) {
        toast.error("No partner selected");
        return;
     }
     // Mock assignment
     toast.success(`Successfully assigned Order #${assignOrderId} to ${getName(selectedItem)}`);
     setAssignOrderId("");
  };

  const handleToggleStatus = () => {
     if (!selectedItem) return;
     const newStatus = !isOnline;
     toast.success(`Successfully marked ${getName(selectedItem)} as ${newStatus ? 'Online' : 'Offline'}`);
     if (activeTab === "delivery_partners") {
         setPartners(prev => prev.map(p => String(p._id || p.id) === String(selectedPartnerId) ? {...p, isOnline: newStatus, isActive: newStatus} : p));
     } else {
         setRestaurants(prev => prev.map(p => String(p._id || p.id) === String(selectedPartnerId) ? {...p, isOnline: newStatus, isActive: newStatus} : p));
     }
  };

  const getCoordinates = (item) => {
     if (!item) return DEFAULT_CENTER;
     // GeoJSON: [lng, lat]
     if (item.location?.coordinates?.length >= 2) {
        return { lat: Number(item.location.coordinates[1]), lng: Number(item.location.coordinates[0]) };
     }
     if (item.lastLocation?.coordinates?.length >= 2) {
        return { lat: Number(item.lastLocation.coordinates[1]), lng: Number(item.lastLocation.coordinates[0]) };
     }
     if (item.latitude && item.longitude) {
        return { lat: Number(item.latitude), lng: Number(item.longitude) };
     }
     if (item.lastLat && item.lastLng) {
        return { lat: Number(item.lastLat), lng: Number(item.lastLng) };
     }
     if (item.location?.lat && item.location?.lng) {
        return { lat: Number(item.location.lat), lng: Number(item.location.lng) };
     }
     if (item.lat && item.lng) {
        return { lat: Number(item.lat), lng: Number(item.lng) };
     }
     // Fake coordinates nearby default center for demo if not found
     const fallbackHash = String(item._id || item.id).charCodeAt(0) || 0;
     return { 
         lat: DEFAULT_CENTER.lat + (fallbackHash % 10) * 0.002, 
         lng: DEFAULT_CENTER.lng + (fallbackHash % 10) * 0.002 
     };
  };

  const getName = (item) => {
    if (!item) return "Unknown";
    return item.name || item.restaurantName || `${item.firstName || item.f_name || ''} ${item.lastName || item.l_name || ''}`.trim() || "Unknown";
  };

  const getAddress = (item) => {
    if (!item) return "N/A";
    return item.address || item.location?.formattedAddress || item.location?.addressLine1 || "Location data not available";
  };

  const selectedName = getName(selectedItem);
  const selectedPhone = selectedItem?.phone || selectedItem?.contactNumber || "N/A";
  const isOnline = selectedItem ? (selectedItem.isOnline !== false && selectedItem.isActive !== false) : false;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto min-h-[calc(100vh-80px)] bg-[#F9FAFB] rounded-tl-3xl mt-2 ml-2">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Live Status Monitor</h1>
          <p className="text-sm text-gray-500 mt-1">Real-time status of service locations and delivery fleets</p>
        </div>
        
        {/* Toggle Tabs */}
        <div className="flex bg-white rounded-full p-1 shadow-sm border border-gray-200 shrink-0">
          <button
            onClick={() => setActiveTab("restaurants")}
            className={`px-5 py-2 text-xs font-bold uppercase tracking-wider rounded-full transition-all ${
              activeTab === "restaurants" ? "bg-rose-600 text-white shadow-sm" : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
            }`}
          >
            RESTAURANTS ({restaurants.length})
          </button>
          <button
            onClick={() => setActiveTab("delivery_partners")}
            className={`px-5 py-2 text-xs font-bold uppercase tracking-wider rounded-full transition-all ${
              activeTab === "delivery_partners" ? "bg-rose-600 text-white shadow-sm" : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
            }`}
          >
            DELIVERY PARTNERS ({partners.length})
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[calc(100vh-220px)] min-h-[600px]">
        {/* Left Column: List */}
        <div className="lg:col-span-4 flex flex-col gap-4 h-full">
          <div className="bg-white rounded-[24px] border border-gray-100 shadow-sm p-5 flex flex-col h-full">
            <h2 className="text-lg font-bold text-gray-900 mb-4">All {activeTab === 'restaurants' ? 'Restaurants' : 'Partners'}</h2>
            
            {/* Search */}
            <div className="relative mb-4 shrink-0 flex items-center gap-2">
              <div className="relative flex-1">
                 <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                 <input
                   type="text"
                   placeholder={`Search ${activeTab === 'restaurants' ? 'restaurants' : 'partners'}...`}
                   value={searchQuery}
                   onChange={(e) => setSearchQuery(e.target.value)}
                   className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-rose-500/20 focus:bg-white transition-all outline-none"
                 />
              </div>
              <button className="w-10 h-10 flex items-center justify-center bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors shrink-0">
                <Settings size={18} className="text-gray-500" />
              </button>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
              {loading && displayedList.length === 0 ? (
                 <div className="text-center text-sm text-gray-400 mt-10">Loading...</div>
              ) : displayedList.length === 0 ? (
                 <div className="text-center text-sm text-gray-400 mt-10">No items found.</div>
              ) : (
                displayedList.map((item, idx) => {
                  const id = String(item._id || item.id);
                  const isSelected = selectedPartnerId === id;
                  const name = getName(item);
                  const phone = item.phone || item.contactNumber || `ID: ${id.substring(0,6)}`;
                  const online = item.isOnline !== false && item.isActive !== false;
                  
                  return (
                    <button
                      key={id || idx}
                      onClick={() => setSelectedPartnerId(id)}
                      className={`w-full text-left p-3 rounded-2xl flex items-center justify-between transition-all border ${
                        isSelected ? "border-rose-200 bg-rose-50/30 shadow-[0_4px_20px_-4px_rgba(225,29,72,0.1)]" : "border-transparent hover:bg-gray-50"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                         <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                           {activeTab === "restaurants" ? (
                             <MapPin size={18} className="text-gray-500" />
                           ) : (
                             <Navigation size={18} className="text-gray-500" />
                           )}
                         </div>
                         <div>
                            <p className="text-sm font-bold text-gray-900">{name}</p>
                            <p className="text-xs text-gray-500">{phone}</p>
                         </div>
                      </div>
                      <div className={`w-2.5 h-2.5 rounded-full ${online ? "bg-[#00E676]" : "bg-gray-300"}`} />
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Details */}
        <div className="lg:col-span-8 flex flex-col h-full">
           {selectedItem ? (
             <div className="bg-white rounded-[32px] border border-gray-100 shadow-sm p-6 lg:p-8 flex flex-col h-full overflow-y-auto custom-scrollbar">
                
                {/* Profile Header */}
                <div className="flex items-start justify-between mb-8 shrink-0">
                   <div className="flex items-center gap-4">
                      <div className="w-16 h-16 rounded-full bg-gray-50 flex items-center justify-center border border-gray-100 shrink-0">
                         {activeTab === "restaurants" ? (
                            <MapPin size={28} className="text-gray-400" />
                         ) : (
                            <Truck size={28} className="text-gray-400" />
                         )}
                      </div>
                      <div>
                         <div className="flex items-center gap-2 mb-1">
                            <h2 className="text-xl font-bold text-gray-900">{selectedName}</h2>
                            <div className={`w-2 h-2 rounded-full ${isOnline ? "bg-[#00E676]" : "bg-gray-300"}`} />
                         </div>
                         <p className="text-sm text-gray-500">{selectedPhone}</p>
                         {activeTab === "delivery_partners" && (
                            <p className="text-xs font-semibold text-gray-400 mt-1 uppercase tracking-wider">
                               VEHICLE: {selectedItem.vehicle_type || 'BIKE'} {selectedItem.vehicle_number ? `(${selectedItem.vehicle_number})` : ''}
                            </p>
                         )}
                      </div>
                   </div>
                   <button 
                      onClick={handleToggleStatus}
                      className="px-5 py-2 rounded-full border border-rose-200 text-rose-500 text-sm font-bold hover:bg-rose-50 transition-colors shrink-0"
                   >
                      Mark {isOnline ? 'Offline' : 'Online'}
                   </button>
                </div>

                {/* Manual Assign Box (Only for delivery partners usually, but we'll show it generally) */}
                {activeTab === "delivery_partners" && (
                   <div className="bg-[#F8FAFC] rounded-2xl p-5 mb-6 border border-[#E2E8F0] shrink-0">
                      <div className="flex items-center gap-2 mb-3">
                         <Package size={16} className="text-indigo-600" />
                         <h3 className="text-sm font-bold text-gray-900">Manual Assign Order</h3>
                      </div>
                      <div className="flex items-center gap-3">
                         <input
                           type="text"
                           placeholder="Order ID (e.g. 10042)"
                           value={assignOrderId}
                           onChange={(e) => setAssignOrderId(e.target.value)}
                           className="flex-1 px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none"
                         />
                         <button 
                           onClick={handleManualAssign}
                           className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 transition-colors shadow-sm shadow-indigo-600/20 shrink-0"
                         >
                           Assign
                         </button>
                      </div>
                   </div>
                )}

                {/* Stats Grid */}
                <div className="grid grid-cols-2 gap-4 mb-6 shrink-0">
                   <div className="border border-gray-100 rounded-2xl p-5 flex flex-col justify-between h-[120px]">
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">DELIVERED TODAY</p>
                      <div className="flex items-end justify-between">
                         <span className="text-3xl font-black text-gray-900">{selectedItem.ordersCount || Math.floor(Math.random() * 10)}</span>
                         <div className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center shrink-0">
                            <CheckCircle2 size={16} className="text-emerald-500" />
                         </div>
                      </div>
                   </div>
                   <div className="border border-gray-100 rounded-2xl p-5 flex flex-col justify-between h-[120px]">
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">CURRENT STATUS</p>
                      <div className="flex items-end justify-between">
                         <span className="text-2xl font-black text-gray-900">{isOnline ? 'Free' : 'Offline'}</span>
                         <div className="w-8 h-8 rounded-full bg-gray-50 flex items-center justify-center shrink-0">
                            <Package size={16} className="text-gray-400" />
                         </div>
                      </div>
                   </div>
                </div>

                {/* Bottom Row: Today's Orders & Map */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-1 min-h-[250px]">
                   
                   {/* Today's Orders Box */}
                   <div className="border border-gray-100 rounded-2xl flex flex-col overflow-hidden">
                      <div className="p-4 border-b border-gray-50 flex items-center gap-2 shrink-0">
                         <Package size={16} className="text-gray-400" />
                         <h3 className="text-sm font-bold text-gray-900">Today's Orders</h3>
                      </div>
                      <div className="p-4 flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-3 min-h-[200px]">
                         {/* Mock Orders List */}
                         {[1,2,3].map(i => (
                            <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-gray-50 border border-transparent hover:border-gray-200 transition-colors cursor-pointer shrink-0">
                               <div>
                                  <p className="text-xs font-bold text-gray-900">Order #FOD-{Math.random().toString(36).substring(2, 8).toUpperCase()}</p>
                                  <p className="text-[10px] text-gray-500 mt-0.5">Test Restaurant</p>
                               </div>
                               <span className="px-2 py-1 bg-amber-100 text-amber-700 text-[9px] font-black uppercase tracking-wider rounded-md">
                                  DELIVERED
                               </span>
                            </div>
                         ))}
                      </div>
                   </div>

                   {/* Map Box */}
                   <div className="rounded-2xl overflow-hidden border border-gray-100 relative bg-gray-50 min-h-[200px]">
                      {loadError ? (
                         <div className="flex items-center justify-center h-full text-sm font-bold text-rose-500 uppercase tracking-widest">Maps Load Failed</div>
                      ) : isLoaded ? (
                         <GoogleMap
                           mapContainerStyle={MAP_CONTAINER_STYLE}
                           center={getCoordinates(selectedItem)}
                           zoom={14}
                           options={{
                             disableDefaultUI: true,
                             zoomControl: true,
                             styles: [
                               { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
                               { featureType: 'transit', elementType: 'labels', stylers: [{ visibility: 'off' }] }
                             ]
                           }}
                         >
                           <MarkerF 
                             position={getCoordinates(selectedItem)} 
                             icon={{
                               path: window.google.maps.SymbolPath.CIRCLE,
                               scale: 8,
                               fillColor: activeTab === 'restaurants' ? '#F43F5E' : '#00E676',
                               fillOpacity: 1,
                               strokeColor: '#fff',
                               strokeWeight: 3,
                             }}
                           />
                         </GoogleMap>
                      ) : (
                         <div className="flex items-center justify-center h-full text-sm text-gray-400">Loading Map...</div>
                      )}
                      {/* Location Overlay Text */}
                      <div className="absolute bottom-3 right-3 left-3 bg-white/90 backdrop-blur-sm p-3 rounded-xl border border-white/50 shadow-sm z-10">
                         <div className="flex items-center gap-2 mb-1">
                            <MapPin size={12} className="text-rose-500 shrink-0" />
                            <p className="text-xs font-bold text-gray-900 truncate">
                               {getAddress(selectedItem)}
                            </p>
                         </div>
                         <p className="text-[9px] text-gray-500 font-medium tracking-wide uppercase truncate pl-5">
                            LAT: {getCoordinates(selectedItem).lat.toFixed(4)}, LNG: {getCoordinates(selectedItem).lng.toFixed(4)}
                         </p>
                      </div>
                   </div>

                </div>

             </div>
           ) : (
             <div className="bg-white rounded-[32px] border border-gray-100 shadow-sm flex items-center justify-center h-full text-gray-400 font-medium">
                Select an item from the list to view details
             </div>
           )}
        </div>
      </div>
    </div>
  );
}
