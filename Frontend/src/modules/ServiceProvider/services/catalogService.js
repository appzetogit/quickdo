import api, { apiCache } from './api';
import { uploadToCloudinary } from '../utils/cloudinaryUpload';

/**
 * Catalog Service
 * Handles all API calls for Categories, Brands (formerly Services), Services (Sub-services), and Home Content
 */

/**
 * Category API calls
 */
export const categoryService = {
  // Get all categories
  getAll: async (params = {}) => {
    const queryParams = new URLSearchParams();
    if (params.status) queryParams.append('status', params.status);
    if (params.showOnHome !== undefined) queryParams.append('showOnHome', params.showOnHome);
    if (params.isPopular !== undefined) queryParams.append('isPopular', params.isPopular);
    if (params.cityId) queryParams.append('cityId', params.cityId);

    const response = await api.get(`/admin/categories${queryParams.toString() ? `?${queryParams.toString()}` : ''}`);
    return response.data;
  },

  // Get single category by ID
  getById: async (id) => {
    const response = await api.get(`/admin/categories/${id}`);
    return response.data;
  },

  // Create new category
  create: async (data) => {
    const response = await api.post('/admin/categories', data);
    return response.data;
  },

  // Update category
  update: async (id, data) => {
    const response = await api.put(`/admin/categories/${id}`, data);
    return response.data;
  },

  // Delete category
  delete: async (id) => {
    const response = await api.delete(`/admin/categories/${id}`);
    return response.data;
  },

  // Update category order
  updateOrder: async (id, homeOrder) => {
    const response = await api.patch(`/admin/categories/${id}/order`, { homeOrder });
    return response.data;
  }
};

/**
 * Brand API calls (Formerly Service)
 */
export const brandService = {
  // Get all brands
  getAll: async (params = {}) => {
    const queryParams = new URLSearchParams();
    if (params.status) queryParams.append('status', params.status);
    if (params.categoryId) queryParams.append('categoryId', params.categoryId);
    if (params.cityId) queryParams.append('cityId', params.cityId);

    const response = await api.get(`/admin/brands${queryParams.toString() ? `?${queryParams.toString()}` : ''}`);
    return response.data;
  },

  // Get single brand by ID
  getById: async (id) => {
    const response = await api.get(`/admin/brands/${id}`);
    return response.data;
  },

  // Create new brand
  create: async (data) => {
    const response = await api.post('/admin/brands', data);
    return response.data;
  },

  // Update brand
  update: async (id, data) => {
    const response = await api.put(`/admin/brands/${id}`, data);
    return response.data;
  },

  // Delete brand
  delete: async (id) => {
    const response = await api.delete(`/admin/brands/${id}`);
    return response.data;
  },

  // Update brand page content
  updatePage: async (id, page) => {
    const response = await api.patch(`/admin/brands/${id}/page`, { page });
    return response.data;
  },

  // Upload brand image/video directly to Cloudinary
  uploadImage: async (file, folder = 'brands', onProgress) => {
    try {
      const url = await uploadToCloudinary(file, folder, onProgress);
      return {
        success: true,
        imageUrl: url,
        message: 'File uploaded successfully'
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to upload file',
        error: error.message
      };
    }
  }
};

/**
 * Service API calls (New Service Model - Child of Brand)
 */
export const serviceService = {
  // Get all services
  getAll: async (params = {}) => {
    const queryParams = new URLSearchParams();
    if (params.status) queryParams.append('status', params.status);
    if (params.brandId) queryParams.append('brandId', params.brandId);

    const response = await api.get(`/admin/services${queryParams.toString() ? `?${queryParams.toString()}` : ''}`);
    return response.data;
  },

  // Get single service by ID
  getById: async (id) => {
    const response = await api.get(`/admin/services/${id}`);
    return response.data;
  },

  // Create new service
  create: async (data) => {
    const response = await api.post('/admin/services', data);
    return response.data;
  },

  // Update service
  update: async (id, data) => {
    const response = await api.put(`/admin/services/${id}`, data);
    return response.data;
  },

  // Delete service
  delete: async (id) => {
    const response = await api.delete(`/admin/services/${id}`);
    return response.data;
  },

  // Upload service image directly to Cloudinary
  uploadImage: async (file, folder = 'services', onProgress) => {
    try {
      const url = await uploadToCloudinary(file, folder, onProgress);
      return {
        success: true,
        imageUrl: url,
        message: 'File uploaded successfully'
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to upload file',
        error: error.message
      };
    }
  }
};

/**
 * Vendor Catalog API calls
 */
export const vendorCatalogService = {
  // Services
  getAllServices: async () => {
    const response = await api.get('/admin/vendor-services');
    return response.data;
  },
  createService: async (data) => {
    const response = await api.post('/admin/vendor-services', data);
    return response.data;
  },
  updateService: async (id, data) => {
    const response = await api.put(`/admin/vendor-services/${id}`, data);
    return response.data;
  },
  deleteService: async (id) => {
    const response = await api.delete(`/admin/vendor-services/${id}`);
    return response.data;
  },

  // Parts
  getAllParts: async () => {
    const response = await api.get('/admin/vendor-parts');
    return response.data;
  },
  createPart: async (data) => {
    const response = await api.post('/admin/vendor-parts', data);
    return response.data;
  },
  updatePart: async (id, data) => {
    const response = await api.put(`/admin/vendor-parts/${id}`, data);
    return response.data;
  },
  deletePart: async (id) => {
    const response = await api.delete(`/admin/vendor-parts/${id}`);
    return response.data;
  }
};

/**
 * Home Content API calls
 */
export const homeContentService = {
  // Get home content
  get: async (params = {}) => {
    const queryParams = new URLSearchParams();
    if (params.cityId) queryParams.append('cityId', params.cityId);

    const response = await api.get(`/admin/home-content${queryParams.toString() ? `?${queryParams.toString()}` : ''}`);
    return response.data;
  },

  // Update home content
  update: async (data, params = {}) => {
    const queryParams = new URLSearchParams();
    if (params.cityId) queryParams.append('cityId', params.cityId);

    const response = await api.put(`/admin/home-content${queryParams.toString() ? `?${queryParams.toString()}` : ''}`, data);
    return response.data;
  }
};

/**
 * Public Catalog Service (for user app - no authentication required)
 * Now with caching for faster data retrieval
 */
export const publicCatalogService = {
  // Get all active categories (cached for 5 minutes)
  getCategories: async (cityId) => {
    const cacheKey = `public:categories:${cityId || 'default'}`;
    const cached = apiCache.get(cacheKey);
    if (cached) return cached;

    const query = cityId ? `?cityId=${cityId}` : '';
    const response = await api.get(`/public/categories${query}`);
    if (response.data.success) {
      apiCache.set(cacheKey, response.data, 300); // 5 minutes
    }
    return response.data;
  },

  // Get all active brands (formerly services)
  getBrands: async (params = {}) => {
    const queryParams = new URLSearchParams();
    if (params.categoryId) queryParams.append('categoryId', params.categoryId);
    if (params.categorySlug) queryParams.append('categorySlug', params.categorySlug);
    if (params.search) queryParams.append('search', params.search);
    if (params.cityId) queryParams.append('cityId', params.cityId);

    const cacheKey = `public:brands:${queryParams.toString()}`;
    const cached = apiCache.get(cacheKey);
    if (cached) return cached;

    const response = await api.get(`/public/brands${queryParams.toString() ? `?${queryParams.toString()}` : ''}`);
    if (response.data.success) {
      apiCache.set(cacheKey, response.data, 120); // 2 minutes
    }
    return response.data;
  },

  // Alias for backward compatibility if needed, but preferable to use getBrands
  getServices: async (params = {}) => {
    // New Service model endpoint
    const queryParams = new URLSearchParams();
    if (params.brandId) queryParams.append('brandId', params.brandId);
    if (params.brandSlug) queryParams.append('brandSlug', params.brandSlug);
    if (params.categoryId) queryParams.append('categoryId', params.categoryId);
    if (params.search) queryParams.append('search', params.search);

    const cacheKey = `public:services:${queryParams.toString()}`;
    const cached = apiCache.get(cacheKey);
    if (cached) return cached;

    const response = await api.get(`/public/services${queryParams.toString() ? `?${queryParams.toString()}` : ''}`);
    if (response.data.success) {
      apiCache.set(cacheKey, response.data, 120);
    }
    return response.data;
  },

  // Get brand by slug (cached for 1 minute)
  getBrandBySlug: async (slug, cityId) => {
    const cacheKey = `public:brand:${slug}:${cityId || 'default'}`;
    const cached = apiCache.get(cacheKey);
    if (cached) return cached;

    const query = cityId ? `?cityId=${cityId}` : '';
    const response = await api.get(`/public/brands/slug/${slug}${query}`);
    if (response.data.success) {
      apiCache.set(cacheKey, response.data, 60); // 1 minute
    }
    return response.data;
  },

  // Get home content (cached for 2 minutes)
  getHomeContent: async (cityId) => {
    const cacheKey = `public:homeContent:${cityId || 'default'}`;
    const cached = apiCache.get(cacheKey);
    if (cached) return cached;

    const query = cityId ? `?cityId=${cityId}` : '';
    const response = await api.get(`/public/home-content${query}`);
    if (response.data.success) {
      apiCache.set(cacheKey, response.data, 120); // 2 minutes
    }
    return response.data;
  },

  // Get consolidated home data (cached for 2 minutes)
  getHomeData: async (cityId) => {
    const cacheKey = `public:homeData:${cityId || 'default'}`;
    const cached = apiCache.get(cacheKey);
    if (cached) return cached;

    const query = cityId ? `?cityId=${cityId}` : '';
    const response = await api.get(`/public/home-data${query}`);
    if (response.data.success) {
      apiCache.set(cacheKey, response.data, 120); // 2 minutes
    }
    return response.data;
  },

  // Invalidate all public caches (useful after admin updates)
  invalidateCache: () => {
    apiCache.invalidatePrefix('public:');
  }
};

