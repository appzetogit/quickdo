import React, { useState, useEffect, useMemo } from "react";
import { FiGrid, FiPlus, FiEdit2, FiTrash2, FiPackage, FiSearch } from "react-icons/fi";
import { toast } from "react-hot-toast";
import CardShell from "../components/CardShell";
import Modal from "../components/Modal";
import { ensureIds, saveCatalog, toAssetUrl } from "../utils";
import { brandService, serviceService, categoryService } from "@sp/services/catalogService";
import { z } from "zod";

// Schema for Service Entity (Child of Brand)
const serviceSchema = z.object({
  title: z.string().min(2, "Title is required"),
  basePrice: z.number().min(0, "Price must be non-negative"),
  gstPercentage: z.number().min(0).max(100).default(18),
  discountPrice: z.number().optional(),
  pricingUnit: z.string().optional(),
  categoryId: z.string().min(1, "Category is required")
});

const ServicesPage = ({ catalog, setCatalog, selectedCity }) => {
  const [fetching, setFetching] = useState(false);
  const servicesData = catalog.services || []; // Brands
  const categories = catalog.categories || [];

  // Filter logic for Brands
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState("all");

  // Robust filtering logic
  const filteredBrands = useMemo(() => {
    // If no data, return empty
    if (!servicesData || servicesData.length === 0) return [];

    // If filter is "all", show everything
    if (selectedCategoryFilter === "all") return servicesData;

    const filterId = String(selectedCategoryFilter);

    return servicesData.filter(s => {
      // 1. Check legacy categoryId
      let directId = s.categoryId?.$oid || s.categoryId;
      if (directId && typeof directId === 'object') {
        directId = directId._id || directId.id; // Extract ID if populated
      }
      if (String(directId) === filterId) return true;

      // 2. Check categoryIds array
      if (Array.isArray(s.categoryIds) && s.categoryIds.length > 0) {
        return s.categoryIds.some(cat => {
          let id = cat?.$oid || cat;
          if (id && typeof id === 'object') {
            id = id._id || id.id; // Extract ID if populated
          }
          return String(id) === filterId;
        });
      }

      return false;
    });
  }, [servicesData, selectedCategoryFilter]);

  // Selected Brand State
  const [activeBrandId, setActiveBrandId] = useState(null);
  const activeBrand = servicesData.find(s => s.id === activeBrandId) || null;

  // Services List State (The child services of the brand)
  const [brandServices, setBrandServices] = useState([]);
  const [loadingServices, setLoadingServices] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  // Fetch data on mount or city change
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Only show full loading spinner if we don't have data yet
        if (!catalog.services || catalog.services.length === 0) {
          setFetching(true);
        }

        const params = { status: 'active' };
        if (selectedCity) params.cityId = selectedCity;

        const [servicesRes, categoriesRes] = await Promise.all([
          brandService.getAll(params),
          categoryService.getAll(params)
        ]);

        let mappedBrands = [];
        let mappedCategories = [];

        if (servicesRes.success) {
          mappedBrands = servicesRes.brands.map((svc) => {
            // Handle potential MongoDB extended JSON format from raw dumps or different endpoints
            const safeId = svc.id || svc._id?.$oid || svc._id;
            const safeCategoryId = svc.categoryId?.$oid || svc.categoryId;
            const safeCategoryIds = (svc.categoryIds || []).map(cid => cid?.$oid || cid);

            return {
              id: safeId,
              title: svc.title,
              slug: svc.slug,
              categoryIds: safeCategoryIds,
              categoryTitles: svc.categoryTitles || [],
              categoryId: safeCategoryId,
              iconUrl: svc.iconUrl || "",
              badge: svc.badge || "",
              routePath: svc.routePath || `/user/${svc.slug}`,
              page: svc.page || {},
              sections: svc.sections || [],
            };
          });
        }

        if (categoriesRes.success) {
          mappedCategories = categoriesRes.categories.map(cat => ({
            id: (cat.id || cat._id?.$oid || cat._id)?.toString() || "",
            title: cat.title,
            slug: cat.slug
          }));
        }

        setCatalog(prev => {
          const next = { ...prev, services: mappedBrands, categories: mappedCategories };
          saveCatalog(next);
          return next;
        });

      } catch (error) {
        console.error('Failed to fetch catalog data:', error);
        toast.error(`Failed to load data: ${error.response?.data?.message || error.message}`);
      } finally {
        setFetching(false);
      }
    };

    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCity]); // Only re-fetch when city changes

  // Auto-select first brand
  useEffect(() => {
    if (filteredBrands.length > 0) {
      if (!activeBrandId || !filteredBrands.find(b => b.id === activeBrandId)) {
        setActiveBrandId(filteredBrands[0].id);
      }
    } else {
      setActiveBrandId(null);
      setBrandServices([]);
    }
  }, [filteredBrands]);

  // Fetch Services when Active Brand Changes
  useEffect(() => {
    const fetchServices = async () => {
      if (!activeBrandId) return;

      try {
        setLoadingServices(true);
        // Using serviceService to get services for this brand
        const response = await serviceService.getAll({ brandId: activeBrandId });
        if (response.success) {
          setBrandServices(response.services || []);
        } else {
          setBrandServices([]);
        }
      } catch (error) {
        console.error("Failed to fetch brand services:", error);
        toast.error("Failed to load services");
      } finally {
        setLoadingServices(false);
      }
    };

    fetchServices();
  }, [activeBrandId]);

  // Form State
  const [editingId, setEditingId] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState({
    title: "",
    basePrice: "",
    gstPercentage: 18,
    discountPrice: "",
    pricingUnit: "",
    categoryId: ""
  });
  const [saving, setSaving] = useState(false);

  // Form Actions
  const resetForm = () => {
    setEditingId(null);

    // Default to strict category if filter is active
    let defaultCat = "";
    if (selectedCategoryFilter !== "all") {
      defaultCat = selectedCategoryFilter;
    } else {
      defaultCat = activeBrand?.categoryIds?.[0] || activeBrand?.categoryId || "";
    }

    setForm({
      title: "",
      basePrice: "",
      gstPercentage: 18,
      discountPrice: "",
      pricingUnit: "",
      categoryId: defaultCat
    });
    setIsModalOpen(false);
  };

  const handleEdit = (service) => {
    setEditingId(service.id || service._id);
    setForm({
      title: service.title,
      basePrice: service.basePrice,
      gstPercentage: service.gstPercentage || 18,
      discountPrice: service.discountPrice || "",
      pricingUnit: service.pricingUnit || "",
      categoryId: service.categoryId?._id || service.categoryId || ""
    });
    setIsModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!activeBrandId) return;

    const data = {
      title: form.title,
      basePrice: Number(form.basePrice),
      gstPercentage: Number(form.gstPercentage),
      discountPrice: form.discountPrice ? Number(form.discountPrice) : undefined,
      pricingUnit: form.pricingUnit,
      categoryId: form.categoryId
    };

    if (form.categoryId === "all") {
      // Logic for adding to ALL categories assigned to the brand
      const uniqueIds = new Set(activeBrand?.categoryIds || []);
      if (activeBrand?.categoryId) uniqueIds.add(activeBrand.categoryId);
      const categoryIds = Array.from(uniqueIds);

      if (categoryIds.length === 0) {
        toast.error("No categories available for this brand to add service to all.");
        return;
      }

      try {
        setSaving(true);
        let successCount = 0;
        const creations = categoryIds.map(catId => 
          serviceService.create({ ...data, categoryId: String(catId), brandId: activeBrandId })
        );
        
        const results = await Promise.all(creations);
        results.forEach(res => { if(res.success) successCount++; });

        toast.success(`Service added to ${successCount} categories`);
        resetForm();
        const reloadRes = await serviceService.getAll({ brandId: activeBrandId });
        if (reloadRes.success) setBrandServices(reloadRes.services);
      } catch (error) {
        console.error("Save all services error:", error);
        toast.error("Failed to add service to all categories");
      } finally {
        setSaving(false);
      }
      return;
    }

    const result = serviceSchema.safeParse(data);
    if (!result.success) {
      toast.error(result.error.errors[0].message);
      return;
    }

    try {
      setSaving(true);
      if (editingId) {
        const response = await serviceService.update(editingId, {
          ...result.data,
          brandId: activeBrandId
        });
        if (response.success) {
          toast.success("Service updated");
          // Refresh list locally
          setBrandServices(prev => prev.map(s => (s.id === editingId || s._id === editingId ? { ...s, ...result.data, categoryId: result.data.categoryId } : s)));
          resetForm();
          // Reload to ensure population
          const reloadRes = await serviceService.getAll({ brandId: activeBrandId });
          if (reloadRes.success) setBrandServices(reloadRes.services);
        }
      } else {
        const response = await serviceService.create({
          ...result.data,
          brandId: activeBrandId
        });
        if (response.success) {
          toast.success("Service created");
          setBrandServices(prev => [...prev, response.service || response.data]);
          resetForm();
          // Reload to be safe
          const reloadRes = await serviceService.getAll({ brandId: activeBrandId });
          if (reloadRes.success) setBrandServices(reloadRes.services);
        }
      }
    } catch (error) {
      console.error("Save service error:", error);
      toast.error(error.response?.data?.message || "Failed to save service");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to delete this service?")) return;
    try {
      await serviceService.delete(id);
      toast.success("Service deleted");
      setBrandServices(prev => prev.filter(s => (s.id !== id && s._id !== id)));
    } catch (error) {
      console.error("Delete service error:", error);
      toast.error("Failed to delete service");
    }
  };

  // Filtered Services List based on search AND Selected Category
  const displayedServices = useMemo(() => {
    let result = brandServices;

    // Filter by Category if selected
    if (selectedCategoryFilter !== "all" && selectedCategoryFilter) {
      result = result.filter(s => {
        // Handle populated object or direct string ID
        const sCatId = s.categoryId?._id || s.categoryId;
        return String(sCatId) === String(selectedCategoryFilter);
      });
    }

    if (!searchTerm) return result;
    const lower = searchTerm.toLowerCase();
    return result.filter(s => s.title.toLowerCase().includes(lower));
  }, [brandServices, searchTerm, selectedCategoryFilter]);

  return (
    <div className="space-y-6">
      <CardShell icon={FiPackage}>
        {/* Top: Category Filter Only */}
        <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
          <label className="block text-sm font-bold text-gray-700 mb-2">Filter by Category</label>
          <div className="flex gap-2 items-center">
            <div className="relative flex-1">
              <select
                value={selectedCategoryFilter}
                onChange={(e) => setSelectedCategoryFilter(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm font-medium text-gray-700 shadow-sm appearance-none cursor-pointer"
              >
                <option value="all">All Categories</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="text-sm text-gray-500 whitespace-nowrap px-2">
              <strong>{filteredBrands.length}</strong> brands
            </div>
          </div>
        </div>
      </CardShell>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
        {/* LEFT COLUMN: LIST OF BRANDS */}
        <div className="lg:col-span-1">
          <CardShell icon={FiGrid} title="Select Brand">
            <div className="max-h-[600px] overflow-y-auto space-y-2 pr-1">
              {fetching && (!servicesData || servicesData.length === 0) ? (
                <div className="text-center py-4 text-sm text-gray-500">Loading brands...</div>
              ) : filteredBrands.length === 0 ? (
                <div className="text-center text-gray-400 py-4 text-sm">No brands found</div>
              ) : (
                filteredBrands.map(brand => (
                  <div
                    key={brand.id}
                    onClick={() => setActiveBrandId(brand.id)}
                    className={`p-3 rounded-lg border cursor-pointer transition-all flex items-center gap-3 ${activeBrandId === brand.id
                      ? 'bg-blue-50 border-blue-500 shadow-sm ring-1 ring-blue-200'
                      : 'bg-white border-gray-200 hover:border-blue-300 hover:bg-gray-50'
                      }`}
                  >
                    {brand.iconUrl ? (
                      <img src={toAssetUrl(brand.iconUrl)} className="w-8 h-8 rounded-md object-contain bg-white border border-gray-100" />
                    ) : (
                      <div className="w-8 h-8 rounded-md bg-gray-100 flex items-center justify-center text-xs text-gray-400 font-bold">
                        {brand.title.charAt(0)}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className={`font-bold text-sm truncate ${activeBrandId === brand.id ? 'text-blue-700' : 'text-gray-800'}`}>
                        {brand.title}
                      </div>
                      <div className="text-xs text-gray-400 truncate" title={
                        selectedCategoryFilter !== "all"
                          ? categories.find(c => String(c.id) === String(selectedCategoryFilter))?.title
                          : (brand.categoryIds && brand.categoryIds.length > 0
                            ? brand.categoryIds.map(cid => {
                              const cIdStr = cid?._id || cid; // Handle populated ID if any
                              return categories.find(c => String(c.id) === String(cIdStr))?.title;
                            }).filter(Boolean).join(', ')
                            : 'Uncategorized')
                      }>
                        {selectedCategoryFilter !== "all"
                          ? categories.find(c => String(c.id) === String(selectedCategoryFilter))?.title
                          : (brand.categoryIds && brand.categoryIds.length > 0
                            ? brand.categoryIds.map(cid => {
                              const cIdStr = cid?._id || cid;
                              return categories.find(c => String(c.id) === String(cIdStr))?.title;
                            }).filter(Boolean).join(', ')
                            : ((categories.find(c => String(c.id) === String(brand.categoryId))?.title) || 'Uncategorized')
                          )
                        }
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardShell>
        </div>

        {/* RIGHT COLUMN: SERVICES LIST */}
        <div className="lg:col-span-3">
          {activeBrand ? (
            <CardShell icon={FiPackage}>
              <div className="flex flex-col md:flex-row justify-between md:items-center gap-4 mb-6 border-b border-gray-100 pb-4">
                <div>
                  <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                    {activeBrand.iconUrl && <img src={toAssetUrl(activeBrand.iconUrl)} className="w-6 h-6 object-contain" />}
                    {activeBrand.title}
                  </h3>
                  <p className="text-sm text-gray-500">Manage individual services for this brand</p>
                </div>

                <div className="flex items-center gap-3">
                  <div className="relative">
                    <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search services..."
                      value={searchTerm}
                      onChange={e => setSearchTerm(e.target.value)}
                      className="pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 w-48"
                    />
                  </div>
                  <button
                    onClick={() => {
                      resetForm();
                      setIsModalOpen(true);
                    }}
                    className="px-4 py-2 bg-primary-600 text-white rounded-lg font-semibold shadow-md hover:bg-primary-700 transition-all flex items-center gap-2"
                  >
                    <FiPlus className="w-4 h-4" />
                    Add Service
                  </button>
                </div>
              </div>

              {loadingServices ? (
                <div className="text-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
                </div>
              ) : displayedServices.length === 0 ? (
                <div className="text-center py-12 bg-gray-50 rounded-xl border border-dashed border-gray-300">
                  <FiPackage className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500 font-bold">No services found for {activeBrand.title}</p>
                  <button onClick={() => setIsModalOpen(true)} className="mt-2 text-primary-600 hover:underline text-sm font-semibold">
                    Add the first service
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {displayedServices.map((service) => {
                    const catId = service.categoryId?._id || service.categoryId;
                    const cat = categories.find(c => String(c.id) === String(catId));
                    const catTitle = service.categoryId?.title || cat?.title || "Uncategorized";

                    return (
                      <div key={service.id || service._id} className="bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md transition-shadow relative group">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <h4 className="font-bold text-gray-900 pr-6">{service.title}</h4>
                            <span className="text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded mr-2 mt-1 inline-block">
                              {catTitle}
                            </span>
                          </div>
                          <span className="bg-green-50 text-green-700 text-[10px] px-2 py-0.5 rounded font-bold border border-green-100 whitespace-nowrap">
                            {service.gstPercentage}% GST
                          </span>
                        </div>

                        <div className="space-y-1 mt-2">
                          <div className="flex justify-between items-baseline">
                            <span className="text-xs text-gray-500">Base Price</span>
                            <span className="font-semibold text-gray-900">₹{service.basePrice}</span>
                          </div>
                          {service.discountPrice && (
                            <div className="flex justify-between items-baseline">
                              <span className="text-xs text-gray-500">Discounted</span>
                              <span className="font-bold text-primary-600">₹{service.discountPrice}</span>
                            </div>
                          )}
                        </div>

                        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 p-1 rounded-lg backdrop-blur-sm shadow-sm">
                          <button onClick={() => handleEdit(service)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded">
                            <FiEdit2 className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => handleDelete(service.id || service._id)} className="p-1.5 text-red-600 hover:bg-red-50 rounded">
                            <FiTrash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardShell>
          ) : (
            <div className="h-full flex flex-col items-center justify-center p-12 bg-gray-50 rounded-xl border border-gray-200 text-center text-gray-500">
              <p>Select a brand from the left to manage its services.</p>
            </div>
          )}
        </div>
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={resetForm}
        title={editingId ? "Edit Service" : "Add Service"}
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">Category</label>
            <select
              value={form.categoryId}
              onChange={e => setForm({ ...form, categoryId: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white"
              required
            >
              <option value="">Select Category</option>
              <option value="all">All (Add to every category below)</option>
              {(() => {
                const uniqueIds = new Set(activeBrand?.categoryIds || []);
                if (activeBrand?.categoryId) uniqueIds.add(activeBrand.categoryId);

                const validOptions = Array.from(uniqueIds).map(catId => {
                  const category = categories.find(c => String(c.id) === String(catId));
                  if (!category) return null;
                  return { id: catId, title: category.title };
                }).filter(Boolean);

                return validOptions.length > 0 ? (
                  validOptions.map(opt => (
                    <option key={opt.id} value={opt.id}>{opt.title}</option>
                  ))
                ) : (
                  <option value="" disabled>No categories assigned to this brand</option>
                );
              })()}
            </select>
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">Service Title</label>
            <input
              value={form.title}
              onChange={e => setForm({ ...form, title: e.target.value })}
              placeholder="e.g. Full AC Service"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Base Price (₹)</label>
              <input
                type="number"
                value={form.basePrice}
                onChange={e => setForm({ ...form, basePrice: e.target.value })}
                placeholder="0"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                required
                min="0"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">GST (%)</label>
              <input
                type="number"
                value={form.gstPercentage}
                onChange={e => setForm({ ...form, gstPercentage: e.target.value })}
                placeholder="18"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                required
                min="0"
                max="100"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-bold text-gray-700 mb-1">Pricing Unit (Optional)</label>
              <input
                value={form.pricingUnit}
                onChange={e => setForm({ ...form, pricingUnit: e.target.value })}
                placeholder="e.g. per sq ft, per visit"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>

          {/* 
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">Discount Price (Optional)</label>
            <input
              type="number"
              value={form.discountPrice}
              onChange={e => setForm({ ...form, discountPrice: e.target.value })}
              placeholder="Leave empty if none"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            />
          </div>
          */}

          <div className="pt-4 flex justify-end gap-3 border-t border-gray-100 mt-4">
            <button
              type="button"
              onClick={resetForm}
              className="px-4 py-2 text-gray-600 font-medium hover:bg-gray-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2 bg-primary-600 text-white font-bold rounded-lg hover:bg-primary-700 transition-colors shadow-sm disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Service"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default ServicesPage;

