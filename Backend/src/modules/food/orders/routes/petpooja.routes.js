import express from 'express';
import { petpoojaWebhookController } from '../controllers/petpooja.controller.js';

const router = express.Router();

// Public webhook callback endpoint
router.post('/', petpoojaWebhookController);

export default router;
