import mongoose from 'mongoose';
import { getFirebaseDB } from '../../../../config/firebase.js';
import { getIO, rooms } from '../../../../config/socket.js';
import {
    NotFoundError,
    ValidationError
} from '../../../../core/auth/errors.js';
import { logger } from '../../../../utils/logger.js';
import { FoodOrder } from '../../orders/models/order.model.js';
import { FoodTransaction } from '../../orders/models/foodTransaction.model.js';
import * as dispatchService from '../../orders/services/order-dispatch.service.js';
import {
    buildOrderIdentityFilter,
    notifyOwnersSafely
} from '../../orders/services/order.helpers.js';
import { FoodDeliveryPartner } from '../models/deliveryPartner.model.js';
import { DeliveryOrderEmergencyRequest } from '../models/orderEmergencyRequest.model.js';

const ACTIVE_REQUEST_STATUSES = ['open', 'in_progress'];
const PRE_PICKUP_ORDER_STATUSES = [
    'confirmed',
    'preparing',
    'ready_for_pickup',
    'reached_pickup'
];

const isBeforePickup = (order) => {
    const phase = String(order?.deliveryState?.currentPhase || '');
    return (
        PRE_PICKUP_ORDER_STATUSES.includes(String(order?.orderStatus || '')) &&
        !order?.deliveryState?.pickedUpAt &&
        !['en_route_to_delivery', 'at_drop', 'delivered', 'completed'].includes(phase)
    );
};

const serializeRequest = (request) => {
    const value = request?.toObject?.() || request;
    if (!value) return null;
    return {
        ...value,
        order: value.orderId && typeof value.orderId === 'object'
            ? value.orderId
            : undefined,
        deliveryPartner: value.deliveryPartnerId && typeof value.deliveryPartnerId === 'object'
            ? value.deliveryPartnerId
            : undefined,
        restaurant: value.restaurantId && typeof value.restaurantId === 'object'
            ? value.restaurantId
            : undefined
    };
};

const populateRequest = (query) => query
    .populate({
        path: 'orderId',
        select: 'order_id orderId orderStatus dispatch deliveryState pricing createdAt updatedAt'
    })
    .populate({
        path: 'deliveryPartnerId',
        select: 'name phone email vehicleType vehicleNumber'
    })
    .populate({
        path: 'restaurantId',
        select: 'restaurantName name phone address area city location'
    })
    .populate({
        path: 'resolvedBy',
        select: 'name email'
    });

async function deassignOrderForRedispatch({
    orderIdentity,
    deliveryPartnerId,
    adminId,
    requestId = null,
    reason,
    historyNote
}) {
    const identity = buildOrderIdentityFilter(orderIdentity);
    if (!identity) throw new ValidationError('Order id required');

    const existingOrder = await FoodOrder.findOne(identity).lean();
    if (!existingOrder) throw new NotFoundError('Order not found');
    if (!isBeforePickup(existingOrder)) {
        throw new ValidationError('Order can no longer be reassigned after pickup');
    }

    const assignedPartnerId = existingOrder.dispatch?.deliveryPartnerId;
    if (
        existingOrder.dispatch?.status !== 'accepted' ||
        !assignedPartnerId ||
        (deliveryPartnerId && String(assignedPartnerId) !== String(deliveryPartnerId))
    ) {
        throw new ValidationError(
            'Order assignment changed or pickup was completed before reassignment'
        );
    }

    const nextOrderStatus =
        existingOrder.orderStatus === 'reached_pickup'
            ? 'ready_for_pickup'
            : existingOrder.orderStatus;
    const now = new Date();

    const order = await FoodOrder.findOneAndUpdate(
        {
            _id: existingOrder._id,
            orderStatus: existingOrder.orderStatus,
            'dispatch.status': 'accepted',
            'dispatch.deliveryPartnerId': assignedPartnerId,
            'deliveryState.pickedUpAt': null,
            'deliveryState.currentPhase': {
                $nin: ['en_route_to_delivery', 'at_drop', 'delivered', 'completed']
            }
        },
        {
            $set: {
                orderStatus: nextOrderStatus,
                'dispatch.status': 'unassigned',
                'dispatch.deliveryPartnerId': null,
                'deliveryState.currentPhase': 'en_route_to_pickup',
                'deliveryState.status': '',
                'deliveryState.reachedPickupAt': null,
                'deliveryState.reachedDropAt': null,
                'deliveryState.pickedUpAt': null,
                'deliveryState.deliveredAt': null
            },
            $unset: {
                'dispatch.assignedAt': '',
                'dispatch.acceptedAt': '',
                'dispatch.dispatchingAt': ''
            },
            $push: {
                'dispatch.offeredTo': {
                    partnerId: assignedPartnerId,
                    at: now,
                    action: 'deassigned'
                },
                statusHistory: {
                    byRole: 'ADMIN',
                    byId: adminId,
                    from: 'accepted',
                    to: 'unassigned',
                    note: historyNote,
                    at: now
                }
            }
        },
        { new: true }
    ).lean();

    if (!order) {
        throw new ValidationError(
            'Order assignment changed or pickup was completed before reassignment'
        );
    }

    await FoodTransaction.findOneAndUpdate(
        { orderId: order._id },
        { $unset: { deliveryPartnerId: '' } }
    );

    const db = getFirebaseDB();
    if (db) {
        await db.ref(`active_orders/${String(order._id)}`).remove().catch((error) => {
            logger.warn(
                `Failed to clear tracking for reassigned order ${order._id}: ${error.message}`
            );
        });
    }

    const payload = {
        orderId: String(order._id),
        orderMongoId: String(order._id),
        ...(requestId ? { requestId: String(requestId) } : {}),
        reason
    };
    const io = getIO();
    if (io) {
        io.to(rooms.delivery(assignedPartnerId)).emit('order_deassigned', payload);
        io.to(rooms.restaurant(order.restaurantId)).emit(
            'order_status_update',
            { ...payload, dispatchStatus: 'unassigned' }
        );
        io.to(rooms.user(order.userId)).emit(
            'order_status_update',
            { ...payload, dispatchStatus: 'unassigned' }
        );
    }

    await notifyOwnersSafely(
        [
            { ownerType: 'DELIVERY_PARTNER', ownerId: assignedPartnerId },
            { ownerType: 'RESTAURANT', ownerId: order.restaurantId },
            { ownerType: 'USER', ownerId: order.userId }
        ],
        {
            title: 'Delivery partner reassignment',
            body: 'The order is being assigned to another delivery partner.',
            data: {
                type: 'order_deassigned',
                orderId: String(order._id),
                ...(requestId ? { requestId: String(requestId) } : {})
            }
        }
    );

    return { order, deliveryPartnerId: assignedPartnerId };
}

export async function deassignAndResendOrderAdmin(orderId, adminId) {
    const result = await deassignOrderForRedispatch({
        orderIdentity: orderId,
        adminId,
        reason: 'Order reassigned by admin',
        historyNote: 'Delivery partner deassigned and dispatch restarted by admin'
    });

    const dispatchResult = await dispatchService.tryAutoAssign(result.order._id);

    await DeliveryOrderEmergencyRequest.updateMany(
        {
            orderId: result.order._id,
            status: { $in: [...ACTIVE_REQUEST_STATUSES, 'processing'] }
        },
        {
            $set: {
                status: 'resolved',
                deassignedAt: new Date(),
                resolvedAt: new Date(),
                resolvedBy: adminId,
                failureReason: ''
            },
            $unset: { activeKey: '' }
        }
    );

    return {
        orderId: String(result.order._id),
        deliveryPartnerId: String(result.deliveryPartnerId),
        dispatchStarted: Boolean(dispatchResult)
    };
}

export async function createOrderEmergencyRequest(deliveryPartnerId, payload = {}) {
    const reason = String(payload.reason || '').trim();
    if (reason.length < 10) {
        throw new ValidationError('Emergency reason must be at least 10 characters');
    }

    const partnerObjectId = new mongoose.Types.ObjectId(deliveryPartnerId);
    const order = await FoodOrder.findOne({
        'dispatch.deliveryPartnerId': partnerObjectId,
        'dispatch.status': 'accepted',
        orderStatus: { $in: PRE_PICKUP_ORDER_STATUSES }
    }).lean();

    if (!order || !isBeforePickup(order)) {
        throw new ValidationError(
            'Emergency reassignment is available only for an accepted order before pickup'
        );
    }

    const existing = await DeliveryOrderEmergencyRequest.findOne({
        activeKey: String(order._id)
    }).lean();
    if (existing) {
        throw new ValidationError('An active reassignment request already exists for this order');
    }

    try {
        const created = await DeliveryOrderEmergencyRequest.create({
            orderId: order._id,
            deliveryPartnerId: partnerObjectId,
            restaurantId: order.restaurantId,
            reason,
            activeKey: String(order._id),
            status: 'open'
        });
        return serializeRequest(created);
    } catch (error) {
        if (error?.code === 11000) {
            throw new ValidationError('An active reassignment request already exists for this order');
        }
        throw error;
    }
}

export async function listOrderEmergencyRequestsByPartner(deliveryPartnerId) {
    const list = await populateRequest(
        DeliveryOrderEmergencyRequest.find({ deliveryPartnerId })
            .sort({ createdAt: -1 })
    ).lean();
    return list.map(serializeRequest);
}

export async function getOrderEmergencyRequestByPartner(requestId, deliveryPartnerId) {
    if (!mongoose.isValidObjectId(requestId)) return null;
    const request = await populateRequest(
        DeliveryOrderEmergencyRequest.findOne({
            _id: requestId,
            deliveryPartnerId
        })
    ).lean();
    return serializeRequest(request);
}

export async function listOrderEmergencyRequestsAdmin(query = {}) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Math.min(200, Number(query.limit) || 50));
    const filter = {};
    if (query.status) filter.status = String(query.status);

    if (query.search && String(query.search).trim()) {
        const term = String(query.search).trim();
        const partnerIds = await FoodDeliveryPartner
            .find({
                $or: [
                    { name: { $regex: term, $options: 'i' } },
                    { phone: { $regex: term, $options: 'i' } }
                ]
            })
            .distinct('_id');
        filter.$or = [
            { reason: { $regex: term, $options: 'i' } },
            { deliveryPartnerId: { $in: partnerIds } }
        ];
    }

    const [list, total] = await Promise.all([
        populateRequest(
            DeliveryOrderEmergencyRequest.find(filter)
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
        ).lean(),
        DeliveryOrderEmergencyRequest.countDocuments(filter)
    ]);

    return {
        requests: list.map(serializeRequest),
        pagination: {
            page,
            limit,
            total,
            pages: Math.max(1, Math.ceil(total / limit))
        }
    };
}

export async function getOrderEmergencyRequestAdmin(requestId) {
    if (!mongoose.isValidObjectId(requestId)) return null;
    const request = await populateRequest(
        DeliveryOrderEmergencyRequest.findById(requestId)
    ).lean();
    return serializeRequest(request);
}

export async function updateOrderEmergencyRequestAdmin(requestId, body = {}) {
    if (!mongoose.isValidObjectId(requestId)) {
        throw new ValidationError('Invalid emergency request id');
    }

    const request = await DeliveryOrderEmergencyRequest.findById(requestId);
    if (!request) throw new NotFoundError('Emergency request not found');
    if (request.status === 'processing') {
        throw new ValidationError('Emergency request is currently being processed');
    }

    if (body.adminResponse !== undefined) {
        request.adminResponse = String(body.adminResponse || '').trim();
    }
    if (body.status !== undefined) {
        const status = String(body.status);
        if (!['open', 'in_progress', 'resolved', 'closed'].includes(status)) {
            throw new ValidationError('Invalid emergency request status');
        }
        request.status = status;
        if (['resolved', 'closed'].includes(status)) {
            request.activeKey = undefined;
            request.resolvedAt = request.resolvedAt || new Date();
        }
    }
    await request.save();
    return serializeRequest(await populateRequest(
        DeliveryOrderEmergencyRequest.findById(request._id)
    ).lean());
}

export async function deassignAndResendEmergencyOrder(requestId, adminId) {
    if (!mongoose.isValidObjectId(requestId)) {
        throw new ValidationError('Invalid emergency request id');
    }

    const alreadyResolved = await DeliveryOrderEmergencyRequest.findOne({
        _id: requestId,
        status: 'resolved'
    }).lean();
    if (alreadyResolved) {
        return { request: serializeRequest(alreadyResolved), alreadyResolved: true };
    }

    const request = await DeliveryOrderEmergencyRequest.findOneAndUpdate(
        {
            _id: requestId,
            status: { $in: ACTIVE_REQUEST_STATUSES }
        },
        {
            $set: {
                status: 'processing',
                failureReason: ''
            }
        },
        { new: true }
    );

    if (!request) {
        throw new ValidationError('Emergency request is no longer available for reassignment');
    }

    let order = null;
    try {
        const existingOrder = await FoodOrder.findById(request.orderId).lean();
        if (!existingOrder) throw new NotFoundError('Order not found');

        if (request.deassignedAt && existingOrder.dispatch?.status === 'unassigned') {
            order = existingOrder;
        } else {
            const result = await deassignOrderForRedispatch({
                orderIdentity: request.orderId,
                deliveryPartnerId: request.deliveryPartnerId,
                adminId,
                requestId: request._id,
                reason: 'Emergency reassignment approved by admin',
                historyNote: `Emergency reassignment request ${request._id}`
            });
            order = result.order;
            request.deassignedAt = new Date();
            await request.save();
        }

        const dispatchResult = await dispatchService.tryAutoAssign(request.orderId);
        if (!dispatchResult) {
            throw new ValidationError('Delivery dispatch is already busy; retry the request');
        }

        request.status = 'resolved';
        request.resolvedAt = new Date();
        request.resolvedBy = adminId;
        request.activeKey = undefined;
        request.failureReason = '';
        await request.save();

        return {
            request: serializeRequest(request),
            orderId: String(request.orderId),
            alreadyResolved: false
        };
    } catch (error) {
        request.status = 'in_progress';
        request.failureReason = String(error?.message || 'Reassignment failed');
        await request.save().catch((saveError) => {
            logger.error(`Failed to persist emergency request failure: ${saveError.message}`);
        });
        throw error;
    }
}
