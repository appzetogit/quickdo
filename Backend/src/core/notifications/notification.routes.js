import express from 'express';
import {
    getInboxController,
    markNotificationReadController,
    dismissNotificationController,
    dismissAllNotificationsController,
    markAllNotificationsReadController,
} from './notification.controller.js';

const router = express.Router();

router.get('/inbox', getInboxController);
router.patch('/:id/read', markNotificationReadController);
router.delete('/:id', dismissNotificationController);
// Clearing the unread badge, as opposed to clearing the inbox below. Ported from
// the quick-commerce fork, which was the only place this existed -- food users
// could not mark everything read without also dismissing it.
router.patch('/inbox/read-all', markAllNotificationsReadController);
router.delete('/inbox/all', dismissAllNotificationsController);

export default router;
