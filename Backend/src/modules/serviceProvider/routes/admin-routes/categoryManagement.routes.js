const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { authenticate } = require('../../middleware/authMiddleware');
const { isAdmin } = require('../../middleware/roleMiddleware');
const {
  getAllCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
  updateCategoryOrder
} = require('../../controllers/adminControllers/categoryController');

// Validation rules
const createCategoryValidation = [
  body('title')
    .trim()
    .notEmpty()
    .withMessage('Category title is required')
    .isLength({ min: 2, max: 100 })
    .withMessage('Title must be between 2 and 100 characters'),
  body('slug')
    .optional({ checkFalsy: true })
    .trim()
    .toLowerCase()
    .matches(/^[a-z0-9-]+$/)
    .withMessage('Slug must contain only lowercase letters, numbers, and hyphens'),
  body('homeOrder')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Home order must be a non-negative integer'),
  body('status')
    .optional()
    .isIn(['active', 'inactive', 'deleted'])
    .withMessage('Status must be active, inactive, or deleted')
];

const updateCategoryValidation = [
  body('title')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Category title cannot be empty')
    .isLength({ min: 2, max: 100 })
    .withMessage('Title must be between 2 and 100 characters'),
  body('slug')
    .optional()
    .trim()
    .toLowerCase()
    .matches(/^[a-z0-9-]+$/)
    .withMessage('Slug must contain only lowercase letters, numbers, and hyphens'),
  body('homeOrder')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Home order must be a non-negative integer'),
  body('status')
    .optional()
    .isIn(['active', 'inactive', 'deleted'])
    .withMessage('Status must be active, inactive, or deleted')
];

// Routes
// GET /api/admin/categories - Get all categories
router.get('/categories', authenticate, isAdmin, getAllCategories);

// GET /api/admin/categories/:id - Get single category
router.get('/categories/:id', authenticate, isAdmin, getCategoryById);

// POST /api/admin/categories - Create new category
router.post('/categories', authenticate, isAdmin, createCategoryValidation, createCategory);

// PUT /api/admin/categories/:id - Update category
router.put('/categories/:id', authenticate, isAdmin, updateCategoryValidation, updateCategory);

// DELETE /api/admin/categories/:id - Delete category (soft delete)
router.delete('/categories/:id', authenticate, isAdmin, deleteCategory);

// PATCH /api/admin/categories/:id/order - Update category order
router.patch('/categories/:id/order', authenticate, isAdmin, updateCategoryOrder);

module.exports = router;
