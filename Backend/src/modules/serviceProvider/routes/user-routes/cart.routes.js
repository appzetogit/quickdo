const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/authMiddleware');
const { isUser } = require('../../middleware/roleMiddleware');
const {
  getUserCart,
  addToCart,
  updateCartItem,
  removeFromCart,
  removeCategoryItems,
  clearCart
} = require('../../controllers/userControllers/userCartController');

// All routes require authentication
router.get('/cart', authenticate, isUser, getUserCart);
router.post('/cart', authenticate, isUser, addToCart);
router.put('/cart/:itemId', authenticate, isUser, updateCartItem);
router.delete('/cart/:itemId', authenticate, isUser, removeFromCart);
router.delete('/cart/category/:category', authenticate, isUser, removeCategoryItems);
router.delete('/cart', authenticate, isUser, clearCart);

module.exports = router;
