const express = require('express');
const router = express.Router();
const {
  listRules,
  createRule,
  updateRule,
  toggleRule,
  deleteRule,
  listOptions
} = require('../../controllers/adminControllers/commissionRuleController');
const { authenticate } = require('../../middleware/authMiddleware');
const { isAdmin } = require('../../middleware/roleMiddleware');

// Commission rules (SOW §8): admin only.
router.use(authenticate);
router.use(isAdmin);

router.get('/options', listOptions);

router.route('/')
  .get(listRules)
  .post(createRule);

router.route('/:id')
  .put(updateRule)
  .delete(deleteRule);

router.patch('/:id/toggle', toggleRule);

module.exports = router;
