import React, { useState, useEffect } from 'react';
import { getPlans, createPlan, updatePlan, deletePlan } from '../../services/planService';
import { categoryService, brandService, serviceService } from '@sp/services/catalogService';
import { FiPlus, FiEdit2, FiTrash2, FiCheck, FiX, FiList, FiPackage, FiTool, FiChevronRight, FiBriefcase } from 'react-icons/fi';
import { toast } from 'react-hot-toast';

const Plans = () => {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentPlan, setCurrentPlan] = useState(null);
  const [formData, setFormData] = useState({ name: 'Silver', price: '', tagline: '', description: '', validityMonths: 1, freeCategories: [], freeBrands: [], freeServices: [], bonusServices: [] });

  const PLAN_TYPES = ['Silver', 'Gold', 'Diamond', 'Platinum'];

  const getCardStyle = (name) => {
    const lower = name.toLowerCase();

    if (lower.includes('platinum')) {
      return {
        container: 'bg-slate-900 text-white border-slate-700 ring-1 ring-slate-700',
        text: 'text-white',
        subtext: 'text-slate-400',
        badge: 'bg-slate-800 text-white',
        price: 'text-white',
        check: 'text-slate-900 bg-white',
        footer: 'bg-slate-800 border-slate-700'
      };
    }
    if (lower.includes('diamond')) {
      return {
        container: 'bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white border-transparent shadow-xl ring-0',
        text: 'text-white',
        subtext: 'text-indigo-100',
        badge: 'bg-white/20 text-white',
        price: 'text-white',
        check: 'text-indigo-600 bg-white',
        footer: 'bg-white/10 border-white/20'
      }
    }
    if (lower.includes('gold')) {
      return {
        container: 'bg-gradient-to-br from-amber-100 to-yellow-100 border-amber-200 text-amber-900',
        text: 'text-amber-900',
        subtext: 'text-amber-700',
        badge: 'bg-amber-200 text-amber-800',
        price: 'text-amber-900',
        check: 'text-amber-100 bg-amber-600',
        footer: 'bg-amber-50/80 border-amber-200'
      };
    }
    // Silver / Default
    return {
      container: 'bg-gradient-to-br from-gray-100 to-slate-200 border-gray-300 text-gray-800',
      text: 'text-gray-900',
      subtext: 'text-gray-600',
      badge: 'bg-white/50 text-gray-700',
      price: 'text-gray-900',
      check: 'text-gray-700 bg-white/60',
      footer: 'bg-gray-50 border-gray-200'
    };
  };

  // Catalog State
  const [categories, setCategories] = useState([]);
  const [brandsList, setBrandsList] = useState([]); // All brands
  const [servicesList, setServicesList] = useState([]); // All services
  const [filteredBrands, setFilteredBrands] = useState([]); // Brands for selected category
  const [filteredServices, setFilteredServices] = useState([]); // Services for selected brand
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedBrand, setSelectedBrand] = useState('');
  const [selectedService, setSelectedService] = useState('');

  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
    setLoading(true);
    try {
      const [plansRes, catsRes, brandsRes, servsRes] = await Promise.all([
        getPlans(),
        categoryService.getAll(),
        brandService.getAll(),
        serviceService.getAll({ status: 'active' })
      ]);

      console.log('DEBUG: catsRes', catsRes);
      console.log('DEBUG: brandsRes', brandsRes);
      console.log('DEBUG: servsRes', servsRes);

      if (plansRes.success) setPlans(plansRes.data);

      // Robust data extraction for categories
      const categoriesData = catsRes.categories || catsRes.data || (Array.isArray(catsRes) ? catsRes : []);
      const finalCats = Array.isArray(categoriesData) ? categoriesData : [];
      console.log('DEBUG: finalCats', finalCats);
      setCategories(finalCats);

      // Robust data extraction for brands
      const brandsData = brandsRes.brands || brandsRes.data || (Array.isArray(brandsRes) ? brandsRes : []);
      const finalBrands = Array.isArray(brandsData) ? brandsData : [];
      console.log('DEBUG: finalBrands', finalBrands);
      setBrandsList(finalBrands);

      // Robust data extraction for services
      const servicesData = servsRes.services || servsRes.data || (Array.isArray(servsRes) ? servsRes : []);
      const finalServices = Array.isArray(servicesData) ? servicesData : [];
      console.log('DEBUG: finalServices', finalServices);
      setServicesList(finalServices);

    } catch (error) {
      console.error('DEBUG: fetchInitialData error', error);
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const fetchPlans = async () => {
    try {
      const res = await getPlans();
      if (res.success) setPlans(res.data);
    } catch (error) {
      console.error('Refresh plans failed', error);
    }
  };

  // Filter brands when category changes
  useEffect(() => {
    if (!selectedCategory) {
      setFilteredBrands([]);
      return;
    }
    const filtered = brandsList.filter(b => {
      if (!b) return false;
      const bCatId = b.categoryId?._id || b.categoryId;
      const directMatch = String(bCatId) === String(selectedCategory);
      const idsMatch = Array.isArray(b.categoryIds) && b.categoryIds.some(cat => {
        if (!cat) return false;
        const catId = cat.id || cat._id || cat;
        return String(catId) === String(selectedCategory);
      });
      return directMatch || idsMatch;
    });
    setFilteredBrands(filtered);
    setSelectedBrand('');
    setSelectedService('');
  }, [selectedCategory, brandsList]);

  // Filter services when category changes
  useEffect(() => {
    if (!selectedCategory) {
      setFilteredServices([]);
      return;
    }
    const filtered = servicesList.filter(s => {
      if (!s) return false;
      const catId = s.categoryId?._id || s.categoryId || s.id;
      return String(catId) === String(selectedCategory);
    });
    setFilteredServices(filtered);
    setSelectedService('');
  }, [selectedCategory, servicesList]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      // Create a clean payload with only IDs for benefit arrays
      const payload = {
        ...formData,
        price: Number(formData.price),
        freeCategories: formData.freeCategories.map(c => String(c?._id || c)),
        freeServices: formData.freeServices.map(s => String(s?._id || s)),
        bonusServices: formData.bonusServices.map(bs => ({
          categoryId: String(bs.categoryId?._id || bs.categoryId),
          serviceId: String(bs.serviceId?._id || bs.serviceId)
        })),
        duration: String(formData.validityMonths || 1)
      };

      if (currentPlan) {
        await updatePlan(currentPlan._id, payload);
        toast.success('Plan updated successfully');
      } else {
        await createPlan(payload);
        toast.success('Plan created successfully');
      }
      setIsModalOpen(false);
      fetchPlans();
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || 'Error saving plan');
    }
  };

  const handleEdit = (plan) => {
    setCurrentPlan(plan);
    setFormData({
      name: plan.name,
      tagline: plan.tagline || '',
      description: plan.description || '',
        price: plan.price,
        validityMonths: plan.validityMonths || plan.validityDays || 1,
        freeCategories: (plan.freeCategories || []).map(c => c._id || c),
        freeServices: (plan.freeServices || []).map(s => s._id || s),
        bonusServices: (plan.bonusServices || []).map(bs => ({
          categoryId: bs.categoryId?._id || bs.categoryId,
          serviceId: bs.serviceId?._id || bs.serviceId
        }))
      });
      setIsModalOpen(true);
    
    // Auto-select first category/brand for easier editing
    if (plan.freeCategories?.length > 0) {
      const firstCatId = plan.freeCategories[0]?._id || plan.freeCategories[0];
      setSelectedCategory(String(firstCatId));
    } else if (plan.freeBrands?.length > 0) {
      const firstBrandObj = plan.freeBrands[0];
      const bCatId = firstBrandObj?.categoryId?._id || firstBrandObj?.categoryId;
      if (bCatId) setSelectedCategory(String(bCatId));
      setSelectedBrand(String(firstBrandObj?._id || firstBrandObj));
    } else if (plan.freeServices?.length > 0) {
      const firstSvcObj = plan.freeServices[0];
      const sCatId = firstSvcObj?.categoryId?._id || firstSvcObj?.categoryId;
      const sBrandId = firstSvcObj?.brandId?._id || firstSvcObj?.brandId;
      if (sCatId) setSelectedCategory(String(sCatId));
      if (sBrandId) setSelectedBrand(String(sBrandId));
    } else {
      setSelectedCategory('');
      setSelectedBrand('');
    }
    setSelectedService('');
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this plan?')) return;
    try {
      await deletePlan(id);
      toast.success('Plan deleted successfully');
      fetchPlans();
    } catch (error) {
      console.error(error);
      toast.error('Failed to delete plan');
    }
  };

  const openCreateModal = () => {
    setCurrentPlan(null);
    setFormData({ 
      name: 'Silver', 
      tagline: '',
      description: '',
      price: '', 
      validityMonths: 1,
      freeCategories: [], 
      freeServices: [], 
      bonusServices: [],
      isActive: true,
      duration: 'Monthly'
    });
    setIsModalOpen(true);
    setSelectedCategory('');
    setSelectedService('');
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end items-center">
        <button
          onClick={openCreateModal}
          className="px-3 py-1.5 bg-primary-600 text-white rounded-lg text-sm font-semibold hover:bg-primary-700 flex items-center gap-2 transition-colors shadow-sm"
        >
          <FiPlus className="w-4 h-4" /> Add New Plan
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center p-8">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {plans.map(plan => {
            const style = getCardStyle(plan.name);
            return (
              <div key={plan._id} className={`rounded-xl shadow-sm border overflow-hidden hover:shadow-md transition-all flex flex-col h-full ${style.container}`}>
                <div className="p-4 flex-1">
                  <div className="flex justify-between items-start mb-3">
                    <h3 className={`text-lg font-bold ${style.text}`}>{plan.name}</h3>
                    <span className={`px-1.5 py-0.5 text-[10px] rounded-full font-medium ${plan.isActive ? 'bg-green-500 text-white' : 'bg-gray-500 text-white'}`}>
                      {plan.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div className={`flex items-baseline gap-2 mb-4 ${style.price}`}>
                    <span className="text-2xl font-bold">₹{plan.price}</span>
                    <span className={`text-[10px] font-medium opacity-60`}>/ {plan.duration || plan.validityMonths || '1'} Months</span>
                  </div>

                  <div className="space-y-2 mb-4">
                    <h4 className={`text-[10px] font-bold uppercase tracking-wider ${style.subtext}`}>Includes</h4>
                    <div className="space-y-1.5">
                      {plan.freeCategories && plan.freeCategories.length > 0 && (
                        <div className={`flex flex-col gap-1 text-xs ${style.text}`}>
                          {plan.freeCategories.map((catRef, idx) => {
                            const catId = String(catRef?._id || catRef);
                            const cat = categories.find(c => String(c.id || c._id) === catId);
                            const displayTitle = cat ? cat.title : (catRef?.title || 'Unlimited Coverage');
                            return (
                              <div key={`c-v-${idx}`} className="flex items-center gap-2">
                                <FiCheck className={`w-3.5 h-3.5 ${style.check} rounded-full p-0.5`} />
                                <span>{displayTitle === 'Unlimited Coverage' ? 'Unlimited Coverage' : `Unlimited ${displayTitle}`}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {plan.freeServices && plan.freeServices.length > 0 && (
                        <div className={`flex flex-col gap-1 text-xs ${style.text}`}>
                          {(() => {
                            const groups = new Map();
                            plan.freeServices.forEach(svcRef => {
                              const svcId = String(svcRef?._id || svcRef);
                              const svc = servicesList.find(s => String(s.id || s._id) === svcId) || svcRef;
                              if (!svc || !svc.title) return;
                              
                              const cid = String(svc.categoryId?._id || svc.categoryId || 'unknown');
                              const tkey = svc.title.trim().toLowerCase();
                              const key = `${cid}_${tkey}`;
                              if (!groups.has(key)) {
                                groups.set(key, { svc, catTitle: svc.categoryId?.title || '' });
                              }
                            });

                            return Array.from(groups.values()).map((group, idx) => (
                              <div key={`s-v-${idx}`} className="flex items-center gap-2">
                                <FiCheck className={`w-3.5 h-3.5 ${style.check} rounded-full p-0.5`} />
                                <span className="truncate">
                                  Free {group.catTitle} {group.svc.title}
                                </span>
                              </div>
                            ));
                          })()}
                        </div>
                      )}

                      {plan.bonusServices && plan.bonusServices.length > 0 && (
                        <div className={`flex flex-col gap-1 text-xs ${style.text} mt-2`}>
                          <h5 className="text-[9px] font-bold opacity-70 uppercase mb-0.5 whitespace-nowrap overflow-hidden text-ellipsis">Free Benefit from Prev. Plan</h5>
                          {(() => {
                            const groups = new Map();
                            plan.bonusServices.forEach(bs => {
                              const svc = bs.serviceId;
                              if (!svc || !svc.title) return;
                              const cid = String(bs.categoryId?._id || bs.categoryId || svc.categoryId?._id || svc.categoryId || 'unknown');
                              const tkey = svc.title.trim().toLowerCase();
                              const key = `${cid}_${tkey}`;
                              if (!groups.has(key)) {
                                groups.set(key, { svc, catTitle: bs.categoryId?.title || svc.categoryId?.title || '' });
                              }
                            });

                            return Array.from(groups.values()).map((group, idx) => (
                              <div key={`bs-v-${idx}`} className="flex items-center justify-between gap-2 bg-black/5 rounded px-2 py-1">
                                <div className="flex items-center gap-2">
                                  <FiPlus className={`w-3 h-3 opacity-50`} />
                                  <span className="truncate max-w-[160px] font-medium">{group.svc.title}</span>
                                </div>
                                <span className="text-[10px] opacity-40 font-bold">₹</span>
                              </div>
                            ));
                          })()}
                        </div>
                      )}

                      {(!plan.freeCategories?.length && !plan.freeServices?.length) && (
                        <span className={`text-xs italic ${style.subtext}`}>No benefits configured</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className={`px-4 py-3 flex justify-end gap-2 border-t ${style.footer}`}>
                  <button
                    onClick={() => handleEdit(plan)}
                    className="p-2 bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white rounded-full transition-all duration-300"
                    title="Edit"
                  >
                    <FiEdit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(plan._id)}
                    className="p-2 bg-red-50 text-red-600 hover:bg-red-600 hover:text-white rounded-full transition-all duration-300"
                    title="Delete"
                  >
                    <FiTrash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )
          })}

          {plans.length === 0 && (
            <div className="col-span-full py-12 text-center text-gray-500 bg-white rounded-xl border border-dashed border-gray-300">
              <p>No plans found. Create one to get started.</p>
            </div>
          )}
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center p-4 z-50 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden animate-in fade-in zoom-in duration-200 my-8 flex flex-col max-h-[90vh]">

            <div className="px-8 py-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <div>
                <h2 className="text-2xl font-bold text-gray-800">{currentPlan ? 'Edit Configuration' : 'Create New Plan'}</h2>
                <p className="text-sm text-gray-500 mt-1">Define plan details and benefits</p>
              </div>
              <button onClick={() => setIsModalOpen(false)} className="bg-white p-2 rounded-full text-gray-400 hover:text-gray-600 shadow-sm border border-gray-200 transition-all hover:rotate-90">
                <FiX className="w-5 h-5" />
              </button>
            </div>

            <div className="p-8 overflow-y-auto custom-scrollbar space-y-8">

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-gray-700">Plan Type</label>
                  <select
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-all font-medium"
                    required
                  >
                    {PLAN_TYPES.map(type => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-semibold text-gray-700">Monthly Price (₹)</label>
                  <div className="relative">
                    <span className="absolute left-4 top-3.5 text-gray-500 font-bold">₹</span>
                    <input
                      type="number"
                      name="price"
                      value={formData.price}
                      onChange={handleInputChange}
                      className="w-full pl-8 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-all font-bold text-gray-800"
                      required
                      placeholder="999"
                      min="0"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-semibold text-gray-700">Validity (Months)</label>
                  <input
                    type="number"
                    name="validityMonths"
                    value={formData.validityMonths}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-all font-bold text-gray-800"
                    required
                    placeholder="1"
                    min="1"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-gray-700">Tagline</label>
                  <input
                    type="text"
                    name="tagline"
                    value={formData.tagline}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-all font-medium"
                    placeholder="e.g. Best for small families"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-gray-700">Description</label>
                  <textarea
                    name="description"
                    value={formData.description}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-all font-medium min-h-[100px]"
                    placeholder="Describe the plan benefits in detail..."
                  />
                </div>
              </div>



              <div className="border border-gray-200 rounded-2xl overflow-hidden">
                <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <span className="bg-blue-100 text-blue-600 p-2 rounded-lg">
                      <FiCheck className="w-5 h-5" />
                    </span>
                    <div>
                      <h3 className="font-bold text-gray-800">Plan Benefits</h3>
                      <p className="text-xs text-gray-500">Configure free services included in this plan</p>
                    </div>
                  </div>
                </div>

                <div className="p-6 bg-white space-y-6">
                  <div className="flex flex-col md:flex-row gap-3 items-end">
                    <div className="flex-1 w-full space-y-1.5">
                      <label className="text-xs font-semibold text-gray-500 uppercase">Category</label>
                      <select
                        value={selectedCategory}
                        onChange={(e) => setSelectedCategory(e.target.value)}
                        className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      >
                        <option value="">Select Category...</option>
                        {categories.map(cat => (
                          <option key={cat.id || cat._id} value={cat.id || cat._id}>{cat.title}</option>
                        ))}
                      </select>
                    </div>

                    <div className="flex-1 w-full space-y-1.5">
                      <label className="text-xs font-semibold text-gray-500 uppercase">Service</label>
                        <select
                          value={selectedService}
                          onChange={(e) => setSelectedService(e.target.value)}
                          disabled={!selectedCategory}
                          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-gray-100 disabled:text-gray-400"
                        >
                          <option value="">{selectedCategory ? 'Select Service Type...' : 'Select Category first'}</option>
                          {(() => {
                            const uniqueNames = Array.from(new Set(filteredServices.map(s => (s.title || '').replace(/\s+/g, ' ').trim().toLowerCase()))).filter(Boolean).sort().map(tKey => {
                              const match = filteredServices.find(s => (s.title || '').replace(/\s+/g, ' ').trim().toLowerCase() === tKey);
                              return match ? match.title.replace(/\s+/g, ' ').trim() : tKey;
                            });
                            return uniqueNames.map(title => (
                              <option key={title} value={title}>All {title} Services (All Brands)</option>
                            ));
                          })()}
                        </select>
                    </div>

                    <button
                      type="button"
                      disabled={!selectedCategory}
                      onClick={() => {
                        let addedAny = false;
                          if (selectedService) {
                            const targetTitleRaw = selectedService.trim().toLowerCase();
                            const matches = filteredServices.filter(s => (s.title || '').trim().toLowerCase() === targetTitleRaw);
                            const matchIds = matches.map(s => String(s._id || s.id));
                          const currentIds = formData.freeServices.map(id => String(id?._id || id));
                          const newServices = [...new Set([...currentIds, ...matchIds])];
                          
                          if (newServices.length > currentIds.length) {
                            setFormData(p => ({ ...p, freeServices: newServices }));
                            addedAny = true;
                          }
                        } else if (selectedCategory) {
                          if (!formData.freeCategories.some(c => String(c._id || c) === String(selectedCategory))) {
                            setFormData(p => ({ ...p, freeCategories: [...p.freeCategories, selectedCategory] }));
                            addedAny = true;
                          }
                        }
                        
                        if (addedAny) {
                          toast.success('Benefit added to list');
                          setSelectedService('');
                        } else {
                          toast.error('Benefit already in list or nothing selected');
                        }
                      }}
                      className="h-[42px] px-6 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-blue-500/20 active:scale-95 transition-all w-full md:w-auto"
                    >
                      Add Benefit
                    </button>
                  </div>

                  <div className="h-px bg-gray-100 w-full"></div>

                  <div className="space-y-3">
                    <p className="text-sm font-semibold text-gray-700">Active Benefits</p>

                    <div className="flex flex-wrap gap-3">
                      {formData.freeCategories.map((catId, idx) => {
                        const targetId = String(catId?._id || catId);
                        const cat = categories.find(c => String(c.id || c._id) === targetId);
                        const displayTitle = cat ? cat.title : (catId?.title || 'Category');
                        return (
                          <div key={`c-tag-${idx}`} className="flex items-center gap-2 pl-3 pr-2 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-full text-sm font-medium shadow-sm">
                            <FiPackage className="w-4 h-4" />
                            <span>{displayTitle}</span>
                            <span className="bg-indigo-200 text-indigo-800 text-[10px] px-1.5 rounded-full uppercase">All Free</span>
                            <button
                              type="button"
                              onClick={() => setFormData(p => ({ ...p, freeCategories: p.freeCategories.filter(id => String(id?._id || id) !== targetId) }))}
                              className="ml-1 p-0.5 hover:bg-white rounded-full transition-colors text-indigo-400 hover:text-red-500"
                            >
                              <FiX className="w-4 h-4" />
                            </button>
                          </div>
                        );
                      })}

                      {/* Grouped Services - by Category AND Title */}
                      {(() => {
                        const groups = new Map();
                        formData.freeServices.forEach(svcId => {
                          const targetId = String(svcId?._id || svcId);
                          const svc = servicesList.find(s => String(s.id || s._id) === targetId);
                          if (!svc) return;
                          
                          const catId = String(svc.categoryId?._id || svc.categoryId);
                          const title = (svc.title || '').trim().toLowerCase();
                          const key = `${catId}_${title}`;
                          
                          if (!groups.has(key)) {
                            groups.set(key, { catId, title, ids: [] });
                          }
                          groups.get(key).ids.push(targetId);
                        });

                        return Array.from(groups.values()).map((group, idx) => {
                          const cat = categories.find(c => String(c.id || c._id) === group.catId);
                          const catName = cat ? cat.title : 'Category';
                          const displayTitle = group.title.charAt(0).toUpperCase() + group.title.slice(1);

                          return (
                            <div key={`svc-tag-${idx}`} className="flex items-center gap-2 pl-3 pr-2 py-1.5 bg-rose-50 text-rose-700 border border-rose-100 rounded-full text-sm font-medium shadow-sm">
                              <FiTool className="w-4 h-4" />
                              <span className="text-[10px] bg-rose-200/50 px-1.5 rounded uppercase font-black mr-1">{catName}</span>
                              <span className="font-bold">{displayTitle}</span>
                              <span className="text-[9px] opacity-60 ml-1">All Brands</span>
                              <button
                                type="button"
                                onClick={() => {
                                  setFormData(p => ({ 
                                    ...p, 
                                    freeServices: p.freeServices.filter(id => !group.ids.includes(String(id?._id || id)))
                                  }));
                                }}
                                className="ml-1 p-0.5 hover:bg-white rounded-full transition-colors text-rose-400 hover:text-red-500"
                              >
                                <FiX className="w-4 h-4" />
                              </button>
                            </div>
                          );
                        });
                      })()}

                      {formData.freeCategories.length === 0 && formData.freeServices.length === 0 && (
                        <p className="text-gray-400 text-sm italic w-full">No benefits added yet. Select a category above to start.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="border border-gray-200 rounded-2xl overflow-hidden">
                <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <span className="bg-emerald-100 text-emerald-600 p-2 rounded-lg">
                      <FiPackage className="w-5 h-5" />
                    </span>
                    <div>
                      <h3 className="font-bold text-gray-800">Free Benefit from Previous Plan</h3>
                      <p className="text-xs text-gray-500">Add services inherited from lower tiers</p>
                    </div>
                  </div>
                </div>

                <div className="p-6 bg-white space-y-6">
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col md:flex-row gap-3 items-end">
                      <div className="flex-1 w-full space-y-1.5">
                        <label className="text-xs font-semibold text-gray-500 uppercase">Category</label>
                        <select
                          value={selectedCategory}
                          onChange={(e) => setSelectedCategory(e.target.value)}
                          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                        >
                          <option value="">Select Category...</option>
                          {categories.map(cat => (
                            <option key={cat.id || cat._id} value={cat.id || cat._id}>{cat.title}</option>
                          ))}
                        </select>
                      </div>

                      <div className="flex-1 w-full space-y-1.5">
                        <label className="text-xs font-semibold text-gray-500 uppercase">Service</label>
                        <select
                          value={selectedService}
                          onChange={(e) => setSelectedService(e.target.value)}
                          disabled={!selectedCategory}
                          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none disabled:bg-gray-100 disabled:text-gray-400"
                        >
                          <option value="">{selectedCategory ? 'Select Service Type...' : 'Select Category first'}</option>
                          {(() => {
                            const uniqueNames = Array.from(new Set(filteredServices.map(s => (s.title || '').replace(/\s+/g, ' ').trim().toLowerCase()))).filter(Boolean).sort().map(tKey => {
                              const match = filteredServices.find(s => (s.title || '').replace(/\s+/g, ' ').trim().toLowerCase() === tKey);
                              return match ? match.title.replace(/\s+/g, ' ').trim() : tKey;
                            });
                            return uniqueNames.map(title => (
                              <option key={title} value={title}>All {title} Services (All Brands)</option>
                            ));
                          })()}
                        </select>
                      </div>
                    </div>

                    <div className="flex flex-col md:flex-row gap-3 items-end">
                      <button
                        type="button"
                        disabled={!selectedService}
                        onClick={() => {
                          const selectionTitleRaw = (selectedService || '').trim().toLowerCase();
                          if (!selectionTitleRaw) return;

                          // Find all service entries with this title (case-insensitive)
                          const matches = filteredServices.filter(s => (s.title || '').trim().toLowerCase() === selectionTitleRaw);
                          
                          let addedAny = false;
                          const newBonusEntries = [...formData.bonusServices];
                          
                          matches.forEach(svcObj => {
                            const svcId = String(svcObj._id || svcObj.id);
                            if (!newBonusEntries.some(bs => String(bs.serviceId?._id || bs.serviceId) === svcId)) {
                              newBonusEntries.push({
                                categoryId: selectedCategory,
                                serviceId: svcObj
                              });
                              addedAny = true;
                            }
                          });

                          if (addedAny) {
                            setFormData(p => ({ ...p, bonusServices: newBonusEntries }));
                            setSelectedService('');
                            toast.success('Benefits added to list');
                          } else {
                            toast.error('Service group already in benefit list');
                          }
                        }}
                        className="h-[42px] px-8 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-emerald-500/20 active:scale-95 transition-all w-full"
                      >
                        Add Service Group to Previous Plan Benefits
                      </button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <p className="text-sm font-semibold text-gray-700">Active Previous Plan Benefits</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {/* Grouped Bonus display - by Category AND Title */}
                      {(() => {
                        const bonusGroups = new Map();
                        formData.bonusServices.forEach(bs => {
                          const sid = String(bs.serviceId?._id || bs.serviceId);
                          const sObj = servicesList.find(s => String(s.id || s._id) === sid);
                          if (!sObj) return;

                          const cid = String(bs.categoryId?._id || bs.categoryId);
                          const title = (sObj.title || '').trim().toLowerCase();
                          const key = `${cid}_${title}`;

                          if (!bonusGroups.has(key)) {
                            bonusGroups.set(key, { bs, title, sid, cid, ids: [] });
                          }
                          bonusGroups.get(key).ids.push(sid);
                        });

                        return Array.from(bonusGroups.values()).map((group, idx) => {
                          const bs = group.bs;
                          const sampleSvc = servicesList.find(s => String(s.id || s._id) === group.sid);
                          const displayTitle = sampleSvc ? sampleSvc.title.trim() : group.title;
                          const catName = bs.categoryId?.title || (categories.find(c => String(c._id || c.id) === group.cid)?.title) || 'Category';

                          return (
                            <div key={`bs-tag-${idx}`} className="flex flex-col gap-1 pl-3 pr-2 py-3 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-xl text-sm font-medium shadow-sm relative">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] bg-emerald-100 text-emerald-600 px-2 py-0.5 rounded uppercase font-black tracking-wider">
                                  {catName}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setFormData(p => ({ 
                                      ...p, 
                                      bonusServices: p.bonusServices.filter(b => {
                                        const sid = b.serviceId?._id || b.serviceId;
                                        return !group.ids.includes(String(sid));
                                      }) 
                                    }));
                                  }}
                                  className="p-1 px-1.5 hover:bg-white rounded transition-colors text-emerald-400 hover:text-red-500"
                                >
                                  <FiX className="w-3.5 h-3.5" />
                                </button>
                              </div>
                              <div className="flex flex-col mt-1">
                                <span className="font-bold text-gray-800 leading-tight">
                                  {displayTitle} <span className="text-[10px] font-normal opacity-50 ml-1">(All Brands)</span>
                                </span>
                                <div className="flex items-center mt-2 text-[10px] opacity-40 uppercase tracking-widest italic">
                                  Tier Inheritance
                                </div>
                              </div>
                            </div>
                          );
                        });
                      })()}
                      {formData.bonusServices.length === 0 && (
                        <p className="text-gray-400 text-sm italic col-span-full">No bonus services added yet.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-8 py-5 border-t border-gray-100 bg-gray-50 flex justify-end gap-3 sticky bottom-0">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-6 py-2.5 bg-white border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-100 transition-colors shadow-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                className="px-8 py-2.5 bg-primary-600 text-white font-bold rounded-xl hover:bg-primary-700 transition-all shadow-lg shadow-primary-600/20 active:scale-95"
              >
                {currentPlan ? 'Save Changes' : 'Create Plan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Plans;

