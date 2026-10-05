import express from 'express';
import {
    sendMessageController,
    listConversationsController,
    createConversationController,
    updateConversationStatusController,
    getHistoryController,
    markReadController
} from '../controllers/chat.controller.js';

const router = express.Router();

// Auth + role gating applied where mounted (routes/index.js).
router.post('/messages', sendMessageController);
router.get('/messages', getHistoryController);
// ?orderId=<id> filters to one order's threads, newest first.
router.get('/conversations', listConversationsController);
router.post('/conversations', createConversationController);
router.patch('/conversations/:conversationId/status', updateConversationStatusController);
router.patch('/conversations/:conversationId/read', markReadController);

export default router;
