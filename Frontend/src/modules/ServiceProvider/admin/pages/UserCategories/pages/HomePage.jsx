import React, { useMemo, useState, useEffect } from "react";
import { FiGrid, FiPlus, FiTrash2, FiSave, FiEdit2 } from "react-icons/fi";
import { toast } from "react-hot-toast";
import CardShell from "../components/CardShell";
import Modal from "../components/Modal";
import ToggleSwitch from "../components/ToggleSwitch"; // Import ToggleSwitch
import { ensureIds, saveCatalog, slugify, toAssetUrl } from "../utils";

import { homeContentService, serviceService } from "@sp/services/catalogService";

const RedirectionSelector = ({
  targetCategoryId,
  slug,
  onChange,
  label = "Redirection Target",
  categories = [],
  allServices = []
}) => {
  // Local state to manage the UI selections
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedSlug, setSelectedSlug] = useState("");

  // Sync props to state
  useEffect(() => {
    // 1. Sync the slug (Service selection)
    setSelectedSlug(slug || "");

    // 2. Determine the correctly selected category
    // If we have a service slug, we try to find its category from the full service list.
    // This is the most accurate source of truth.
    const serviceFromSlug = (slug && allServices?.length)
      ? allServices.find(s => s.slug === slug)
      : null;

    if (serviceFromSlug?.categoryId) {
      // If service found, enforce its category
      // Handle potential object/string mismatch
      const catId = serviceFromSlug.categoryId?._id || serviceFromSlug.categoryId;
      setSelectedCategory(typeof catId === 'object' ? String(catId) : catId);
    } else if (targetCategoryId) {
      // Fallback: If no service found (or no slug), trust the explicit targetCategoryId
      const catId = targetCategoryId?._id || targetCategoryId;
      setSelectedCategory(typeof catId === 'object' ? String(catId || "") : (catId || ""));
    } else if (!slug) {
      // If no slug and no category, reset (e.g. fresh add)
      setSelectedCategory("");
    }
    // Note: If slug exists but service not found AND no targetCategoryId, 
    // we leave selectedCategory as is (or it might be waiting for services to load).

  }, [slug, targetCategoryId, allServices]);

  const handleCategoryChange = (e) => {
    const catId = e.target.value;
    setSelectedCategory(catId);
    setSelectedSlug(""); // Reset service when category changes

    // Notify parent: Only Category selected
    onChange({ targetCategoryId: catId, slug: null, targetServiceId: null });
  };

  const handleServiceChange = (e) => {
    const svcSlug = e.target.value;
    setSelectedSlug(svcSlug);

    // Notify parent: Service selected (Category implied)
    // We pass the currently selected category as well
    const svc = allServices.find(s => s.slug === svcSlug);
    onChange({
      targetCategoryId: selectedCategory,
      slug: svcSlug || null,
      targetServiceId: svc ? (svc.id || svc._id) : null
    });
  };

  const filteredServices = selectedCategory
    ? allServices.filter(s => {
      const sCatId = s.categoryId?._id || s.categoryId;
      return String(sCatId) === String(selectedCategory);
    })
    : [];

  return (
    <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
      <label className="block text-sm font-bold text-gray-700 mb-3">{label}</label>

      <div className="space-y-4">
        {/* Step 1: Category Selection */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">
            1. Select Category
          </label>
          <select
            value={selectedCategory}
            onChange={handleCategoryChange}
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all text-sm"
          >
            <option value="">-- Choose Category --</option>
            {(categories || []).map((c) => (
              <option key={c.id || c._id} value={c.id || c._id}>
                {c.title || "Untitled Category"}
              </option>
            ))}
          </select>
        </div>

        {/* Step 2: Service Selection */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">
            2. Select Service
          </label>
          <select
            value={selectedSlug}
            onChange={handleServiceChange}
            disabled={!selectedCategory}
            className={`w-full px-3 py-2.5 border border-gray-300 rounded-lg bg-white transition-all text-sm ${!selectedCategory ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'focus:ring-2 focus:ring-blue-500 focus:border-blue-500'
              }`}
          >
            <option value="" disabled>-- Select Service --</option>
            {filteredServices.map((s) => (
              <option key={s.id || s._id} value={s.slug || ""}>
                {s.title || "Untitled Service"}
              </option>
            ))}
            {selectedCategory && filteredServices.length === 0 && (
              <option disabled>No services found in this category</option>
            )}
          </select>
          {selectedSlug && (
            <p className="text-xs text-blue-600 mt-1 font-medium">
              * Will redirect to Service Details page
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

const HomePage = ({ catalog, setCatalog, selectedCity }) => {
  const [isBannerModalOpen, setIsBannerModalOpen] = useState(false);
  const [bannerForm, setBannerForm] = useState({ imageUrl: "", text: "", targetCategoryId: "", slug: "", targetServiceId: "", scrollToSection: "" });
  const [editingBannerId, setEditingBannerId] = useState(null);

  const [isPromoModalOpen, setIsPromoModalOpen] = useState(false);
  const [promoForm, setPromoForm] = useState({ title: "", subtitle: "", buttonText: "Explore", gradientClass: "from-blue-600 to-blue-800", imageUrl: "", targetCategoryId: "", slug: "", targetServiceId: "", scrollToSection: "" });
  const [editingPromoId, setEditingPromoId] = useState(null);

  const [isCuratedModalOpen, setIsCuratedModalOpen] = useState(false);
  const [curatedForm, setCuratedForm] = useState({ title: "", gifUrl: "", youtubeUrl: "" });
  const [editingCuratedId, setEditingCuratedId] = useState(null);

  const [isNoteworthyModalOpen, setIsNoteworthyModalOpen] = useState(false);
  const [noteworthyForm, setNoteworthyForm] = useState({ title: "", imageUrl: "", targetCategoryId: "", slug: "", targetServiceId: "" });
  const [editingNoteworthyId, setEditingNoteworthyId] = useState(null);

  const [isBookedModalOpen, setIsBookedModalOpen] = useState(false);
  const [bookedForm, setBookedForm] = useState({ title: "", rating: "", reviews: "", price: "", originalPrice: "", discount: "", imageUrl: "", targetCategoryId: "", slug: "", targetServiceId: "" });
  const [editingBookedId, setEditingBookedId] = useState(null);

  const [isCategorySectionModalOpen, setIsCategorySectionModalOpen] = useState(false);
  const [categorySectionForm, setCategorySectionForm] = useState({ title: "", seeAllTargetCategoryId: "", seeAllSlug: "", seeAllTargetServiceId: "", cards: [] });
  const [editingCategorySectionId, setEditingCategorySectionId] = useState(null);

  const [isCardModalOpen, setIsCardModalOpen] = useState(false);
  const [cardForm, setCardForm] = useState({
    title: "",
    imageUrl: "",
    rating: "",
    reviews: "",
    price: "",
    originalPrice: "",
    discount: "",
    targetCategoryId: "",
    slug: "",
    targetServiceId: ""
  });
  const [editingCardId, setEditingCardId] = useState(null);

  // Uploading state for all modals
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  const categories = useMemo(() => {
    const list = ensureIds(catalog).categories || [];
    return [...list].sort((a, b) => {
      const ao = Number.isFinite(a.homeOrder) ? a.homeOrder : 0;
      const bo = Number.isFinite(b.homeOrder) ? b.homeOrder : 0;
      if (ao !== bo) return ao - bo;
      return (a.title || "").localeCompare(b.title || "");
    });
  }, [catalog]);

  const home = ensureIds(catalog).home;

  // Fetch home content from API on mount or city change
  useEffect(() => {
    const fetchHomeContent = async () => {
      try {
        const params = {};
        if (selectedCity) params.cityId = selectedCity;

        const response = await homeContentService.get(params);
        if (response.success && response.homeContent) {
          const hc = response.homeContent;

          // Helper function to add IDs to items if they don't have them and convert ObjectIds to strings
          const addIds = (items) => {
            return items.map((item, idx) => ({
              ...item,
              id: item.id || (item._id ? item._id.toString() : `item-${Date.now()}-${idx}`),
              targetCategoryId: item.targetCategoryId ? (typeof item.targetCategoryId === 'object' ? item.targetCategoryId.toString() : item.targetCategoryId) : item.targetCategoryId,
              targetServiceId: item.targetServiceId ? (typeof item.targetServiceId === 'object' ? item.targetServiceId.toString() : item.targetServiceId) : item.targetServiceId,
              seeAllTargetCategoryId: item.seeAllTargetCategoryId ? (typeof item.seeAllTargetCategoryId === 'object' ? item.seeAllTargetCategoryId.toString() : item.seeAllTargetCategoryId) : item.seeAllTargetCategoryId,
              seeAllTargetServiceId: item.seeAllTargetServiceId ? (typeof item.seeAllTargetServiceId === 'object' ? item.seeAllTargetServiceId.toString() : item.seeAllTargetServiceId) : item.seeAllTargetServiceId,
              // For category sections cards
              cards: item.cards ? item.cards.map((card, cIdx) => ({
                ...card,
                id: card.id || (card._id ? card._id.toString() : `hcard-${Date.now()}-${idx}-${cIdx}`),
                targetCategoryId: card.targetCategoryId ? (typeof card.targetCategoryId === 'object' ? card.targetCategoryId.toString() : card.targetCategoryId) : card.targetCategoryId,
                targetServiceId: card.targetServiceId ? (typeof card.targetServiceId === 'object' ? card.targetServiceId.toString() : card.targetServiceId) : card.targetServiceId,
              })) : item.cards
            }));
          };

          // Map API response to component's expected format
          const next = ensureIds(catalog);
          next.home = {
            banners: addIds(hc.banners || []),
            promoCarousel: addIds(hc.promos || []), // API returns 'promos', component expects 'promoCarousel'
            curatedServices: addIds(hc.curated || []), // API returns 'curated', component expects 'curatedServices'
            newAndNoteworthy: addIds(hc.noteworthy || []), // API returns 'noteworthy', component expects 'newAndNoteworthy'
            mostBooked: addIds(hc.booked || []), // API returns 'booked', component expects 'mostBooked'
            categorySections: addIds(hc.categorySections || []),
            isBannersVisible: hc.isBannersVisible ?? true,
            isPromosVisible: hc.isPromosVisible ?? true,
            isCuratedVisible: hc.isCuratedVisible ?? true,
            isNoteworthyVisible: hc.isNoteworthyVisible ?? true,
            isBookedVisible: hc.isBookedVisible ?? true,
            isCategorySectionsVisible: hc.isCategorySectionsVisible ?? true,
            isCategoriesVisible: hc.isCategoriesVisible ?? true
          };
          setCatalog(next);
          saveCatalog(next);
        }
      } catch (error) {
        console.error("Error fetching home content:", error);
        toast.error("Failed to load home content");
      }
    };
    fetchHomeContent();
  }, [selectedCity]); // Re-fetch on city change

  const getCategoryTitle = (id) => {
    const found = categories.find((c) => c.id === id);
    return found?.title || "";
  };



  // Fetch services for redirection selector
  const [allServices, setAllServices] = useState([]);

  useEffect(() => {
    const fetchServices = async () => {
      try {
        const params = {};
        if (selectedCity) params.cityId = selectedCity;

        const response = await serviceService.getAll(params);
        if (response.success) {
          setAllServices(response.services || []);
        }
      } catch (error) {
        console.error("Failed to fetch services", error);
      }
    };
    fetchServices();
  }, [selectedCity]);

  const updateCategory = (id, patch) => {
    const next = ensureIds(catalog);
    next.categories = next.categories.map((c) => (c.id === id ? { ...c, ...patch } : c));
    setCatalog(next);
    saveCatalog(next);
  };

  const moveCategory = (id, dir) => {
    const next = ensureIds(catalog);
    const list = [...next.categories].sort((a, b) => (a.homeOrder || 0) - (b.homeOrder || 0));
    const idx = list.findIndex((c) => c.id === id);
    if (idx < 0) return;
    const targetIdx = dir === "up" ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= list.length) return;
    const a = list[idx];
    const b = list[targetIdx];
    const aOrder = a.homeOrder || 0;
    const bOrder = b.homeOrder || 0;
    next.categories = next.categories.map((c) => {
      if (c.id === a.id) return { ...c, homeOrder: bOrder };
      if (c.id === b.id) return { ...c, homeOrder: aOrder };
      return c;
    });
    setCatalog(next);
    saveCatalog(next);
  };

  const syncHomeToBackend = async (homeData) => {
    setIsSyncing(true);
    try {
      const payload = {
        banners: homeData.banners,
        promos: homeData.promoCarousel,
        curated: homeData.curatedServices,
        noteworthy: homeData.newAndNoteworthy,
        booked: homeData.mostBooked,
        categorySections: homeData.categorySections,
        isBannersVisible: homeData.isBannersVisible,
        isPromosVisible: homeData.isPromosVisible,
        isCuratedVisible: homeData.isCuratedVisible,
        isNoteworthyVisible: homeData.isNoteworthyVisible,
        isBookedVisible: homeData.isBookedVisible,
        isCategorySectionsVisible: homeData.isCategorySectionsVisible,
        isCategoriesVisible: homeData.isCategoriesVisible
      };
      await homeContentService.update(payload, { cityId: selectedCity });
      toast.success('Home page updated successfully!');
    } catch (error) {
      console.error('Failed to sync home content:', error);
      const msg = error.response?.data?.message || error.message || 'Failed to save changes to server';
      toast.error(msg);
      throw error; // Rethrow to allow callers to handle it
    } finally {
      setIsSyncing(false);
    }
  };

  const setHomeBanners = async (banners) => {
    const next = ensureIds(catalog);
    next.home = { ...(next.home || { banners: [] }), banners };
    setCatalog(next);
    saveCatalog(next);
    return await syncHomeToBackend(next.home);
  };

  const patchHome = async (patch) => {
    const next = ensureIds(catalog);
    next.home = { ...(next.home || {}), ...patch };
    setCatalog(next);
    saveCatalog(next);
    return await syncHomeToBackend(next.home);
  };

  // Banner handlers
  const resetBannerForm = () => {
    setEditingBannerId(null);
    setBannerForm({ imageUrl: "", text: "", targetCategoryId: "", slug: "", targetServiceId: "", scrollToSection: "" });
    setIsBannerModalOpen(false);
  };

  const saveBanner = async () => {
    try {
      const banners = home?.banners || [];
      if (editingBannerId) {
        await setHomeBanners(banners.map((b) => (b.id === editingBannerId ? { ...b, ...bannerForm } : b)));
      } else {
        await setHomeBanners([...banners, { id: `hbnr-${Date.now()}`, ...bannerForm }]);
      }
      resetBannerForm();
    } catch (error) {
      // Error already toasted in sync function
    }
  };

  // Promo handlers
  const resetPromoForm = () => {
    setEditingPromoId(null);
    setPromoForm({ title: "", subtitle: "", buttonText: "Explore", gradientClass: "from-blue-600 to-blue-800", imageUrl: "", targetCategoryId: "", slug: "", targetServiceId: "", scrollToSection: "" });
    setIsPromoModalOpen(false);
  };

  const savePromo = async () => {
    try {
      const promos = home?.promoCarousel || [];
      if (editingPromoId) {
        await patchHome({ promoCarousel: promos.map((p) => (p.id === editingPromoId ? { ...p, ...promoForm } : p)) });
      } else {
        await patchHome({ promoCarousel: [...promos, { id: `hprm-${Date.now()}`, ...promoForm }] });
      }
      resetPromoForm();
    } catch (error) { }
  };

  // Curated handlers
  const resetCuratedForm = () => {
    setEditingCuratedId(null);
    setCuratedForm({ title: "", gifUrl: "", youtubeUrl: "" });
    setIsCuratedModalOpen(false);
  };

  const saveCurated = async () => {
    try {
      const curated = home?.curatedServices || [];
      if (editingCuratedId) {
        await patchHome({ curatedServices: curated.map((c) => (c.id === editingCuratedId ? { ...c, ...curatedForm } : c)) });
      } else {
        await patchHome({ curatedServices: [...curated, { id: `hcur-${Date.now()}`, ...curatedForm }] });
      }
      resetCuratedForm();
    } catch (error) { }
  };

  // Noteworthy handlers
  const resetNoteworthyForm = () => {
    setEditingNoteworthyId(null);
    setNoteworthyForm({ title: "", imageUrl: "", targetCategoryId: "", slug: "", targetServiceId: "" });
    setIsNoteworthyModalOpen(false);
  };

  const saveNoteworthy = async () => {
    try {
      const noteworthy = home?.newAndNoteworthy || [];
      if (editingNoteworthyId) {
        await patchHome({ newAndNoteworthy: noteworthy.map((n) => (n.id === editingNoteworthyId ? { ...n, ...noteworthyForm } : n)) });
      } else {
        await patchHome({ newAndNoteworthy: [...noteworthy, { id: `hnnw-${Date.now()}`, ...noteworthyForm }] });
      }
      resetNoteworthyForm();
    } catch (error) { }
  };

  // Most Booked handlers
  const resetBookedForm = () => {
    setEditingBookedId(null);
    setBookedForm({ title: "", rating: "", reviews: "", price: "", originalPrice: "", discount: "", imageUrl: "", targetCategoryId: "", slug: "", targetServiceId: "" });
    setIsBookedModalOpen(false);
  };

  const saveBooked = async () => {
    try {
      const booked = home?.mostBooked || [];
      if (editingBookedId) {
        await patchHome({ mostBooked: booked.map((b) => (b.id === editingBookedId ? { ...b, ...bookedForm } : b)) });
      } else {
        await patchHome({ mostBooked: [...booked, { id: `hmb-${Date.now()}`, ...bookedForm }] });
      }
      resetBookedForm();
    } catch (error) { }
  };

  // Category Section handlers
  const resetCategorySectionForm = () => {
    setEditingCategorySectionId(null);
    setCategorySectionForm({ title: "", seeAllTargetCategoryId: "", seeAllSlug: "", seeAllTargetServiceId: "", cards: [] });
    setIsCategorySectionModalOpen(false);
  };

  const saveCategorySection = async () => {
    try {
      const title = categorySectionForm.title.trim();
      if (!title) return alert("Section title required");

      const sections = home?.categorySections || [];
      if (editingCategorySectionId) {
        await patchHome({
          categorySections: sections.map((s) =>
            s.id === editingCategorySectionId ? { ...s, ...categorySectionForm } : s
          ),
        });
      } else {
        await patchHome({
          categorySections: [
            ...sections,
            { id: `hsec-${Date.now()}`, ...categorySectionForm },
          ],
        });
      }
      resetCategorySectionForm();
    } catch (error) { }
  };

  // Card handlers for category sections
  const resetCardForm = () => {
    setEditingCardId(null);
    setCardForm({
      title: "",
      imageUrl: "",
      rating: "",
      reviews: "",
      price: "",
      originalPrice: "",
      discount: "",
      targetCategoryId: "",
      slug: "",
      targetServiceId: ""
    });
    setIsCardModalOpen(false);
  };

  const saveCard = () => {
    const title = cardForm.title.trim();
    if (!title) {
      toast.error("Card title is required");
      return;
    }

    const cards = categorySectionForm.cards || [];
    if (editingCardId) {
      setCategorySectionForm((prev) => ({
        ...prev,
        cards: cards.map((c) => (c.id === editingCardId ? { ...c, ...cardForm } : c)),
      }));
    } else {
      setCategorySectionForm((prev) => ({
        ...prev,
        cards: [...cards, { id: `hcard-${Date.now()}`, ...cardForm }],
      }));
    }
    resetCardForm();
  };

  const removeCardFromSection = (cardId) => {
    setCategorySectionForm((prev) => ({
      ...prev,
      cards: prev.cards.filter((c) => c.id !== cardId),
    }));
  };

  return (
    <div className="space-y-4">
      <CardShell icon={FiGrid}>
        <div className="space-y-4">
          <div>
            <div className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-3">
              <div className="w-1.5 h-6 bg-gradient-to-b from-primary-500 to-primary-600 rounded-full"></div>
              <span>Home Banners</span>
            </div>
          </div>
          <div className="flex items-center justify-end mb-3 gap-4">
            <ToggleSwitch
              label="Show Banners"
              checked={home?.isBannersVisible !== false}
              onChange={() => patchHome({ isBannersVisible: !home?.isBannersVisible })}
            />
            <button
              type="button"
              onClick={() => {
                setBannerForm({ imageUrl: "", text: "", targetCategoryId: "", scrollToSection: "" });
                setIsBannerModalOpen(true);
              }}
              className="px-4 py-2 rounded-xl text-white transition-all flex items-center gap-2 text-sm font-semibold shadow-md hover:shadow-lg relative z-10"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: 'linear-gradient(to right, #2874F0, #1e5fd4)',
                border: 'none',
                cursor: 'pointer'
              }}
            >
              <FiPlus className="w-4 h-4" style={{ display: 'block', color: '#ffffff' }} />
              <span>Add Banner</span>
            </button>
          </div>

          {(home?.banners || []).length === 0 ? (
            <div className="text-base text-gray-500">No home banners added</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b-2 border-gray-200">
                    <th className="text-left py-2 px-3 text-sm font-bold text-gray-700 w-12">#</th>
                    <th className="text-left py-2 px-3 text-sm font-bold text-gray-700 w-24">Image</th>
                    <th className="text-left py-2 px-3 text-sm font-bold text-gray-700">Text</th>
                    {/* <th className="text-left py-2 px-3 text-sm font-bold text-gray-700">Redirect</th>
                    <th className="text-left py-2 px-3 text-sm font-bold text-gray-700">Scroll To</th> */}
                    <th className="text-center py-2 px-3 text-sm font-bold text-gray-700 w-32">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(home.banners || []).map((b, idx) => (
                    <tr key={b.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="py-2.5 px-3 text-sm font-semibold text-gray-600">{idx + 1}</td>
                      <td className="py-2.5 px-3">
                        {b.imageUrl ? (
                          <img src={b.imageUrl} alt="Banner" className="h-14 w-14 object-cover rounded-lg border border-gray-200" />
                        ) : (
                          <div className="h-14 w-14 bg-gray-100 rounded-lg border border-gray-200 flex items-center justify-center">
                            <span className="text-[10px] text-gray-400">No img</span>
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="text-sm text-gray-900">{b.text || "—"}</div>
                      </td>
                      {/* <td className="py-2.5 px-3">
                        <div className="text-sm text-gray-600">
                          {b.slug
                            ? `Service: ${allServices.find(s => s.slug === b.slug)?.title || b.slug}`
                            : (b.targetCategoryId ? getCategoryTitle(b.targetCategoryId) : "—")
                          }
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="text-sm text-gray-600">{b.scrollToSection || "—"}</div>
                      </td> */}
                      <td className="py-2.5 px-3">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingBannerId(b.id);
                              setBannerForm({ ...b });
                              setIsBannerModalOpen(true);
                            }}
                            className="p-1.5 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                            title="Edit"
                          >
                            <FiEdit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setHomeBanners((home.banners || []).filter((x) => x.id !== b.id))}
                            className="p-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
                            title="Delete"
                          >
                            <FiTrash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CardShell>

      <CardShell icon={FiGrid}>
        <div className="space-y-5">
          {/* Promo Carousel (PromoCarousel) */}
          <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3 pb-2 mb-3 border-b border-gray-200">
              <div>
                <div className="text-lg font-bold text-gray-900">Home Promo Carousel</div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <ToggleSwitch
                label="Show Promos"
                checked={home?.isPromosVisible !== false}
                onChange={() => patchHome({ isPromosVisible: !home?.isPromosVisible })}
              />
              <button
                type="button"
                onClick={() => {
                  resetPromoForm();
                  setIsPromoModalOpen(true);
                }}
                className="px-4 py-2 rounded-xl text-white transition-all flex items-center gap-2 text-sm font-semibold shadow-md hover:shadow-lg"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  background: 'linear-gradient(to right, #2874F0, #1e5fd4)',
                  border: 'none',
                  cursor: 'pointer'
                }}
              >
                <FiPlus className="w-4 h-4" style={{ display: 'block', color: '#ffffff' }} />
                <span>Add</span>
              </button>
            </div>

          {(home.promoCarousel || []).length === 0 ? (
            <div className="text-base text-gray-500">No promo cards</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b-2 border-gray-200">
                    <th className="text-left py-2 px-3 text-sm font-bold text-gray-700 w-12">#</th>
                    <th className="text-left py-2 px-3 text-sm font-bold text-gray-700 w-24">Image</th>
                    <th className="text-left py-2 px-3 text-sm font-bold text-gray-700">Title</th>
                    <th className="text-left py-2 px-3 text-sm font-bold text-gray-700">Subtitle</th>
                    {/* <th className="text-left py-2 px-3 text-sm font-bold text-gray-700">Button Text</th>
                    <th className="text-left py-2 px-3 text-sm font-bold text-gray-700">Redirect</th> */}
                    <th className="text-center py-2 px-3 text-sm font-bold text-gray-700 w-32">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(home.promoCarousel || []).map((p, idx) => (
                    <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="py-2.5 px-3 text-sm font-semibold text-gray-600">{idx + 1}</td>
                      <td className="py-2.5 px-3">
                        {p.imageUrl ? (
                          <img src={p.imageUrl} alt="Promo" className="h-14 w-14 object-cover rounded-lg border border-gray-200" />
                        ) : (
                          <div className="h-14 w-14 bg-gray-100 rounded-lg border border-gray-200 flex items-center justify-center">
                            <span className="text-[10px] text-gray-400">No img</span>
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="text-sm font-semibold text-gray-900">{p.title || "—"}</div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="text-sm text-gray-600">{p.subtitle || "—"}</div>
                      </td>
                      {/* <td className="py-2.5 px-3">
                        <div className="text-sm text-gray-600">{p.buttonText || "—"}</div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="text-sm text-gray-600">{p.targetCategoryId ? getCategoryTitle(p.targetCategoryId) : "—"}</div>
                      </td> */}
                      <td className="py-2.5 px-3">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingPromoId(p.id);
                              setPromoForm({ ...p });
                              setIsPromoModalOpen(true);
                            }}
                            className="p-1.5 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                            title="Edit"
                          >
                            <FiEdit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => patchHome({ promoCarousel: (home.promoCarousel || []).filter((x) => x.id !== p.id) })}
                            className="p-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
                            title="Delete"
                          >
                            <FiTrash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Curated Services */}
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3 pb-2 mb-3 border-b border-gray-200">
            <div>
              <div className="text-lg font-bold text-gray-900">Thoughtful Curations</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <ToggleSwitch
              label="Show Curated"
              checked={home?.isCuratedVisible !== false}
              onChange={() => patchHome({ isCuratedVisible: !home?.isCuratedVisible })}
            />
            <button
              type="button"
              onClick={() => {
                resetCuratedForm();
                setIsCuratedModalOpen(true);
              }}
              className="px-4 py-2 rounded-xl text-white transition-all flex items-center gap-2 text-sm font-semibold shadow-md hover:shadow-lg"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: 'linear-gradient(to right, #2874F0, #1e5fd4)',
                border: 'none',
                cursor: 'pointer'
              }}
            >
              <FiPlus className="w-4 h-4" style={{ display: 'block', color: '#ffffff' }} />
              <span>Add</span>
            </button>
          </div>
        {(home.curatedServices || []).length === 0 ? (
          <div className="text-base text-gray-500">No items</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b-2 border-gray-200">
                  <th className="text-left py-2 px-3 text-sm font-bold text-gray-700 w-12">#</th>
                  <th className="text-left py-2 px-3 text-sm font-bold text-gray-700">Title</th>
                  <th className="text-left py-2 px-3 text-sm font-bold text-gray-700">YouTube URL</th>
                  <th className="text-center py-2 px-3 text-sm font-bold text-gray-700 w-32">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(home.curatedServices || []).map((s, idx) => (
                  <tr key={s.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="py-2.5 px-3 text-sm font-semibold text-gray-600">{idx + 1}</td>
                    <td className="py-2.5 px-3">
                      <div className="text-sm font-semibold text-gray-900">{s.title || "—"}</div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="text-sm text-gray-600">{s.youtubeUrl || "—"}</div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingCuratedId(s.id);
                            setCuratedForm({ ...s });
                            setIsCuratedModalOpen(true);
                          }}
                          className="p-1.5 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                          title="Edit"
                        >
                          <FiEdit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => patchHome({ curatedServices: (home.curatedServices || []).filter((x) => x.id !== s.id) })}
                          className="p-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
                          title="Delete"
                        >
                          <FiTrash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </div>

        {/* New & Noteworthy */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3 pb-3 mb-4 border-b border-gray-200">
            <div>
              <div className="text-xl font-bold text-gray-900">New & Noteworthy</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <ToggleSwitch
              label="Show Noteworthy"
              checked={home?.isNoteworthyVisible !== false}
              onChange={() => patchHome({ isNoteworthyVisible: !home?.isNoteworthyVisible })}
            />
            <button
              type="button"
              onClick={() => {
                resetNoteworthyForm();
                setIsNoteworthyModalOpen(true);
              }}
              className="px-5 py-3 rounded-xl text-white transition-all flex items-center gap-2 text-sm font-semibold shadow-md hover:shadow-lg"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: 'linear-gradient(to right, #2874F0, #1e5fd4)',
                border: 'none',
                cursor: 'pointer'
              }}
            >
              <FiPlus className="w-4 h-4" style={{ display: 'block', color: '#ffffff' }} />
              <span>Add</span>
            </button>
          </div>
          {
            (home.newAndNoteworthy || []).length === 0 ? (
              <div className="text-base text-gray-500">No items</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b-2 border-gray-200">
                      <th className="text-left py-3 px-4 text-sm font-bold text-gray-700 w-12">#</th>
                      <th className="text-left py-3 px-4 text-sm font-bold text-gray-700 w-24">Image</th>
                      <th className="text-left py-3 px-4 text-sm font-bold text-gray-700">Title</th>
                      <th className="text-left py-3 px-4 text-sm font-bold text-gray-700">Redirect</th>
                      <th className="text-center py-3 px-4 text-sm font-bold text-gray-700 w-32">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(home.newAndNoteworthy || []).map((s, idx) => (
                      <tr key={s.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                        <td className="py-4 px-4 text-sm font-semibold text-gray-600">{idx + 1}</td>
                        <td className="py-4 px-4">
                          {s.imageUrl ? (
                            <img src={s.imageUrl} alt="Preview" className="h-16 w-16 object-cover rounded-lg border border-gray-200" />
                          ) : (
                            <div className="h-16 w-16 bg-gray-100 rounded-lg border border-gray-200 flex items-center justify-center">
                              <span className="text-xs text-gray-400">No img</span>
                            </div>
                          )}
                        </td>
                        <td className="py-4 px-4">
                          <div className="text-sm font-semibold text-gray-900">{s.title || "—"}</div>
                        </td>
                        <td className="py-4 px-4">
                          <div className="text-sm text-gray-600">
                            {s.slug
                              ? `Service: ${allServices.find(svc => svc.slug === s.slug)?.title || s.slug}`
                              : (s.targetCategoryId ? getCategoryTitle(s.targetCategoryId) : "—")
                            }
                          </div>
                        </td>
                        <td className="py-4 px-4">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingNoteworthyId(s.id);
                                setNoteworthyForm({ ...s });
                                setIsNoteworthyModalOpen(true);
                              }}
                              className="p-2 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                              title="Edit"
                            >
                              <FiEdit2 className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => patchHome({ newAndNoteworthy: (home.newAndNoteworthy || []).filter((x) => x.id !== s.id) })}
                              className="p-2 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
                              title="Delete"
                            >
                              <FiTrash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </div>

          {/* Most Booked */}
          < div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm" >
            <div className="flex items-start justify-between gap-3 pb-3 mb-4 border-b border-gray-200">
              <div>
                <div className="text-xl font-bold text-gray-900">Most Booked Services</div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <ToggleSwitch
                label="Show Most Booked"
                checked={home?.isBookedVisible !== false}
                onChange={() => patchHome({ isBookedVisible: !home?.isBookedVisible })}
              />
              <button
                type="button"
                onClick={() => {
                  resetBookedForm();
                  setIsBookedModalOpen(true);
                }}
                className="px-5 py-3 rounded-xl text-white transition-all flex items-center gap-2 text-sm font-semibold shadow-md hover:shadow-lg"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  background: 'linear-gradient(to right, #2874F0, #1e5fd4)',
                  border: 'none',
                  cursor: 'pointer'
                }}
              >
                <FiPlus className="w-4 h-4" style={{ display: 'block', color: '#ffffff' }} />
                <span>Add</span>
              </button>
            </div>
          {(home.mostBooked || []).length === 0 ? (
            <div className="text-base text-gray-500">No items</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b-2 border-gray-200">
                    <th className="text-left py-3 px-4 text-sm font-bold text-gray-700 w-12">#</th>
                    <th className="text-left py-3 px-4 text-sm font-bold text-gray-700 w-24">Image</th>
                    <th className="text-left py-3 px-4 text-sm font-bold text-gray-700">Title</th>
                    <th className="text-left py-3 px-4 text-sm font-bold text-gray-700">Rating</th>
                    <th className="text-left py-3 px-4 text-sm font-bold text-gray-700">Reviews</th>
                    <th className="text-left py-3 px-4 text-sm font-bold text-gray-700">Price</th>
                    <th className="text-left py-3 px-4 text-sm font-bold text-gray-700">Original</th>
                    <th className="text-left py-3 px-4 text-sm font-bold text-gray-700">Discount</th>
                    <th className="text-left py-3 px-4 text-sm font-bold text-gray-700">Redirect</th>
                    <th className="text-center py-3 px-4 text-sm font-bold text-gray-700 w-32">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(home.mostBooked || []).map((s, idx) => (
                    <tr key={s.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="py-4 px-4 text-sm font-semibold text-gray-600">{idx + 1}</td>
                      <td className="py-4 px-4">
                        {s.imageUrl ? (
                          <img src={s.imageUrl} alt="Preview" className="h-16 w-16 object-cover rounded-lg border border-gray-200" />
                        ) : (
                          <div className="h-16 w-16 bg-gray-100 rounded-lg border border-gray-200 flex items-center justify-center">
                            <span className="text-xs text-gray-400">No img</span>
                          </div>
                        )}
                      </td>
                      <td className="py-4 px-4">
                        <div className="text-sm font-semibold text-gray-900">{s.title || "—"}</div>
                      </td>
                      <td className="py-4 px-4">
                        <div className="text-sm text-gray-600">{s.rating || "—"}</div>
                      </td>
                      <td className="py-4 px-4">
                        <div className="text-sm text-gray-600">{s.reviews || "—"}</div>
                      </td>
                      <td className="py-4 px-4">
                        <div className="text-sm font-semibold text-gray-900">{s.price ? `₹${s.price}` : "—"}</div>
                      </td>
                      <td className="py-4 px-4">
                        <div className="text-sm text-gray-500 line-through">{s.originalPrice ? `₹${s.originalPrice}` : "—"}</div>
                      </td>
                      <td className="py-4 px-4">
                        <div className="text-sm text-gray-600">{s.discount || "—"}</div>
                      </td>
                      <td className="py-4 px-4">
                        <div className="text-sm text-gray-600">
                          {s.slug
                            ? `Service: ${allServices.find(svc => svc.slug === s.slug)?.title || s.slug}`
                            : (s.targetCategoryId ? getCategoryTitle(s.targetCategoryId) : "—")
                          }
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingBookedId(s.id);
                              setBookedForm({ ...s });
                              setIsBookedModalOpen(true);
                            }}
                            className="p-2 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                            title="Edit"
                          >
                            <FiEdit2 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => patchHome({ mostBooked: (home.mostBooked || []).filter((x) => x.id !== s.id) })}
                            className="p-2 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
                            title="Delete"
                          >
                            <FiTrash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

          {/* Category Sections (Cleaning essentials style) */}
          {/* Category Sections (Modern Card Grid) */}
          <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between gap-4 pb-4 mb-6 border-b border-gray-100">
              <div>
                <h3 className="text-xl font-bold text-gray-900">Category Sections</h3>
                <p className="text-sm text-gray-500 mt-1">Horizontal scrollable sections like "Cleaning Essentials"</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <ToggleSwitch
                label="Show Sections"
                checked={home?.isCategorySectionsVisible !== false}
                onChange={() => patchHome({ isCategorySectionsVisible: !home?.isCategorySectionsVisible })}
              />
              <button
                type="button"
                onClick={() => {
                  resetCategorySectionForm();
                  setIsCategorySectionModalOpen(true);
                }}
                className="px-5 py-2.5 text-white rounded-xl font-semibold shadow-md hover:shadow-lg transition-all flex items-center gap-2"
                style={{ backgroundColor: '#2874F0' }}
                onMouseEnter={(e) => e.target.style.backgroundColor = '#1e5fd4'}
                onMouseLeave={(e) => e.target.style.backgroundColor = '#2874F0'}
              >
                <FiPlus className="w-5 h-5" />
                <span>Add Section</span>
              </button>
            </div>

          {
            (home.categorySections || []).length === 0 ? (
              <div className="text-center py-12 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                <FiGrid className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 font-medium">No category sections added yet</p>
                <button
                  onClick={() => setIsCategorySectionModalOpen(true)}
                  className="mt-2 font-semibold hover:underline text-sm"
                  style={{ color: '#2874F0' }}
                >
                  Create one now
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {(home.categorySections || []).map((sec) => (
                  <div
                    key={sec.id}
                    className="group bg-white rounded-xl border border-gray-200 hover:shadow-md transition-all duration-300 flex flex-col overflow-hidden relative"
                    style={{ borderColor: 'transparent' }}
                  >
                    <div className="absolute inset-0 pointer-events-none border border-gray-200 group-hover:border-blue-400 rounded-xl transition-colors duration-300"></div>

                    <div className="p-4 flex-1 relative z-10">
                      <div className="flex justify-between items-start mb-3">
                        <h4 className="font-bold text-lg text-gray-900 line-clamp-1" title={sec.title}>{sec.title || "Untitled"}</h4>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => {
                              setEditingCategorySectionId(sec.id);
                              setCategorySectionForm({
                                title: sec.title || "",
                                seeAllTargetCategoryId: sec.seeAllTargetCategoryId || "",
                                cards: sec.cards || []
                              });
                              setIsCategorySectionModalOpen(true);
                            }}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Edit"
                          >
                            <FiEdit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() =>
                              patchHome({
                                categorySections: (home.categorySections || []).filter((x) => x.id !== sec.id),
                              })
                            }
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Delete"
                          >
                            <FiTrash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-sm text-gray-600">
                          <span className="px-2 py-0.5 bg-gray-100 rounded text-xs font-semibold text-gray-500 uppercase tracking-wider">Redirect</span>
                          <span className="truncate flex-1 font-medium text-gray-800">
                            {sec.seeAllTargetCategoryId ? getCategoryTitle(sec.seeAllTargetCategoryId) : "None"}
                          </span>
                        </div>

                        <div>
                          <div className="flex justify-between items-center mb-2">
                            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Content Preview</span>
                            <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md text-xs font-bold">{(sec.cards || []).length} Cards</span>
                          </div>
                          <div className="flex -space-x-2 overflow-hidden py-1 h-12 items-center">
                            {(sec.cards || []).length === 0 && (
                              <span className="text-xs text-gray-400 italic pl-1">No content</span>
                            )}
                            {(sec.cards || []).slice(0, 5).map((c, i) => (
                              <div key={i} className="relative w-10 h-10 rounded-full border-2 border-white bg-gray-100 flex-shrink-0">
                                {c.imageUrl ? (
                                  <img src={c.imageUrl} alt="" className="w-full h-full rounded-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-[10px] text-gray-400 font-bold">?</div>
                                )}
                              </div>
                            ))}
                            {(sec.cards || []).length > 5 && (
                              <div className="w-10 h-10 rounded-full border-2 border-white bg-gray-50 flex items-center justify-center text-xs font-bold text-gray-500 z-10">
                                +{(sec.cards || []).length - 5}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          }
        </div>
        </div>
      </CardShell>

      <CardShell icon={FiGrid} title="Home Categories">
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm text-gray-600">{categories.length} categories</div>
          <ToggleSwitch
            label="Show Home Categories"
            checked={home?.isCategoriesVisible !== false}
            onChange={() => patchHome({ isCategoriesVisible: !home?.isCategoriesVisible })}
          />
        </div>
        {categories.length === 0 ? (
          <div className="text-center py-8 text-gray-500">No categories yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b-2 border-gray-200">
                  <th className="text-left py-3 px-4 text-sm font-bold text-gray-700 w-12">#</th>
                  <th className="text-left py-3 px-4 text-sm font-bold text-gray-700 w-20">Icon</th>
                  <th className="text-left py-3 px-4 text-sm font-bold text-gray-700">Name</th>
                  <th className="text-left py-3 px-4 text-sm font-bold text-gray-700">Slug</th>
                  <th className="text-left py-3 px-4 text-sm font-bold text-gray-700">Badge</th>
                  <th className="text-center py-3 px-4 text-sm font-bold text-gray-700 w-32">Status</th>
                  <th className="text-center py-3 px-4 text-sm font-bold text-gray-700 w-40">Order</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((c, idx) => (
                  <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="py-4 px-4 text-sm font-semibold text-gray-600">{idx + 1}</td>
                    <td className="py-4 px-4">
                      {c.homeIconUrl ? (
                        <img src={c.homeIconUrl} alt={c.title} className="h-12 w-12 object-cover rounded-lg border border-gray-200" />
                      ) : (
                        <div className="h-12 w-12 bg-gray-100 rounded-lg border border-gray-200 flex items-center justify-center">
                          <span className="text-xs text-gray-400">No icon</span>
                        </div>
                      )}
                    </td>
                    <td className="py-4 px-4">
                      <div className="font-bold text-gray-900">{c.title || "Untitled"}</div>
                    </td>
                    <td className="py-4 px-4">
                      <div className="text-sm text-gray-600">{c.slug || "—"}</div>
                    </td>
                    <td className="py-4 px-4">
                      {c.homeBadge ? (
                        <span className="inline-block px-2 py-1 text-xs font-semibold bg-blue-100 text-blue-700 rounded">{c.homeBadge}</span>
                      ) : (
                        <span className="text-sm text-gray-400">—</span>
                      )}
                    </td>
                    <td className="py-4 px-4 text-center">
                      <span className={`inline-block px-3 py-1 text-xs font-bold rounded ${c.showOnHome !== false ? "bg-green-500 text-white" : "bg-gray-300 text-gray-700"}`}>
                        {c.showOnHome !== false ? "VISIBLE" : "HIDDEN"}
                      </span>
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => moveCategory(c.id, "up")}
                          className="px-2 py-1 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors text-xs font-semibold"
                          title="Move up"
                          disabled={idx === 0}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => moveCategory(c.id, "down")}
                          className="px-2 py-1 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors text-xs font-semibold"
                          title="Move down"
                          disabled={idx === categories.length - 1}
                        >
                          ↓
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardShell>
      <Modal
        isOpen={isBannerModalOpen}
        onClose={resetBannerForm}
        title={editingBannerId ? "Edit Banner" : "Add Banner"}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-base font-bold text-gray-900 mb-2">Image</label>
            <div className="space-y-3">
              <input
                type="file"
                accept="image/*"
                disabled={uploading}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setUploading(true);
                    setUploadProgress(0);
                    try {
                      const response = await serviceService.uploadImage(file, 'banners', (progress) => {
                        setUploadProgress(progress);
                      });
                      if (response.success) {
                        setBannerForm((p) => ({ ...p, imageUrl: response.imageUrl }));
                        toast.success("Image uploaded!");
                      }
                    } catch (error) {
                      console.error('Banner upload error:', error);
                      const msg = error.response?.data?.message || error.message || "Failed to upload image";
                      toast.error(msg);
                    } finally {
                      setUploading(false);
                      setUploadProgress(0);
                    }
                  }
                }}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all bg-white file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100 disabled:opacity-50 disabled:cursor-not-allowed"
              />
              {uploading && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-blue-600 text-sm font-medium">
                    <div className="flex items-center gap-2">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                      Uploading...
                    </div>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="w-full bg-blue-100 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-blue-600 h-full transition-all duration-300 ease-out"
                      style={{ width: `${uploadProgress}%` }}
                    ></div>
                  </div>
                </div>
              )}
              {bannerForm.imageUrl && !uploading && (
                <div className="relative inline-block group">
                  <img src={bannerForm.imageUrl} alt="Preview" className="h-24 w-auto object-cover rounded-lg border border-gray-200 shadow-sm" />
                  <button
                    onClick={() => setBannerForm(p => ({ ...p, imageUrl: "" }))}
                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Remove image"
                  >
                    <FiTrash2 className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          </div>
          <div>
            <label className="block text-base font-bold text-gray-900 mb-2">Text (optional)</label>
            <input
              value={bannerForm.text}
              onChange={(e) => setBannerForm((p) => ({ ...p, text: e.target.value }))}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all bg-white"
              placeholder="Winter offers"
            />
          </div>
          {/* <RedirectionSelector
            categories={categories}
            allServices={allServices}
            targetCategoryId={bannerForm.targetCategoryId}
            slug={bannerForm.slug}
            onChange={(patch) => setBannerForm((p) => ({ ...p, ...patch }))}
            label="Redirect to..."
          />
          <div>
            <label className="block text-base font-bold text-gray-900 mb-2">Scroll To Section (ID)</label>
            <input
              value={bannerForm.scrollToSection}
              onChange={(e) => setBannerForm((p) => ({ ...p, scrollToSection: e.target.value }))}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all bg-white"
              placeholder="Waxing & threading"
            />
          </div> */}
          <div className="flex gap-3 pt-4">
            <button
              onClick={saveBanner}
              disabled={uploading || isSyncing}
              className={`flex-1 py-3.5 text-white rounded-xl font-semibold transition-all flex items-center justify-center gap-2 shadow-md hover:shadow-lg ${(uploading || isSyncing) ? 'opacity-50 cursor-not-allowed bg-gray-400' : ''}`}
              style={{ backgroundColor: (uploading || isSyncing) ? '#cbd5e1' : '#2874F0' }}
            >
              {(uploading || isSyncing) ? (
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
              ) : <FiSave className="w-5 h-5" />}
              {uploading ? "Uploading..." : isSyncing ? "Saving..." : (editingBannerId ? "Update Banner" : "Add Banner")}
            </button>
            <button
              onClick={resetBannerForm}
              disabled={isSyncing}
              className="px-6 py-3.5 text-gray-700 rounded-xl font-medium hover:bg-gray-100 transition-all border border-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={isPromoModalOpen}
        onClose={resetPromoForm}
        title={editingPromoId ? "Edit Promo" : "Add Promo"}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-base font-bold text-gray-900 mb-2">Image</label>
            <div className="space-y-3">
              <input
                type="file"
                accept="image/*"
                disabled={uploading}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setUploading(true);
                    setUploadProgress(0);
                    try {
                      const response = await serviceService.uploadImage(file, 'promos', (progress) => {
                        setUploadProgress(progress);
                      });
                      if (response.success) {
                        setPromoForm((p) => ({ ...p, imageUrl: response.imageUrl }));
                        toast.success("Image uploaded!");
                      }
                    } catch (error) {
                      console.error('Promo upload error:', error);
                      const msg = error.response?.data?.message || error.message || "Failed to upload image";
                      toast.error(msg);
                    } finally {
                      setUploading(false);
                      setUploadProgress(0);
                    }
                  }
                }}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all bg-white file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100 disabled:opacity-50 disabled:cursor-not-allowed"
              />
              {uploading && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-blue-600 text-sm font-medium">
                    <div className="flex items-center gap-2">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                      Uploading...
                    </div>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="w-full bg-blue-100 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-blue-600 h-full transition-all duration-300 ease-out"
                      style={{ width: `${uploadProgress}%` }}
                    ></div>
                  </div>
                </div>
              )}
              {promoForm.imageUrl && !uploading && (
                <div className="relative inline-block group">
                  <img src={promoForm.imageUrl} alt="Preview" className="h-24 w-auto object-cover rounded-lg border border-gray-200 shadow-sm" />
                  <button
                    onClick={() => setPromoForm(p => ({ ...p, imageUrl: "" }))}
                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Remove image"
                  >
                    <FiTrash2 className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-base font-bold text-gray-900 mb-2">Title</label>
              <input
                value={promoForm.title}
                onChange={(e) => setPromoForm((p) => ({ ...p, title: e.target.value }))}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all bg-white"
                placeholder="Title"
              />
            </div>
            <div>
              <label className="block text-base font-bold text-gray-900 mb-2">Subtitle</label>
              <input
                value={promoForm.subtitle}
                onChange={(e) => setPromoForm((p) => ({ ...p, subtitle: e.target.value }))}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all bg-white"
                placeholder="Subtitle"
              />
            </div>
          </div>
          {/* <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-base font-bold text-gray-900 mb-2">Button Text</label>
              <input
                value={promoForm.buttonText}
                onChange={(e) => setPromoForm((p) => ({ ...p, buttonText: e.target.value }))}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all bg-white"
                placeholder="Explore"
              />
            </div>
            <div>
              <label className="block text-base font-bold text-gray-900 mb-2">Gradient Class</label>
              <input
                value={promoForm.gradientClass}
                onChange={(e) => setPromoForm((p) => ({ ...p, gradientClass: e.target.value }))}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all bg-white"
                placeholder="from-blue-600 to-blue-800"
              />
            </div>
          </div>
          <RedirectionSelector
            categories={categories}
            allServices={allServices}
            targetCategoryId={promoForm.targetCategoryId}
            slug={promoForm.slug}
            onChange={(patch) => setPromoForm((p) => ({ ...p, ...patch }))}
            label="Redirect to..."
          />
          <div>
            <label className="block text-base font-bold text-gray-900 mb-2">Scroll To Section (optional)</label>
            <input
              value={promoForm.scrollToSection}
              onChange={(e) => setPromoForm((p) => ({ ...p, scrollToSection: e.target.value }))}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all bg-white"
              placeholder="Waxing & threading"
            />
          </div> */}
          <div className="flex gap-3 pt-4">
            <button
              onClick={savePromo}
              disabled={uploading || isSyncing}
              className={`flex-1 py-3.5 text-white rounded-xl font-semibold transition-all flex items-center justify-center gap-2 shadow-md hover:shadow-lg ${(uploading || isSyncing) ? 'opacity-50 cursor-not-allowed bg-gray-400' : ''}`}
              style={{ backgroundColor: (uploading || isSyncing) ? '#cbd5e1' : '#2874F0' }}
            >
              {(uploading || isSyncing) ? (
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
              ) : <FiSave className="w-5 h-5" />}
              {uploading ? "Uploading..." : isSyncing ? "Saving..." : (editingPromoId ? "Update Promo" : "Add Promo")}
            </button>
            <button
              onClick={resetPromoForm}
              disabled={isSyncing}
              className="px-6 py-3.5 text-gray-700 rounded-xl font-medium hover:bg-gray-100 transition-all border border-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={isCuratedModalOpen}
        onClose={resetCuratedForm}
        title={editingCuratedId ? "Edit Curated Service" : "Add Curated Service"}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-base font-bold text-gray-900 mb-2">Title</label>
            <input
              value={curatedForm.title}
              onChange={(e) => setCuratedForm((p) => ({ ...p, title: e.target.value }))}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all bg-white"
              placeholder="Bathroom Deep Cleaning"
            />
          </div>

          <div>
            <label className="block text-base font-bold text-gray-900 mb-2">YouTube URL</label>
            <input
              value={curatedForm.youtubeUrl}
              onChange={(e) => setCuratedForm((p) => ({ ...p, youtubeUrl: e.target.value }))}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all bg-white"
              placeholder="https://youtube.com/..."
            />
          </div>

          <div className="flex gap-3 pt-4">
            <button
              onClick={saveCurated}
              disabled={uploading || isSyncing}
              className={`flex-1 py-3.5 text-white rounded-xl font-semibold transition-all flex items-center justify-center gap-2 shadow-md hover:shadow-lg ${(uploading || isSyncing) ? 'opacity-50 cursor-not-allowed bg-gray-400' : ''}`}
              style={{ backgroundColor: (uploading || isSyncing) ? '#cbd5e1' : '#2874F0' }}
            >
              {(uploading || isSyncing) ? (
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
              ) : <FiSave className="w-5 h-5" />}
              {uploading ? "Uploading..." : isSyncing ? "Saving..." : (editingCuratedId ? "Update Curated Service" : "Add Curated Service")}
            </button>
            <button
              onClick={resetCuratedForm}
              disabled={isSyncing}
              className="px-6 py-3.5 text-gray-700 rounded-xl font-medium hover:bg-gray-100 transition-all border border-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={isNoteworthyModalOpen}
        onClose={resetNoteworthyForm}
        title={editingNoteworthyId ? "Edit New & Noteworthy" : "Add New & Noteworthy"}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-base font-bold text-gray-900 mb-2">Title</label>
            <input
              value={noteworthyForm.title}
              onChange={(e) => setNoteworthyForm((p) => ({ ...p, title: e.target.value }))}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all bg-white"
              placeholder="Bathroom & Kitchen Cleaning"
            />
          </div>
          <div>
            <label className="block text-base font-bold text-gray-900 mb-2">Image</label>
            <div className="space-y-3">
              <input
                type="file"
                accept="image/*"
                disabled={uploading}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setUploading(true);
                    setUploadProgress(0);
                    try {
                      const response = await serviceService.uploadImage(file, 'noteworthy', (progress) => {
                        setUploadProgress(progress);
                      });
                      if (response.success) {
                        setNoteworthyForm((p) => ({ ...p, imageUrl: response.imageUrl }));
                        toast.success("Image uploaded!");
                      }
                    } catch (error) {
                      console.error('Noteworthy upload error:', error);
                      const msg = error.response?.data?.message || error.message || "Failed to upload image";
                      toast.error(msg);
                    } finally {
                      setUploading(false);
                      setUploadProgress(0);
                    }
                  }
                }}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all bg-white file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100 disabled:opacity-50 disabled:cursor-not-allowed"
              />
              {uploading && (
                <div className="space-y-2 mt-2">
                  <div className="flex items-center justify-between text-blue-600 text-sm font-medium">
                    <div className="flex items-center gap-2">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                      Uploading...
                    </div>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="w-full bg-blue-100 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-blue-600 h-full transition-all duration-300 ease-out"
                      style={{ width: `${uploadProgress}%` }}
                    ></div>
                  </div>
                </div>
              )}
              {noteworthyForm.imageUrl && !uploading && (
                <div className="relative inline-block group">
                  <img src={noteworthyForm.imageUrl} alt="Preview" className="h-24 w-auto object-cover rounded-lg border border-gray-200 shadow-sm" />
                  <button
                    onClick={() => setNoteworthyForm(p => ({ ...p, imageUrl: "" }))}
                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Remove image"
                  >
                    <FiTrash2 className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          </div>

          <RedirectionSelector
            categories={categories}
            allServices={allServices}
            targetCategoryId={noteworthyForm.targetCategoryId}
            slug={noteworthyForm.slug}
            onChange={(patch) => setNoteworthyForm((p) => ({ ...p, ...patch }))}
            label="Redirect to..."
          />

          <div className="flex gap-3 pt-4">
            <button
              onClick={saveNoteworthy}
              disabled={uploading || isSyncing}
              className={`flex-1 py-3.5 text-white rounded-xl font-semibold transition-all flex items-center justify-center gap-2 shadow-md hover:shadow-lg ${(uploading || isSyncing) ? 'opacity-50 cursor-not-allowed bg-gray-400' : ''}`}
              style={{ backgroundColor: (uploading || isSyncing) ? '#cbd5e1' : '#2874F0' }}
            >
              {(uploading || isSyncing) ? (
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
              ) : <FiSave className="w-5 h-5" />}
              {uploading ? "Uploading..." : isSyncing ? "Saving..." : (editingNoteworthyId ? "Update" : "Add")}
            </button>
            <button
              onClick={resetNoteworthyForm}
              disabled={isSyncing}
              className="px-6 py-3.5 text-gray-700 rounded-xl font-medium hover:bg-gray-100 transition-all border border-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={isBookedModalOpen}
        onClose={resetBookedForm}
        title={editingBookedId ? "Edit Most Booked" : "Add Most Booked"}
        size="lg"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-base font-bold text-gray-900 mb-2">Title</label>
            <input
              value={bookedForm.title}
              onChange={(e) => setBookedForm((p) => ({ ...p, title: e.target.value }))}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all bg-white"
              placeholder="Intense cleaning (2 bathrooms)"
            />
          </div>
          <div>
            <label className="block text-base font-bold text-gray-900 mb-2">Image</label>
            <div className="space-y-3">
              <input
                type="file"
                accept="image/*"
                disabled={uploading}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setUploading(true);
                    setUploadProgress(0);
                    try {
                      const response = await serviceService.uploadImage(file, 'booked', (progress) => {
                        setUploadProgress(progress);
                      });
                      if (response.success) {
                        setBookedForm((p) => ({ ...p, imageUrl: response.imageUrl }));
                        toast.success("Image uploaded!");
                      }
                    } catch (error) {
                      console.error('Booked upload error:', error);
                      const msg = error.response?.data?.message || error.message || "Failed to upload image";
                      toast.error(msg);
                    } finally {
                      setUploading(false);
                      setUploadProgress(0);
                    }
                  }
                }}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all bg-white file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100 disabled:opacity-50 disabled:cursor-not-allowed"
              />
              {uploading && (
                <div className="space-y-2 mt-2">
                  <div className="flex items-center justify-between text-blue-600 text-sm font-medium">
                    <div className="flex items-center gap-2">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                      Uploading...
                    </div>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="w-full bg-blue-100 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-blue-600 h-full transition-all duration-300 ease-out"
                      style={{ width: `${uploadProgress}%` }}
                    ></div>
                  </div>
                </div>
              )}
              {bookedForm.imageUrl && !uploading && (
                <div className="relative inline-block group">
                  <img src={bookedForm.imageUrl} alt="Preview" className="h-24 w-auto object-cover rounded-lg border border-gray-200 shadow-sm" />
                  <button
                    onClick={() => setBookedForm(p => ({ ...p, imageUrl: "" }))}
                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Remove image"
                  >
                    <FiTrash2 className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-base font-bold text-gray-900 mb-2">Rating</label>
              <input
                value={bookedForm.rating}
                onChange={(e) => setBookedForm((p) => ({ ...p, rating: e.target.value }))}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all bg-white"
                placeholder="4.79"
              />
            </div>
            <div>
              <label className="block text-base font-bold text-gray-900 mb-2">Reviews</label>
              <input
                value={bookedForm.reviews}
                onChange={(e) => setBookedForm((p) => ({ ...p, reviews: e.target.value }))}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all bg-white"
                placeholder="3.7M"
              />
            </div>
            <div>
              <label className="block text-base font-bold text-gray-900 mb-2">Price</label>
              <input
                value={bookedForm.price}
                onChange={(e) => {
                  const newPrice = e.target.value;
                  let newDiscount = bookedForm.discount;

                  // Auto-calculate discount
                  if (newPrice && bookedForm.originalPrice) {
                    const priceVal = parseFloat(newPrice.toString().replace(/[^0-9.]/g, ''));
                    const originalVal = parseFloat(bookedForm.originalPrice.toString().replace(/[^0-9.]/g, ''));

                    if (!isNaN(priceVal) && !isNaN(originalVal) && originalVal > priceVal) {
                      const discountVal = Math.round(((originalVal - priceVal) / originalVal) * 100);
                      newDiscount = `${discountVal}% OFF`;
                    }
                  }

                  setBookedForm((p) => ({ ...p, price: newPrice, discount: newDiscount }));
                }}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all bg-white"
                placeholder="950"
              />
            </div>
            <div>
              <label className="block text-base font-bold text-gray-900 mb-2">Original Price</label>
              <input
                value={bookedForm.originalPrice}
                onChange={(e) => {
                  const newOriginalPrice = e.target.value;
                  let newDiscount = bookedForm.discount;

                  // Auto-calculate discount
                  if (bookedForm.price && newOriginalPrice) {
                    const priceVal = parseFloat(bookedForm.price.toString().replace(/[^0-9.]/g, ''));
                    const originalVal = parseFloat(newOriginalPrice.toString().replace(/[^0-9.]/g, ''));

                    if (!isNaN(priceVal) && !isNaN(originalVal) && originalVal > priceVal) {
                      const discountVal = Math.round(((originalVal - priceVal) / originalVal) * 100);
                      newDiscount = `${discountVal}% OFF`;
                    }
                  }

                  setBookedForm((p) => ({ ...p, originalPrice: newOriginalPrice, discount: newDiscount }));
                }}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all bg-white"
                placeholder="1,038"
              />
            </div>
            <div>
              <label className="block text-base font-bold text-gray-900 mb-2">Discount (auto)</label>
              <input
                value={bookedForm.discount}
                onChange={(e) => setBookedForm((p) => ({ ...p, discount: e.target.value }))}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all bg-gray-50 text-gray-600"
                placeholder="8% OFF"
              />
            </div>
          </div>
          <RedirectionSelector
            categories={categories}
            allServices={allServices}
            targetCategoryId={bookedForm.targetCategoryId}
            slug={bookedForm.slug}
            onChange={(patch) => setBookedForm((p) => ({ ...p, ...patch }))}
            label="Redirect to..."
          />
          <div className="flex gap-3 pt-4">
            <button
              onClick={saveBooked}
              disabled={uploading || isSyncing}
              className={`flex-1 py-3.5 text-white rounded-xl font-semibold transition-all flex items-center justify-center gap-2 shadow-md hover:shadow-lg ${(uploading || isSyncing) ? 'opacity-50 cursor-not-allowed bg-gray-400' : ''}`}
              style={{ backgroundColor: (uploading || isSyncing) ? '#cbd5e1' : '#2874F0' }}
            >
              {(uploading || isSyncing) ? (
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
              ) : <FiSave className="w-5 h-5" />}
              {uploading ? "Uploading..." : isSyncing ? "Saving..." : (editingBookedId ? "Update" : "Add")}
            </button>
            <button
              onClick={resetBookedForm}
              disabled={isSyncing}
              className="px-6 py-3.5 text-gray-700 rounded-xl font-medium hover:bg-gray-100 transition-all border border-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>

      {/* Category Section Modal */}
      <Modal
        isOpen={isCategorySectionModalOpen}
        onClose={resetCategorySectionForm}
        title={editingCategorySectionId ? "Edit Category Section" : "Add Category Section"}
        size="lg"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-base font-bold text-gray-900 mb-2">Section Title</label>
            <input
              value={categorySectionForm.title}
              onChange={(e) => setCategorySectionForm((p) => ({ ...p, title: e.target.value }))}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all bg-white"
              placeholder="e.g. Cleaning Essentials"
            />
          </div>
          <RedirectionSelector
            categories={categories}
            allServices={allServices}
            targetCategoryId={categorySectionForm.seeAllTargetCategoryId}
            slug={categorySectionForm.seeAllSlug}
            onChange={(patch) => setCategorySectionForm((p) => ({
              ...p,
              seeAllTargetCategoryId: patch.targetCategoryId,
              seeAllSlug: patch.slug
            }))}
            label="See All Redirect"
          />

          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="block text-base font-bold text-gray-900">Cards ({categorySectionForm.cards.length})</label>
              <button
                type="button"
                onClick={() => {
                  resetCardForm();
                  setIsCardModalOpen(true);
                }}
                className="px-4 py-2 rounded-xl text-white transition-all flex items-center gap-2 text-sm font-semibold shadow-md hover:shadow-lg"
                style={{
                  background: 'linear-gradient(to right, #2874F0, #1e5fd4)',
                  border: 'none',
                  cursor: 'pointer'
                }}
              >
                <FiPlus className="w-4 h-4" />
                <span>Add Card</span>
              </button>
            </div>
            {categorySectionForm.cards.length === 0 ? (
              <div className="text-sm text-gray-500 text-center py-4 border border-gray-200 rounded-lg">
                No cards added. Select a category above to add.
              </div>
            ) : (
              <div className="space-y-2 border border-gray-200 rounded-lg p-3 max-h-96 overflow-y-auto">
                {categorySectionForm.cards.map((card) => {
                  const category = categories.find((c) => c.id === card.targetCategoryId);
                  return (
                    <div key={card.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                      <div className="flex items-center gap-3 flex-1">
                        {card.imageUrl ? (
                          <img src={card.imageUrl} alt={card.title} className="h-12 w-12 object-cover rounded-lg border border-gray-200" />
                        ) : (
                          <div className="h-12 w-12 bg-gray-200 rounded-lg border border-gray-200 flex items-center justify-center">
                            <span className="text-xs text-gray-400">No img</span>
                          </div>
                        )}
                        <div className="flex-1">
                          <div className="text-sm font-semibold text-gray-900">{card.title || "Untitled"}</div>
                          <div className="flex items-center gap-3 mt-1 flex-wrap">
                            {card.rating && (
                              <span className="text-xs text-gray-600">⭐ {card.rating}</span>
                            )}
                            {card.reviews && (
                              <span className="text-xs text-gray-500">{card.reviews}</span>
                            )}
                            {card.price && (
                              <span className="text-xs font-semibold text-gray-900">₹{card.price}</span>
                            )}
                            {card.originalPrice && (
                              <span className="text-xs text-gray-400 line-through">₹{card.originalPrice}</span>
                            )}
                            {card.discount && (
                              <span className="text-xs font-semibold text-green-600">{card.discount} off</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingCardId(card.id);
                            setCardForm({
                              id: card.id,
                              title: card.title || "",
                              imageUrl: card.imageUrl || "",
                              rating: card.rating || "",
                              reviews: card.reviews || "",
                              price: card.price || "",
                              originalPrice: card.originalPrice || "",
                              discount: card.discount || "",
                              targetCategoryId: card.targetCategoryId || ""
                            });
                            setIsCardModalOpen(true);
                          }}
                          className="p-2 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                          title="Edit"
                        >
                          <FiEdit2 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeCardFromSection(card.id)}
                          className="p-2 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
                          title="Remove"
                        >
                          <FiTrash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="flex gap-3 pt-4">
            <button
              onClick={saveCategorySection}
              disabled={isSyncing}
              className={`flex-1 py-3.5 text-white rounded-xl font-semibold transition-all flex items-center justify-center gap-2 shadow-md hover:shadow-lg ${isSyncing ? 'opacity-50 cursor-not-allowed bg-gray-400' : ''}`}
              style={{ backgroundColor: isSyncing ? '#cbd5e1' : '#2874F0' }}
              onMouseEnter={(e) => !isSyncing && (e.target.style.backgroundColor = '#1e5fd4')}
              onMouseLeave={(e) => !isSyncing && (e.target.style.backgroundColor = '#2874F0')}
            >
              {isSyncing ? (
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
              ) : <FiSave className="w-5 h-5" />}
              {isSyncing ? "Saving..." : (editingCategorySectionId ? "Update Section" : "Add Section")}
            </button>
            <button
              onClick={resetCategorySectionForm}
              disabled={isSyncing}
              className="px-6 py-3.5 text-gray-700 rounded-xl font-medium hover:bg-gray-100 transition-all border border-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>

      {/* Card Modal for Category Sections */}
      <Modal
        isOpen={isCardModalOpen}
        onClose={resetCardForm}
        title={editingCardId ? "Edit Card" : "Add Card"}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-base font-bold text-gray-900 mb-2">Card Title *</label>
            <input
              value={cardForm.title}
              onChange={(e) => setCardForm((p) => ({ ...p, title: e.target.value }))}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all bg-white"
              placeholder="e.g. Salon for Women"
            />
          </div>

          <div>
            <label className="block text-base font-bold text-gray-900 mb-2">Image</label>
            <div className="space-y-3">
              <input
                type="file"
                accept="image/*,video/*"
                disabled={uploading}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setUploading(true);
                    setUploadProgress(0);
                    try {
                      const response = await serviceService.uploadImage(file, 'cards', (progress) => {
                        setUploadProgress(progress);
                      });
                      if (response.success) {
                        setCardForm((p) => ({ ...p, imageUrl: response.imageUrl }));
                        toast.success("Media uploaded!");
                      }
                    } catch (error) {
                      console.error('Card upload error:', error);
                      toast.error("Failed to upload media");
                    } finally {
                      setUploading(false);
                      setUploadProgress(0);
                    }
                  }
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 file:mr-2 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100 disabled:opacity-50 disabled:cursor-not-allowed"
              />
              {uploading && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-blue-600 text-sm font-medium">
                    <div className="flex items-center gap-2">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                      Uploading...
                    </div>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="w-full bg-blue-100 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-blue-600 h-full transition-all duration-300 ease-out"
                      style={{ width: `${uploadProgress}%` }}
                    ></div>
                  </div>
                </div>
              )}
              {cardForm.imageUrl && !uploading && (
                <div className="relative inline-block group">
                  <img src={cardForm.imageUrl} alt="Preview" className="h-24 w-auto object-cover rounded-lg border border-gray-200 shadow-sm" />
                  <button
                    onClick={() => setCardForm(p => ({ ...p, imageUrl: "" }))}
                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Remove image"
                  >
                    <FiTrash2 className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
            <input
              type="text"
              value={cardForm.imageUrl}
              onChange={(e) => setCardForm((p) => ({ ...p, imageUrl: e.target.value }))}
              className="w-full mt-2 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="Or paste image URL"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-base font-bold text-gray-900 mb-2">Rating (optional)</label>
              <input
                type="text"
                value={cardForm.rating}
                onChange={(e) => setCardForm((p) => ({ ...p, rating: e.target.value }))}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all bg-white"
                placeholder="e.g. 4.79"
              />
            </div>
            <div>
              <label className="block text-base font-bold text-gray-900 mb-2">Reviews (optional)</label>
              <input
                type="text"
                value={cardForm.reviews}
                onChange={(e) => setCardForm((p) => ({ ...p, reviews: e.target.value }))}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all bg-white"
                placeholder="e.g. 3.7M"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-base font-bold text-gray-900 mb-2">Price *</label>
              <input
                type="text"
                value={cardForm.price}
                onChange={(e) => {
                  const newPrice = e.target.value;
                  let newDiscount = cardForm.discount;

                  // Auto-calculate discount
                  if (newPrice && cardForm.originalPrice) {
                    const priceVal = parseFloat(newPrice.toString().replace(/[^0-9.]/g, ''));
                    const originalVal = parseFloat(cardForm.originalPrice.toString().replace(/[^0-9.]/g, ''));

                    if (!isNaN(priceVal) && !isNaN(originalVal) && originalVal > priceVal) {
                      const discountVal = Math.round(((originalVal - priceVal) / originalVal) * 100);
                      newDiscount = `${discountVal}% OFF`;
                    }
                  }

                  setCardForm((p) => ({ ...p, price: newPrice, discount: newDiscount }));
                }}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all bg-white"
                placeholder="e.g. 950"
              />
            </div>
            <div>
              <label className="block text-base font-bold text-gray-900 mb-2">Original Price (optional)</label>
              <input
                type="text"
                value={cardForm.originalPrice}
                onChange={(e) => {
                  const newOriginalPrice = e.target.value;
                  let newDiscount = cardForm.discount;

                  // Auto-calculate discount
                  if (cardForm.price && newOriginalPrice) {
                    const priceVal = parseFloat(cardForm.price.toString().replace(/[^0-9.]/g, ''));
                    const originalVal = parseFloat(newOriginalPrice.toString().replace(/[^0-9.]/g, ''));

                    if (!isNaN(priceVal) && !isNaN(originalVal) && originalVal > priceVal) {
                      const discountVal = Math.round(((originalVal - priceVal) / originalVal) * 100);
                      newDiscount = `${discountVal}% OFF`;
                    }
                  }

                  setCardForm((p) => ({ ...p, originalPrice: newOriginalPrice, discount: newDiscount }));
                }}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all bg-white"
                placeholder="e.g. 1,038"
              />
            </div>
            <div>
              <label className="block text-base font-bold text-gray-900 mb-2">Discount (auto)</label>
              <input
                type="text"
                value={cardForm.discount}
                onChange={(e) => setCardForm((p) => ({ ...p, discount: e.target.value }))}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all bg-gray-50 text-gray-600"
                placeholder="e.g. 8% OFF"
              />
            </div>
          </div>
          <RedirectionSelector
            categories={categories}
            allServices={allServices}
            targetCategoryId={cardForm.targetCategoryId}
            slug={cardForm.slug}
            onChange={(patch) => setCardForm((p) => ({ ...p, ...patch }))}
            label="Redirect to..."
          />
          <div className="flex gap-3 pt-4">
            <button
              onClick={saveCard}
              disabled={uploading || isSyncing}
              className={`flex-1 py-3.5 text-white rounded-xl font-semibold transition-all flex items-center justify-center gap-2 shadow-md hover:shadow-lg ${(uploading || isSyncing) ? 'opacity-50 cursor-not-allowed bg-gray-400' : ''}`}
              style={{ backgroundColor: (uploading || isSyncing) ? '#cbd5e1' : '#2874F0' }}
            >
              {uploading ? (
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
              ) : <FiSave className="w-5 h-5" />}
              {uploading ? "Uploading..." : (editingCardId ? "Update Card" : "Add Card")}
            </button>
            <button
              onClick={resetCardForm}
              className="px-6 py-3.5 text-gray-700 rounded-xl font-medium hover:bg-gray-100 transition-all border border-gray-200"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default HomePage;

