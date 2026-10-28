import { sendResponse } from '../../../../utils/response.js';
import * as chatService from '../services/chat.service.js';

const me = (req) => ({ role: req.user?.role, id: req.user?.userId });

export async function sendMessageController(req, res, next) {
    try {
        const message = await chatService.sendMessage(me(req), req.body || {});
        return sendResponse(res, 201, 'Message sent', { message });
    } catch (err) {
        next(err);
    }
}

export async function listConversationsController(req, res, next) {
    try {
        // ?orderId=<id> narrows to that order's threads. Omit it for everything.
        const data = await chatService.listConversations(me(req), {
            orderId: req.query.orderId
        });
        return sendResponse(res, 200, 'Conversations fetched', data);
    } catch (err) {
        next(err);
    }
}

export async function createConversationController(req, res, next) {
    try {
        const data = await chatService.createConversation(me(req), req.body || {});
        return sendResponse(res, 201, 'Conversation created', data);
    } catch (err) {
        next(err);
    }
}

export async function updateConversationStatusController(req, res, next) {
    try {
        const data = await chatService.updateConversationStatus(
            me(req),
            req.params.conversationId,
            req.body?.status
        );
        return sendResponse(res, 200, 'Conversation updated', data);
    } catch (err) {
        next(err);
    }
}

export async function getHistoryController(req, res, next) {
    try {
        const data = await chatService.getHistory(me(req), {
            conversationId: req.query.conversationId,
            page: req.query.page,
            limit: req.query.limit
        });
        return sendResponse(res, 200, 'Messages fetched', data);
    } catch (err) {
        next(err);
    }
}

export async function markReadController(req, res, next) {
    try {
        const data = await chatService.markRead(me(req), req.params.conversationId);
        return sendResponse(res, 200, 'Marked as read', data);
    } catch (err) {
        next(err);
    }
}
