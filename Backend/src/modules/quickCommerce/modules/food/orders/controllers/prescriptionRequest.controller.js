import { sendResponse } from '../../../../utils/response.js';
import {
    cancelPrescriptionRequest,
    claimPrescriptionRequest,
    createPrescriptionRequest,
    declinePrescriptionRequest,
    listNearbyPharmacies,
    listRequestsForPharmacy,
    listRequestsForUser,
} from '../services/prescriptionRequest.service.js';

/** Customer: the pharmacies near this address, and whether broadcasting is on. */
export async function listNearbyPharmaciesController(req, res, next) {
    try {
        const result = await listNearbyPharmacies(req.user?.userId, {
            lat: req.query?.lat,
            lng: req.query?.lng,
        });
        return sendResponse(res, 200, 'Pharmacies near you', result);
    } catch (err) {
        next(err);
    }
}

/** Customer: send this prescription to every pharmacy in range. */
export async function createPrescriptionRequestController(req, res, next) {
    try {
        const result = await createPrescriptionRequest(req.user?.userId, req.body || {});
        return sendResponse(
            res,
            201,
            `Sent to ${result.invitedCount} ${result.invitedCount === 1 ? 'pharmacy' : 'pharmacies'} near you`,
            result,
        );
    } catch (err) {
        next(err);
    }
}

/** Customer: my requests. */
export async function listMyPrescriptionRequestsController(req, res, next) {
    try {
        const requests = await listRequestsForUser(req.user?.userId, { limit: req.query?.limit });
        return sendResponse(res, 200, 'Your prescription requests', { requests });
    } catch (err) {
        next(err);
    }
}

/** Customer: withdraw a request nobody has taken yet. */
export async function cancelPrescriptionRequestController(req, res, next) {
    try {
        const result = await cancelPrescriptionRequest(req.params.requestId, req.user?.userId);
        return sendResponse(res, 200, 'Request cancelled', result);
    } catch (err) {
        next(err);
    }
}

/** Pharmacy: prescriptions offered to me. */
export async function listPharmacyRequestsController(req, res, next) {
    try {
        const requests = await listRequestsForPharmacy(req.user?.userId, { limit: req.query?.limit });
        return sendResponse(res, 200, 'Open prescription requests', { requests });
    } catch (err) {
        next(err);
    }
}

/** Pharmacy: take it. Creates the order, and closes the request for everyone else. */
export async function claimPrescriptionRequestController(req, res, next) {
    try {
        const result = await claimPrescriptionRequest(req.params.requestId, req.user?.userId);
        return sendResponse(res, 201, 'Prescription accepted', result);
    } catch (err) {
        next(err);
    }
}

/** Pharmacy: pass on it. */
export async function declinePrescriptionRequestController(req, res, next) {
    try {
        const result = await declinePrescriptionRequest(req.params.requestId, req.user?.userId);
        return sendResponse(res, 200, 'Request removed from your queue', result);
    } catch (err) {
        next(err);
    }
}
