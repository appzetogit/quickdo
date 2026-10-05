export const LS_KEY = "adminUserAppCatalog";

export const toAssetUrl = (url) => {
  if (!url) return '';
  // For Cloudinary URLs, return as-is
  if (url.startsWith('http')) return url;
  // For any other URLs, return as-is (they should already be full URLs from Cloudinary)
  return url;
};

export const slugify = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

export const loadCatalog = () => {
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) {
    return {
      mode: "multi",
      home: { banners: [] },
      categories: [],
      services: [],
      updatedAt: new Date().toISOString(),
    };
  }
  try {
    const parsed = JSON.parse(raw);
    return {
      mode: parsed?.mode === "single" ? "single" : "multi",
      home: parsed?.home && typeof parsed.home === "object" ? parsed.home : { banners: [] },
      categories: Array.isArray(parsed?.categories) ? parsed.categories : [],
      services: Array.isArray(parsed?.services) ? parsed.services : [],
      updatedAt: parsed?.updatedAt || new Date().toISOString(),
    };
  } catch {
    return {
      mode: "multi",
      home: { banners: [] },
      categories: [],
      services: [],
      updatedAt: new Date().toISOString(),
    };
  }
};

export const saveCatalog = (catalog) => {
  const payload = { ...catalog, updatedAt: new Date().toISOString() };
  localStorage.setItem(LS_KEY, JSON.stringify(payload));
  window.dispatchEvent(new Event("adminUserAppCatalogUpdated"));
};

export const ensureIds = (catalog) => {
  const categoriesForLookup = Array.isArray(catalog?.categories) ? catalog.categories : [];
  const getTargetCategoryIdFromRoute = (routePath) => {
    const rp = String(routePath || "").trim();
    if (!rp) return "";
    const match = categoriesForLookup.find((c) => String(c?.routePath || "").trim() === rp);
    return match?.id || "";
  };

  const withIds = {
    ...catalog,
    home: {
      ...(catalog?.home || {}),
      banners: Array.isArray(catalog?.home?.banners)
        ? catalog.home.banners.map((b) => ({
          id: b.id || `hbnr-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          imageUrl: b.imageUrl || "",
          text: b.text || "",
          targetCategoryId: b.targetCategoryId || getTargetCategoryIdFromRoute(b.routePath),
          slug: b.slug || "",
          targetServiceId: b.targetServiceId || null,
          scrollToSection: b.scrollToSection || "",
        }))
        : [],
      promoCarousel: Array.isArray(catalog?.home?.promoCarousel)
        ? catalog.home.promoCarousel.map((p) => ({
          id: p.id || `hprm-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          title: p.title || "",
          subtitle: p.subtitle || "",
          buttonText: p.buttonText || "",
          gradientClass: p.gradientClass || p.className || "from-blue-600 to-blue-800",
          imageUrl: p.imageUrl || p.image || "",
          targetCategoryId:
            p.targetCategoryId || getTargetCategoryIdFromRoute(p.routePath || p.route),
          slug: p.slug || "",
          targetServiceId: p.targetServiceId || null,
          scrollToSection: p.scrollToSection || "",
        }))
        : [],
      curatedServices: Array.isArray(catalog?.home?.curatedServices)
        ? catalog.home.curatedServices.map((s) => ({
          id: s.id || `hcur-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          title: s.title || "",
          gifUrl: s.gifUrl || "",
          youtubeUrl: s.youtubeUrl || "",
          targetCategoryId: s.targetCategoryId || getTargetCategoryIdFromRoute(s.routePath),
          slug: s.slug || "",
          targetServiceId: s.targetServiceId || null,
        }))
        : [],
      newAndNoteworthy: Array.isArray(catalog?.home?.newAndNoteworthy)
        ? catalog.home.newAndNoteworthy.map((s) => ({
          id: s.id || `hnnw-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          title: s.title || "",
          imageUrl: s.imageUrl || "",
          targetCategoryId: s.targetCategoryId || getTargetCategoryIdFromRoute(s.routePath),
          slug: s.slug || "",
          targetServiceId: s.targetServiceId || null,
        }))
        : [],
      mostBooked: Array.isArray(catalog?.home?.mostBooked)
        ? catalog.home.mostBooked.map((s) => ({
          id: s.id || `hmb-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          title: s.title || "",
          rating: s.rating || "",
          reviews: s.reviews || "",
          price: s.price || "",
          originalPrice: s.originalPrice || "",
          discount: s.discount || "",
          imageUrl: s.imageUrl || "",
          targetCategoryId: s.targetCategoryId || getTargetCategoryIdFromRoute(s.routePath),
          slug: s.slug || "",
          targetServiceId: s.targetServiceId || null,
        }))
        : [],
      categorySections: Array.isArray(catalog?.home?.categorySections)
        ? catalog.home.categorySections.map((sec) => ({
          id: sec.id || `hsec-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          title: sec.title || "",
          seeAllTargetCategoryId:
            sec.seeAllTargetCategoryId || getTargetCategoryIdFromRoute(sec.seeAllRoutePath),
          seeAllSlug: sec.seeAllSlug || "",
          seeAllTargetServiceId: sec.seeAllTargetServiceId || null,
          cards: Array.isArray(sec.cards)
            ? sec.cards.map((c) => ({
              ...c,
              id: c.id || `hcard-${Date.now()}-${Math.random().toString(16).slice(2)}`,
              targetCategoryId: c.targetCategoryId || getTargetCategoryIdFromRoute(c.routePath),
              slug: c.slug || "",
              targetServiceId: c.targetServiceId || null,
            }))
            : [],
        }))
        : [],
    },
    categories: (catalog.categories || []).map((c) => ({
      id: c.id || `ucat-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title: c.title || "",
      slug: c.slug || slugify(c.title),
      homeIconUrl: c.homeIconUrl || "",
      homeBadge: c.homeBadge || "",
      hasSaleBadge: Boolean(c.hasSaleBadge),
      showOnHome: c.showOnHome !== false,
      homeOrder: Number.isFinite(c.homeOrder) ? c.homeOrder : 0,
      // Preserve additional fields
      cityIds: c.cityIds || [],
      description: c.description || "",
      imageUrl: c.imageUrl || "",
      status: c.status || "active",
      isPopular: Boolean(c.isPopular),
    })),
    services: (catalog.services || []).map((s) => ({
      id: s.id || `usvc-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title: s.title || "",
      slug: s.slug || slugify(s.title),
      iconUrl: s.iconUrl || "",
      badge: s.badge || "",
      categoryId: s.categoryId || "",
      // Preserve additional fields
      categoryIds: s.categoryIds || [],
      categoryTitles: s.categoryTitles || [],
      cityIds: s.cityIds || [],
      status: s.status || "active",
      isPopular: Boolean(s.isPopular),
      isFeatured: Boolean(s.isFeatured),
      routePath: s.slug ? `/user/${s.slug}` : (s.routePath || ""),
      page: {
        banners: Array.isArray(s.page?.banners)
          ? s.page.banners.map((b) => ({
            id: b.id || `ubnr-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            imageUrl: b.imageUrl || "",
            text: b.text || "",
          }))
          : [],
        ratingTitle: s.page?.ratingTitle || s.title || "",
        ratingValue: s.page?.ratingValue || "",
        bookingsText: s.page?.bookingsText || "",
        paymentOffersEnabled: s.page?.paymentOffersEnabled !== false,
        paymentOffers: Array.isArray(s.page?.paymentOffers)
          ? s.page.paymentOffers.map((o) => ({
            id: o.id || `uoff-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            title: o.title || "",
            description: o.description || "",
            iconUrl: o.iconUrl || "",
            discount: o.discount || "",
            code: o.code || "",
          }))
          : [],
        serviceCategoriesGrid: Array.isArray(s.page?.serviceCategoriesGrid)
          ? s.page.serviceCategoriesGrid.map((g) => ({
            id: g.id || `ugrd-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            title: g.title || "",
            imageUrl: g.imageUrl || "",
            badge: g.badge || "",
          }))
          : [],
      },
      sections: Array.isArray(s.sections)
        ? s.sections.map((sec) => ({
          id: sec.id || `usec-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          title: sec.title || "",
          anchorId: sec.anchorId || slugify(sec.title),
          navImageUrl: sec.navImageUrl || "",
          navBadge: sec.navBadge || "",
          type: sec.type || "standard",
          cards: Array.isArray(sec.cards)
            ? sec.cards.map((k) => ({
              id: k.id || `ucard-${Date.now()}-${Math.random().toString(16).slice(2)}`,
              title: k.title || "",
              subtitle: k.subtitle || "",
              rating: k.rating || "",
              reviews: k.reviews || "",
              price: k.price ?? "",
              originalPrice: k.originalPrice ?? "",
              duration: k.duration || "",
              options: k.options || "",
              badge: k.badge || "",
              label: k.label || "",
              offer: k.offer || "",
              priceText: k.priceText || "",
              perBathroom: k.perBathroom || "",
              iconName: k.iconName || "",
              description: k.description || "",
              imageUrl: k.imageUrl || k.image || "",
              features: Array.isArray(k.features) ? k.features : [],
              imageText: k.imageText
                ? {
                  titleLines: Array.isArray(k.imageText.titleLines)
                    ? k.imageText.titleLines
                    : Array.isArray(k.imageText.title)
                      ? k.imageText.title
                      : [],
                  subtitle: k.imageText.subtitle || "",
                }
                : null,
            }))
            : [],
        }))
        : [],
    })),
  };
  return withIds;
};

