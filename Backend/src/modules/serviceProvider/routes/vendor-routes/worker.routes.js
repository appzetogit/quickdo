const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { authenticate } = require('../../middleware/authMiddleware');
const { isVendor } = require('../../middleware/roleMiddleware');
const {
  getVendorWorkers,
  getVendorWorkerById,
  addWorker,
  linkWorker,
  updateWorker,
  removeWorker,
  getWorkerPerformance
} = require('../../controllers/vendorControllers/vendorWorkerController');

// Validation rules
const addWorkerValidation = [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').optional({ checkFalsy: true }).isEmail().withMessage('Valid email is required'),
  body('phone').trim().notEmpty().isLength({ min: 10, max: 10 }).withMessage('Phone number must be 10 digits'),
  body('aadhar.number').trim().notEmpty().isLength({ min: 12, max: 12 }).withMessage('Aadhar number must be 12 digits'),
  body('aadhar.document').trim().notEmpty().withMessage('Aadhar document is required'),
  body('serviceCategory').optional().trim(),
  body('serviceCategories').optional().isArray().withMessage('Service Categories must be an array'),
  body('skills').optional().isArray().withMessage('Skills must be an array')
];

const updateWorkerValidation = [
  body('name').optional().trim().notEmpty(),
  body('email').optional().isEmail(),
  body('serviceCategory').optional().trim(),
  body('serviceCategories').optional().isArray(),
  body('skills').optional().isArray(),
  body('status').optional().isIn(['active', 'inactive', 'suspended'])
];

// Routes
router.get('/', authenticate, isVendor, getVendorWorkers);
router.post('/link', authenticate, isVendor, linkWorker);
router.post('/', authenticate, isVendor, addWorkerValidation, addWorker);
router.get('/:id', authenticate, isVendor, getVendorWorkerById);
router.put('/:id', authenticate, isVendor, updateWorkerValidation, updateWorker);
router.delete('/:id', authenticate, isVendor, removeWorker);
router.get('/:id/performance', authenticate, isVendor, getWorkerPerformance);

module.exports = router;

