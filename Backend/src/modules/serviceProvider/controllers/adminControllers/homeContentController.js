const HomeContent = require('../../models/HomeContent');
const { validationResult } = require('express-validator');

/**
 * Get Home Content
 * GET /api/admin/home-content
 */
const getHomeContent = async (req, res) => {
  try {
    const { cityId } = req.query;
    // Use the static method which handles default/creation
    let homeContent = await HomeContent.getHomeContent(cityId);

    res.status(200).json({
      success: true,
      homeContent: {
        id: homeContent._id,
        cityId: homeContent.cityId,
        banners: homeContent.banners || [],
        promos: homeContent.promos || [],
        curated: homeContent.curated || [],
        noteworthy: homeContent.noteworthy || [],
        booked: homeContent.booked || [],
        categorySections: homeContent.categorySections || [],
        categorySections: homeContent.categorySections || [],
        isActive: homeContent.isActive,
        isBannersVisible: homeContent.isBannersVisible ?? true,
        isPromosVisible: homeContent.isPromosVisible ?? true,
        isCuratedVisible: homeContent.isCuratedVisible ?? true,
        isNoteworthyVisible: homeContent.isNoteworthyVisible ?? true,
        isBookedVisible: homeContent.isBookedVisible ?? true,
        isCategorySectionsVisible: homeContent.isCategorySectionsVisible ?? true,
        isCategoriesVisible: homeContent.isCategoriesVisible ?? true,
        createdAt: homeContent.createdAt,
        updatedAt: homeContent.updatedAt
      }
    });
  } catch (error) {
    console.error('Get home content error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch home content. Please try again.'
    });
  }
};

/**
 * Update Home Content
 * PUT /api/admin/home-content
 */
const updateHomeContent = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { cityId } = req.query;

    // Use static method to ensure we get the correct doc (or create if needed)
    let homeContent = await HomeContent.getHomeContent(cityId);

    // Helper to sanitize array items
    const sanitizeItems = (items) => {
      if (!Array.isArray(items)) return [];
      return items.map(item => {
        const newItem = { ...item };
        // Remove frontend-only 'id' fields that are strings
        // Added 'hsec-' for category sections
        if (typeof newItem.id === 'string' && (
          newItem.id.startsWith('hbnr-') ||
          newItem.id.startsWith('hprm-') ||
          newItem.id.startsWith('hcur-') ||
          newItem.id.startsWith('hnot-') ||
          newItem.id.startsWith('hbkd-') ||
          newItem.id.startsWith('hsec-')
        )) {
          delete newItem.id;
        }

        // Handle targetCategoryId/seeAllTargetCategoryId
        if (newItem.targetCategoryId === '') newItem.targetCategoryId = null;
        if (newItem.seeAllTargetCategoryId === '') newItem.seeAllTargetCategoryId = null;
        if (newItem.targetServiceId === '') newItem.targetServiceId = null;
        if (newItem.seeAllTargetServiceId === '') newItem.seeAllTargetServiceId = null;

        // Handle nested cards in categorySections
        if (Array.isArray(newItem.cards)) {
          newItem.cards = newItem.cards.map(card => {
            const newCard = { ...card };
            if (newCard.targetCategoryId === '') newCard.targetCategoryId = null;
            if (newCard.targetServiceId === '') newCard.targetServiceId = null;

            // Remove frontend-only 'id' fields from cards ie. 'hcard-'
            if (typeof newCard.id === 'string' && newCard.id.startsWith('hcard-')) {
              delete newCard.id;
            }

            return newCard;
          });
        }

        return newItem;
      });
    };

    // Update fields with sanitization
    if (req.body.banners !== undefined) homeContent.banners = sanitizeItems(req.body.banners);
    if (req.body.promos !== undefined) homeContent.promos = sanitizeItems(req.body.promos);
    if (req.body.curated !== undefined) homeContent.curated = sanitizeItems(req.body.curated);
    if (req.body.noteworthy !== undefined) homeContent.noteworthy = sanitizeItems(req.body.noteworthy);
    if (req.body.booked !== undefined) homeContent.booked = sanitizeItems(req.body.booked);
    if (req.body.categorySections !== undefined) {
      homeContent.categorySections = sanitizeItems(req.body.categorySections);
      homeContent.markModified('categorySections');
    }
    if (req.body.isActive !== undefined) homeContent.isActive = req.body.isActive;
    if (req.body.isBannersVisible !== undefined) homeContent.isBannersVisible = req.body.isBannersVisible;
    if (req.body.isPromosVisible !== undefined) homeContent.isPromosVisible = req.body.isPromosVisible;
    if (req.body.isCuratedVisible !== undefined) homeContent.isCuratedVisible = req.body.isCuratedVisible;
    if (req.body.isNoteworthyVisible !== undefined) homeContent.isNoteworthyVisible = req.body.isNoteworthyVisible;
    if (req.body.isBookedVisible !== undefined) homeContent.isBookedVisible = req.body.isBookedVisible;
    if (req.body.isCategorySectionsVisible !== undefined) homeContent.isCategorySectionsVisible = req.body.isCategorySectionsVisible;
    if (req.body.isCategoriesVisible !== undefined) homeContent.isCategoriesVisible = req.body.isCategoriesVisible;

    await homeContent.save();

    res.status(200).json({
      success: true,
      message: 'Home content updated successfully',
      homeContent: {
        id: homeContent._id,
        cityId: homeContent.cityId,
        banners: homeContent.banners,
        promos: homeContent.promos,
        curated: homeContent.curated,
        noteworthy: homeContent.noteworthy,
        booked: homeContent.booked,
        categorySections: homeContent.categorySections,
        categorySections: homeContent.categorySections,
        isActive: homeContent.isActive,
        isBannersVisible: homeContent.isBannersVisible,
        isPromosVisible: homeContent.isPromosVisible,
        isCuratedVisible: homeContent.isCuratedVisible,
        isNoteworthyVisible: homeContent.isNoteworthyVisible,
        isBookedVisible: homeContent.isBookedVisible,
        isCategorySectionsVisible: homeContent.isCategorySectionsVisible,
        isCategoriesVisible: homeContent.isCategoriesVisible
      }
    });
  } catch (error) {
    console.error('Update home content error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update home content. Please try again.'
    });
  }
};

module.exports = {
  getHomeContent,
  updateHomeContent
};

