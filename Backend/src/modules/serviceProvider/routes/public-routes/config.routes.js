const express = require('express');
const router = express.Router();
const { getPublicSettings } = require('../../controllers/adminControllers/settingsController');

router.get('/config', getPublicSettings);

module.exports = router;
