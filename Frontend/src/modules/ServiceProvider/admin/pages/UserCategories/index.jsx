import React, { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ensureIds, loadCatalog } from "./utils";
import HomePage from "./pages/HomePage";
import CategoriesPage from "./pages/CategoriesPage";
import ServicesPage from "./pages/ServicesPage";
import BrandsPage from "./pages/BrandsPage";
import VendorServicesPage from "./pages/VendorServicesPage";
import VendorPartsPage from "./pages/VendorPartsPage";

import { cityService } from "../../services/cityService";

const UserCategories = () => {
  const [catalog, setCatalog] = useState(() => ensureIds(loadCatalog()));
  const [cities, setCities] = useState([]);
  const [selectedCity, setSelectedCity] = useState('');

  useEffect(() => {
    const handler = () => setCatalog(ensureIds(loadCatalog()));
    window.addEventListener("adminUserAppCatalogUpdated", handler);
    return () => window.removeEventListener("adminUserAppCatalogUpdated", handler);
  }, []);

  // Fetch cities once for the parent container
  useEffect(() => {
    const fetchCities = async () => {
      try {
        const response = await cityService.getAll();
        if (response.success) {
          const loadedCities = (response.cities || []).filter(city => city.isActive);
          setCities(loadedCities);

          // Auto-select default or first city if none selected
          // Removed to keep 'Global (All Cities)' as default
          // if (!selectedCity && loadedCities.length > 0) {
          //   const defaultCity = loadedCities.find(c => c.isDefault);
          //   // Handle potentially different ID formats
          //   const cityId = defaultCity
          //     ? (defaultCity._id || defaultCity.id)
          //     : (loadedCities[0]._id || loadedCities[0].id);

          //   if (cityId) {
          //     setSelectedCity(cityId);
          //   }
          // }
        }
      } catch (error) {
        console.error('Failed to fetch cities:', error);
      }
    };
    fetchCities();
  }, []);

  // Get admin role to control UI visibility
  const isAdminSuper = (() => {
    try {
      const storedData = sessionStorage.getItem('adminData') || localStorage.getItem('adminData');
      const stored = JSON.parse(storedData || '{}');
      return (stored.role || 'admin') === 'super_admin';
    } catch (e) {
      return false;
    }
  })();

  return (
    <div className="space-y-4">
      {/* Global City Filter Header - Visible only to Super Admin */}
      {isAdminSuper && (
        <div className="bg-gradient-to-r from-slate-800 to-slate-900 p-4 rounded-xl shadow-lg flex items-center justify-between text-white border border-slate-700">
          <div>
            <h2 className="text-lg font-bold text-white">Parameters</h2>
            <p className="text-sm text-slate-300">Filter all catalog content by city</p>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-slate-200">Selected City:</label>
            <select
              value={selectedCity}
              onChange={(e) => setSelectedCity(e.target.value)}
              className="px-4 py-2 bg-slate-700 text-white border border-slate-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 min-w-[200px]"
            >
              <option value="">Global (All Cities)</option>
              {cities.map(city => {
                const cityId = city._id || city.id;
                return <option key={cityId} value={cityId}>{city.name}</option>
              })}
            </select>
          </div>
        </div>
      )}

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
        <Routes>
          <Route index element={<Navigate to="home" replace />} />
          <Route path="home" element={<HomePage catalog={catalog} setCatalog={setCatalog} selectedCity={selectedCity} />} />
          <Route path="categories" element={<CategoriesPage catalog={catalog} setCatalog={setCatalog} selectedCity={selectedCity} />} />
          <Route path="sections" element={<ServicesPage catalog={catalog} setCatalog={setCatalog} selectedCity={selectedCity} />} />
          <Route path="brands" element={<BrandsPage catalog={catalog} setCatalog={setCatalog} selectedCity={selectedCity} />} />
          <Route path="vendor-services" element={<VendorServicesPage />} />
          <Route path="vendor-parts" element={<VendorPartsPage />} />
          <Route path="*" element={<Navigate to="home" replace />} />
        </Routes>
      </motion.div>
    </div>
  );
};

export default UserCategories;



