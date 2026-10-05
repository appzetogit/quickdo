const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { authenticate } = require('../../middleware/authMiddleware');
const { isWorker } = require('../../middleware/roleMiddleware');
const {
  getAssignedJobs,
  getPendingRequests,
  getJobById,
  updateJobStatus,
  startJob,
  completeJob,
  addWorkerNotes,
  verifyVisit,
  workerReachedLocation,
  collectCash,
  respondToJob
} = require('../../controllers/bookingControllers/workerBookingController');
const {
  createOrUpdateBill,
  getBillByBookingId
} = require('../../controllers/vendorControllers/vendorBillController');
const VendorServiceCatalog = require('../../models/VendorServiceCatalog');
const VendorPartsCatalog = require('../../models/VendorPartsCatalog');

// Validation rules
const updateStatusValidation = [
  body('status').isIn(['in_progress', 'completed'])
    .withMessage('Invalid status')
];

const respondValidation = [
  body('status').isIn(['ACCEPTED', 'REJECTED']).withMessage('Invalid status')
];

const addNotesValidation = [
  body('notes').trim().notEmpty().withMessage('Notes are required')
];

// Routes
router.get('/jobs/pending-requests', authenticate, isWorker, getPendingRequests);
router.get('/jobs', authenticate, isWorker, getAssignedJobs);
router.get('/jobs/:id', authenticate, isWorker, getJobById);
router.put('/jobs/:id/respond', authenticate, isWorker, respondValidation, respondToJob);
router.put('/jobs/:id/status', authenticate, isWorker, updateStatusValidation, updateJobStatus);
router.post('/jobs/:id/start', authenticate, isWorker, startJob);
router.post('/jobs/:id/reached', authenticate, isWorker, workerReachedLocation);
router.post('/jobs/:id/visit/verify', authenticate, isWorker, verifyVisit);
router.post('/jobs/:id/complete', authenticate, isWorker, completeJob);
router.post('/jobs/:id/payment/collect', authenticate, isWorker, collectCash);
router.post('/jobs/:id/notes', authenticate, isWorker, addNotesValidation, addWorkerNotes);

// Bill Routes
router.post('/jobs/:id/bill', authenticate, isWorker, (req, res, next) => {
  req.params.bookingId = req.params.id;
  next();
}, createOrUpdateBill);

router.get('/jobs/:id/bill', authenticate, isWorker, (req, res, next) => {
  req.params.bookingId = req.params.id;
  next();
}, getBillByBookingId);

// Catalog Routes (for billing)
router.get('/catalog/services', authenticate, isWorker, async (req, res) => {
  try {
    const services = await VendorServiceCatalog.find({ status: 'active' }).populate('categoryId', 'title').sort({ name: 1 });
    res.status(200).json({ success: true, services });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch services catalog' });
  }
});

router.get('/catalog/parts', authenticate, isWorker, async (req, res) => {
  try {
    const parts = await VendorPartsCatalog.find({ status: 'active' })
      .populate('categoryId', 'title')
      .sort({ name: 1 });
    res.status(200).json({ success: true, parts });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch parts catalog' });
  }
});

module.exports = router;

