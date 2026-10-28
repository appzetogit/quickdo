const Cart = require('../../models/Cart');
const Service = require('../../models/UserService');

/**
 * Get user's cart
 */
const getCart = async (req, res) => {
  try {
    const userId = req.user.id;

    let cart = await Cart.findOne({ userId }).populate('items.serviceId', 'title iconUrl basePrice discountPrice');

    if (!cart) {
      // Create empty cart if doesn't exist
      cart = await Cart.create({ userId, items: [] });
    }

    res.status(200).json({
      success: true,
      data: cart.items || []
    });
  } catch (error) {
    console.error('Get cart error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch cart'
    });
  }
};

/**
 * Add item to cart
 */
const addToCart = async (req, res) => {
  try {
    const userId = req.user.id;
    const { serviceId, title, category, price, unitPrice, serviceCount = 1, icon, description, categoryId, vendorId, sectionId, brandId } = req.body;

    if (!title || !category || !price) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    let cart = await Cart.findOne({ userId });

    if (!cart) {
      cart = new Cart({ userId, items: [] });
    }

    // Check if item already exists
    const existingItemIndex = cart.items.findIndex(
      item => item.serviceId?.toString() === serviceId || item.title === title
    );

    if (existingItemIndex > -1) {
      // Update quantity
      cart.items[existingItemIndex].serviceCount += serviceCount;
    } else {
      // Add new item
      cart.items.push({
        serviceId: serviceId || null,
        categoryId: categoryId || null,
        sectionId: sectionId || brandId || null, // Map either to sectionId
        brandId: brandId || sectionId || null,   // Also keep brandId if needed for frontend consistency
        title,
        description: description || '',
        icon: icon || '',
        category,
        price,
        unitPrice: unitPrice || price,
        serviceCount,
        vendorId: vendorId || null
      });
    }

    await cart.save();

    res.status(200).json({
      success: true,
      data: cart.items,
      message: 'Item added to cart'
    });
  } catch (error) {
    console.error('Add to cart error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add item to cart'
    });
  }
};

/**
 * Update cart item quantity
 */
const updateCartItem = async (req, res) => {
  try {
    const userId = req.user.id;
    const { itemId } = req.params;
    const { serviceCount } = req.body;

    if (!serviceCount || serviceCount < 1) {
      return res.status(400).json({
        success: false,
        message: 'Invalid quantity'
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
    await cart.save();

    res.status(200).json({
      success: true,
      data: cart.items,
      message: 'Cart updated'
    });
  } catch (error) {
    console.error('Update cart error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update cart'
    });
  }
};

/**
 * Remove item from cart
 */
const removeCartItem = async (req, res) => {
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
      data: cart.items,
      message: 'Item removed from cart'
    });
  } catch (error) {
    console.error('Remove cart item error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove item'
    });
  }
};

/**
 * Remove all items from a category
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

    cart.items = cart.items.filter(item => item.category !== decodeURIComponent(category));
    await cart.save();

    res.status(200).json({
      success: true,
      data: cart.items,
      message: 'Category items removed'
    });
  } catch (error) {
    console.error('Remove category items error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove category items'
    });
  }
};

/**
 * Clear entire cart
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
      data: [],
      message: 'Cart cleared'
    });
  } catch (error) {
    console.error('Clear cart error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear cart'
    });
  }
};

module.exports = {
  getCart,
  addToCart,
  updateCartItem,
  removeCartItem,
  removeCategoryItems,
  clearCart
};
