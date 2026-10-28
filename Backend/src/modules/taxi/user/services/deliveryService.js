import { ApiError } from '../../../../utils/ApiError.js';
import { normalizePoint } from '../../../../utils/geo.js';
import { GoodsType } from '../../admin/models/GoodsType.js';
import { Vehicle } from '../../admin/models/Vehicle.js';
import { startDispatchFlow } from '../../services/dispatchService.js';
import { Delivery } from '../models/Delivery.js';
import {
  createRideRecord,
  ensureRideParticipantAccess,
  getActiveRideForIdentity,
  getRideDetails,
  getRideRoom,
  listRideHistoryForIdentity,
  serializeRideRealtime,
} from '../../services/rideService.js';

const ensureParcelRide = (ride) => {
  if (!ride || String(ride.serviceType || ride.type || 'ride').toLowerCase() !== 'parcel') {
    throw new ApiError(404, 'Delivery not found');
  }

  return ride;
};

const normalizeVehicleLabel = (value = '') =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');

const getVehicleTokens = (vehicle = {}) =>
  [
    vehicle?.name,
    vehicle?.vehicle_type,
    vehicle?.icon_types,
    String(vehicle?.name || '').replace(/\s+/g, '_'),
  ]
    .map(normalizeVehicleLabel)
    .filter(Boolean);

const goodsTypeAllowsVehicle = (goodsType, vehicle) => {
  const allowedLabels = String(goodsType?.goods_types_for || goodsType?.goods_type_for || 'both')
    .split(',')
    .map(normalizeVehicleLabel)
    .filter(Boolean);

  if (!allowedLabels.length || allowedLabels.includes('both') || allowedLabels.includes('all')) {
    return true;
  }

  const tokens = getVehicleTokens(vehicle);
  return allowedLabels.some((label) => tokens.some((token) => token.includes(label) || label.includes(token)));
};

const ensureDeliveryVehicleAllowed = async ({ vehicleTypeId, parcel }) => {
  const category = String(parcel?.category || '').trim();

  if (!vehicleTypeId || !category) {
    return;
  }

  const [goodsType, vehicle] = await Promise.all([
    GoodsType.findOne({
      goods_type_name: { $regex: `^${category.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
      active: 1,
    })
      .select('goods_type_name goods_types_for goods_type_for')
      .lean(),
    Vehicle.findById(vehicleTypeId).select('name vehicle_type icon_types').lean(),
  ]);

  if (!goodsType || !vehicle) {
    return;
  }

  if (!goodsTypeAllowsVehicle(goodsType, vehicle)) {
    throw new ApiError(400, `${goodsType.goods_type_name || category} is not allowed for the selected vehicle type`);
  }
};

export const serializeDeliveryRealtime = (ride) => {
  const serializedRide = serializeRideRealtime(ride);

  return {
    ...serializedRide,
    deliveryId: ride.deliveryId?._id ? String(ride.deliveryId._id) : ride.deliveryId ? String(ride.deliveryId) : null,
    rideId: String(ride._id),
    room: getRideRoom(ride._id),
    type: 'parcel',
    serviceType: 'parcel',
  };
};

export const createDeliveryRecord = async ({
  userId,
  pickup,
  drop,
  pickupAddress,
  dropAddress,
  fare,
  vehicleTypeId,
  vehicleTypeIds,
  vehicleIconType,
  vehicleIconUrl,
  paymentMethod,
  parcel,
}) => {
  await ensureDeliveryVehicleAllowed({ vehicleTypeId, parcel });

  const ride = await createRideRecord({
    userId,
    pickupCoords: normalizePoint(pickup, 'pickup'),
    dropCoords: normalizePoint(drop, 'drop'),
    pickupAddress,
    dropAddress,
    fare: Number(fare || 0),
    vehicleTypeId,
    vehicleTypeIds,
    vehicleIconType,
    vehicleIconUrl,
    paymentMethod,
    transport_type: 'delivery',
    serviceType: 'parcel',
    parcel,
  });

  await startDispatchFlow(ride);

  const detailedRide = await getRideDetails(ride._id);
  return serializeDeliveryRealtime(ensureParcelRide(detailedRide));
};

export const getActiveDeliveryForIdentity = async ({ role, entityId }) => {
  const ride = await getActiveRideForIdentity({ role, entityId });

  if (!ride) {
    return null;
  }

  if (String(ride.serviceType || ride.type || 'ride').toLowerCase() !== 'parcel') {
    return null;
  }

  return serializeDeliveryRealtime(ride);
};

export const getDeliveryById = async ({ deliveryId, role, entityId }) => {
  const delivery = await Delivery.findById(deliveryId).select('rideId');

  if (!delivery?.rideId) {
    throw new ApiError(404, 'Delivery not found');
  }

  await ensureRideParticipantAccess({ rideId: delivery.rideId, role, entityId });
  const ride = await getRideDetails(delivery.rideId);
  return serializeDeliveryRealtime(ensureParcelRide(ride));
};

export const listDeliveriesForIdentity = async ({ role, entityId, limit }) => {
  const rides = await listRideHistoryForIdentity({ role, entityId, limit });
  return rides
    .filter((ride) => String(ride.serviceType || ride.type || 'ride').toLowerCase() === 'parcel')
    .map((ride) => ({
      ...ride,
      type: 'parcel',
      serviceType: 'parcel',
    }));
};
