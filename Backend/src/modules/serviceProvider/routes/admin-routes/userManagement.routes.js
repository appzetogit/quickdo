const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { authenticate } = require('../../middleware/authMiddleware');
const { isAdmin } = require('../../middleware/roleMiddleware');
const {
  getAllUsers,
  getUserDetails,
  toggleUserStatus,
  deleteUser,
  getUserBookings,
  getUserWalletTransactions,
  getAllUserBookings
} = require('../../controllers/adminControllers/adminUserController');

// Validation rules
const toggleStatusValidation = [
  body('isActive').isBoolean().withMessage('isActive must be a boolean')
];

// Routes
router.get('/users', authenticate, isAdmin, getAllUsers);
router.get('/users/bookings', authenticate, isAdmin, getAllUserBookings);
router.get('/users/:id', authenticate, isAdmin, getUserDetails);
router.put('/users/:id/status', authenticate, isAdmin, toggleStatusValidation, toggleUserStatus);
router.delete('/users/:id', authenticate, isAdmin, deleteUser);
router.get('/users/:id/bookings', authenticate, isAdmin, getUserBookings);
router.get('/users/:id/wallet', authenticate, isAdmin, getUserWalletTransactions);

module.exports = router;

