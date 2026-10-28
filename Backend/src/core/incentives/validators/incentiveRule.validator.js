import mongoose from 'mongoose';
import { ApiError } from '../../../utils/ApiError.js';

const SEGMENTS = ['foodAndQuick', 'taxiAndPorter', 'heavyParcel'];
const MAX_TIERS = 12;

function validateTier(raw, index) {
    const fromOrders = Number(raw?.fromOrders);
    const toOrders = Number(raw?.toOrders);
    const rewardAmount = Number(raw?.rewardAmount);

    if (!Number.isFinite(fromOrders) || fromOrders < 1) {
        throw new ApiError(400, `Tier ${index + 1}: "from" must be a number of at least 1`);
    }
    if (!Number.isFinite(toOrders) || toOrders < fromOrders) {
        throw new ApiError(400, `Tier ${index + 1}: "to" must be a number at or above "from"`);
    }
    if (!Number.isFinite(rewardAmount) || rewardAmount < 0) {
        throw new ApiError(400, `Tier ${index + 1}: reward must be a non-negative number`);
    }

    return {
        fromOrders: Math.round(fromOrders),
        toOrders: Math.round(toOrders),
        rewardAmount: Math.round(rewardAmount * 100) / 100,
    };
}

export function validateIncentiveRuleUpsertDto(body = {}) {
    const segment = String(body.segment || '').trim();
    if (!SEGMENTS.includes(segment)) {
        throw new ApiError(400, `segment must be one of: ${SEGMENTS.join(', ')}`);
    }

    const rawTiers = Array.isArray(body.tiers) ? body.tiers : [];
    if (rawTiers.length === 0) {
        throw new ApiError(400, 'At least one tier is required, e.g. "1-5 orders → ₹100"');
    }
    if (rawTiers.length > MAX_TIERS) {
        throw new ApiError(400, `At most ${MAX_TIERS} tiers are allowed`);
    }

    const tiers = rawTiers.map(validateTier);

    // Ascending and strictly increasing by "to" — the crediting loop pays
    // every tier the rider has reached, in order, so two tiers unlocking at
    // the same order count would be ambiguous about which one "reaching 10
    // orders" actually means.
    for (let i = 1; i < tiers.length; i += 1) {
        if (tiers[i].toOrders <= tiers[i - 1].toOrders) {
            throw new ApiError(400, 'Tiers must be in order, each "to" higher than the one before it');
        }
    }

    // Optional: a ladder for one zone. Empty is the default ladder.
    const rawZone = body.zoneId === undefined || body.zoneId === null ? '' : String(body.zoneId).trim();
    if (rawZone && !mongoose.Types.ObjectId.isValid(rawZone)) {
        throw new ApiError(400, 'zoneId must be a zone id, or empty for the default ladder');
    }

    // Optional, taxiAndPorter only: a ladder for one vehicle type. Empty
    // applies to every vehicle type in the zone (or platform-wide).
    const rawVehicleType =
        body.vehicleTypeId === undefined || body.vehicleTypeId === null ? '' : String(body.vehicleTypeId).trim();
    if (rawVehicleType && !mongoose.Types.ObjectId.isValid(rawVehicleType)) {
        throw new ApiError(400, 'vehicleTypeId must be a vehicle type id, or empty for every vehicle type');
    }
    if (rawVehicleType && segment === 'foodAndQuick') {
        throw new ApiError(400, 'vehicleTypeId only applies to the taxi and heavy parcel ladders');
    }

    const windowType = String(body.windowType || 'daily').trim();
    if (!['daily', 'weekly'].includes(windowType)) {
        throw new ApiError(400, 'windowType must be "daily" or "weekly"');
    }

    const dateOrNull = (v, label) => {
        if (v === undefined || v === null || v === '') return null;
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) throw new ApiError(400, `${label} is not a valid date`);
        return d;
    };
    const startsAt = dateOrNull(body.startsAt, 'Start date');
    const endsAt = dateOrNull(body.endsAt, 'End date');
    if (startsAt && endsAt && endsAt <= startsAt) {
        throw new ApiError(400, 'End date must be after the start date');
    }

    return {
        segment,
        tiers,
        startsAt,
        endsAt,
        title: String(body.title || '').trim(),
        zoneId: rawZone ? new mongoose.Types.ObjectId(rawZone) : null,
        zoneName: rawZone ? String(body.zoneName || '').trim().slice(0, 120) : '',
        vehicleTypeId: rawVehicleType ? new mongoose.Types.ObjectId(rawVehicleType) : null,
        vehicleTypeName: rawVehicleType ? String(body.vehicleTypeName || '').trim().slice(0, 120) : '',
        windowType,
    };
}
