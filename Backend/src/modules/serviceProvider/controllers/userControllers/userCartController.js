const Cart = require('../../models/Cart');
const Service = require('../../models/UserService');
const Brand = require('../../models/Brand');
const { validationResult } = require('express-validator');
const mongoose = require('mongoose');

/**
 * Get user's cart
 */
const getUserCart = async (req, res) => {
  try {
    const userId = req.user.id;

    let cart = await Cart.findOne({ userId }).populate('items.serviceId', 'title iconUrl slug').populate('items.categoryId', 'title slug');

    if (!cart) {
      // Create empty cart if doesn't exist
      cart = await Cart.create({ userId, items: [] });
    }

    res.status(200).json({
      success: true,
      data: cart.items || []
    });
  } catch (error) {
    console.error('Get user cart error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch cart. Please try again.'
    });
  }
};

/**
 * Add item to cart
 */
const addToCart = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const userId = req.user.id;
    const {
      serviceId,
      categoryId,
      title,
      description,
      icon,
      category,
      price,
      originalPrice,
      unitPrice,
      serviceCount,
      rating,
      reviews,
      vendorId,
      sectionTitle, // Brand name
      sectionIcon,  // Brand logo URL
      card          // Card details snapshot
    } = req.body;

    console.log(`[AddToCart] Request details - Title: ${title}, Section: ${sectionTitle}, ServiceId: ${serviceId}`);

    // Verify service exists (if serviceId is provided)
    let service = null;
    if (serviceId && mongoose.Types.ObjectId.isValid(serviceId)) {
      service = await Service.findById(serviceId).catch(() => null);
      if (!service) {
        // Also check if serviceId is a Brand ID
        const brand = await Brand.findById(serviceId).catch(() => null);
        if (!brand && !title) {
          return res.status(404).json({
            success: false,
            message: 'Service not found'
          });
        }
      }
    } else if (serviceId && !title) {
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    // Get or create cart
    let cart = await Cart.findOne({ userId });

    console.log(`[AddToCart] User: ${userId}, Cart Found: ${!!cart}`);

    if (!cart) {
      console.log('[AddToCart] Creating new cart');
      cart = await Cart.create({ userId, items: [] });
    }

    // Check if item already exists in cart
    const existingItemIndex = cart.items.findIndex(
      item => item.title === title && (!serviceId || item.serviceId?.toString() === serviceId)
    );

    if (existingItemIndex !== -1) {
      // Update quantity if item exists
      const existingItem = cart.items[existingItemIndex];
      const newCount = (existingItem.serviceCount || 1) + (serviceCount || 1);
      const newPrice = existingItem.unitPrice * newCount;

      cart.items[existingItemIndex].serviceCount = newCount;
      cart.items[existingItemIndex].price = newPrice;
    } else {
      // Add new item
      const newItem = {
        title,
        description: description || '',
        icon: icon || '',
        category,
        price: price || unitPrice || 0,
        originalPrice: originalPrice || null,
        unitPrice: unitPrice || price || 0,
        serviceCount: serviceCount || 1,
        rating: rating || '4.8',
        reviews: reviews || '10k+',
        vendorId: vendorId || null,
        sectionTitle: sectionTitle || '',
        sectionIcon: sectionIcon || null,
        card: card || null
      };

      // Only add serviceId and categoryId if they are valid ObjectIds
      if (serviceId && mongoose.Types.ObjectId.isValid(serviceId)) newItem.serviceId = serviceId;
      if (categoryId && mongoose.Types.ObjectId.isValid(categoryId)) newItem.categoryId = categoryId;

      console.log(`[AddToCart] Adding new item: ${title}`);
      cart.items.push(newItem);
    }

    await cart.save();
    console.log(`[AddToCart] Cart saved. Total items: ${cart.items.length}`);

    res.status(200).json({
      success: true,
      message: 'Item added to cart',
      data: cart.items
    });
  } catch (error) {
    console.error('Add to cart error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add item to cart. Please try again.'
    });
  }
};

/**
 * Update cart item quantity
 */
const updateCartItem = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const userId = req.user.id;
    const { itemId } = req.params;
    const { serviceCount } = req.body;

    if (serviceCount < 1) {
      return res.status(400).json({
        success: false,
        message: 'Quantity must be at least 1'
      });
    }

    const cart = await Cart.findOne({ userId });
    if (!cart) {
      return res.status(404).json({
        success: false,
        message: 'Cart not found'
      });
    }

    const item = cart.items.id(itemId);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Item not found in cart'
      });
    }

    item.serviceCount = serviceCount;
    item.price = item.unitPrice * serviceCount;
    await cart.save();

    res.status(200).json({
      success: true,
      message: 'Cart item updated',
      data: cart.items
    });
  } catch (error) {
    console.error('Update cart item error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update cart item. Please try again.'
    });
  }
};

/**
 * Remove item from cart
 */
const removeFromCart = async (req, res) => {
  try {
    const userId = req.user.id;
    const { itemId } = req.params;

    const cart = await Cart.findOne({ userId });
    if (!cart) {
      return res.status(404).json({
        success: false,
        message: 'Cart not found'
      });
    }

    cart.items = cart.items.filter(item => item._id.toString() !== itemId);
    await cart.save();

    res.status(200).json({
      success: true,
      message: 'Item removed from cart',
      data: cart.items
    });
  } catch (error) {
    console.error('Remove from cart error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove item from cart. Please try again.'
    });
  }
};

/**
 * Clear cart (remove all items)
 */
const clearCart = async (req, res) => {
  try {
    const userId = req.user.id;

    const cart = await Cart.findOne({ userId });
    if (!cart) {
      return res.status(404).json({
        success: false,
        message: 'Cart not found'
      });
    }

    cart.items = [];
    await cart.save();

    res.status(200).json({
      success: true,
      message: 'Cart cleared',
      data: []
    });
  } catch (error) {
    console.error('Clear cart error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear cart. Please try again.'
    });
  }
};

/**
 * Remove items by category
 */
const removeCategoryItems = async (req, res) => {
  try {
    const userId = req.user.id;
    const { category } = req.params;

    const cart = await Cart.findOne({ userId });
    if (!cart) {
      return res.status(404).json({
        success: false,
        message: 'Cart not found'
      });
    }

    cart.items = cart.items.filter(item => item.category !== category);
    await cart.save();

    res.status(200).json({
      success: true,
      message: 'Category items removed from cart',
      data: cart.items
    });
  } catch (error) {
    console.error('Remove category items error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove category items. Please try again.'
    });
  }
};

module.exports = {
  getUserCart,
  addToCart,
  updateCartItem,
  removeFromCart,
  clearCart,
  removeCategoryItems
};

