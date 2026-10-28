const Brand = require('../../models/Brand');
const Category = require('../../models/Category');
const { validationResult } = require('express-validator');
const { SERVICE_STATUS } = require('../../utils/constants');

/**
 * Get all brands
 * GET /api/admin/brands
 */
const getAllBrands = async (req, res) => {
  try {
    const { status, categoryId, cityId } = req.query;

    // Build query
    const query = {};
    if (status) query.status = status;
    if (categoryId) query.categoryIds = categoryId;
    if (cityId) {
      query.$or = [
        { cityIds: cityId },
        { cityIds: { $size: 0 } },
        { cityIds: { $exists: false } }
      ];
    }

    const brands = await Brand.find(query)
      // .populate('categoryIds', 'title slug')
      .select('-__v')
      .sort({ createdAt: -1 })
      .lean();

    // Helper function to clean MongoDB _id fields from nested objects
    const cleanMongoIds = (obj) => {
      if (!obj) return obj;
      if (Array.isArray(obj)) {
        return obj.map(item => cleanMongoIds(item));
      }
      if (typeof obj === 'object' && obj !== null) {
        const cleaned = {};
        for (const [key, value] of Object.entries(obj)) {
          if (key === '_id') continue; // Skip _id fields
          cleaned[key] = cleanMongoIds(value);
        }
        return cleaned;
      }
      return obj;
    };

    res.status(200).json({
      success: true,
      count: brands.length,
      brands: brands.map(brand => {
        // Ensure categoryIds is an array of populated objects (or at least handle if populated correctly)
        // If populate worked, cat will be an object. If not, it might be an ID string/OID.

        const validCats = (Array.isArray(brand.categoryIds) ? brand.categoryIds : []).filter(c => c);

        const catIds = validCats.map(cat => {
          if (cat._id) return cat._id.toString();
          if (typeof cat === 'string') return cat;
          if (cat.toString) return cat.toString();
          return null;
        }).filter(Boolean);

        const catTitles = validCats.map(cat => {
          if (cat.title) return cat.title;
          return null;
        }).filter(Boolean);

        return {
          id: brand._id.toString(),
          title: brand.title,
          slug: brand.slug,
          cityIds: brand.cityIds || [],
          categoryIds: catIds,
          categoryTitles: catTitles,
          categoryId: catIds[0] || null, // fallback to first ID
          categoryTitle: catTitles[0] || null,
          iconUrl: brand.iconUrl,
          badge: brand.badge,
          routePath: brand.routePath,
          status: brand.status,
          isPopular: brand.isPopular,
          isFeatured: brand.isFeatured,
          rating: brand.rating,
          totalBookings: brand.totalBookings,
          page: cleanMongoIds(brand.page) || {},
          sections: cleanMongoIds(brand.sections) || [],
          createdAt: brand.createdAt,
          updatedAt: brand.updatedAt
        };
      })
    });
  } catch (error) {
    console.error('Get all brands error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch brands. Please try again.'
    });
  }
};

/**
 * Get single brand by ID
 * GET /api/admin/brands/:id
 */
const getBrandById = async (req, res) => {
  try {
    const { id } = req.params;

    const brand = await Brand.findById(id)
      .populate('categoryIds', 'title slug')
      .select('-__v')
      .lean();

    if (!brand) {
      return res.status(404).json({
        success: false,
        message: 'Brand not found'
      });
    }

    // Helper function to clean MongoDB _id fields from nested objects
    const cleanMongoIds = (obj) => {
      if (!obj) return obj;
      if (Array.isArray(obj)) {
        return obj.map(item => cleanMongoIds(item));
      }
      if (typeof obj === 'object' && obj !== null) {
        const cleaned = {};
        for (const [key, value] of Object.entries(obj)) {
          if (key === '_id') continue; // Skip _id fields
          cleaned[key] = cleanMongoIds(value);
        }
        return cleaned;
      }
      return obj;
    };

    res.status(200).json({
      success: true,
      brand: {
        id: brand._id.toString(),
        title: brand.title,
        slug: brand.slug,
        cityIds: brand.cityIds || [],
        categoryIds: (brand.categoryIds || []).map(cat => cat._id?.toString() || cat.toString()),
        categoryTitles: (brand.categoryIds || []).map(cat => cat.title).filter(Boolean),
        categoryId: brand.categoryIds?.[0]?._id?.toString() || brand.categoryIds?.[0]?.toString(),
        categoryTitle: brand.categoryIds?.[0]?.title || null,
        iconUrl: brand.iconUrl,
        badge: brand.badge,
        routePath: brand.routePath,
        status: brand.status,
        isPopular: brand.isPopular,
        isFeatured: brand.isFeatured,
        rating: brand.rating,
        totalBookings: brand.totalBookings,
        page: cleanMongoIds(brand.page) || {},
        sections: cleanMongoIds(brand.sections) || [],
        createdAt: brand.createdAt,
        updatedAt: brand.updatedAt
      }
    });
  } catch (error) {
    console.error('Get brand by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch brand. Please try again.'
    });
  }
};

/**
 * Create new brand
 * POST /api/admin/brands
 */
const createBrand = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const {
      title,
      slug,
      categoryId, // backward compatibility
      categoryIds: providedCategoryIds, // array
      iconUrl,
      logo,
      badge,
      basePrice,
      discountPrice,
      page,
      sections,
      cityIds
    } = req.body;

    // Validate cities if provided
    if (cityIds && cityIds.length > 0) {
      // Logic to validate cities could be added here
      // For now we trust the ID list or rely on frontend
    }

    // Determine final category IDs
    const categoryIds = providedCategoryIds || (categoryId ? [categoryId] : []);

    if (categoryIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide at least one category'
      });
    }

    // Validate categories exist
    const categoriesCount = await Category.countDocuments({ _id: { $in: categoryIds } });
    if (categoriesCount !== categoryIds.length) {
      return res.status(400).json({
        success: false,
        message: 'One or more categories not found'
      });
    }

    // Check if brand with same title or slug exists
    const existingBrand = await Brand.findOne({
      status: { $ne: SERVICE_STATUS.DELETED },
      $or: [
        { title: title.trim() },
        { slug: slug?.trim().toLowerCase() }
      ]
    });

    if (existingBrand) {
      return res.status(400).json({
        success: false,
        message: 'Brand with this title or slug already exists'
      });
    }

    // Helper to sanitize targetCategoryId
    const sanitizeId = (id) => id === '' ? null : id;

    const sanitizedPage = page ? { ...page } : {
      banners: [],
      ratingTitle: title.trim(),
      ratingValue: '',
      bookingsText: '',
      paymentOffersEnabled: true,
      paymentOffers: [],
      serviceCategoriesGrid: []
    };

    if (sanitizedPage.serviceCategoriesGrid) {
      sanitizedPage.serviceCategoriesGrid = sanitizedPage.serviceCategoriesGrid.map(item => ({
        ...item,
        targetCategoryId: sanitizeId(item.targetCategoryId)
      }));
    }

    const sanitizedSections = (sections || []).map(section => {
      const newSection = { ...section };
      if (Array.isArray(newSection.cards)) {
        newSection.cards = newSection.cards.map(card => ({
          ...card,
          targetCategoryId: sanitizeId(card.targetCategoryId)
        }));
      }
      return newSection;
    });

    const brand = await Brand.create({
      title: title.trim(),
      slug: slug?.trim().toLowerCase() || undefined,
      categoryIds: categoryIds,
      iconUrl: iconUrl || null,
      badge: badge?.trim() || null,
      routePath: `/user/brand/${slug?.trim().toLowerCase() || title.trim().toLowerCase().replace(/\s+/g, '-')}`,
      page: sanitizedPage,
      sections: sanitizedSections,
      cityIds: cityIds || [],
      status: SERVICE_STATUS.ACTIVE,
      createdBy: req.user.id
    });

    res.status(201).json({
      success: true,
      message: 'Brand created successfully',
      brand: {
        id: brand._id,
        title: brand.title,
        slug: brand.slug,
        categoryIds: brand.categoryIds.map(c => c.toString()),
        iconUrl: brand.iconUrl,
        logo: brand.logo,
        badge: brand.badge,
        routePath: brand.routePath,
        page: brand.page,
        sections: brand.sections,
        createdAt: brand.createdAt,
        updatedAt: brand.updatedAt
      }
    });
  } catch (error) {
    console.error('Create brand error:', error);

    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Brand with this title or slug already exists'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to create brand. Please try again.'
    });
  }
};

/**
 * Update brand
 * PUT /api/admin/brands/:id
 */
const updateBrand = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { id } = req.params;
    const {
      title,
      slug,
      categoryId, // backward compatibility
      categoryIds: providedCategoryIds, // array
      iconUrl,
      logo,
      badge,
      basePrice,
      discountPrice,
      page,
      sections,
      status,
      cityIds: updateCityIds
    } = req.body;

    const categoryIds = providedCategoryIds || (categoryId ? [categoryId] : undefined);

    const brand = await Brand.findById(id);

    if (!brand) {
      return res.status(404).json({
        success: false,
        message: 'Brand not found'
      });
    }

    // Validate categories if provided
    if (categoryIds) {
      const categoriesCount = await Category.countDocuments({ _id: { $in: categoryIds } });
      if (categoriesCount !== categoryIds.length) {
        return res.status(400).json({
          success: false,
          message: 'One or more categories not found'
        });
      }
    }

    // Check if title or slug conflicts with another brand
    if (title || slug) {
      const existingBrand = await Brand.findOne({
        _id: { $ne: id },
        status: { $ne: SERVICE_STATUS.DELETED },
        $or: [
          title ? { title: title.trim() } : {},
          slug ? { slug: slug.trim().toLowerCase() } : {}
        ]
      });

      if (existingBrand) {
        return res.status(400).json({
          success: false,
          message: 'Brand with this title or slug already exists'
        });
      }
    }

    // Update fields
    if (title !== undefined) brand.title = title.trim();
    if (slug !== undefined) {
      brand.slug = slug.trim().toLowerCase();
      brand.routePath = `/user/brand/${slug.trim().toLowerCase()}`;
    }
    if (updateCityIds !== undefined) brand.cityIds = updateCityIds;
    if (categoryIds !== undefined) brand.categoryIds = categoryIds;
    if (iconUrl !== undefined) brand.iconUrl = iconUrl || null;
    if (badge !== undefined) brand.badge = badge?.trim() || null;
    if (page !== undefined) brand.page = page;
    if (sections !== undefined) {
      // Helper to sanitize targetCategoryId
      const sanitizeId = (id) => id === '' ? null : id;

      if (Array.isArray(sections)) {
        brand.sections = sections.map(section => {
          const newSection = { ...section };

          // Sanitize card IDs in sections
          if (Array.isArray(newSection.cards)) {
            newSection.cards = newSection.cards.map(card => ({
              ...card,
              targetCategoryId: sanitizeId(card.targetCategoryId)
            }));
          }

          return newSection;
        });
      } else {
        brand.sections = sections;
      }
    }
    if (status !== undefined) brand.status = status;

    await brand.save();

    res.status(200).json({
      success: true,
      message: 'Brand updated successfully',
      brand: {
        id: brand._id,
        title: brand.title,
        slug: brand.slug,
        categoryIds: brand.categoryIds.map(c => c.toString()),
        iconUrl: brand.iconUrl,
        logo: brand.logo,
        badge: brand.badge,
        routePath: brand.routePath,
        page: brand.page,
        sections: brand.sections,
        createdAt: brand.createdAt,
        updatedAt: brand.updatedAt
      }
    });
  } catch (error) {
    console.error('Update brand error:', error);

    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Brand with this title or slug already exists'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to update brand. Please try again.'
    });
  }
};

/**
 * Delete brand (soft delete - set status to deleted)
 * DELETE /api/admin/brands/:id
 */
const deleteBrand = async (req, res) => {
  try {
    const { id } = req.params;

    const brand = await Brand.findById(id);

    if (!brand) {
      return res.status(404).json({
        success: false,
        message: 'Brand not found'
      });
    }

    // Soft delete - set status to deleted
    brand.status = SERVICE_STATUS.DELETED;
    brand.slug = `${brand.slug}-deleted-${Date.now()}`;
    await brand.save();

    res.status(200).json({
      success: true,
      message: 'Brand deleted successfully'
    });
  } catch (error) {
    console.error('Delete brand error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete brand. Please try again.'
    });
  }
};

/**
 * Update brand page content
 * PATCH /api/admin/brands/:id/page
 */
const updateBrandPage = async (req, res) => {
  try {
    const { id } = req.params;
    const { page } = req.body;

    const brand = await Brand.findById(id);

    if (!brand) {
      return res.status(404).json({
        success: false,
        message: 'Brand not found'
      });
    }

    if (page !== undefined) {
      // Helper to sanitize targetCategoryId
      const sanitizeId = (id) => id === '' ? null : id;

      const sanitizedPage = { ...page };

      if (sanitizedPage.serviceCategoriesGrid) {
        sanitizedPage.serviceCategoriesGrid = sanitizedPage.serviceCategoriesGrid.map(item => ({
          ...item,
          targetCategoryId: sanitizeId(item.targetCategoryId)
        }));
      }

      if (sanitizedPage.paymentOffers) {
        sanitizedPage.paymentOffers = sanitizedPage.paymentOffers.map(item => ({
          ...item,
          targetCategoryId: sanitizeId(item.targetCategoryId)
        }));
      }

      if (sanitizedPage.banners) {
        sanitizedPage.banners = sanitizedPage.banners.map(item => ({
          ...item,
          targetCategoryId: sanitizeId(item.targetCategoryId)
        }));
      }

      // Explicitly update fields to ensure Mongoose detects changes
      if (sanitizedPage.ratingTitle !== undefined) brand.page.ratingTitle = sanitizedPage.ratingTitle;
      if (sanitizedPage.ratingValue !== undefined) brand.page.ratingValue = sanitizedPage.ratingValue;
      if (sanitizedPage.bookingsText !== undefined) brand.page.bookingsText = sanitizedPage.bookingsText;
      if (sanitizedPage.paymentOffersEnabled !== undefined) brand.page.paymentOffersEnabled = sanitizedPage.paymentOffersEnabled;

      if (sanitizedPage.banners) {
        brand.page.banners = sanitizedPage.banners;
      }

      if (sanitizedPage.paymentOffers) {
        brand.page.paymentOffers = sanitizedPage.paymentOffers;
      }

      if (sanitizedPage.serviceCategoriesGrid) {
        brand.page.serviceCategoriesGrid = sanitizedPage.serviceCategoriesGrid;
      }

      // Mark as modified to ensure saving
      brand.markModified('page');
    }

    await brand.save();

    res.status(200).json({
      success: true,
      message: 'Brand page content updated successfully',
      brand: {
        id: brand._id,
        page: brand.page
      }
    });
  } catch (error) {
    console.error('Update brand page error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update brand page. Please try again.'
    });
  }
};

/**
 * Upload brand image
 * POST /api/admin/brands/upload-image
 */
const uploadBrandImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided'
      });
    }

    // req.file.path contains the full Cloudinary URL when using multer-storage-cloudinary
    res.status(200).json({
      success: true,
      message: 'Image uploaded successfully',
      imageUrl: req.file.path
    });
  } catch (error) {
    console.error('Upload image error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to upload image'
    });
  }
};

module.exports = {
  getAllBrands,
  getBrandById,
  createBrand,
  updateBrand,
  deleteBrand,
  updateBrandPage,
  uploadBrandImage
};
