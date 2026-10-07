import mongoose from 'mongoose';
import { managedBrand } from '../../../../core/settings/platformProfile.service.js';
import { ApiError } from '../../../../utils/ApiError.js';
import { createDefaultAdminState } from '../data/defaultAdminState.js';
import { Admin } from '../models/Admin.js';
import { User } from '../../user/models/User.js';
import { UserWallet } from '../../user/models/UserWallet.js';
import { WalletTransaction } from '../../driver/models/WalletTransaction.js';
import { forAdminAdjustment } from '../../../../core/finance/idempotencyKeys.js';
import { AdminBusinessSetting } from '../models/AdminBusinessSetting.js';
import { AdminAppSetting } from '../models/AdminAppSetting.js';
// AppModule import removed
import { createDefaultBusinessSettings } from '../data/defaultBusinessSettings.js';
import { createDefaultAppSettings } from '../data/defaultAppSettings.js';
import { Airport } from '../models/Airport.js';
import { DriverNeededDocument } from '../models/DriverNeededDocument.js';
import { ReferralTranslation } from '../models/ReferralTranslation.js';
import { AdminThirdPartySetting } from '../models/AdminThirdPartySetting.js';
import { createDefaultThirdPartySettings } from '../data/defaultThirdPartySettings.js';
import { RentalPackageType } from '../models/RentalPackageType.js';
import { SetPrice } from '../models/SetPrice.js';
import { SurgeSlot } from '../models/SurgeSlot.js';
import { findOverlappingSlot, normalizeSurgeSlot } from '../../common/surgeSlot.js';
import { ServiceLocation } from '../models/ServiceLocation.js';
import { Vehicle } from '../models/Vehicle.js';
import { Driver } from '../../driver/models/Driver.js';
import { Zone } from '../../driver/models/Zone.js';
import { Ride } from '../../user/models/Ride.js';
import { UserSubscription } from '../../user/models/UserSubscription.js';
import { AppLanguage } from '../models/AppLanguage.js';
import { RideModule } from '../models/RideModule.js';
import { SubscriptionPlan } from '../models/SubscriptionPlan.js';
import { TaxiAppModule } from '../models/TaxiAppModule.js';
import { NotificationChannel } from '../models/NotificationChannel.js';
import { UserPreference } from '../models/UserPreference.js';
import { AdminRole } from '../models/AdminRole.js';
import { PaymentGateway } from '../models/PaymentGateway.js';
import { PaymentMethod } from '../models/PaymentMethod.js';
import { OnboardingScreen } from '../models/OnboardingScreen.js';
import { WithdrawalRequest } from '../models/WithdrawalRequest.js';
import { SupportTicket } from '../../support/models/SupportTicket.js';
import TaxiTransportType from '../models/TaxiTransportType.js';
import Country from '../models/Country.js';
import { comparePassword, hashPassword } from '../../driver/services/authService.js';
import {
  applyDriverWalletAdjustment,
  serializeDriverWallet,
} from '../../driver/services/walletService.js';
import { RIDE_LIVE_STATUS, RIDE_STATUS, VEHICLE_TYPES } from '../../constants/index.js';
import {
  cancelRideByAdmin,
  emitToDriver,
  notifyUserAccountDeleted,
} from '../../services/dispatchService.js';
import { sendEmail } from '../../services/mailService.js';
import { getActivePaymentGateway, normalizePaymentSettingsPayload } from '../../services/paymentGatewayService.js';
import { signAccessToken } from '../../services/tokenService.js';
import { invalidateMapSettingsCache } from '../../../../core/settings/mapSettings.service.js';
import {
  ADMIN_PERMISSIONS,
  SUPERADMIN_PERMISSION,
  hasAdminPermission,
  normalizeAdminPermissions,
  normalizeAdminType,
} from './adminAccessService.js';

const PUBLIC_VEHICLE_CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
// Keyed by module id (or "all"), because the catalogue now differs per
// module and one shared slot would serve the wrong list.
let publicVehicleCatalogCache = {
  byModule: {},
};

const deepMerge = (target, source) => {
  const result = { ...target };
  for (const key in source) {
    if (source[key] instanceof Object && key in result && result[key] instanceof Object) {
      result[key] = deepMerge(result[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
};

const buildPaginator = (items, page = 1, limit = 50) => {
  const safePage = Number(page) || 1;
  const safeLimit = Number(limit) || 50;
  const start = (safePage - 1) * safeLimit;
  const results = items.slice(start, start + safeLimit);

  return {
    results,
    paginator: {
      current_page: safePage,
      per_page: safeLimit,
      total: items.length,
      last_page: Math.max(1, Math.ceil(items.length / safeLimit)),
    },
  };
};

const nextId = () => new mongoose.Types.ObjectId().toString();
const toObjectId = (value) => {
  if (value === null || value === undefined) return null;

  const normalized =
    typeof value === 'string'
      ? value.trim()
      : String(value).trim();

  if (!normalized || !mongoose.isValidObjectId(normalized)) {
    return null;
  }

  return new mongoose.Types.ObjectId(normalized);
};

const normalizeBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  return false;
};

const normalizeObjectIdList = (values = []) =>
  [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean))]
    .map(toObjectId)
    .filter(Boolean);

const getAdminScope = (admin = {}) => ({
  adminType: normalizeAdminType(admin.admin_type || admin.role),
  serviceLocationIds: normalizeObjectIdList(admin.service_location_ids),
  zoneIds: normalizeObjectIdList(admin.zone_ids),
});

const isSuperAdmin = (admin = {}) => getAdminScope(admin).adminType === 'superadmin';

const buildNoAccessQuery = (field) => ({ [field]: { $in: [] } });

const getScopedZoneIds = async (admin = {}) => {
  const { adminType, zoneIds, serviceLocationIds } = getAdminScope(admin);

  if (adminType === 'superadmin') {
    return [];
  }

  if (zoneIds.length > 0) {
    return zoneIds;
  }

  if (serviceLocationIds.length === 0) {
    return [];
  }

  const zoneIdsFromLocations = await Zone.find({
    service_location_id: { $in: serviceLocationIds },
  }).distinct('_id');

  return zoneIdsFromLocations.map((value) => toObjectId(value)).filter(Boolean);
};

const buildServiceLocationScopeQuery = (admin = {}, field = 'service_location_id') => {
  const { adminType, serviceLocationIds } = getAdminScope(admin);

  if (adminType === 'superadmin') {
    return {};
  }

  if (serviceLocationIds.length === 0) {
    return buildNoAccessQuery(field);
  }

  return { [field]: { $in: serviceLocationIds } };
};

const buildZoneScopeQuery = async (admin = {}, field = 'zone_id') => {
  const { adminType } = getAdminScope(admin);

  if (adminType === 'superadmin') {
    return {};
  }

  const scopedZoneIds = await getScopedZoneIds(admin);

  if (scopedZoneIds.length === 0) {
    return buildNoAccessQuery(field);
  }

  return { [field]: { $in: scopedZoneIds } };
};

const assertAdminPermission = (admin, permission, label = 'resource') => {
  if (!hasAdminPermission(admin, permission)) {
    throw new ApiError(403, `You do not have permission to access ${label}`);
  }
};

const assertServiceLocationAccess = (admin = {}, serviceLocationId) => {
  if (isSuperAdmin(admin)) {
    return;
  }

  const normalizedId = String(serviceLocationId || '').trim();
  const { serviceLocationIds } = getAdminScope(admin);

  if (!normalizedId || !serviceLocationIds.some((item) => String(item) === normalizedId)) {
    throw new ApiError(403, 'Service location is outside your assigned scope');
  }
};

const assertZoneAccess = async (admin = {}, zoneId) => {
  if (isSuperAdmin(admin)) {
    return;
  }

  const normalizedId = String(zoneId || '').trim();
  if (!normalizedId) {
    throw new ApiError(403, 'Zone is outside your assigned scope');
  }

  const { zoneIds, serviceLocationIds } = getAdminScope(admin);

  if (zoneIds.length > 0) {
    if (!zoneIds.some((item) => String(item) === normalizedId)) {
      throw new ApiError(403, 'Zone is outside your assigned scope');
    }
    return;
  }

  const zone = await Zone.findById(normalizedId).select('service_location_id').lean();
  if (!zone || !serviceLocationIds.some((item) => String(item) === String(zone.service_location_id || ''))) {
    throw new ApiError(403, 'Zone is outside your assigned scope');
  }
};

const serializeAdminSummary = (admin, serviceLocationMap = new Map(), zoneMap = new Map()) => {
  const serviceLocationIds = normalizeObjectIdList(admin.service_location_ids).map(String);
  const zoneIds = normalizeObjectIdList(admin.zone_ids).map(String);

  return {
    _id: admin._id,
    id: admin._id,
    name: admin.name || '',
    email: admin.email || '',
    phone: admin.phone || '',
    role: admin.role || '',
    admin_type: normalizeAdminType(admin.admin_type || admin.role),
    permissions: normalizeAdminPermissions(admin.permissions || []),
    service_location_ids: serviceLocationIds,
    zone_ids: zoneIds,
    service_locations: serviceLocationIds
      .map((id) => serviceLocationMap.get(id))
      .filter(Boolean)
      .map((item) => ({
        id: String(item._id || item.id || ''),
        name: item.service_location_name || item.name || '',
        country: item.country || '',
      })),
    zones: zoneIds
      .map((id) => zoneMap.get(id))
      .filter(Boolean)
      .map((item) => ({
        id: String(item._id || item.id || ''),
        name: item.name || '',
        service_location_id: String(item.service_location_id || ''),
      })),
    active: admin.active !== false,
    status: admin.status || (admin.active === false ? 'inactive' : 'active'),
    createdAt: admin.createdAt || null,
    updatedAt: admin.updatedAt || null,
  };
};

const enrichAdminSummaries = async (admins = []) => {
  const serviceLocationIds = [
    ...new Set(
      admins.flatMap((admin) => normalizeObjectIdList(admin.service_location_ids).map(String)),
    ),
  ];
  const zoneIds = [
    ...new Set(
      admins.flatMap((admin) => normalizeObjectIdList(admin.zone_ids).map(String)),
    ),
  ];

  const [serviceLocations, zones] = await Promise.all([
    serviceLocationIds.length > 0
      ? ServiceLocation.find({ _id: { $in: serviceLocationIds } })
          .select('_id name service_location_name country')
          .lean()
      : [],
    zoneIds.length > 0
      ? Zone.find({ _id: { $in: zoneIds } })
          .select('_id name service_location_id')
          .lean()
      : [],
  ]);

  const serviceLocationMap = new Map(serviceLocations.map((item) => [String(item._id), item]));
  const zoneMap = new Map(zones.map((item) => [String(item._id), item]));

  return admins.map((admin) => serializeAdminSummary(admin, serviceLocationMap, zoneMap));
};

const normalizeDriverAccountType = (value) => {
  const normalized = String(value || 'individual').trim().toLowerCase();

  if (normalized === 'fleet drivers' || normalized === 'fleet_drivers' || normalized === 'fleetdrivers') {
    return 'fleet_drivers';
  }

  if (normalized === 'both') {
    return 'both';
  }

  return 'individual';
};

const normalizeDriverTemplateType = (value) => {
  const normalized = String(value || 'document').trim().toLowerCase();
  return normalized === 'vehicle_field' ? 'vehicle_field' : 'document';
};

const normalizeDriverVehicleFieldType = (value) => {
  const normalized = String(value || 'text').trim().toLowerCase();
  return ['text', 'number', 'textarea', 'select', 'multi_select', 'location_select', 'vehicle_type_select'].includes(normalized)
    ? normalized
    : 'text';
};

const DRIVER_VEHICLE_FIELD_DEFINITIONS = {
  locationId: { label: 'Operating City', field_type: 'location_select', field_group: 'common', account_type: 'both', sort_order: 10 },
  serviceCategories: { label: 'Service Category', field_type: 'multi_select', field_group: 'driver', account_type: 'individual', sort_order: 20, options: ['taxi', 'outstation'] },
  vehicleTypeId: { label: 'Vehicle Type', field_type: 'vehicle_type_select', field_group: 'driver', account_type: 'individual', sort_order: 30 },
  make: { label: 'Brand / Make', field_type: 'text', field_group: 'driver', account_type: 'individual', sort_order: 40, placeholder: 'e.g. Maruti Suzuki' },
  model: { label: 'Model', field_type: 'text', field_group: 'driver', account_type: 'individual', sort_order: 50, placeholder: 'Swift, Bolt' },
  year: { label: 'Year', field_type: 'number', field_group: 'driver', account_type: 'individual', sort_order: 60, placeholder: String(new Date().getFullYear()) },
  number: { label: 'Plate Number', field_type: 'text', field_group: 'driver', account_type: 'individual', sort_order: 70, placeholder: 'DL1RT1234' },
  color: { label: 'Exterior Color', field_type: 'text', field_group: 'driver', account_type: 'individual', sort_order: 80, placeholder: 'e.g. White, Black' },
};

const slugify = (value = '') =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || `document-${Date.now()}`;

const buildDefaultDriverVehicleFieldConfigs = () =>
  Object.entries(DRIVER_VEHICLE_FIELD_DEFINITIONS).map(([field_key, meta]) => ({
    template_type: 'vehicle_field',
    field_key,
    name: meta.label,
    slug: `vehicle-field-${slugify(field_key)}`,
    account_type: meta.account_type || 'individual',
    field_type: meta.field_type || 'text',
    field_group: meta.field_group || '',
    placeholder: meta.placeholder || '',
    help_text: '',
    sort_order: Number(meta.sort_order || 0) / 10 || 0,
    options: Array.isArray(meta.options) ? meta.options : [],
    is_editable: true,
    is_required: true,
    active: true,
  }));

const toDocumentKey = (value = '') => {
  const normalized = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim();

  if (!normalized) {
    return `document${Date.now()}`;
  }

  return normalized
    .split(/\s+/)
    .map((part, index) =>
      index === 0
        ? part.toLowerCase()
        : `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`,
    )
    .join('');
};

const normalizeVehicleTransportType = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'delivery') return 'delivery';
  if (normalized === 'both' || normalized === 'all') return 'both';
  return 'taxi';
};

const normalizeDriverRegisterFor = (value = '', fallback = 'taxi') => {
  const normalized = String(value || fallback || 'taxi').trim().toLowerCase();
  if (normalized === 'all') return 'both';
  if (normalized === 'both') return 'both';
  if (normalized === 'delivery') return 'delivery';
  if (normalized === 'outstation') return 'outstation';
  if (normalized === 'bike') return 'bike';
  if (normalized === 'auto') return 'auto';
  if (normalized === 'car') return 'car';
  return 'taxi';
};

const normalizeDriverServiceCategories = (value, fallback = 'taxi') => {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];

  const normalized = [...new Set(
    rawValues
      .map((item) => String(item || '').trim().toLowerCase())
      .flatMap((item) => item === 'both' ? ['taxi', 'outstation'] : item ? [item] : [])
      .filter((item) => ['taxi', 'outstation', 'delivery'].includes(item)),
  )];

  if (normalized.length > 0) {
    return normalized;
  }

  const registerFor = normalizeDriverRegisterFor(fallback);
  if (registerFor === 'both') {
    return ['taxi', 'outstation'];
  }

  return ['taxi', 'outstation', 'delivery'].includes(registerFor)
    ? [registerFor]
    : ['taxi'];
};

const normalizeDeliveryCategory = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'trucks') return 'trucks';
  if (normalized === '2wheeler' || normalized === '2_wheeler' || normalized === 'two_wheeler') return '2wheeler';
  if (normalized === 'movers' || normalized === 'packers_movers' || normalized === 'packers-and-movers') return 'movers';
  return '';
};

const normalizeDeliveryDistancePricing = (value = {}, fallback = {}) => {
  const source = value && typeof value === 'object' ? value : {};
  const defaults = fallback && typeof fallback === 'object' ? fallback : {};

  return {
    enabled: Boolean(source.enabled ?? defaults.enabled ?? false),
    base_price: Number(source.base_price ?? defaults.base_price ?? 0),
    free_distance: Number(source.free_distance ?? defaults.free_distance ?? 0),
    distance_price: Number(source.distance_price ?? defaults.distance_price ?? 0),
    free_time: Number(source.free_time ?? defaults.free_time ?? 0),
    time_price: Number(source.time_price ?? defaults.time_price ?? 0),
  };
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_USER_GENDERS = new Set(['male', 'female', 'other', 'prefer-not-to-say']);


const findById = (items, id) => items.find((item) => String(item._id) === String(id));

const removeById = (items, id) => items.filter((item) => String(item._id) !== String(id));

const moveItemById = (items, id) => {
  const index = items.findIndex((item) => String(item._id) === String(id));

  if (index === -1) {
    return { item: null, rest: items };
  }

  return {
    item: items[index],
    rest: [...items.slice(0, index), ...items.slice(index + 1)],
  };
};

const toNullableNumber = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeZoneCoordinates = (coordinates = []) => {
  if (!Array.isArray(coordinates) || coordinates.length < 3) {
    throw new ApiError(400, 'Zone polygon requires at least 3 points');
  }

  const ring = coordinates
    .map((point) => {
      const lat = Number(point?.lat);
      const lng = Number(point?.lng);

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new ApiError(400, 'Zone polygon contains invalid coordinates');
      }

      return [lng, lat];
    });

  const [firstLng, firstLat] = ring[0];
  const [lastLng, lastLat] = ring[ring.length - 1];

  if (firstLng !== lastLng || firstLat !== lastLat) {
    ring.push([firstLng, firstLat]);
  }

  return ring;
};

const normalizeZoneCircleCenter = (payload = {}) => {
  const lat = Number(payload?.lat);
  const lng = Number(payload?.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new ApiError(400, 'Zone circle center contains invalid coordinates');
  }

  return { lat, lng };
};

const normalizeZoneCircleRadius = (radius) => {
  const parsed = Number(radius);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ApiError(400, 'Zone circle radius must be greater than 0');
  }

  return parsed;
};

const buildCirclePolygonRing = (center, radiusMeters, segments = 36) => {
  const earthRadiusMeters = 6378137;
  const latRadians = (Number(center.lat) * Math.PI) / 180;
  const lngRadians = (Number(center.lng) * Math.PI) / 180;
  const angularDistance = Number(radiusMeters) / earthRadiusMeters;
  const ring = [];

  for (let index = 0; index < segments; index += 1) {
    const bearing = (2 * Math.PI * index) / segments;
    const sinLat = Math.sin(latRadians);
    const cosLat = Math.cos(latRadians);
    const sinAngular = Math.sin(angularDistance);
    const cosAngular = Math.cos(angularDistance);
    const sinBearing = Math.sin(bearing);
    const cosBearing = Math.cos(bearing);

    const pointLat = Math.asin(
      sinLat * cosAngular + cosLat * sinAngular * cosBearing,
    );
    const pointLng =
      lngRadians +
      Math.atan2(
        sinBearing * sinAngular * cosLat,
        cosAngular - sinLat * Math.sin(pointLat),
      );

    ring.push([
      Number((((pointLng * 180) / Math.PI + 540) % 360) - 180),
      Number((pointLat * 180) / Math.PI),
    ]);
  }

  if (ring.length > 0) {
    ring.push([...ring[0]]);
  }

  return ring;
};

const normalizeZoneGeometryPayload = (payload = {}, existing = {}) => {
  const boundaryMode = String(
    payload.boundary_mode || existing.boundary_mode || 'polygon',
  ).toLowerCase() === 'circle'
    ? 'circle'
    : 'polygon';

  if (boundaryMode === 'circle') {
    const center = normalizeZoneCircleCenter(payload.circle_center || existing.circle_center || {});
    const radiusMeters = normalizeZoneCircleRadius(
      payload.circle_radius_meters ?? existing.circle_radius_meters,
    );

    return {
      boundary_mode: 'circle',
      circle_center: center,
      circle_radius_meters: radiusMeters,
      geometry: {
        type: 'Polygon',
        coordinates: [buildCirclePolygonRing(center, radiusMeters)],
      },
    };
  }

  return {
    boundary_mode: 'polygon',
    circle_center: {
      lat: null,
      lng: null,
    },
    circle_radius_meters: null,
    geometry: {
      type: 'Polygon',
      coordinates: [normalizeZoneCoordinates(payload.coordinates)],
    },
  };
};

const normalizeAirportBoundary = (coordinates = []) => normalizeZoneCoordinates(coordinates);

/** Crow-flies kilometres, to one decimal -- the precision a card shows. */
const haversineKm = (from, to) => {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const dLat = radians(to.lat - from.lat);
  const dLng = radians(to.lng - from.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.sin(dLng / 2) ** 2;
  const km = 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
  return Math.round(km * 10) / 10;
};

/**
 * The landmarks an admin submitted, cleaned.
 *
 * A place with no name or no coordinates is dropped rather than stored:
 * the app puts these straight into a booking, and a card that cannot be
 * tapped is worse than one that was never drawn. Capped at 12 because the
 * rider sees a single row of them.
 */
const normalizeZonePopularPlaces = (value) => {
  if (!Array.isArray(value)) return [];

  return value
    .map((raw) => {
      const lat = Number(raw?.location?.lat ?? raw?.lat);
      const lng = Number(raw?.location?.lng ?? raw?.lng);
      const name = String(raw?.name || '').trim();
      if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      // 0,0 is the Atlantic, and it is what an empty form field parses to.
      if (lat === 0 && lng === 0) return null;

      return {
        name,
        image: String(raw?.image || '').trim(),
        address: String(raw?.address || '').trim(),
        location: { lat, lng },
        active: raw?.active !== false,
      };
    })
    .filter(Boolean)
    .slice(0, 12);
};

const serializeZone = (zone) => ({
  _id: zone._id,
  id: zone._id,
  name: zone.name || '',
  service_location_id: zone.service_location_id?._id || zone.service_location_id || '',
  unit: zone.unit || 'km',
  peak_zone_ride_count: zone.peak_zone_ride_count,
  peak_zone_radius: zone.peak_zone_radius,
  peak_zone_selection_duration: zone.peak_zone_selection_duration,
  peak_zone_duration: zone.peak_zone_duration,
  peak_zone_surge_percentage: zone.peak_zone_surge_percentage,
  ride_surge_enabled: Boolean(zone.ride_surge_enabled),
  maximum_distance_for_regular_rides: zone.maximum_distance_for_regular_rides,
  maximum_distance_for_outstation_rides: zone.maximum_distance_for_outstation_rides,
  active: zone.active !== false,
  status: zone.status || (zone.active === false ? 'inactive' : 'active'),
  boundary_mode: zone.boundary_mode || 'polygon',
  circle_center:
    Number.isFinite(Number(zone.circle_center?.lat)) && Number.isFinite(Number(zone.circle_center?.lng))
      ? {
          lat: Number(zone.circle_center.lat),
          lng: Number(zone.circle_center.lng),
        }
      : null,
  circle_radius_meters: Number.isFinite(Number(zone.circle_radius_meters))
    ? Number(zone.circle_radius_meters)
    : null,
  coordinates: Array.isArray(zone.geometry?.coordinates?.[0])
    ? zone.geometry.coordinates[0].map(([lng, lat]) => ({ lat: Number(lat), lng: Number(lng) }))
    : [],
  popular_places: normalizeZonePopularPlaces(zone.popular_places),
  createdAt: zone.createdAt,
  updatedAt: zone.updatedAt,
});

const serializeSetPrice = (item) => ({
  _id: item._id,
  id: item._id,
  zone_id: item.zone_id
    ? {
      _id: item.zone_id._id || item.zone_id,
      name: item.zone_id.name || '',
    }
    : null,
  service_location_id: item.service_location_id
    ? {
      _id: item.service_location_id._id || item.service_location_id,
      name: item.service_location_id.service_location_name || item.service_location_id.name || '',
    }
    : null,
  transport_type: item.transport_type || '',
  vehicle_type: item.vehicle_type
    ? {
      _id: item.vehicle_type._id || item.vehicle_type,
      name: item.vehicle_type.name || '',
      icon: item.vehicle_type.icon || '',
    }
    : null,
  vehicle_name: item.vehicle_type?.name || '',
  icon: item.vehicle_type?.icon || item.icon || '',
  app_modules: item.app_modules ?? '',
  vehicle_preference: item.vehicle_preference ?? '',
  payment_type: Array.isArray(item.payment_type) ? item.payment_type : (typeof item.payment_type === 'string' ? item.payment_type.split(',') : []),

  // Commissions
  customer_commission_type: item.customer_commission_type || 'percentage',
  customer_commission: item.customer_commission,
  admin_commision_type: item.admin_commision_type ?? (item.customer_commission_type === 'percentage' ? 1 : 0),
  admin_commision: item.admin_commision ?? item.customer_commission,

  driver_commission_type: item.driver_commission_type || 'percentage',
  driver_commission: item.driver_commission,
  admin_commission_type_from_driver: item.admin_commission_type_from_driver ?? (item.driver_commission_type === 'percentage' ? 1 : 0),
  admin_commission_from_driver: item.admin_commission_from_driver ?? item.driver_commission,

  owner_commission_type: item.owner_commission_type || 'percentage',
  owner_commission: item.owner_commission,
  admin_commission_type_for_owner: item.admin_commission_type_for_owner ?? (item.owner_commission_type === 'percentage' ? 1 : 0),
  admin_commission_for_owner: item.admin_commission_for_owner ?? item.owner_commission,

  service_tax: item.service_tax,
  eta_sequence: item.eta_sequence,
  order_number: item.order_number ?? item.eta_sequence ?? 1,

  // Core Pricing
  base_price: item.base_price,
  base_distance: item.base_distance,
  price_per_distance: item.price_per_distance,
  time_price: item.time_price,
  waiting_charge: item.waiting_charge,
  ride_surge_amount: item.ride_surge_amount ?? 0,
  outstation_base_price: item.outstation_base_price ?? 0,
  outstation_base_distance: item.outstation_base_distance ?? 0,
  outstation_price_per_distance: item.outstation_price_per_distance ?? 0,
  outstation_time_price: item.outstation_time_price ?? 0,
  free_waiting_before: item.free_waiting_before,
  free_waiting_after: item.free_waiting_after,

  // Settings
  enable_airport_ride: Boolean(item.enable_airport_ride),
  enable_outstation_ride: Boolean(item.enable_outstation_ride),
  support_airport_fee: item.support_airport_fee ?? (item.enable_airport_ride ? 1 : 0),
  support_outstation: item.support_outstation ?? (item.enable_outstation_ride ? 1 : 0),

  // Cancellation
  user_cancellation_fee_type: item.user_cancellation_fee_type || 'percentage',
  user_cancellation_fee: item.user_cancellation_fee,
  driver_cancellation_fee_type: item.driver_cancellation_fee_type || 'percentage',
  driver_cancellation_fee: item.driver_cancellation_fee,
  cancellation_fee_goes_to: item.cancellation_fee_goes_to || 'admin',

  status: item.status || (item.active === false ? 'inactive' : 'active'),
  active: item.active !== false,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});

const serializeRentalPackageType = (item) => ({
  _id: item._id,
  id: item._id,
  transport_type: item.transport_type || 'taxi',
  name: item.name || '',
  short_description: item.short_description || '',
  description: item.description || '',
  status: item.status || (item.active === false ? 'inactive' : 'active'),
  active: item.active !== false,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});

const normalizePackageVehiclePriceItem = (item = {}) => ({
  vehicle_type: toObjectId(item.vehicle_type?._id || item.vehicle_type?.id || item.vehicle_type || item.type_id),
  base_price: Number(item.base_price ?? 0),
  free_distance: Number(item.free_distance ?? item.base_distance ?? 0),
  distance_price: Number(item.distance_price ?? item.price_per_distance ?? 0),
  free_time: Number(item.free_time ?? 0),
  time_price: Number(item.time_price ?? 0),
  admin_commision_type: Number(item.admin_commision_type ?? 1),
  admin_commision: Number(item.admin_commision ?? 0),
  admin_commission_type_from_driver: Number(item.admin_commission_type_from_driver ?? 1),
  admin_commission_from_driver: Number(item.admin_commission_from_driver ?? 0),
  admin_commission_type_for_owner: Number(item.admin_commission_type_for_owner ?? 1),
  admin_commission_for_owner: Number(item.admin_commission_for_owner ?? 0),
  service_tax: Number(item.service_tax ?? 0),
  cancellation_fee: Number(item.cancellation_fee ?? item.user_cancellation_fee ?? 0),
  active: Number(item.active ?? 1),
});

const buildDriverDocumentFields = (item) => {
  if (item.image_type === 'front_back') {
    return [
      {
        key: item.front_key,
        label: `${item.name} Front`,
        side: 'front',
        required: item.is_required !== false,
      },
      {
        key: item.back_key,
        label: `${item.name} Back`,
        side: 'back',
        required: item.is_required !== false,
      },
    ].filter((field) => Boolean(field.key));
  }

  return [
    {
      key: item.key,
      label:
        item.image_type === 'front'
          ? `${item.name} Front`
          : item.image_type === 'back'
            ? `${item.name} Back`
            : item.name,
      side: item.image_type === 'front' ? 'front' : item.image_type === 'back' ? 'back' : 'single',
      required: item.is_required !== false,
    },
  ].filter((field) => Boolean(field.key));
};

const serializeDriverVehicleField = (item) => {
  const definition = DRIVER_VEHICLE_FIELD_DEFINITIONS[item.field_key] || {};
  const isBuiltin = Boolean(DRIVER_VEHICLE_FIELD_DEFINITIONS[item.field_key]);

  return {
    _id: item._id,
    id: item._id,
    template_type: 'vehicle_field',
    name: item.name || definition.label || '',
    account_type: item.account_type || definition.account_type || 'individual',
    field_key: item.field_key || '',
    field_type: item.field_type || definition.field_type || 'text',
    field_group: item.field_group || definition.field_group || '',
    is_builtin: isBuiltin,
    placeholder: item.placeholder || definition.placeholder || '',
    help_text: item.help_text || '',
    sort_order: Number(item.sort_order || definition.sort_order || 0),
    options: Array.isArray(item.options) ? item.options : Array.isArray(definition.options) ? definition.options : [],
    is_editable: Boolean(item.is_editable),
    is_required: Boolean(item.is_required),
    active: item.active !== false,
    status: item.active === false ? 'inactive' : 'active',
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
};

/**
 * Which driver classes a document is demanded of.
 *
 * An empty list means everyone, which is what every document meant before
 * this existed -- so an admin who never opens the boxes changes nothing.
 * Unknown values are dropped rather than refused: a stale panel build must
 * not be able to fail a save.
 */
const DRIVER_DOCUMENT_CLASSES = ['two_wheeler', 'passenger_taxi'];

const normalizeDocumentAppliesTo = (value) => {
  const raw = Array.isArray(value)
    ? value
    : String(value ?? '')
        .split(',')
        .map((item) => item.trim());

  const seen = new Set();
  for (const item of raw) {
    const key = String(item || '').trim().toLowerCase();
    if (DRIVER_DOCUMENT_CLASSES.includes(key)) seen.add(key);
  }
  // Stable order, so two admins ticking the same boxes store the same array.
  return DRIVER_DOCUMENT_CLASSES.filter((key) => seen.has(key));
};

const serializeDriverNeededDocument = (item) => ({
  _id: item._id,
  id: item._id,
  template_type: normalizeDriverTemplateType(item.template_type),
  name: item.name || '',
  account_type: item.account_type || 'individual',
  image_type: item.image_type || 'front_back',
  has_expiry_date: Boolean(item.has_expiry_date),
  has_identify_number: Boolean(item.has_identify_number),
  identify_number_key: item.identify_number_key || '',
  is_editable: Boolean(item.is_editable),
  is_required: Boolean(item.is_required),
  active: item.active !== false,
  // Which driver classes must produce it. Empty = everyone, which is how
  // the catalogue behaved before this field existed. Returned so the edit
  // form can re-tick the boxes -- without it a saved value never came back
  // and the boxes looked cleared on every reload.
  applies_to: Array.isArray(item.applies_to) ? item.applies_to : [],
  status: item.active === false ? 'inactive' : 'active',
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});

const serializeDriverNeededDocumentTemplate = (item) => ({
  ...serializeDriverNeededDocument(item),
  fields: buildDriverDocumentFields(item),
});

const LEGACY_DRIVER_DOCUMENT_SEED_SIGNATURES = [
  { slug: 'aadhar-card', front_key: 'aadharFront', back_key: 'aadharBack', key: '' },
  { slug: 'driving-license', key: 'drivingLicense', front_key: '', back_key: '' },
  { slug: 'vehicle-rc', key: 'vehicleRC', front_key: '', back_key: '' },
];

const cleanupLegacySeededDriverNeededDocuments = async () => {
  const items = await DriverNeededDocument.find().lean();

  if (items.length !== LEGACY_DRIVER_DOCUMENT_SEED_SIGNATURES.length) {
    return;
  }

  const isLegacySeedSet = items.every((item) =>
    LEGACY_DRIVER_DOCUMENT_SEED_SIGNATURES.some(
      (seed) =>
        seed.slug === item.slug &&
        String(seed.key || '') === String(item.key || '') &&
        String(seed.front_key || '') === String(item.front_key || '') &&
        String(seed.back_key || '') === String(item.back_key || ''),
    ),
  );

  if (!isLegacySeedSet) {
    return;
  }

  await DriverNeededDocument.deleteMany({
    slug: { $in: LEGACY_DRIVER_DOCUMENT_SEED_SIGNATURES.map((item) => item.slug) },
  });
};

const REFERRAL_TRANSLATION_DEFAULTS = {
  instant_referrer_user: '',
  instant_referrer_user_and_new_user: '',
  conditional_referrer_user_ride_count: '',
  conditional_referrer_user_earnings: '',
  dual_conditional_referrer_user_and_new_user_ride_count: '',
  dual_conditional_referrer_user_and_new_user_earnings: '',
  banner_text: '',
};

const normalizeReferralTranslationSection = (payload = {}) => ({
  instant_referrer_user: String(payload.instant_referrer_user || ''),
  instant_referrer_user_and_new_user: String(payload.instant_referrer_user_and_new_user || ''),
  conditional_referrer_user_ride_count: String(payload.conditional_referrer_user_ride_count || ''),
  conditional_referrer_user_earnings: String(payload.conditional_referrer_user_earnings || ''),
  dual_conditional_referrer_user_and_new_user_ride_count: String(
    payload.dual_conditional_referrer_user_and_new_user_ride_count || '',
  ),
  dual_conditional_referrer_user_and_new_user_earnings: String(
    payload.dual_conditional_referrer_user_and_new_user_earnings || '',
  ),
  banner_text: String(payload.banner_text || ''),
});

const serializeReferralTranslation = ({ language, translation }) => ({
  _id: translation?._id || null,
  language_code: String(language?.code || translation?.language_code || '').toLowerCase(),
  language_name: language?.name || translation?.language_name || '',
  active: Number(language?.active ?? 1) === 1,
  default_status: Number(language?.default_status ?? 0) === 1,
  user_referral: {
    ...REFERRAL_TRANSLATION_DEFAULTS,
    ...normalizeReferralTranslationSection(translation?.user_referral),
  },
  driver_referral: {
    ...REFERRAL_TRANSLATION_DEFAULTS,
    ...normalizeReferralTranslationSection(translation?.driver_referral),
  },
  createdAt: translation?.createdAt || null,
  updatedAt: translation?.updatedAt || null,
});

const resolveReferralTranslationLanguage = async (languageCode = '') => {
  const normalizedLanguageCode = String(languageCode || '').trim().toLowerCase();
  const languages = await AppLanguage.find().sort({ default_status: -1, code: 1 }).lean();

  const preferredLanguage =
    languages.find((item) => String(item.code || '').toLowerCase() === normalizedLanguageCode) ||
    languages.find((item) => Number(item.default_status) === 1) ||
    languages[0] ||
    null;

  return {
    languages,
    preferredLanguage,
    normalizedLanguageCode,
  };
};

const cleanupLegacySeededDriverNeededDocumentsFinal = async () => {
  const items = await DriverNeededDocument.find().lean();

  if (items.length !== LEGACY_DRIVER_DOCUMENT_SEED_SIGNATURES.length) {
    return;
  }

  const isLegacySeedSet = items.every((item) =>
    LEGACY_DRIVER_DOCUMENT_SEED_SIGNATURES.some(
      (seed) =>
        seed.slug === item.slug &&
        String(seed.key || '') === String(item.key || '') &&
        String(seed.front_key || '') === String(item.front_key || '') &&
        String(seed.back_key || '') === String(item.back_key || ''),
    ),
  );

  if (!isLegacySeedSet) {
    return;
  }

  await DriverNeededDocument.deleteMany({
    slug: { $in: LEGACY_DRIVER_DOCUMENT_SEED_SIGNATURES.map((item) => item.slug) },
  });
};

const serializeAirport = (item) => ({
  _id: item._id,
  id: item._id,
  name: item.name || '',
  code: item.code || '',
  service_location_id: item.service_location_id
    ? {
      _id: item.service_location_id._id || item.service_location_id,
      name: item.service_location_id.service_location_name || item.service_location_id.name || '',
      country: item.service_location_id.country || '',
    }
    : null,
  zone_id: item.zone_id
    ? {
      _id: item.zone_id._id || item.zone_id,
      name: item.zone_id.name || '',
    }
    : null,
  terminal: item.terminal || '',
  address: item.address || '',
  contact_number: item.contact_number || '',
  latitude: item.latitude,
  longitude: item.longitude,
  boundary_coordinates: Array.isArray(item.boundary?.coordinates?.[0])
    ? item.boundary.coordinates[0].map(([lng, lat]) => ({ lat: Number(lat), lng: Number(lng) }))
    : [],
  airport_surge: Number(item.airport_surge ?? 0),
  support_airport_fee: Number(item.support_airport_fee ?? 0),
  status: item.status || (item.active === false ? 'inactive' : 'active'),
  active: item.active !== false,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});

const serializeDriver = (driver) => ({
  _id: driver._id,
  name: driver.name || driver.user_id?.name || '',
  phone: driver.phone || driver.user_id?.phone || driver.user_id?.mobile || '',
  mobile: driver.phone || driver.user_id?.phone || driver.user_id?.mobile || '',
  email: driver.email || driver.user_id?.email || '',
  gender: driver.gender || '',
  user_id: driver.user_id || driver.user || null,
  service_location_id: driver.service_location_id || null,
  country: driver.country || null,
  profile_picture: driver.profile_picture || '',
  city: driver.city || '',
  service_location_name: driver.city || '',
  transport_type: driver.registerFor || driver.vehicleType || '',
  register_for: driver.registerFor || '',
  service_categories: Array.isArray(driver.serviceCategories) ? driver.serviceCategories : [],
  vehicle_type: driver.vehicleType || '',
  vehicle_type_id: driver.vehicleTypeId || null,
  vehicleIconType: driver.vehicleIconType || driver.vehicleType || '',
  vehicleImage: driver.vehicleImage || '',
  vehicle_make: driver.vehicleMake || '',
  vehicle_model: driver.vehicleModel || '',
  vehicle_number: driver.vehicleNumber || '',
  vehicle_color: driver.vehicleColor || '',
  rating:
    Number(driver.ratingCount || 0) > 0
      ? Number(driver.rating || 0)
      : 0,
  rating_count: Number(driver.ratingCount || 0),
  approve: Boolean(driver.approve),
  status: driver.status || (driver.approve ? 'approved' : 'pending'),
  active: driver.approve !== false && String(driver.status || '').toLowerCase() !== 'inactive',
  deletedAt: driver.deletedAt || null,
  deletionRequest: driver.deletionRequest || { status: 'none' },
  documents: driver.documents || {},
  onboarding: driver.onboarding || {},
  createdAt: driver.createdAt,
  updatedAt: driver.updatedAt,
});

const DRIVER_LIST_SELECT = [
  '_id',
  'name',
  'phone',
  'email',
  'service_location_id',
  'city',
  'registerFor',
  'vehicleType',
  'vehicleNumber',
  'vehicleColor',
  'rating',
  'ratingCount',
  'isOnline',
  'approve',
  'status',
  'createdAt',
  'updatedAt',
].join(' ');

const serializeDriverListItem = (driver) => ({
  _id: driver._id,
  id: driver._id,
  name: driver.name || '',
  phone: driver.phone || '',
  mobile: driver.phone || '',
  email: driver.email || '',
  service_location_id: driver.service_location_id || null,
  city: driver.city || '',
  service_location_name:
    driver.service_location_id?.service_location_name ||
    driver.service_location_id?.name ||
    driver.city ||
    '',
  transport_type: driver.registerFor || driver.vehicleType || '',
  register_for: driver.registerFor || '',
  vehicle_type: driver.vehicleType || '',
  vehicle_number: driver.vehicleNumber || '',
  vehicle_color: driver.vehicleColor || '',
  rating:
    Number(driver.ratingCount || 0) > 0
      ? Number(driver.rating || 0)
      : 0,
  rating_count: Number(driver.ratingCount || 0),
  isOnline: Boolean(driver.isOnline),
  approve: Boolean(driver.approve),
  status: driver.status || (driver.approve ? 'approved' : 'pending'),
  active: driver.approve !== false && String(driver.status || '').toLowerCase() !== 'inactive',
  createdAt: driver.createdAt,
  updatedAt: driver.updatedAt,
});

const serializeUser = (user) => ({
  _id: user._id,
  id: user._id,
  name: user.name || '',
  email: user.email || '',
  gender: user.gender || '',
  profileImage: user.profileImage || '',
  mobile: user.phone || user.mobile || '',
  phone: user.phone || user.mobile || '',
  wallet_balance: Number(user.wallet_balance || 0),
  active: user.active !== false && !user.deletedAt,
  deletedAt: user.deletedAt || null,
  deletion_reason: user.deletion_reason || '',
  deletionRequest: user.deletionRequest || { status: 'none' },
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

const USER_LIST_SELECT = [
  '_id',
  'name',
  'email',
  'gender',
  'phone',
  'mobile',
  'wallet_balance',
  'active',
  'deletedAt',
  'deletion_reason',
  'deletionRequest',
  'createdAt',
  'updatedAt',
].join(' ');

const serializeUserListItem = (user) => ({
  _id: user._id,
  id: user._id,
  name: user.name || '',
  email: user.email || '',
  gender: user.gender || '',
  mobile: user.phone || user.mobile || '',
  phone: user.phone || user.mobile || '',
  wallet_balance: Number(user.wallet_balance || 0),
  active:
    (user.active ?? user.isActive) !== false &&
    !user.deletedAt,
  deletedAt: user.deletedAt || null,
  deletion_reason: user.deletion_reason || '',
  deletionRequest: user.deletionRequest || { status: 'none' },
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

const DEFAULT_SERVICE_LOCATION_CENTER = { lat: 22.7196, lng: 75.8577 };

const normalizeServiceLocationPayload = (payload = {}, fallback = {}) => {
  const latitude = Number(payload.latitude ?? fallback.latitude ?? DEFAULT_SERVICE_LOCATION_CENTER.lat);
  const longitude = Number(payload.longitude ?? fallback.longitude ?? DEFAULT_SERVICE_LOCATION_CENTER.lng);
  const name = payload.name?.trim() || fallback.name || fallback.service_location_name;
  const currencyCode = String(payload.currency_code ?? fallback.currency_code ?? 'INR').toUpperCase();
  const status = payload.status ?? fallback.status ?? 'active';

  return {
    name,
    service_location_name: name,
    address: payload.address ?? fallback.address ?? '',
    country: payload.country ?? fallback.country ?? 'India',
    currency_name: payload.currency_name ?? fallback.currency_name ?? currencyCode,
    currency_symbol: payload.currency_symbol ?? fallback.currency_symbol ?? '₹',
    currency_code: currencyCode,
    currency_symbol: payload.currency_symbol ?? fallback.currency_symbol ?? '₹',
    timezone: payload.timezone ?? fallback.timezone ?? 'Asia/Kolkata',
    unit: payload.unit ?? fallback.unit ?? 'km',
    latitude,
    longitude,
    location: {
      type: 'Point',
      coordinates: [longitude, latitude],
    },
    status,
    active: status === 'active',
  };
};

const escapeRegex = (value = '') =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const resolveServiceLocationForImport = async (value) => {
  const candidate = String(value || '').trim();
  if (!candidate) return null;

  if (mongoose.isValidObjectId(candidate)) {
    const byId = await ServiceLocation.findById(candidate).lean();
    if (byId) return byId;
  }

  return ServiceLocation.findOne({
    $or: [
      { name: new RegExp(`^${escapeRegex(candidate)}$`, 'i') },
      { service_location_name: new RegExp(`^${escapeRegex(candidate)}$`, 'i') },
    ],
  }).lean();
};

const resolveVehicleForImport = async (vehicleLabel, transportType) => {
  const candidate = String(vehicleLabel || '').trim();
  if (!candidate) return null;

  if (mongoose.isValidObjectId(candidate)) {
    const byId = await Vehicle.findById(candidate).lean();
    if (byId) return byId;
  }

  return Vehicle.findOne({
    name: new RegExp(`^${escapeRegex(candidate)}$`, 'i'),
    ...(transportType
      ? { transport_type: { $in: [normalizeVehicleTransportType(transportType), 'both'] } }
      : {}),
  }).lean();
};

const normalizeImportTransportType = (value = '') =>
  String(value || '').trim().toLowerCase() === 'delivery' ? 'delivery' : 'taxi';

const normalizeImportVehicleType = (value = '', vehicleRecord = null) => {
  const vehicleText = String(
    vehicleRecord?.icon_types || vehicleRecord?.name || value || '',
  )
    .trim()
    .toLowerCase();

  if (vehicleText.includes('bike') || vehicleText.includes('scooter')) return 'bike';
  if (vehicleText.includes('auto') || vehicleText.includes('rickshaw')) return 'auto';
  return 'car';
};

export const csvFromRows = (headers, rows) => {
  const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return [headers.join(','), ...rows.map((row) => headers.map((header) => escape(row[header])).join(','))].join('\n');
};

const syncSettingRows = (rows, payload) =>
  rows.map((row) => {
    if (!(row.key in payload)) return row;
    const nextValue = String(payload[row.key]);
    return {
      ...row,
      value: nextValue,
      is_active: row.key.startsWith('enable_') ? nextValue === '1' : row.is_active,
    };
  });

const DEFAULT_ADMIN_EMAIL = 'admin@gmail.com';
const DEFAULT_ADMIN_PASSWORD = '12345';
const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$/;

const syncDefaultAdminRecord = async () => {
  const now = new Date();
  const existingAdmin = await Admin.findOne({ email: DEFAULT_ADMIN_EMAIL }).select('+password');
  const nextPassword =
    !existingAdmin || !BCRYPT_HASH_PATTERN.test(existingAdmin.password || '')
      ? await hashPassword(DEFAULT_ADMIN_PASSWORD)
      : undefined;

  await Admin.collection.updateOne(
    { email: DEFAULT_ADMIN_EMAIL },
    {
      $set: {
        name: 'Super Admin',
        email: DEFAULT_ADMIN_EMAIL,
        phone: '9999999999',
        role: 'superadmin',
        admin_type: 'superadmin',
        permissions: ['*'],
        active: true,
        status: 'active',
        ...(nextPassword ? { password: nextPassword } : {}),
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt: now,
      },
    },
    { upsert: true },
  );
};

const seedInitialData = async () => {
  const defaults = createDefaultAdminState();

  // Seed Users
  if (await User.countDocuments() === 0) {
    await User.insertMany(defaults.users.map(u => ({ ...u, phone: u.mobile, password: 'password123' })));
  }

  // Seed Service Locations
  if (await ServiceLocation.countDocuments() === 0) {
    await ServiceLocation.insertMany(defaults.serviceLocations);
  }

  // Seed Drivers
  if (await Driver.countDocuments() === 0) {
    await Driver.insertMany(defaults.drivers.map(d => ({ ...d, phone: d.mobile })));
  }

  // Seed Languages
  if (await AppLanguage.countDocuments() === 0) {
    await AppLanguage.insertMany(defaults.languages);
  }

  // Seed Ride Modules
  if (await RideModule.countDocuments() === 0) {
    await RideModule.insertMany(defaults.rideModules);
  }

  // Seed App Modules removed (Migrated to AdminAppSetting)

  // Seed Notification Channels
  if (await NotificationChannel.countDocuments() === 0) {
    await NotificationChannel.insertMany(defaults.notificationChannels);
  }

  // Seed Subscription Plans
  if (await SubscriptionPlan.countDocuments() === 0) {
    await SubscriptionPlan.insertMany(defaults.subscriptionPlans);
  }

  // Seed Preferences
  if (await UserPreference.countDocuments() === 0) {
    await UserPreference.insertMany(defaults.preferences);
  }

  // Seed Admin Roles
  if (await AdminRole.countDocuments() === 0) {
    await AdminRole.insertMany(defaults.roles);
  }

  // Seed Payment Gateways
  if (await PaymentGateway.countDocuments() === 0) {
    await PaymentGateway.insertMany(defaults.paymentGateways);
  }

  // Seed Onboarding Screens
  if (await OnboardingScreen.countDocuments() === 0) {
    await OnboardingScreen.insertMany(defaults.onboardingScreens);
  }

};

export const ensureServiceLocationsSeeded = async () => {
  if (await ServiceLocation.countDocuments() === 0) {
    const defaults = createDefaultAdminState();
    await ServiceLocation.insertMany(defaults.serviceLocations);
  }
};

export const ensureAdminState = async () => {
  await syncDefaultAdminRecord();
  await seedInitialData();
  return { ready: true };
};

export const getAdminModuleInfo = async () => {
  const [
    userCount,
    deletedUserCount,
    driverCount,
    zoneCount
  ] = await Promise.all([
    User.countDocuments({ deletedAt: null }),
    User.countDocuments({ deletedAt: { $ne: null } }),
    Driver.countDocuments(),
    Zone.countDocuments(),
  ]);
  return {
    module: 'admin',
    ready: true,
    message: 'Admin module is wired with independent collections',
    snapshot: {
      users: userCount,
      deleted_users: deletedUserCount,
      drivers: driverCount,
      zones: zoneCount,
    },
  };
};

export const loginAdmin = async ({ email, password }) => {
  const admin = await Admin.findOne({ email: email?.trim().toLowerCase() }).select('+password');

  if (!admin) {
    throw new ApiError(401, 'Invalid admin credentials');
  }

  const passwordMatches = BCRYPT_HASH_PATTERN.test(admin.password || '')
    ? await comparePassword(password, admin.password)
    : admin.password === password;

  if (!passwordMatches) {
    throw new ApiError(401, 'Invalid admin credentials');
  }

  if (admin.active === false || String(admin.status || '').toLowerCase() === 'inactive') {
    throw new ApiError(403, 'Admin account is inactive');
  }

  const [serializedAdmin] = await enrichAdminSummaries([admin]);

  return {
    token: signAccessToken({ sub: String(admin._id), role: 'admin' }),
    admin: serializedAdmin,
  };
};

export const listAdminPermissions = async () =>
  ADMIN_PERMISSIONS.map((key) => ({ key, label: key }));

export const listAdmins = async (currentAdmin) => {
  assertAdminPermission(currentAdmin, 'subadmins.manage', 'subadmins');

  const admins = await Admin.find()
    .select('-resetPasswordOtp -resetPasswordExpires')
    .sort({ createdAt: -1 })
    .lean();

  return enrichAdminSummaries(admins);
};

const validateSubadminPayload = async (payload = {}, existingAdminId = null) => {
  const adminType = normalizeAdminType(payload.admin_type || payload.role);
  const name = String(payload.name || '').trim();
  const email = String(payload.email || '').trim().toLowerCase();
  const phone = String(payload.phone || '').trim();
  const role = String(payload.role || (adminType === 'superadmin' ? 'superadmin' : 'subadmin')).trim();
  const permissions = normalizeAdminPermissions(
    adminType === 'superadmin' ? [SUPERADMIN_PERMISSION] : payload.permissions || [],
  );
  const serviceLocationIds = normalizeObjectIdList(payload.service_location_ids);
  const zoneIds = normalizeObjectIdList(payload.zone_ids);
  const active = payload.active === undefined ? true : normalizeBoolean(payload.active);
  const status = String(payload.status || (active ? 'active' : 'inactive')).trim().toLowerCase() === 'inactive'
    ? 'inactive'
    : 'active';

  if (!name) {
    throw new ApiError(400, 'Admin name is required');
  }

  if (!email) {
    throw new ApiError(400, 'Admin email is required');
  }

  const duplicate = await Admin.findOne({
    email,
    ...(existingAdminId ? { _id: { $ne: existingAdminId } } : {}),
  }).lean();

  if (duplicate) {
    throw new ApiError(409, 'Admin email already exists');
  }

  if (adminType === 'subadmin' && permissions.length === 0) {
    throw new ApiError(400, 'Select at least one permission for the subadmin');
  }

  if (adminType === 'subadmin' && serviceLocationIds.length === 0) {
    throw new ApiError(400, 'Assign at least one service location to the subadmin');
  }

  if (serviceLocationIds.length > 0) {
    const count = await ServiceLocation.countDocuments({ _id: { $in: serviceLocationIds } });
    if (count !== serviceLocationIds.length) {
      throw new ApiError(400, 'One or more selected service locations are invalid');
    }
  }

  if (zoneIds.length > 0) {
    const zones = await Zone.find({ _id: { $in: zoneIds } }).select('_id service_location_id').lean();
    if (zones.length !== zoneIds.length) {
      throw new ApiError(400, 'One or more selected zones are invalid');
    }

    if (
      adminType === 'subadmin' &&
      zones.some((zone) => !serviceLocationIds.some((id) => String(id) === String(zone.service_location_id || '')))
    ) {
      throw new ApiError(400, 'Assigned zones must belong to the selected service locations');
    }
  }

  return {
    admin_type: adminType,
    name,
    email,
    phone,
    role,
    permissions,
    service_location_ids: adminType === 'superadmin' ? [] : serviceLocationIds,
    zone_ids: adminType === 'superadmin' ? [] : zoneIds,
    active,
    status,
  };
};

export const createAdminAccount = async (currentAdmin, payload = {}) => {
  assertAdminPermission(currentAdmin, 'subadmins.manage', 'subadmins');

  const password = String(payload.password || '').trim();
  const passwordConfirmation = String(payload.password_confirmation || payload.passwordConfirmation || '').trim();

  if (!password || password.length < 5) {
    throw new ApiError(400, 'Password must be at least 5 characters');
  }

  if (!passwordConfirmation || password !== passwordConfirmation) {
    throw new ApiError(400, 'Passwords do not match');
  }

  const validated = await validateSubadminPayload(payload);
  const created = await Admin.create({
    ...validated,
    password: await hashPassword(password),
  });

  const [serializedAdmin] = await enrichAdminSummaries([created]);
  return serializedAdmin;
};

export const updateAdminAccount = async (currentAdmin, id, payload = {}) => {
  assertAdminPermission(currentAdmin, 'subadmins.manage', 'subadmins');

  const admin = await Admin.findById(id).select('+password');
  if (!admin) {
    throw new ApiError(404, 'Admin account not found');
  }

  if (String(admin._id) === String(currentAdmin?.id || '')) {
    throw new ApiError(400, 'Use your profile flow to update your own admin account');
  }

  const validated = await validateSubadminPayload(payload, admin._id);
  Object.assign(admin, validated);

  if (payload.password) {
    const password = String(payload.password || '').trim();
    const passwordConfirmation = String(payload.password_confirmation || payload.passwordConfirmation || '').trim();
    if (password.length < 5) {
      throw new ApiError(400, 'Password must be at least 5 characters');
    }
    if (password !== passwordConfirmation) {
      throw new ApiError(400, 'Passwords do not match');
    }
    admin.password = await hashPassword(password);
  }

  await admin.save();
  const [serializedAdmin] = await enrichAdminSummaries([admin]);
  return serializedAdmin;
};

export const deleteAdminAccount = async (currentAdmin, id) => {
  assertAdminPermission(currentAdmin, 'subadmins.manage', 'subadmins');

  const admin = await Admin.findById(id).lean();
  if (!admin) {
    throw new ApiError(404, 'Admin account not found');
  }

  if (String(admin._id) === String(currentAdmin?.id || '')) {
    throw new ApiError(400, 'You cannot delete your own admin account');
  }

  await Admin.deleteOne({ _id: admin._id });
  return { deleted: true };
};

export const forgotPassword = async (email) => {
  const admin = await Admin.findOne({ email: email?.trim().toLowerCase() });
  if (!admin) {
    throw new ApiError(404, 'Admin with this email not found');
  }

  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  admin.resetPasswordOtp = otp;
  admin.resetPasswordExpires = otpExpires;
  admin.resetPasswordAttempts = 0;
  await admin.save();

  // Send real email
  await sendEmail({
    to: email,
    subject: `Password Reset OTP for ${process.env.APP_NAME || 'Quick Drop'}`,
    text: `Your OTP for password reset is: ${otp}. It will expire in 10 minutes.`,
    html: `
      <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px; max-width: 500px;">
        <h2 style="color: #f97316;">Password Reset</h2>
        <p>Hello,</p>
        <p>You requested a password reset for your admin account. Use the following OTP to continue:</p>
        <div style="font-size: 32px; font-weight: bold; padding: 10px; background: #fff7ed; color: #f97316; text-align: center; border-radius: 8px; margin: 20px 0;">
          ${otp}
        </div>
        <p>This OTP is valid for 10 minutes. If you did not request this, please ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="font-size: 12px; color: #666;">Regards,<br>Team ${process.env.APP_NAME || 'Quick Drop'}</p>
      </div>
    `,
  });

  // Development only: a reset code in the production log is a way into the admin
  // panel for anyone who can read the logs.
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[ADMIN FORGOT PASSWORD] OTP for ${email}: ${otp}`);
  }

  return { message: 'OTP sent to your email' };
};

/*
 * Check a submitted reset code, spending an attempt on a wrong one.
 *
 * There was no limit: a 6-digit code valid for 10 minutes on unauthenticated,
 * un-rate-limited routes could be brute-forced into an admin password reset. After
 * MAX_RESET_ATTEMPTS wrong codes the current code is burnt and a new one must be
 * requested. The attempt is counted atomically, so parallel guesses cannot all slip
 * under the limit.
 */
const MAX_RESET_ATTEMPTS = 5;

const checkResetOtp = async (email, otp) => {
  const normalizedEmail = email?.trim().toLowerCase();
  const admin = await Admin.findOne({ email: normalizedEmail })
    .select('+resetPasswordOtp +resetPasswordExpires +resetPasswordAttempts');

  const usable = admin
    && admin.resetPasswordOtp
    && new Date() <= admin.resetPasswordExpires
    && (admin.resetPasswordAttempts || 0) < MAX_RESET_ATTEMPTS;
  if (usable && String(otp || '') === admin.resetPasswordOtp) {
    return admin;
  }

  if (admin && admin.resetPasswordOtp) {
    const counted = await Admin.findOneAndUpdate(
      { _id: admin._id },
      { $inc: { resetPasswordAttempts: 1 } },
      { new: true },
    ).select('+resetPasswordAttempts');
    if ((counted?.resetPasswordAttempts || 0) >= MAX_RESET_ATTEMPTS) {
      await Admin.updateOne({ _id: admin._id }, { $unset: { resetPasswordOtp: 1, resetPasswordExpires: 1 } });
    }
  }
  throw new ApiError(400, 'Invalid or expired OTP');
};

export const verifyResetOtp = async ({ email, otp }) => {
  await checkResetOtp(email, otp);

  return { success: true, message: 'OTP verified successfully' };
};

export const resetPassword = async ({ email, otp, password }) => {
  const admin = await checkResetOtp(email, otp);

  admin.password = await hashPassword(password);
  admin.resetPasswordOtp = undefined;
  admin.resetPasswordExpires = undefined;
  admin.resetPasswordAttempts = 0;
  await admin.save();

  return { success: true, message: 'Password reset successful' };
};

export const listUsers = async ({ page = 1, limit = 50, search = '' }) => {
  const safePage = Number(page) || 1;
  const safeLimit = Number(limit) || 50;
  const start = (safePage - 1) * safeLimit;
  const query = { deletedAt: null };

  if (search) {
    const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    query.$or = [{ name: regex }, { phone: regex }, { email: regex }];
  }

  const [users, total] = await Promise.all([
    User.find(query)
      .select(USER_LIST_SELECT)
      .sort({ createdAt: -1 })
      .skip(start)
      .limit(safeLimit)
      .lean(),
    User.countDocuments(query),
  ]);

  return {
    results: users.map(serializeUserListItem),
    paginator: {
      current_page: safePage,
      per_page: safeLimit,
      total,
      last_page: Math.max(1, Math.ceil(total / safeLimit)),
    },
  };
};

export const bulkImportUsers = async (payload = {}) => {
  const incomingUsers = Array.isArray(payload.users) ? payload.users : [];

  if (!incomingUsers.length) {
    throw new ApiError(400, 'users array is required');
  }

  if (incomingUsers.length > 2000) {
    throw new ApiError(400, 'Too many users in one import (max 2000)');
  }

  const errors = [];
  const created = [];
  const skipped = [];

  for (let index = 0; index < incomingUsers.length; index += 1) {
    const raw = incomingUsers[index] || {};
    const name = String(raw.name || '').trim();
    const phone = String(raw.phone || raw.mobile || '').replace(/\D/g, '');
    const email = String(raw.email || '').trim().toLowerCase();
    const gender = String(raw.gender || '').trim().toLowerCase();
    const countryCode = String(raw.countryCode || raw.country_code || raw.country || '').trim();

    if (!name) {
      errors.push({ index, field: 'name', message: 'Name is required' });
      continue;
    }

    if (!/^\d{10}$/.test(phone)) {
      errors.push({ index, field: 'phone', message: 'A valid 10-digit phone number is required' });
      continue;
    }

    if (email && !EMAIL_REGEX.test(email)) {
      errors.push({ index, field: 'email', message: 'A valid email address is required' });
      continue;
    }

    const normalizedGender = VALID_USER_GENDERS.has(gender) ? gender : '';
    const normalizedCountryCode = countryCode && countryCode.startsWith('+') ? countryCode : '+91';

    const existingUser = await User.findOne({ phone }).lean();
    if (existingUser) {
      skipped.push({ index, phone, id: String(existingUser._id) });
      continue;
    }

    try {
      const user = await User.create({
        name,
        phone,
        email,
        gender: normalizedGender,
        countryCode: normalizedCountryCode,
        isVerified: true,
        active: raw.active ?? true,
      });
      created.push(serializeUser(user.toObject()));
    } catch (error) {
      const message = error?.message || 'Failed to create user';
      errors.push({ index, message });
    }
  }

  return {
    created_count: created.length,
    skipped_count: skipped.length,
    error_count: errors.length,
    created,
    skipped: skipped.slice(0, 200),
    errors: errors.slice(0, 200),
  };
};

export const bulkImportDrivers = async (payload = {}) => {
  const incomingDrivers = Array.isArray(payload.drivers) ? payload.drivers : [];

  if (!incomingDrivers.length) {
    throw new ApiError(400, 'drivers array is required');
  }

  if (incomingDrivers.length > 2000) {
    throw new ApiError(400, 'Too many drivers in one import (max 2000)');
  }

  const errors = [];
  const created = [];
  const skipped = [];

  for (let index = 0; index < incomingDrivers.length; index += 1) {
    const raw = incomingDrivers[index] || {};
    const name = String(raw.name || '').trim();
    const phone = String(raw.phone || raw.mobile || '').replace(/\D/g, '');
    const email = String(raw.email || '').trim().toLowerCase();
    const gender = String(raw.gender || '').trim().toLowerCase();
    const serviceLocationInput = String(
      raw.service_location || raw.serviceLocation || '',
    ).trim();
    const transportType = normalizeImportTransportType(
      raw.transport_type || raw.transportType,
    );
    const vehicleInput = String(raw.vehicle_type || raw.vehicleType || '').trim();

    if (!name) {
      errors.push({ index, field: 'name', message: 'Name is required' });
      continue;
    }

    if (!/^\d{10}$/.test(phone)) {
      errors.push({
        index,
        field: 'phone',
        message: 'A valid 10-digit phone number is required',
      });
      continue;
    }

    if (email && !EMAIL_REGEX.test(email)) {
      errors.push({ index, field: 'email', message: 'A valid email address is required' });
      continue;
    }

    if (!serviceLocationInput) {
      errors.push({
        index,
        field: 'service_location',
        message: 'Service location is required',
      });
      continue;
    }

    const existingDriver = await Driver.findOne({ phone }).lean();
    if (existingDriver) {
      skipped.push({ index, phone, id: String(existingDriver._id) });
      continue;
    }

    const serviceLocation = await resolveServiceLocationForImport(serviceLocationInput);
    const normalizedVehicleInput = vehicleInput || transportType || 'car';
    const vehicleRecord = await resolveVehicleForImport(
      normalizedVehicleInput,
      transportType,
    );
    const vehicleType = normalizeImportVehicleType(
      normalizedVehicleInput,
      vehicleRecord,
    );

    try {
      const driver = await Driver.create({
        name,
        phone,
        email,
        gender,
        password: await hashPassword(phone),
        vehicleType,
        vehicleTypeId: vehicleRecord?._id || null,
        vehicleMake: String(raw.vehicle_make || raw.vehicleMake || '').trim(),
        vehicleModel: String(raw.vehicle_model || raw.vehicleModel || '').trim(),
        vehicleColor: String(raw.vehicle_color || raw.vehicleColor || '').trim(),
        vehicleNumber: String(raw.vehicle_number || raw.vehicleNumber || '').trim(),
        registerFor: transportType,
        city:
          serviceLocation?.service_location_name ||
          serviceLocation?.name ||
          serviceLocationInput ||
          String(raw.country || '').trim(),
        approve: raw.approve !== undefined ? Boolean(raw.approve) : true,
        status: raw.status || (raw.approve === false ? 'pending' : 'approved'),
        onboarding: {
          importCountry: String(raw.country || '').trim(),
          importServiceLocation: serviceLocationInput,
          importedByAdmin: true,
        },
      });

      created.push(serializeDriver(driver.toObject()));
    } catch (error) {
      errors.push({ index, message: error?.message || 'Failed to create driver' });
    }
  }

  return {
    created_count: created.length,
    skipped_count: skipped.length,
    error_count: errors.length,
    created,
    skipped: skipped.slice(0, 200),
    errors: errors.slice(0, 200),
  };
};

export const createUser = async (payload) => {
  const name = String(payload.name || '').trim();
  const phone = String(payload.phone || payload.mobile || '').replace(/\D/g, '');
  const email = String(payload.email || '').trim().toLowerCase();
  const password = String(payload.password || '');
  const passwordConfirmation = String(payload.password_confirmation ?? payload.confirmPassword ?? '');
  const gender = String(payload.gender || '').trim().toLowerCase();
  const profileImage = String(payload.profileImage || '').trim();

  if (!name) throw new ApiError(400, 'User name is required');
  if (!/^\d{10}$/.test(phone)) throw new ApiError(400, 'A valid 10-digit phone number is required');
  if (!email) throw new ApiError(400, 'Email is required');
  if (!EMAIL_REGEX.test(email)) throw new ApiError(400, 'A valid email address is required');
  if (!gender || !VALID_USER_GENDERS.has(gender)) throw new ApiError(400, 'A valid gender is required');
  if (!password.trim()) throw new ApiError(400, 'Password is required');
  if (password.length < 5) throw new ApiError(400, 'Password must be at least 5 characters');
  if (!passwordConfirmation) throw new ApiError(400, 'Confirm password is required');
  if (password !== passwordConfirmation) throw new ApiError(400, 'Passwords do not match');

  const existingUser = await User.findOne({ phone });
  if (existingUser) {
    throw new ApiError(409, 'Phone number already exists');
  }

  const user = await User.create({
    name,
    phone,
    email,
    gender,
    profileImage,
    password: await hashPassword(password),
    wallet_balance: Number(payload.wallet_balance || 0),
    active: payload.active ?? true,
  });

  return serializeUser(user.toObject());
};

export const updateUser = async (id, payload) => {
  const update = {};

  if (payload.name !== undefined) update.name = String(payload.name || '').trim();
  if (payload.phone !== undefined || payload.mobile !== undefined) {
    update.phone = String(payload.phone || payload.mobile || '').replace(/\D/g, '');
    if (!/^\d{10}$/.test(update.phone)) {
      throw new ApiError(400, 'A valid 10-digit phone number is required');
    }
  }
  if (payload.email !== undefined) {
    update.email = String(payload.email || '').trim().toLowerCase();
    if (update.email && !EMAIL_REGEX.test(update.email)) {
      throw new ApiError(400, 'A valid email address is required');
    }
  }
  if (payload.gender !== undefined) {
    update.gender = String(payload.gender || '').trim().toLowerCase();
    if (update.gender && !VALID_USER_GENDERS.has(update.gender)) {
      throw new ApiError(400, 'A valid gender is required');
    }
  }
  if (payload.profileImage !== undefined) update.profileImage = String(payload.profileImage || '').trim();
  if (payload.wallet_balance !== undefined) update.wallet_balance = Number(payload.wallet_balance || 0);
  if (payload.active !== undefined) update.active = Boolean(payload.active);
  if (payload.password) {
    update.password = await hashPassword(String(payload.password));
  }

  const user = await User.findOneAndUpdate(
    { _id: id, deletedAt: null },
    { $set: update },
    { returnDocument: 'after', runValidators: true },
  );

  if (!user) throw new ApiError(404, 'User not found');
  return serializeUser(user.toObject());
};

export const deleteUser = async (id) => {
  const user = await User.findOneAndUpdate(
    { _id: id, deletedAt: null },
    {
      $set: {
        deletedAt: new Date(),
        deletion_reason: 'admin_delete',
        active: false,
      },
    },
    { returnDocument: 'after' },
  );

  if (!user) {
    throw new ApiError(404, 'User not found');
  }
  return true;
};

export const listDeletedUsers = async ({ page = 1, limit = 50 }) => {
  const safePage = Number(page) || 1;
  const safeLimit = Number(limit) || 50;
  const start = (safePage - 1) * safeLimit;

  const [users, total] = await Promise.all([
    User.find({ deletedAt: { $ne: null } })
      .sort({ deletedAt: -1, createdAt: -1 })
      .skip(start)
      .limit(safeLimit)
      .lean(),
    User.countDocuments({ deletedAt: { $ne: null } }),
  ]);

  return {
    results: users.map(serializeUser),
    paginator: {
      current_page: safePage,
      per_page: safeLimit,
      total,
      last_page: Math.max(1, Math.ceil(total / safeLimit)),
    },
  };
};

export const restoreDeletedUser = async (id) => {
  const user = await User.findOneAndUpdate(
    { _id: id, deletedAt: { $ne: null } },
    {
      $set: {
        deletedAt: null,
        deletion_reason: '',
        active: true,
      },
    },
    { returnDocument: 'after', runValidators: true },
  );

  if (!user) {
    throw new ApiError(404, 'Deleted user not found');
  }

  return serializeUser(user.toObject());
};

export const permanentlyDeleteDeletedUser = async (id) => {
  const deleted = await User.findOneAndDelete({ _id: id, deletedAt: { $ne: null } });

  if (!deleted) {
    throw new ApiError(404, 'Deleted user not found');
  }
  return true;
};

export const listUserDeletionRequests = async ({ page = 1, limit = 50, status = 'pending' } = {}) => {
  const safePage = Number(page) || 1;
  const safeLimit = Number(limit) || 50;
  const requestedStatus = String(status || 'pending').toLowerCase();
  const start = (safePage - 1) * safeLimit;
  const statusQuery =
    requestedStatus === 'all'
      ? { $in: ['pending', 'approved', 'rejected'] }
      : requestedStatus;
  const query = {
    'deletionRequest.status': statusQuery,
    deletedAt: null,
  };

  const [users, total] = await Promise.all([
    User.find(query)
      .sort({ 'deletionRequest.requestedAt': -1, createdAt: -1 })
      .skip(start)
      .limit(safeLimit)
      .lean(),
    User.countDocuments(query),
  ]);

  return {
    results: users.map(serializeUser),
    paginator: {
      current_page: safePage,
      per_page: safeLimit,
      total,
      last_page: Math.max(1, Math.ceil(total / safeLimit)),
    },
  };
};

export const approveUserDeletionRequest = async (id, adminId) => {
  const now = new Date();
  const user = await User.findOneAndUpdate(
    { _id: id, deletedAt: null, 'deletionRequest.status': 'pending' },
    {
      $set: {
        deletedAt: now,
        active: false,
        isActive: false,
        deletion_reason: 'user_delete_request',
        'deletionRequest.status': 'approved',
        'deletionRequest.reviewedAt': now,
        'deletionRequest.reviewedBy': adminId || null,
        'deletionRequest.adminNote': '',
      },
    },
    { returnDocument: 'after', runValidators: true },
  );

  if (!user) throw new ApiError(404, 'Pending user deletion request not found');
  notifyUserAccountDeleted(user._id);
  return serializeUser(user.toObject());
};

export const rejectUserDeletionRequest = async (id, payload = {}, adminId) => {
  const now = new Date();
  const adminNote = String(payload.adminNote || payload.note || '').trim();
  const user = await User.findOneAndUpdate(
    { _id: id, deletedAt: null, 'deletionRequest.status': 'pending' },
    {
      $set: {
        active: true,
        isActive: true,
        'deletionRequest.status': 'rejected',
        'deletionRequest.reviewedAt': now,
        'deletionRequest.reviewedBy': adminId || null,
        'deletionRequest.adminNote': adminNote,
      },
    },
    { returnDocument: 'after', runValidators: true },
  );

  if (!user) throw new ApiError(404, 'Pending user deletion request not found');
  return serializeUser(user.toObject());
};

export const getUserById = async (id) => {
  const user = await User.findById(id).lean();

  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  const subscriptions = await UserSubscription.find({ userId: id })
    .sort({ active: -1, expiresAt: 1, createdAt: -1 })
    .populate('planId', 'name')
    .populate('vehicle_type_id', 'name')
    .lean();

  const activeSubscriptions = subscriptions.filter((item) => item.active !== false && String(item.status || '') === 'active');

  const rides = await Ride.find({
    userId: id,
    'feedback.rating': { $gte: 1 },
  })
    .sort({ completedAt: -1, createdAt: -1 })
    .populate('driverId', 'name')
    .lean();

  return {
    ...serializeUser(user),
    subscriptionSummary: {
      activeCount: activeSubscriptions.length,
      activePlans: activeSubscriptions.map((item) => ({
        id: String(item._id),
        planId: item.planId?._id ? String(item.planId._id) : String(item.planId || ''),
        name: item.name || item.planId?.name || '',
        status: item.status || 'active',
        benefit_type: item.benefit_type || 'limited',
        ride_limit: Number(item.ride_limit || 0),
        rides_used: Number(item.rides_used || 0),
        rides_remaining: String(item.benefit_type || '') === 'unlimited'
          ? null
          : Math.max(0, Number(item.ride_limit || 0) - Number(item.rides_used || 0)),
        vehicle_type: item.vehicle_type_id?._id
          ? {
              id: String(item.vehicle_type_id._id),
              name: item.vehicle_type_id.name || '',
            }
          : null,
        expiresAt: item.expiresAt || null,
      })),
    },
    reviews: rides.map((ride) => ({
      _id: ride._id,
      request_id: String(ride._id),
      rating: Number(ride.feedback?.rating || 0),
      comment: String(ride.feedback?.comment || '').trim(),
      createdAt: ride.feedback?.submittedAt || ride.completedAt || ride.createdAt || null,
      driver_id: ride.driverId
        ? {
            _id: ride.driverId._id || ride.driverId,
            name: ride.driverId.name || 'Unknown',
          }
        : null,
    })),
  };
};

/**
 * Seed the default vehicle fields, once, safely.
 *
 * This runs on every read of the driver-needed-document endpoints, and the
 * admin panel loads template_type=document and template_type=vehicle_field
 * concurrently. A count-then-insertMany pair let both requests observe zero
 * and both insert, and the loser died on the unique slug index -- a 500 on an
 * admin screen that was only trying to list rows.
 *
 * Upserting keyed on the slug removes the race instead of narrowing it: the
 * slugs are deterministic, so a concurrent duplicate is now a no-op rather
 * than a collision. $setOnInsert is deliberate -- an admin who edited a
 * seeded field must not have it reset on the next page load.
 *
 * A racing upsert can still surface E11000 from the index itself; that means
 * the row the other request inserted is already there, which is the desired
 * end state, so it is tolerated. Anything else still propagates.
 */
const ensureDefaultDriverVehicleFields = async () => {
  const count = await DriverNeededDocument.countDocuments({ template_type: 'vehicle_field' });
  if (count > 0) {
    return;
  }

  try {
    await DriverNeededDocument.bulkWrite(
      buildDefaultDriverVehicleFieldConfigs().map((doc) => ({
        updateOne: {
          filter: { slug: doc.slug },
          update: { $setOnInsert: doc },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  } catch (error) {
    const codes = [error?.code, ...(error?.writeErrors || []).map((e) => e?.code ?? e?.err?.code)];
    const onlyDuplicates = codes.filter((c) => c !== undefined).every((c) => c === 11000);
    if (!onlyDuplicates) {
      throw error;
    }
  }
};

export const listUserRequests = async (id) => {
  const user = await User.findById(id).lean();

  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  const rides = await Ride.find({ userId: id }).sort({ createdAt: -1 }).populate('driverId', 'name').lean();

  return {
    results: rides.map((ride) => ({
      request_id: String(ride._id),
      trip_start_time: ride.createdAt,
      user_id: {
        _id: String(id),
        name: user.name || '',
      },
      driver_id: ride.driverId
        ? {
          _id: ride.driverId._id || ride.driverId,
          name: ride.driverId.name || 'Pending',
        }
        : null,
      is_completed: String(ride.status).toLowerCase() === 'completed',
      is_cancelled: String(ride.status).toLowerCase() === 'cancelled',
      is_paid: String(ride.status).toLowerCase() === 'completed',
      payment_type: 'cash',
      status: ride.status,
    })),
  };
};

export const listUserWalletHistory = async (id) => {
  const user = await User.findById(id).lean();

  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  const wallet = await UserWallet.findOne({ userId: id }).lean();

  return {
    balance: wallet?.balance || 0,
    refundWallet: wallet?.refundWallet || 0,
    results: (wallet?.transactions || []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(t => ({
      _id: String(t._id),
      amount: t.amount,
      type: t.kind,
      description: t.title,
      createdAt: t.createdAt,
    })),
  };
};

export const adjustUserWallet = async (id, payload = {}) => {
  const amount = Number(payload.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ApiError(400, 'Amount must be greater than 0');
  }

  const operation = String(payload.operation || 'credit').toLowerCase();
  if (!['credit', 'debit'].includes(operation)) {
    throw new ApiError(400, 'Operation must be credit or debit');
  }

  const user = await User.findById(id);
  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  let wallet = await UserWallet.findOne({ userId: id });
  if (!wallet) {
    wallet = new UserWallet({ userId: id, balance: 0, refundWallet: 0, transactions: [] });
  }

  const currentBalance = wallet.balance || 0;
  const nextBalance = operation === 'credit' ? currentBalance + amount : currentBalance - amount;

  wallet.balance = nextBalance;
  wallet.transactions.push({
    kind: operation,
    amount,
    title: payload.description || `Admin adjustment (${operation})`,
  });

  await wallet.save();
  return { balance: Number(nextBalance.toFixed(2)) };
};

export const listDrivers = async ({ page = 1, limit = 50, status, search, approve, isOnline } = {}, currentAdmin = null) => {
  const safePage = Number(page) || 1;
  const safeLimit = Number(limit) || 50;
  const start = (safePage - 1) * safeLimit;

  const query = { deletedAt: null };
  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'drivers.view', 'drivers');
    Object.assign(query, buildServiceLocationScopeQuery(currentAdmin));
  }

  if (status) {
    query.status = status;
  }
  
  if (approve !== undefined) {
    query.approve = approve === 'true' || approve === true || approve === 1;
  }

  if (isOnline !== undefined) {
    query.isOnline = isOnline === 'true' || isOnline === true || isOnline === 1;
  }

  if (search) {
    const regex = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    query.$or = [
      { name: regex },
      { phone: regex },
      { email: regex },
      { vehicleNumber: regex }
    ];
  }

  const total = await Driver.countDocuments(query);

  const drivers = await Driver.find(query)
    .select(DRIVER_LIST_SELECT)
    .sort({ createdAt: -1 })
    .skip(start)
    .limit(safeLimit)
    .lean();

  const serviceLocationIds = [
    ...new Set(
      drivers
        .map((driver) => String(driver.service_location_id || ''))
        .filter(Boolean),
    ),
  ];

  const serviceLocations = serviceLocationIds.length
    ? await ServiceLocation.find({ _id: { $in: serviceLocationIds } })
        .select('_id service_location_name name country')
        .lean()
    : [];

  const serviceLocationMap = new Map(
    serviceLocations.map((location) => [String(location._id), location]),
  );

  const hydratedDrivers = drivers.map((driver) => ({
    ...driver,
    service_location_id: driver.service_location_id
      ? serviceLocationMap.get(String(driver.service_location_id)) || driver.service_location_id
      : null,
  }));

  return {
    results: hydratedDrivers.map(serializeDriverListItem),
    paginator: {
      current_page: safePage,
      per_page: safeLimit,
      total,
      last_page: Math.max(1, Math.ceil(total / safeLimit)),
    },
  };
};

export const listDriverRatings = async ({ page = 1, limit = 50, search = '' }) => {
  const safePage = Number(page) || 1;
  const safeLimit = Number(limit) || 50;
  const start = (safePage - 1) * safeLimit;
  const term = String(search || '').trim();

  const query = { deletedAt: null };
  if (term) {
    const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    query.$or = [{ name: regex }, { phone: regex }, { email: regex }];
  }

  const [drivers, total] = await Promise.all([
    Driver.find(query).sort({ rating: -1, createdAt: -1 }).skip(start).limit(safeLimit).lean(),
    Driver.countDocuments(query),
  ]);

  return {
    results: drivers.map((driver) => ({
      _id: driver._id,
      name: driver.name || '',
      mobile: driver.phone || '',
      phone: driver.phone || '',
      email: driver.email || '',
      rating: Number(driver.ratingCount || 0) > 0 ? Number(driver.rating || 0) : 0,
      rating_count: Number(driver.ratingCount || 0),
      transport_type: driver.registerFor || driver.vehicleType || '',
    })),
    paginator: {
      current_page: safePage,
      per_page: safeLimit,
      total,
      last_page: Math.max(1, Math.ceil(total / safeLimit)),
    },
  };
};

export const getDriverRatingDetail = async (id) => {
  const driver = await Driver.findById(id).lean();
  if (!driver) {
    throw new ApiError(404, 'Driver not found');
  }

  const rides = await Ride.find({ driverId: driver._id }).sort({ createdAt: -1 }).lean();

  return {
    driver: {
      _id: driver._id,
      name: driver.name || '',
      phone: driver.phone || '',
      email: driver.email || '',
      rating: Number(driver.ratingCount || 0) > 0 ? Number(driver.rating || 0) : 0,
      rating_count: Number(driver.ratingCount || 0),
      transport_type: driver.registerFor || driver.vehicleType || '',
      vehicle_make: driver.vehicleMake || '',
      vehicle_model: driver.vehicleModel || '',
      vehicle_number: driver.vehicleNumber || '',
      image: driver.profile_image || driver.avatar || '',
      vehicle_image: 'https://img.freepik.com/free-vector/yellow-passenger-transport-taxi-car_1017-4886.jpg',
    },
    reviews: rides.map((ride) => ({
      _id: ride._id,
      request_id: String(ride._id),
      date: ride.createdAt,
      pickup_location: ride.pickupLocation?.coordinates
        ? `${ride.pickupLocation.coordinates[1]}, ${ride.pickupLocation.coordinates[0]}`
        : 'N/A',
      rating: Number(driver.ratingCount || 0) > 0 ? Number(driver.rating || 0) : 0,
    })),
  };
};

export const listNegativeBalanceDrivers = async ({ page = 1, limit = 50, search = '' }) => {
  const safePage = Number(page) || 1;
  const safeLimit = Number(limit) || 50;
  const start = (safePage - 1) * safeLimit;
  const term = String(search || '').trim();

  const query = { deletedAt: null, 'wallet.balance': { $lt: 0 } };
  if (term) {
    const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    query.$or = [{ name: regex }, { phone: regex }, { email: regex }];
  }

  const [drivers, total, totals] = await Promise.all([
    Driver.find(query)
      .sort({ 'wallet.balance': 1, createdAt: -1 })
      .skip(start)
      .limit(safeLimit)
      .lean(),
    Driver.countDocuments(query),
    Driver.aggregate([
      { $match: query },
      { $group: { _id: null, total_outstanding: { $sum: { $abs: '$wallet.balance' } } } },
    ]),
  ]);

  const totalOutstanding = Number(totals?.[0]?.total_outstanding || 0);

  return {
    results: drivers.map((driver) => ({
      _id: driver._id,
      name: driver.name || '',
      service_location_name: driver.city || '',
      email: driver.email || '',
      mobile: driver.phone || '',
      transport_type: driver.registerFor || driver.vehicleType || '',
      approve: Boolean(driver.approve),
      status: driver.status || (driver.approve ? 'approved' : 'pending'),
      balance: Number(driver.wallet?.balance || 0),
    })),
    paginator: {
      current_page: safePage,
      per_page: safeLimit,
      total,
      last_page: Math.max(1, Math.ceil(total / safeLimit)),
    },
    summary: {
      total_outstanding: totalOutstanding,
    },
  };
};

export const listDriverWithdrawalSummaries = async ({ page = 1, limit = 50, search = '', status = 'pending' }) => {
  const safePage = Number(page) || 1;
  const safeLimit = Number(limit) || 50;
  const start = (safePage - 1) * safeLimit;
  const term = String(search || '').trim();

  const match = status === 'all' ? {} : { status };
  let matchedDriverIds = null;

  if (term) {
    const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const drivers = await Driver.find({ deletedAt: null, $or: [{ name: regex }, { phone: regex }, { email: regex }] })
      .select('_id')
      .lean();
    matchedDriverIds = drivers.map((d) => d._id);
    if (matchedDriverIds.length === 0) {
      return {
        results: [],
        paginator: { current_page: safePage, per_page: safeLimit, total: 0, last_page: 1 },
      };
    }
    match.driver_id = { $in: matchedDriverIds };
  }

  const groupPipeline = [
    { $match: match },
    {
      $group: {
        _id: '$driver_id',
        pending_count: { $sum: 1 },
        pending_amount: { $sum: '$amount' },
        last_request_at: { $max: '$createdAt' },
      },
    },
  ];

  const [groups, countRows] = await Promise.all([
    WithdrawalRequest.aggregate([
      ...groupPipeline,
      { $sort: { last_request_at: -1 } },
      { $skip: start },
      { $limit: safeLimit },
    ]),
    WithdrawalRequest.aggregate([...groupPipeline, { $count: 'total' }]),
  ]);

  const total = Number(countRows?.[0]?.total || 0);
  const driverIds = groups.map((g) => g._id).filter(Boolean);
  const drivers = await Driver.find({ _id: { $in: driverIds } }).lean();
  const latestRequests = driverIds.length
    ? await WithdrawalRequest.find({
        driver_id: { $in: driverIds },
        ...match,
      })
        .sort({ createdAt: -1 })
        .lean()
    : [];
  const byId = new Map(drivers.map((d) => [String(d._id), d]));
  const latestRequestByDriverId = new Map();

  latestRequests.forEach((request) => {
    const key = String(request.driver_id || '');
    if (key && !latestRequestByDriverId.has(key)) {
      latestRequestByDriverId.set(key, request);
    }
  });

  return {
    results: groups.map((row) => {
      const driver = byId.get(String(row._id));
      const latestRequest = latestRequestByDriverId.get(String(row._id));
      return {
        driver_id: row._id,
        latest_request_id: latestRequest?._id || null,
        last_request_at: row.last_request_at,
        pending_count: Number(row.pending_count || 0),
        pending_amount: Number(row.pending_amount || 0),
        status: status,
        driver: driver
          ? {
            _id: driver._id,
            name: driver.name || '',
            mobile: driver.phone || '',
            email: driver.email || '',
          }
          : null,
      };
    }),
    paginator: {
      current_page: safePage,
      per_page: safeLimit,
      total,
      last_page: Math.max(1, Math.ceil(total / safeLimit)),
    },
  };
};

export const listDriverWithdrawals = async ({ driverId, page = 1, limit = 50 }) => {
  const safePage = Number(page) || 1;
  const safeLimit = Number(limit) || 50;
  const start = (safePage - 1) * safeLimit;

  const driver = await Driver.findById(driverId).lean();
  if (!driver) {
    throw new ApiError(404, 'Driver not found');
  }

  const [items, total] = await Promise.all([
    WithdrawalRequest.find({ driver_id: driver._id }).sort({ createdAt: -1 }).skip(start).limit(safeLimit).lean(),
    WithdrawalRequest.countDocuments({ driver_id: driver._id }),
  ]);

  return {
    driver: {
      _id: driver._id,
      name: driver.name || '',
      mobile: driver.phone || '',
      email: driver.email || '',
      city: driver.city || '',
      vehicle_number: driver.vehicleNumber || '',
      vehicle_type: driver.vehicleType || '',
      register_for: driver.registerFor || '',
      wallet: await serializeDriverWallet(driver),
    },
    results: items.map((item) => ({
      _id: item._id,
      amount: Number(item.amount || 0),
      requested_currency: 'INR',
      status: item.status || 'pending',
      payment_method: item.payment_method || '',
      createdAt: item.createdAt,
    })),
    paginator: {
      current_page: safePage,
      per_page: safeLimit,
      total,
      last_page: Math.max(1, Math.ceil(total / safeLimit)),
    },
  };
};

export const getDriverWithdrawalContextByRequestId = async ({ requestId, page = 1, limit = 50 }) => {
  const request = await WithdrawalRequest.findById(requestId).lean();

  if (!request || !request.driver_id) {
    throw new ApiError(404, 'Withdrawal request not found');
  }

  return listDriverWithdrawals({
    driverId: request.driver_id,
    page,
    limit,
  });
};

export const approveDriverWithdrawalRequest = async (requestId, adminId = null) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const request = await WithdrawalRequest.findById(requestId).session(session);
    if (!request || !request.driver_id) {
      throw new ApiError(404, 'Withdrawal request not found');
    }

    if (request.status !== 'pending') {
      throw new ApiError(400, 'Only pending withdrawal requests can be approved');
    }

    const driver = await Driver.findById(request.driver_id).session(session);
    if (!driver) {
      throw new ApiError(404, 'Driver not found');
    }

    const requestAmount = Math.round(Number(request.amount || 0) * 100) / 100;
    const currentBalance = Math.round(Number(driver.wallet?.balance || 0) * 100) / 100;

    if (!Number.isFinite(requestAmount) || requestAmount <= 0) {
      throw new ApiError(400, 'Withdrawal request amount is invalid');
    }

    if (currentBalance < requestAmount) {
      throw new ApiError(400, 'Driver wallet balance is not enough for this withdrawal');
    }

    const walletResult = await applyDriverWalletAdjustment({
      driverId: driver._id,
      amount: -requestAmount,
      type: 'adjustment',
      description: 'Driver withdrawal approved by admin',
      metadata: {
        withdrawalRequestId: String(request._id),
        approvedBy: adminId ? String(adminId) : null,
        paymentMethod: request.payment_method || 'bank_transfer',
      },
      session,
    });

    request.status = 'completed';
    await request.save({ session });

    await session.commitTransaction();

    emitToDriver(driver._id, 'driver:wallet:updated', {
      wallet: walletResult.wallet,
      transaction: walletResult.transaction,
    });

    return {
      request: {
        _id: request._id,
        driver_id: request.driver_id,
        amount: requestAmount,
        payment_method: request.payment_method || '',
        status: request.status,
        createdAt: request.createdAt,
        updatedAt: request.updatedAt,
      },
      wallet: walletResult.wallet,
    };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

export const rejectDriverWithdrawalRequest = async (requestId) => {
  const request = await WithdrawalRequest.findById(requestId);
  if (!request || !request.driver_id) {
    throw new ApiError(404, 'Withdrawal request not found');
  }

  if (request.status !== 'pending') {
    throw new ApiError(400, 'Only pending withdrawal requests can be rejected');
  }

  request.status = 'cancelled';
  await request.save();

  return {
    request: {
      _id: request._id,
      driver_id: request.driver_id,
      amount: Number(request.amount || 0),
      payment_method: request.payment_method || '',
      status: request.status,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    },
  };
};

export const adjustDriverWallet = async (id, payload = {}) => {
  const amount = Number(payload.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ApiError(400, 'Amount must be greater than 0');
  }

  const operation = String(payload.operation || 'credit').toLowerCase();
  if (!['credit', 'debit'].includes(operation)) {
    throw new ApiError(400, 'Operation must be credit or debit');
  }

  const normalizedAmount = Math.round(amount * 100) / 100;
  const signedAmount = operation === 'credit' ? normalizedAmount : -normalizedAmount;
  const description = payload.description || `Admin adjustment (${operation})`;

  /*
   * Delegates to applyDriverWalletAdjustment instead of moving the balance itself.
   *
   * What stood here was a SECOND writer of driver.wallet.balance, and the two
   * disagreed in both of the ways that matter:
   *
   *   - it read `driver.wallet.balance`, computed a new figure in JavaScript, and
   *     wrote it back absolutely with `driver.save()`. An admin adjustment landing
   *     at the same moment as a ride settlement (or as another admin) lost one of
   *     the two updates outright -- the money simply disappeared from the balance
   *     while both ledger rows claimed to have applied. applyDriverWalletAdjustment
   *     does the arithmetic server-side in an aggregation-pipeline `$add`, which
   *     cannot lose a concurrent write.
   *
   *   - it blocked on `nextBalance < -cashLimit` while the other writer blocks on
   *     `balance <= minimumBalanceForOrders` from app settings. Two rules for one
   *     question, so whether a driver could take work depended on which code path
   *     had last touched their wallet.
   *
   * BEHAVIOUR CHANGES, deliberately: the block threshold for admin adjustments is
   * now the configured minimum-balance rule rather than the ad-hoc `-cashLimit`
   * default of 500, and `wallet.cashLimit` is written as the shared ceiling. That
   * convergence is the point of the change, not a side effect of it.
   *
   * The ledger row, its own Mongo transaction and the {balance} response shape are
   * unchanged, so callers and the admin UI see what they saw before.
   */
  const { applyDriverWalletAdjustment } = await import('../../driver/services/walletService.js');

  const result = await applyDriverWalletAdjustment({
    driverId: id,
    amount: signedAmount,
    type: 'adjustment',
    description,
    metadata: {
      source: 'admin',
      operation,
      rawAmount: normalizedAmount,
      /*
       * Recorded now so the unique index added with the rest of the idempotency
       * work has something to build on. It does NOT yet make this call idempotent:
       * nothing enforces uniqueness until that index exists, and an admin panel
       * that does not send a clientRequestId still produces a fresh key per call.
       * Stated rather than implied, so nobody reads this field as a guarantee.
       */
      ...(payload.clientRequestId
        ? { referenceKey: forAdminAdjustment(payload.adminId || 'admin', payload.clientRequestId) }
        : {}),
    },
  });

  return { balance: Number(Number(result.driver.wallet.balance).toFixed(2)) };
};

export const listDriverWalletHistory = async (id) => {
  const driver = await Driver.findById(id).lean();

  if (!driver) {
    throw new ApiError(404, 'Driver not found');
  }

  const transactions = await WalletTransaction.find({ driverId: id })
    .sort({ createdAt: -1 })
    .lean();

  return {
    balance: Number(driver.wallet?.balance || 0),
    results: transactions.map(t => ({
      _id: String(t._id),
      amount: t.amount,
      type: t.metadata?.operation || t.kind || (t.amount < 0 ? 'debit' : 'credit'),
      description: t.description || t.title || '',
      createdAt: t.createdAt,
    })),
  };
};

export const listDeletedDrivers = async ({ page = 1, limit = 50 }) => {
  const safePage = Number(page) || 1;
  const safeLimit = Number(limit) || 50;
  const start = (safePage - 1) * safeLimit;

  const [drivers, total] = await Promise.all([
    Driver.find({ deletedAt: { $ne: null } })
      .select(DRIVER_LIST_SELECT)
      .sort({ deletedAt: -1, createdAt: -1 })
      .skip(start)
      .limit(safeLimit)
      .lean(),
    Driver.countDocuments({ deletedAt: { $ne: null } }),
  ]);

  return {
    results: drivers.map(serializeDriverListItem),
    paginator: {
      current_page: safePage,
      per_page: safeLimit,
      total,
      last_page: Math.max(1, Math.ceil(total / safeLimit)),
    },
  };
};

export const listDriverDeletionRequests = async ({ page = 1, limit = 50, status = 'pending' } = {}) => {
  const safePage = Number(page) || 1;
  const safeLimit = Number(limit) || 50;
  const requestedStatus = String(status || 'pending').toLowerCase();
  const start = (safePage - 1) * safeLimit;
  const statusQuery =
    requestedStatus === 'all'
      ? { $in: ['pending', 'approved', 'rejected'] }
      : requestedStatus;

  const query = {
    'deletionRequest.status': statusQuery,
    deletedAt: null,
  };

  const [drivers, total] = await Promise.all([
    Driver.find(query)
      .select(DRIVER_LIST_SELECT)
      .sort({ 'deletionRequest.requestedAt': -1, createdAt: -1 })
      .skip(start)
      .limit(safeLimit)
      .lean(),
    Driver.countDocuments(query),
  ]);

  return {
    results: drivers.map(serializeDriverListItem),
    paginator: {
      current_page: safePage,
      per_page: safeLimit,
      total,
      last_page: Math.max(1, Math.ceil(total / safeLimit)),
    },
  };
};

export const approveDriverDeletionRequest = async (id, adminId) => {
  const now = new Date();
  const driver = await Driver.findOneAndDelete(
    { _id: id, deletedAt: null, 'deletionRequest.status': 'pending' },
  );

  if (!driver) throw new ApiError(404, 'Pending driver deletion request not found');

  const removedDriver = driver.toObject ? driver.toObject() : driver;

  return serializeDriver({
    ...removedDriver,
    deletedAt: now,
    approve: false,
    status: 'inactive',
    deletion_reason: 'driver_delete_request',
    deletionRequest: {
      ...(removedDriver.deletionRequest || {}),
      status: 'approved',
      reviewedAt: now,
      reviewedBy: adminId || null,
      adminNote: '',
    },
  });
};

export const rejectDriverDeletionRequest = async (id, payload = {}, adminId) => {
  const now = new Date();
  const adminNote = String(payload.adminNote || payload.note || '').trim();
  const driver = await Driver.findOneAndUpdate(
    { _id: id, deletedAt: null, 'deletionRequest.status': 'pending' },
    {
      $set: {
        approve: true,
        status: 'approved',
        'deletionRequest.status': 'rejected',
        'deletionRequest.reviewedAt': now,
        'deletionRequest.reviewedBy': adminId || null,
        'deletionRequest.adminNote': adminNote,
      },
    },
    { returnDocument: 'after', runValidators: true },
  );

  if (!driver) throw new ApiError(404, 'Pending driver deletion request not found');
  return serializeDriver(driver.toObject());
};

export const restoreDeletedDriver = async (id) => {
  const driver = await Driver.findOneAndUpdate(
    { _id: id, deletedAt: { $ne: null } },
    { $set: { deletedAt: null } },
    { returnDocument: 'after' },
  );

  if (!driver) {
    throw new ApiError(404, 'Deleted driver not found');
  }

  return serializeDriver(driver.toObject ? driver.toObject() : driver);
};

export const permanentlyDeleteDeletedDriver = async (id) => {
  const deleted = await Driver.findOneAndDelete({ _id: id, deletedAt: { $ne: null } });
  if (!deleted) {
    throw new ApiError(404, 'Deleted driver not found');
  }
  return true;
};

export const createDriver = async (payload = {}, currentAdmin = null) => {
  const name = String(payload.name || '').trim();
  const phone = String(payload.phone || payload.mobile || '').replace(/\D/g, '');
  const password = String(payload.password || '').trim();
  const passwordConfirmation = String(
    payload.password_confirmation || payload.passwordConfirmation || '',
  ).trim();
  const email = String(payload.email || '').trim();

  if (!name) throw new ApiError(400, 'Driver name is required');
  if (!phone) throw new ApiError(400, 'Driver phone is required');
  if (!password || password.length < 6) {
    throw new ApiError(400, 'Password must be at least 6 characters');
  }
  if (passwordConfirmation && password !== passwordConfirmation) {
    throw new ApiError(400, 'Password confirmation does not match');
  }

  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'drivers.view', 'drivers');
  }

  const existing = await Driver.findOne({ phone }).lean();
  if (existing) throw new ApiError(409, 'Driver phone already exists');

  const registerFor = normalizeDriverRegisterFor(
    payload.transport_type || payload.transportType || payload.register_for || payload.registerFor || 'taxi',
  );

  let city = String(payload.city || '').trim();
  const serviceLocationId = payload.service_location_id || payload.area || payload.service_location;
  if (currentAdmin && serviceLocationId) {
    assertServiceLocationAccess(currentAdmin, serviceLocationId);
  }
  if (serviceLocationId) {
    const location = await ServiceLocation.findById(serviceLocationId).lean();
    if (location) {
      city = location.service_location_name || location.name || city;
    }
  }

  const vehicleTypeId =
    payload.vehicle_type_id || payload.vehicleTypeId || payload.vehicleType?._id || payload.vehicleType?.id || null;
  const vehicleRecord =
    vehicleTypeId && mongoose.isValidObjectId(vehicleTypeId)
      ? await Vehicle.findById(vehicleTypeId).lean()
      : null;
  const normalizedVehicleInput = String(
    vehicleRecord?.name ||
      payload.vehicle_type ||
      payload.vehicleType?.name ||
      payload.vehicleType ||
      payload.car_type ||
      registerFor ||
      'car',
  ).trim();
  const vehicleType = normalizeImportVehicleType(
    normalizedVehicleInput,
    vehicleRecord,
  );
  const vehicleIconType = vehicleType;
  const profilePicture = String(payload.profile_picture || payload.profilePicture || '').trim();
  const status = String(
    payload.status || (payload.approve === false ? 'pending' : 'approved'),
  )
    .trim()
    .toLowerCase();
  const approve =
    payload.approve !== undefined
      ? Boolean(payload.approve)
      : !['pending', 'disapproved', 'inactive', 'rejected'].includes(status);
  const serviceCategories = normalizeDriverServiceCategories(
    payload.serviceCategories ?? payload.service_categories,
    registerFor,
  );
  const onboardingPayload =
    payload.onboarding && typeof payload.onboarding === 'object' && !Array.isArray(payload.onboarding)
      ? payload.onboarding
      : {};
  const documents =
    payload.documents && typeof payload.documents === 'object' && !Array.isArray(payload.documents)
      ? payload.documents
      : {};

  const driver = await Driver.create({
    name,
    phone,
    email,
    service_location_id:
      serviceLocationId && mongoose.isValidObjectId(serviceLocationId) ? toObjectId(serviceLocationId) : null,
    country: payload.country || null,
    profile_picture: profilePicture,
    profileImage: profilePicture,
    gender: String(payload.gender || '').trim(),
    password: await hashPassword(password),
    vehicleType,
    vehicleIconType,
    vehicleTypeId: vehicleTypeId && mongoose.isValidObjectId(vehicleTypeId) ? toObjectId(vehicleTypeId) : null,
    vehicleMake: String(payload.vehicle_make || payload.vehicleMake || payload.car_make || '').trim(),
    vehicleModel: String(payload.vehicle_model || payload.vehicleModel || payload.car_model || '').trim(),
    vehicleColor: String(payload.vehicle_color || payload.vehicleColor || payload.car_color || '').trim(),
    vehicleNumber: String(payload.vehicle_number || payload.vehicleNumber || payload.car_number || '').trim(),
    registerFor,
    serviceCategories,
    city,
    approve,
    status,
    documents,
    onboarding: {
      ...onboardingPayload,
      role: 'driver',
      createdByAdmin: true,
    },
  });

  return serializeDriver(driver.toObject());
};

export const updateDriver = async (id, payload, currentAdmin = null) => {
  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'drivers.view', 'drivers');
    const existingDriver = await Driver.findById(id).select('service_location_id').lean();
    if (!existingDriver) {
      throw new ApiError(404, 'Driver not found');
    }
    assertServiceLocationAccess(currentAdmin, existingDriver.service_location_id);
  }

  const update = {};

  if (payload.name !== undefined) {
    update.name = String(payload.name || '').trim();
  }

  const phoneValue = payload.phone ?? payload.mobile;
  if (phoneValue !== undefined) {
    update.phone = String(phoneValue || '').trim();
  }

  if (payload.email !== undefined) {
    update.email = String(payload.email || '').trim();
  }

  if (payload.gender !== undefined) {
    update.gender = String(payload.gender || '').trim();
  }

  const transportTypeValue =
    payload.transport_type ?? payload.transportType ?? payload.register_for ?? payload.registerFor;
  if (transportTypeValue !== undefined) {
    update.registerFor = normalizeDriverRegisterFor(transportTypeValue);
  }

  const vehicleTypeValue = payload.vehicle_type ?? payload.vehicleType ?? payload.car_type;
  if (vehicleTypeValue !== undefined) {
    update.vehicleType = String(vehicleTypeValue || '').trim().toLowerCase() || 'car';
  }

  const vehicleTypeId =
    payload.vehicle_type_id ?? payload.vehicleTypeId ?? payload.vehicleType?._id ?? payload.vehicleType?.id;
  if (vehicleTypeId !== undefined) {
    update.vehicleTypeId =
      vehicleTypeId && mongoose.isValidObjectId(vehicleTypeId) ? toObjectId(vehicleTypeId) : null;
  }

  if (payload.vehicle_make !== undefined || payload.vehicleMake !== undefined || payload.car_make !== undefined) {
    update.vehicleMake = String(payload.vehicle_make ?? payload.vehicleMake ?? payload.car_make ?? '').trim();
  }

  if (payload.vehicle_model !== undefined || payload.vehicleModel !== undefined || payload.car_model !== undefined) {
    update.vehicleModel = String(payload.vehicle_model ?? payload.vehicleModel ?? payload.car_model ?? '').trim();
  }

  if (payload.vehicle_color !== undefined || payload.vehicleColor !== undefined || payload.car_color !== undefined) {
    update.vehicleColor = String(payload.vehicle_color ?? payload.vehicleColor ?? payload.car_color ?? '').trim();
  }

  if (payload.vehicle_number !== undefined || payload.vehicleNumber !== undefined || payload.car_number !== undefined) {
    update.vehicleNumber = String(payload.vehicle_number ?? payload.vehicleNumber ?? payload.car_number ?? '').trim();
  }

  const serviceLocationValue = payload.service_location_id ?? payload.area ?? payload.service_location;
  if (serviceLocationValue !== undefined) {
    if (currentAdmin && serviceLocationValue) {
      assertServiceLocationAccess(currentAdmin, serviceLocationValue);
    }
    update.service_location_id =
      serviceLocationValue && mongoose.isValidObjectId(serviceLocationValue)
        ? toObjectId(serviceLocationValue)
        : null;
  }

  if (payload.country !== undefined) {
    update.country = payload.country || null;
  }

  if ('approve' in payload) {
    update.approve = Boolean(payload.approve);
  }

  if (payload.status !== undefined) {
    update.status = String(payload.status);
  } else if ('approve' in payload) {
    update.status = update.approve ? 'approved' : 'pending';
  }

  if (payload.documents !== undefined) {
    update.documents = payload.documents;
  }

  if (payload.onboarding !== undefined) {
    update.onboarding = payload.onboarding;
  }

  const driver = await Driver.findByIdAndUpdate(id, update, { returnDocument: 'after' });
  if (!driver) throw new ApiError(404, 'Driver not found');
  return serializeDriver(driver);
};

export const updateDriverPassword = async (id, password) => {
  if (!password || String(password).length < 4) {
    throw new ApiError(400, 'Password must be at least 4 characters');
  }
  const driver = await Driver.findByIdAndUpdate(
    id,
    {
      password: await hashPassword(password),
      password_last_updated_at: new Date(),
    },
    { returnDocument: 'after' },
  );

  if (!driver) throw new ApiError(404, 'Driver not found');
  return serializeDriver(driver);
};

export const deleteDriver = async (id) => {
  const deleted = await Driver.findByIdAndDelete(id);
  if (!deleted) {
    throw new ApiError(404, 'Driver not found');
  }
  return true;
};

export const getDriverById = async (id, currentAdmin = null) => {
  const driver = await Driver.findById(id).lean();
  if (!driver) {
    throw new ApiError(404, 'Driver not found');
  }
  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'drivers.view', 'drivers');
    // assertServiceLocationAccess(currentAdmin, driver.service_location_id);
  }
  return serializeDriver(driver);
};

export const getDriverProfile = async (id) => {
  const driver = await Driver.findById(id).lean();
  if (!driver) {
    throw new ApiError(404, 'Driver not found');
  }

  const [rides, walletTransactions] = await Promise.all([
    Ride.find({ driverId: driver._id }).sort({ createdAt: -1 }).lean(),
    WalletTransaction.find({ driverId: driver._id }).sort({ createdAt: -1 }).lean(),
  ]);
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const isCompleted = (ride) => String(ride.status || '').toLowerCase() === 'completed';
  const isCancelled = (ride) => String(ride.status || '').toLowerCase() === 'cancelled';
  const isOngoing = (ride) => !isCompleted(ride) && !isCancelled(ride);

  const completedRides = rides.filter(isCompleted);
  const cancelledRides = rides.filter(isCancelled);
  const ongoingRides = rides.filter(isOngoing);
  const todayRides = rides.filter((ride) => ride.createdAt && ride.createdAt >= startOfDay);
  const todayCompleted = completedRides.filter((ride) =>
    (ride.completedAt || ride.createdAt) >= startOfDay
  );
  const todayCancelled = cancelledRides.filter((ride) =>
    (ride.completedAt || ride.createdAt) >= startOfDay
  );

  const sum = (items, field) =>
    items.reduce((total, item) => total + Number(item?.[field] || 0), 0);

  const totalEarnings = sum(completedRides, 'fare');
  const todayEarnings = sum(todayCompleted, 'fare');
  const driverEarnings = completedRides.reduce((total, ride) => {
    const fare = Number(ride?.fare || 0);
    const commission = Number(ride?.commissionAmount || 0);
    const earning = Number(ride?.driverEarnings ?? Math.max(fare - commission, 0));
    return total + earning;
  }, 0);
  const adminCommission = completedRides.reduce((total, ride) => {
    const fare = Number(ride?.fare || 0);
    const explicitCommission = ride?.commissionAmount;
    const fallbackCommission = Math.max(fare - Number(ride?.driverEarnings || 0), 0);
    return total + Number(explicitCommission ?? fallbackCommission);
  }, 0);
  const byCash = sum(completedRides.filter((r) => r.paymentMethod === 'cash'), 'fare');
  const byCard = sum(completedRides.filter((r) => r.paymentMethod === 'online'), 'fare');
  const spendAmount = walletTransactions.reduce((total, item) => {
    const amount = Number(item?.amount || 0);
    return amount < 0 ? total + Math.abs(amount) : total;
  }, 0);
  const creditAmount = walletTransactions.reduce((total, item) => {
    const amount = Number(item?.amount || 0);
    return amount > 0 ? total + amount : total;
  }, 0);
  const balanceAmount = Number(driver?.wallet?.balance || 0);
  const cashLimit = Number(driver?.wallet?.cashLimit ?? 500);
  const isWalletBlocked = Boolean(driver?.wallet?.isBlocked);

  const driverLocation = driver.location?.coordinates || [];
  const lastRideLocation = rides.find((ride) => Array.isArray(ride.lastDriverLocation?.coordinates));
  const coordinates = driverLocation.length === 2 ? driverLocation : (lastRideLocation?.lastDriverLocation?.coordinates || []);

  const [lng, lat] = coordinates;
  const hasValidLocation = Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);

  return {
    ...serializeDriver(driver),
    joined_at: driver.createdAt ? new Date(driver.createdAt).toLocaleString('en-IN') : 'N/A',
    vehicle: {
      type: driver.vehicleType || driver.registerFor || '',
      make: driver.vehicleMake || '',
      model: driver.vehicleModel || '',
      color: driver.vehicleColor || '',
      number: driver.vehicleNumber || '',
    },
    image: driver.profile_image || driver.avatar || '',
    vehicle_image: driver.vehicleImage || 'https://img.freepik.com/free-vector/yellow-passenger-transport-taxi-car_1017-4886.jpg',
    stats: {
      total_trips: rides.length,
      completed_trips: completedRides.length,
      cancelled_trips: cancelledRides.length,
      ongoing_trips: ongoingRides.length,
      today_trips: todayRides.length,
      today_cancelled: todayCancelled.length,
    },
    earnings: {
      today_earnings: Number(todayEarnings.toFixed(2)),
      total_earnings: Number(totalEarnings.toFixed(2)),
      driver_earnings: Number(driverEarnings.toFixed(2)),
      admin_commission: Number(adminCommission.toFixed(2)),
      by_cash: Number(byCash.toFixed(2)),
      by_wallet: 0,
      by_card: Number(byCard.toFixed(2)),
      spend_amount: Number(spendAmount.toFixed(2)),
      balance_amount: Number(balanceAmount.toFixed(2)),
    },
    wallet: {
      balance: Number(balanceAmount.toFixed(2)),
      cash_limit: Number(cashLimit.toFixed(2)),
      is_blocked: isWalletBlocked,
      total_credits: Number(creditAmount.toFixed(2)),
      total_debits: Number(spendAmount.toFixed(2)),
      transaction_count: walletTransactions.length,
    },
    location: hasValidLocation ? { lat, lng } : null,
  };
};

export const getSubscriptionSettings = async () => {
  const setting = await AdminBusinessSetting.findOne({ scope: 'default' }).lean();
  return setting?.subscription || { mode: 'commissionOnly' };
};

export const updateSubscriptionSettings = async (payload) => {
  const { mode } = payload;
  if (!['commissionOnly', 'subscriptionOnly', 'both'].includes(mode)) {
    throw new ApiError(400, 'Invalid subscription mode');
  }

  const setting = await AdminBusinessSetting.findOneAndUpdate(
    { scope: 'default' },
    { $set: { 'subscription.mode': mode } },
    { returnDocument: 'after', upsert: true },
  );

  return setting.subscription;
};

export const getReferralSettings = async (type) => {
  const setting = await AdminBusinessSetting.findOne({ scope: 'default' }).lean();
  const referral = setting?.referral || { driver: { enabled: false, type: 'instant_referrer', amount: 0 }, user: { enabled: false, type: 'instant_referrer', amount: 0 } };
  return type ? referral[type] : referral;
};

const sanitizeReferralMilestones = (items = []) =>
  (Array.isArray(items) ? items : [])
    .map((item, index) => ({
      id: String(item?.id || `milestone_${index + 1}`).trim(),
      name: String(item?.name || `Milestone ${index + 1}`).trim(),
      enabled: Boolean(item?.enabled ?? true),
      active_hours_per_day: Math.max(0, Number(item?.active_hours_per_day ?? 0) || 0),
      required_weeks: Math.max(0, Number(item?.required_weeks ?? 0) || 0),
      min_trips_per_week: Math.max(0, Number(item?.min_trips_per_week ?? 0) || 0),
      payout_amount: Math.max(0, Number(item?.payout_amount ?? 0) || 0),
      notes: String(item?.notes || '').trim(),
    }))
    .filter((item) => item.name);

const sanitizeReferralRewardFeatures = (items = []) =>
  (Array.isArray(items) ? items : [])
    .map((item, index) => ({
      id: String(item?.id || `feature_${index + 1}`).trim(),
      key: String(item?.key || `feature_${index + 1}`).trim(),
      label: String(item?.label || `Feature ${index + 1}`).trim(),
      enabled: Boolean(item?.enabled ?? false),
      reward_amount: Math.max(0, Number(item?.reward_amount ?? 0) || 0),
      target_value: Math.max(0, Number(item?.target_value ?? 0) || 0),
      unit: String(item?.unit || '').trim(),
      description: String(item?.description || '').trim(),
    }))
    .filter((item) => item.label);

export const updateReferralSettings = async (type, payload) => {
  const updateKey = `referral.${type}`;
  
  // Sanitize data
  const updateData = {
    ...payload,
    enabled: Boolean(payload.enabled),
    amount: Number(payload.amount || 0),
  };

  if (payload.ride_count !== undefined) {
    updateData.ride_count = Math.max(0, Number(payload.ride_count || 0) || 0);
  }

  if (type === 'driver') {
    updateData.milestone_program_enabled = Boolean(payload.milestone_program_enabled);
    updateData.milestone_programs = sanitizeReferralMilestones(payload.milestone_programs);
    updateData.reward_features = sanitizeReferralRewardFeatures(payload.reward_features);
  }

  const setting = await AdminBusinessSetting.findOneAndUpdate(
    { scope: 'default' },
    { $set: { [updateKey]: updateData } },
    { returnDocument: 'after', upsert: true },
  );

  return setting.referral[type];
};

export const getReferralDashboard = async () => {
  const [totalDrivers, totalUsers] = await Promise.all([
    Driver.countDocuments(),
    User.countDocuments(),
  ]);

  // Mocking some parts for the dashboard view
  return {
    total_drivers: totalDrivers,
    total_users: totalUsers,
    active_referrals: 0,
    referral_earning: 0,
    user_referrals: {
      normal_user: totalUsers,
      referral_user: 0,
      monthly: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    },
    driver_referrals: {
      normal_driver: totalDrivers,
      referral_driver: 0,
      monthly: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    }
  };
};

export const listSubscriptionPlans = async () =>
  SubscriptionPlan.find({ audience: 'driver' }).sort({ createdAt: -1 }).populate('vehicle_type_id').lean();
export const createSubscriptionPlan = async (payload) => {
  if (!String(payload?.name || '').trim()) {
    throw new ApiError(400, 'Subscription name is required');
  }

  const plan = await SubscriptionPlan.create({
    ...payload,
    audience: 'driver',
    amount: Number(payload.amount || 0),
    duration: Number(payload.duration || 0),
    benefit_type: 'standard',
    ride_limit: 0,
    active: true,
  });
  return plan.toObject();
};

export const listCustomerSubscriptionPlans = async () =>
  SubscriptionPlan.find({ audience: 'user' }).sort({ createdAt: -1 }).populate('vehicle_type_id').lean();

export const createCustomerSubscriptionPlan = async (payload = {}) => {
  if (!String(payload?.name || '').trim()) {
    throw new ApiError(400, 'Subscription name is required');
  }
  if (!payload?.vehicle_type_id || !mongoose.Types.ObjectId.isValid(payload.vehicle_type_id)) {
    throw new ApiError(400, 'Valid vehicle type is required');
  }

  const benefitType = String(payload.benefit_type || '').trim().toLowerCase() === 'unlimited'
    ? 'unlimited'
    : 'limited';

  const plan = await SubscriptionPlan.create({
    ...payload,
    audience: 'user',
    amount: Number(payload.amount || 0),
    duration: Math.max(1, Number(payload.duration || 0)),
    benefit_type: benefitType,
    ride_limit: benefitType === 'unlimited' ? 0 : Math.max(1, Number(payload.ride_limit || 0)),
    active: payload.active !== undefined ? Boolean(payload.active) : true,
  });
  return plan.toObject();
};

export const listUserSubscriptionsByUserId = async (userId) => {
  const user = await User.findById(userId).lean();

  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  const items = await UserSubscription.find({ userId })
    .sort({ active: -1, expiresAt: 1, createdAt: -1 })
    .populate('planId', 'name description')
    .populate('vehicle_type_id', 'name')
    .lean();

  return {
    results: items.map((item) => ({
      id: String(item._id),
      planId: item.planId?._id ? String(item.planId._id) : String(item.planId || ''),
      name: item.name || item.planId?.name || '',
      description: item.description || item.planId?.description || '',
      amount: Number(item.amount || 0),
      durationDays: Number(item.durationDays || 0),
      transport_type: item.transport_type || 'taxi',
      benefit_type: item.benefit_type || 'limited',
      ride_limit: Number(item.ride_limit || 0),
      rides_used: Number(item.rides_used || 0),
      rides_remaining: String(item.benefit_type || '') === 'unlimited'
        ? null
        : Math.max(0, Number(item.ride_limit || 0) - Number(item.rides_used || 0)),
      status: item.status || 'active',
      active: item.active !== false,
      vehicle_type: item.vehicle_type_id?._id
        ? {
            id: String(item.vehicle_type_id._id),
            name: item.vehicle_type_id.name || '',
          }
        : null,
      purchasedAt: item.purchasedAt || null,
      expiresAt: item.expiresAt || null,
      createdAt: item.createdAt || null,
    })),
  };
};

export const listServiceLocations = async (currentAdmin = null) => {
  await ensureServiceLocationsSeeded();
  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'service_locations.view', 'service locations');
  }
  const query = currentAdmin ? buildServiceLocationScopeQuery(currentAdmin) : {};
  return ServiceLocation.find(query).sort({ createdAt: -1 }).lean();
};

export const seedCountries = async () => {
  const defaults = [
    { name: 'India', code: 'IN' },
    { name: 'United Arab Emirates', code: 'AE' },
    { name: 'United Kingdom', code: 'GB' },
    { name: 'United States', code: 'US' }
  ];
  const results = [];
  for (const item of defaults) {
    const existing = await Country.findOne({ name: item.name });
    if (!existing) {
      results.push(await Country.create(item));
    } else {
      results.push(existing);
    }
  }
  return results;
};

export const listCountries = async () => {
  let list = await Country.find({ active: true }).lean();
  if (list.length === 0) {
    await seedCountries();
    list = await Country.find({ active: true }).lean();
  }
  
  const locations = await listServiceLocations();
  const locationCountryNames = [...new Set(
    locations
      .map((item) => (typeof item.country === 'object' ? item.country?.name : item.country))
      .filter(Boolean)
      .map((name) => String(name).trim()),
  )];

  for (const name of locationCountryNames) {
    const matched = list.some((item) => item.name?.toLowerCase() === name.toLowerCase());
    if (!matched) {
      const code = name.slice(0, 2).toUpperCase();
      let dbCountry = await Country.findOne({ name });
      if (!dbCountry) {
        dbCountry = await Country.create({ name, code });
      }
      list.push(dbCountry.toObject ? dbCountry.toObject() : dbCountry);
    }
  }

  return list;
};

export const createServiceLocation = async (payload, currentAdmin = null) => {
  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'service_locations.view', 'service locations');
    if (!isSuperAdmin(currentAdmin)) {
      throw new ApiError(403, 'Only the superadmin can create service locations');
    }
  }

  if (!payload.name?.trim()) {
    throw new ApiError(400, 'Service location name is required');
  }

  await ensureServiceLocationsSeeded();
  const persistedLocation = await ServiceLocation.create(normalizeServiceLocationPayload(payload));
  return persistedLocation.toObject();

  const location = {
    _id: nextId(),
    name: payload.name.trim(),
    service_location_name: payload.name.trim(),
    address: payload.address || '',
    country: payload.country || 'India',
    currency_name: payload.currency_name || 'Indian Rupee',
    currency_symbol: payload.currency_symbol || '₹',
    currency_code: payload.currency_code || 'INR',
    timezone: payload.timezone || 'Asia/Kolkata',
    unit: payload.unit || 'km',
    latitude: Number(payload.latitude || 22.7196),
    longitude: Number(payload.longitude || 75.8577),
    status: payload.status || 'active',
    active: payload.status ? payload.status === 'active' : true,
    createdAt: new Date(),
  };

  state.serviceLocations.unshift(location);
  await state.save();
  return location;
};

export const updateServiceLocation = async (id, payload, currentAdmin = null) => {
  await ensureServiceLocationsSeeded();
  const persistedLocation = await ServiceLocation.findById(id);
  if (!persistedLocation) {
    throw new ApiError(404, 'Service location not found');
  }
  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'service_locations.view', 'service locations');
    assertServiceLocationAccess(currentAdmin, persistedLocation._id);
  }
  Object.assign(persistedLocation, normalizeServiceLocationPayload(payload, persistedLocation.toObject()));
  await persistedLocation.save();
  return persistedLocation.toObject();

  const state = await ensureAdminState();
  const location = findById(state.serviceLocations, id);

  if (!location) {
    throw new ApiError(404, 'Service location not found');
  }

  Object.assign(location, payload, {
    name: payload.name?.trim() || location.name,
    service_location_name: payload.name?.trim() || location.service_location_name,
    latitude: payload.latitude !== undefined ? Number(payload.latitude) : location.latitude,
    longitude: payload.longitude !== undefined ? Number(payload.longitude) : location.longitude,
    active: payload.status !== undefined ? payload.status === 'active' : location.active,
    status: payload.status || location.status,
  });

  await state.save();
  return location;
};

export const deleteServiceLocation = async (id, currentAdmin = null) => {
  await ensureServiceLocationsSeeded();
  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'service_locations.view', 'service locations');
    assertServiceLocationAccess(currentAdmin, id);
  }
  const deleted = await ServiceLocation.findByIdAndDelete(id);
  if (!deleted) {
    throw new ApiError(404, 'Service location not found');
  }
  return true;

  const state = await ensureAdminState();
  state.serviceLocations = removeById(state.serviceLocations, id);
  await state.save();
  return true;
};

export const listNearbyServiceLocations = async ({ latitude, longitude, maxDistance = 50000, limit = 20 }) => {
  await ensureServiceLocationsSeeded();

  const lat = Number(latitude);
  const lng = Number(longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new ApiError(400, 'Valid latitude and longitude are required');
  }

  return ServiceLocation.find({
    location: {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [lng, lat],
        },
        $maxDistance: Number(maxDistance),
      },
    },
  })
    .limit(Number(limit) || 20)
    .lean();
};

export const listRideModules = async () => RideModule.find().sort({ createdAt: -1 }).lean();

const formatRidePointLabel = (point, fallback = 'Unknown') => {
  const [lng, lat] = point?.coordinates || [];

  if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
    return `${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}`;
  }

  return fallback;
};

const toAdminRideRow = (ride) => {
  const requestCode = `REQ_${String(ride._id).slice(-12).toUpperCase()}`;
  const status = String(ride.status || '').toLowerCase();
  const liveStatus = String(ride.liveStatus || '').toLowerCase();

  let tripStatus = 'UPCOMING';
  if (status === RIDE_STATUS.COMPLETED) {
    tripStatus = 'COMPLETED';
  } else if (status === RIDE_STATUS.CANCELLED) {
    tripStatus = 'CANCELLED';
  } else if (status === RIDE_STATUS.ONGOING || liveStatus === RIDE_LIVE_STATUS.STARTED) {
    tripStatus = 'ONGOING';
  } else if (status === RIDE_STATUS.ACCEPTED || liveStatus === RIDE_LIVE_STATUS.ACCEPTED || liveStatus === RIDE_LIVE_STATUS.ARRIVING) {
    tripStatus = 'ACCEPTED';
  }

  return {
    id: String(ride._id),
    requestId: requestCode,
    date: ride.createdAt,
    userName: ride.userId?.name || 'Unknown User',
    driverName: ride.driverId?.name || 'Unassigned',
    transportType: ride.driverId?.vehicleType || ride.vehicleIconType || 'Taxi',
    tripStatus,
    rideStatus: ride.status,
    liveStatus: ride.liveStatus,
    paymentOption: 'CASH',
    fare: Number(ride.fare || 0),
    baseFare: Number(ride.baseFare || ride.fare || 0),
    waitingChargeAmount: Number(ride.waitingChargeAmount || 0),
    distanceChargeAmount: Number(ride.distanceChargeAmount || 0),
    timeChargeAmount: Number(ride.timeChargeAmount || 0),
    pickupLabel: formatRidePointLabel(ride.pickupLocation, 'Pickup'),
    dropLabel: formatRidePointLabel(ride.dropLocation, 'Drop'),
    pickupLocation: ride.pickupLocation,
    dropLocation: ride.dropLocation,
    lastDriverLocation: ride.lastDriverLocation || null,
    user: ride.userId ? {
      id: String(ride.userId._id),
      name: ride.userId.name || '',
      phone: ride.userId.phone || '',
    } : null,
    driver: ride.driverId ? {
      id: String(ride.driverId._id),
      name: ride.driverId.name || '',
      phone: ride.driverId.phone || '',
      vehicleType: ride.driverId.vehicleType || '',
      vehicleNumber: ride.driverId.vehicleNumber || '',
    } : null,
    cancelled_by: ride.cancelled_by || '',
    cancellation_reason: ride.cancellation_reason || '',
    cancellation_charge: Number(ride.cancellation_charge || 0),
    cancellation_status: ride.cancellation_status || 'none',
    pending_cancellation_due: Number(ride.pending_cancellation_due || 0),
    recovery_status: ride.recovery_status || 'none',
    recovered_in_ride: ride.recovered_in_ride ? String(ride.recovered_in_ride) : null,
    recovered_at: ride.recovered_at || null,
    cancellation_time: ride.cancellation_time || null,
    recovered_cancellation_due: Number(ride.recovered_cancellation_due || 0),
  };
};

const toAdminIntercityTripRow = (ride) => {
  const requestCode = `INT_${String(ride._id).slice(-12).toUpperCase()}`;
  const status = String(ride.status || '').toLowerCase();
  const liveStatus = String(ride.liveStatus || '').toLowerCase();
  const intercity = ride.intercity || {};

  let tripStatus = 'UPCOMING';
  if (status === RIDE_STATUS.COMPLETED) {
    tripStatus = 'COMPLETED';
  } else if (status === RIDE_STATUS.CANCELLED) {
    tripStatus = 'CANCELLED';
  } else if (
    status === RIDE_STATUS.ONGOING ||
    liveStatus === RIDE_LIVE_STATUS.STARTED ||
    liveStatus === RIDE_LIVE_STATUS.ARRIVED
  ) {
    tripStatus = 'ON_TRIP';
  }

  const fromCity = String(intercity.fromCity || '').trim();
  const toCity = String(intercity.toCity || '').trim();

  return {
    id: String(ride._id),
    requestId: requestCode,
    date: ride.createdAt,
    userName: ride.userId?.name || 'Unknown User',
    driverName: ride.driverId?.name || 'Unassigned',
    transportType: intercity.vehicleName || ride.driverId?.vehicleType || ride.vehicleIconType || 'Intercity',
    tripStatus,
    rideStatus: ride.status,
    liveStatus: ride.liveStatus,
    paymentOption: String(ride.paymentMethod || 'cash').toUpperCase(),
    fare: Number(ride.fare || 0),
    pickupLabel: ride.pickupAddress || formatRidePointLabel(ride.pickupLocation, 'Pickup'),
    dropLabel: ride.dropAddress || formatRidePointLabel(ride.dropLocation, 'Drop'),
    routeLabel: [fromCity, toCity].filter(Boolean).join(' -> '),
    tripType: intercity.tripType || '',
    travelDate: intercity.travelDate || '',
    cancelled_by: ride.cancelled_by || '',
    cancellation_reason: ride.cancellation_reason || '',
    cancellation_charge: Number(ride.cancellation_charge || 0),
    cancellation_status: ride.cancellation_status || 'none',
    pending_cancellation_due: Number(ride.pending_cancellation_due || 0),
    recovery_status: ride.recovery_status || 'none',
    recovered_in_ride: ride.recovered_in_ride ? String(ride.recovered_in_ride) : null,
    recovered_at: ride.recovered_at || null,
    cancellation_time: ride.cancellation_time || null,
    recovered_cancellation_due: Number(ride.recovered_cancellation_due || 0),
  };
};





export const listOngoingRides = async (query = {}) => {
  const page = Number(query.page || 1);
  const limit = Number(query.limit || 10);
  const tab = String(query.tab || 'all').toLowerCase();
  const search = String(query.search || '').trim().toLowerCase();

  const rides = await Ride.find({
    status: { $in: [RIDE_STATUS.SEARCHING, RIDE_STATUS.ACCEPTED, RIDE_STATUS.ONGOING] },
  })
    .sort({ createdAt: -1 })
    .populate('userId', 'name phone')
    .populate('driverId', 'name phone vehicleType vehicleNumber')
    .lean();

  let rows = rides.map(toAdminRideRow);

  if (tab === 'accepted') {
    rows = rows.filter((row) => row.tripStatus === 'ACCEPTED');
  } else if (tab === 'upcoming') {
    rows = rows.filter((row) => row.tripStatus === 'UPCOMING');
  } else if (tab === 'ongoing') {
    rows = rows.filter((row) => row.tripStatus === 'ONGOING');
  }

  if (search) {
    rows = rows.filter((row) =>
      [
        row.requestId,
        row.userName,
        row.driverName,
        row.transportType,
        row.pickupLabel,
        row.dropLabel,
      ].some((value) => String(value || '').toLowerCase().includes(search)),
    );
  }

  return buildPaginator(rows, page, limit);
};

export const listRideRequests = async (query = {}) => {
  const page = Number(query.page || 1);
  const limit = Number(query.limit || 10);
  const tab = String(query.tab || 'all').toLowerCase();
  const search = String(query.search || '').trim().toLowerCase();

  // Old parcel trips (parcel delivery was removed) are listed with the rides.
  const rides = await Ride.find({
    serviceType: { $ne: 'intercity' },
    adminHiddenAt: null,
  })
    .sort({ createdAt: -1 })
    .populate('userId', 'name phone')
    .populate('driverId', 'name phone vehicleType vehicleNumber')
    .lean();

  let rows = rides.map(toAdminRideRow);

  if (tab === 'completed') {
    rows = rows.filter((row) => row.tripStatus === 'COMPLETED');
  } else if (tab === 'cancelled') {
    rows = rows.filter((row) => row.tripStatus === 'CANCELLED');
  } else if (tab === 'upcoming') {
    rows = rows.filter((row) => row.tripStatus === 'UPCOMING');
  } else if (tab === 'on trip' || tab === 'on_trip' || tab === 'ongoing') {
    rows = rows.filter((row) => row.tripStatus === 'ACCEPTED' || row.tripStatus === 'ONGOING');
  }

  if (search) {
    rows = rows.filter((row) =>
      [
        row.requestId,
        row.userName,
        row.driverName,
        row.transportType,
        row.pickupLabel,
        row.dropLabel,
      ].some((value) => String(value || '').toLowerCase().includes(search)),
    );
  }

  return buildPaginator(rows, page, limit);
};

export const listIntercityTrips = async (query = {}) => {
  const page = Number(query.page || 1);
  const limit = Number(query.limit || 10);
  const tab = String(query.tab || 'all').toLowerCase();
  const search = String(query.search || '').trim().toLowerCase();

  const rides = await Ride.find({ serviceType: 'intercity' })
    .sort({ createdAt: -1 })
    .populate('userId', 'name phone')
    .populate('driverId', 'name phone vehicleType vehicleNumber')
    .lean();

  let rows = rides.map(toAdminIntercityTripRow);

  if (tab === 'completed') {
    rows = rows.filter((row) => row.tripStatus === 'COMPLETED');
  } else if (tab === 'cancelled') {
    rows = rows.filter((row) => row.tripStatus === 'CANCELLED');
  } else if (tab === 'upcoming') {
    rows = rows.filter((row) => row.tripStatus === 'UPCOMING');
  } else if (tab === 'on trip' || tab === 'on_trip' || tab === 'ongoing') {
    rows = rows.filter((row) => row.tripStatus === 'ON_TRIP');
  }

  if (search) {
    rows = rows.filter((row) =>
      [
        row.requestId,
        row.userName,
        row.driverName,
        row.transportType,
        row.pickupLabel,
        row.dropLabel,
        row.routeLabel,
        row.tripType,
        row.travelDate,
      ].some((value) => String(value || '').toLowerCase().includes(search)),
    );
  }

  return buildPaginator(rows, page, limit);
};

/**
 * Delete a trip from the admin trips list.
 *
 * A ride still searching or under way is cancelled first (the same admin cancel
 * the ongoing-rides screen uses, which releases the driver). Then the ride is
 * hidden from the list; it stays in the database because the driver's earnings,
 * payments and reports refer to it.
 */
export const removeRideFromTrips = async (rideId, adminId = '') => {
  if (!mongoose.Types.ObjectId.isValid(String(rideId))) {
    throw new ApiError(400, 'Invalid ride id');
  }
  const ride = await Ride.findById(rideId).select('status adminHiddenAt').lean();
  if (!ride || ride.adminHiddenAt) throw new ApiError(404, 'Ride not found');
  const live = ['searching', 'accepted', 'ongoing', 'arriving', 'started', 'arrived']
    .includes(String(ride.status || '').toLowerCase());
  if (live) await cancelRideByAdmin(rideId);
  await Ride.updateOne(
    { _id: rideId, adminHiddenAt: null },
    { $set: { adminHiddenAt: new Date(), adminHiddenBy: String(adminId || '') } },
  );
  return { id: String(rideId), deleted: true, cancelledFirst: live };
};

export const deleteOngoingRide = async (rideId) => {
  if (!mongoose.Types.ObjectId.isValid(String(rideId))) {
    throw new ApiError(400, 'Invalid ride id');
  }

  const deletedRide = await cancelRideByAdmin(rideId);

  if (!deletedRide) {
    throw new ApiError(404, 'Ride not found');
  }

  return {
    id: String(deletedRide._id),
    deleted: true,
    status: deletedRide.status,
    liveStatus: deletedRide.liveStatus,
  };
};

export const listVehicleTypes = async (queryParams = {}) => {
  const query = {};
  if (queryParams.transport_type) {
    const normalizedTransportType = normalizeVehicleTransportType(queryParams.transport_type);
    query.transport_type = normalizedTransportType === 'both'
      ? 'both'
      : { $in: [normalizedTransportType, 'both'] };
  }
  const items = await Vehicle.find(query).sort({ createdAt: -1 }).lean();
  const results = items.map((item) => ({
    ...item,
    icon: item.map_icon || item.icon || item.image || '',
    map_icon: item.map_icon || item.icon || item.image || '',
    delivery_category: item.delivery_category || '',
    ride_surge_amount: Number(item.ride_surge_amount || 0),
    delivery_distance_pricing: normalizeDeliveryDistancePricing(item.delivery_distance_pricing),
  }));

  return {
    results,
    paginator: {
      data: results,
      total: results.length,
      current_page: 1,
      last_page: 1,
      per_page: results.length,
      from: 1,
      to: results.length
    }
  };
};


export const listVehicleCatalog = async () => {
  const items = await Vehicle.find().sort({ createdAt: -1 }).lean();

  const results = items.map((item) => ({
    ...item,
    id: String(item._id),
    icon: item.map_icon || item.icon || item.image || '',
    map_icon: item.map_icon || item.icon || item.image || '',
    delivery_category: item.delivery_category || '',
    ride_surge_amount: Number(item.ride_surge_amount || 0),
    delivery_distance_pricing: normalizeDeliveryDistancePricing(item.delivery_distance_pricing),
    // Sent as an array of id strings so the form can re-tick the boxes.
    // Without this the saved value never came back and the picker looked
    // empty again on every refresh.
    app_modules: Array.isArray(item.app_modules)
      ? item.app_modules.map((v) => String(v))
      : [],
    supported_vehicles: Array.isArray(item.supported_other_vehicle_types)
      ? item.supported_other_vehicle_types.map((v) => String(v)).join(',')
      : '',
    icon_types_for: item.icon_types,
    trip_dispatch_type: item.dispatch_type,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  }));

  return {
    results,
    paginator: {
      data: results,
      total: results.length,
      current_page: 1,
      last_page: 1,
      per_page: 10,
      from: 1,
      to: results.length,
    }
  };
};

/**
 * The vehicle types a module offers, or the whole catalogue.
 *
 * A vehicle with no modules set is offered under all of them, so an
 * unconfigured platform behaves exactly as it did before this existed.
 */
/**
 * The vehicles an admin has actually priced in one zone.
 *
 * Includes rows with no zone of their own, which price the vehicle
 * everywhere. Returns null when the zone is unknown, meaning "do not filter".
 */
const vehicleIdsPricedInZone = async (zoneId) => {
  if (!zoneId || !mongoose.Types.ObjectId.isValid(String(zoneId))) return null;

  const rows = await SetPrice.find({
    $or: [
      { zone_id: new mongoose.Types.ObjectId(String(zoneId)) },
      { zone_id: null },
      { zone_id: { $exists: false } },
    ],
    // Only a live rule counts. A switched-off price is the admin saying the
    // vehicle is not on offer, which is exactly what this reads.
    $and: [
      { $or: [{ status: 'active' }, { status: { $exists: false } }] },
      { $or: [{ active: 1 }, { active: true }, { active: { $exists: false } }] },
    ],
  })
    .select('vehicle_type')
    .lean();

  return new Set(rows.map((row) => String(row.vehicle_type)).filter(Boolean));
};

export const listPublicVehicleCatalog = async (appModuleId = null, { zoneId = null } = {}) => {
  // The zone is part of the key: one shared slot would let the first zone
  // asked answer for every other one, which is the same bug the per-module
  // key already fixed once.
  const moduleKey = String(appModuleId || 'all') + '|' + String(zoneId || 'any');
  // Keyed per module: one shared slot would let the first module asked
  // answer for every other one.
  const cached = publicVehicleCatalogCache.byModule?.[moduleKey];
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  // Empty app_modules means every module, so a module asks for its own
  // vehicles OR the ones that belong to all of them.
  const filter = appModuleId
    ? {
        $or: [
          { app_modules: appModuleId },
          { app_modules: { $size: 0 } },
          { app_modules: { $exists: false } },
        ],
      }
    : {};

  const items = await Vehicle.find(filter)
    .select('name short_description description transport_type dispatch_type icon_types delivery_category delivery_distance_pricing capacity ride_surge_amount image icon map_icon status active app_modules bid_step_amount bid_step_count bid_max_increase')
    .sort({ createdAt: -1 })
    .lean();

  // Priced in this zone, or not offered in it. Null means the zone could
  // not be worked out, and then nothing is filtered.
  const priced = await vehicleIdsPricedInZone(zoneId);
  const offered = priced ? items.filter((item) => priced.has(String(item._id))) : items;

  const results = offered.map((item) => ({
    id: String(item._id),
    _id: item._id,
    name: item.name || '',
    short_description: item.short_description || '',
    description: item.description || '',
    transport_type: item.transport_type || 'taxi',
    dispatch_type: item.dispatch_type || 'normal',
    icon_types: item.icon_types || 'car',
    delivery_category: item.delivery_category || '',
    delivery_distance_pricing: normalizeDeliveryDistancePricing(item.delivery_distance_pricing),
    capacity: Number(item.capacity || 0),
    ride_surge_amount: Number(item.ride_surge_amount || 0),
    // What a waiting rider may add, and how far they may go. Sent on every
    // vehicle so the app can build the buttons without a second request once
    // the ride is already searching.
    bidding_enabled: ['bidding', 'both'].includes(String(item.dispatch_type || 'normal')),
    bidStepAmount: Number(item.bid_step_amount || 10),
    bidStepCount: Number(item.bid_step_count || 4),
    bidMaxIncrease:
      Number(item.bid_max_increase || 0) > 0
        ? Number(item.bid_max_increase)
        : Number(item.bid_step_amount || 10) * Number(item.bid_step_count || 4),
    image: item.image || '',
    map_icon: item.map_icon || item.icon || item.image || '',
    status: item.status ?? 1,
    active: item.active !== false && Number(item.status ?? 1) !== 0,
    // Sent so the admin panel can show what is ticked without a second
    // request, and so a client can explain why a list is short.
    app_modules: (item.app_modules || []).map(String),
  }));

  const payload = {
    results,
    paginator: {
      data: results,
      total: results.length,
      current_page: 1,
      last_page: 1,
      per_page: results.length,
      from: results.length ? 1 : 0,
      to: results.length,
    },
  };

  publicVehicleCatalogCache.byModule = {
    ...(publicVehicleCatalogCache.byModule || {}),
    [moduleKey]: {
      value: payload,
      expiresAt: Date.now() + PUBLIC_VEHICLE_CATALOG_CACHE_TTL_MS,
    },
  };

  return payload;
};

export const listVehiclePreferences = async () => {
  return listPreferences();
};

/**
 * The bidding numbers an admin typed, or the defaults.
 *
 * Zero on the ceiling is meaningful: it means "step x count", which is what
 * the buttons already add up to, rather than "no boost allowed".
 */
const normalizeBidSettings = (payload = {}) => {
  const num = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };
  return {
    bid_step_amount: Math.max(1, num(payload.bid_step_amount, 10)),
    bid_step_count: Math.min(10, Math.max(1, num(payload.bid_step_count, 4))),
    bid_max_increase: num(payload.bid_max_increase, 0),
  };
};

export const createVehicleType = async (payload) => {
  if (!payload.name?.trim()) {
    throw new ApiError(400, 'Vehicle name is required');
  }

  if (!payload.transport_type?.trim()) {
    throw new ApiError(400, 'Transport type is required');
  }

  const mapIcon = payload.map_icon ?? payload.mapIcon ?? payload.icon ?? payload.image ?? '';
  const transportType = normalizeVehicleTransportType(payload.transport_type);

  const vehicle = await Vehicle.create({
    name: payload.name.trim(),
    short_description: payload.short_description ?? '',
    description: payload.description ?? '',
    transport_type: transportType,
    dispatch_type: payload.dispatch_type || 'normal',
    icon_types: payload.icon_types || 'car',
    capacity: Number(payload.capacity || 0),
    ride_surge_amount: Math.max(0, Number(payload.ride_surge_amount || 0)),
    size: payload.size ?? '',
    is_taxi: payload.is_taxi || transportType,
    is_accept_share_ride: Number(payload.is_accept_share_ride || 0) ? 1 : 0,
    delivery_category: ['delivery', 'both'].includes(transportType)
      ? normalizeDeliveryCategory(payload.delivery_category)
      : '',
    delivery_distance_pricing: ['delivery', 'both'].includes(transportType)
      ? normalizeDeliveryDistancePricing(payload.delivery_distance_pricing)
      : normalizeDeliveryDistancePricing(),
    image: payload.image ?? mapIcon,
    icon: mapIcon,
    map_icon: mapIcon,
    status: Number(payload.status ?? 1) ? 1 : 0,
    active: Number(payload.status ?? 1) === 1,
    ...normalizeBidSettings(payload),
    app_modules: Array.isArray(payload.app_modules)
      ? payload.app_modules.filter(Boolean).map(toObjectId)
      : [],
    supported_other_vehicle_types: Array.isArray(payload.supported_other_vehicle_types)
      ? payload.supported_other_vehicle_types.filter(Boolean).map(toObjectId)
      : [],
    vehicle_preference: Array.isArray(payload.vehicle_preference)
      ? payload.vehicle_preference.filter(Boolean).map(toObjectId)
      : [],
  });

  publicVehicleCatalogCache = { byModule: {} };

  return vehicle.toObject();
};

export const updateVehicleType = async (id, payload) => {
  const vehicle = await Vehicle.findById(id);
  if (!vehicle) {
    throw new ApiError(404, 'Vehicle type not found');
  }

  if (payload.name !== undefined) {
    vehicle.name = String(payload.name).trim();
  }
  if (payload.short_description !== undefined) {
    vehicle.short_description = payload.short_description ?? '';
  }
  if (payload.description !== undefined) {
    vehicle.description = payload.description ?? '';
  }
  if (payload.transport_type !== undefined) {
    vehicle.transport_type = normalizeVehicleTransportType(payload.transport_type);
  }
  if (payload.dispatch_type !== undefined) {
    vehicle.dispatch_type = payload.dispatch_type || 'normal';
  }
  if (payload.icon_types !== undefined) {
    vehicle.icon_types = payload.icon_types || 'car';
  }
  if (payload.image !== undefined) {
    vehicle.image = payload.image ?? '';
  }
  if (payload.icon !== undefined || payload.map_icon !== undefined || payload.mapIcon !== undefined || payload.image !== undefined) {
    const mapIcon = payload.map_icon ?? payload.mapIcon ?? payload.icon ?? payload.image ?? '';
    vehicle.icon = mapIcon;
    vehicle.map_icon = mapIcon;
  }
  if (payload.capacity !== undefined) {
    vehicle.capacity = Number(payload.capacity || 0);
  }
  if (payload.ride_surge_amount !== undefined) {
    vehicle.ride_surge_amount = Math.max(0, Number(payload.ride_surge_amount || 0));
  }
  if (payload.size !== undefined) {
    vehicle.size = payload.size ?? '';
  }
  if (payload.is_taxi !== undefined) {
    vehicle.is_taxi = payload.is_taxi || vehicle.transport_type;
  }
  if (payload.is_accept_share_ride !== undefined) {
    vehicle.is_accept_share_ride = Number(payload.is_accept_share_ride || 0) ? 1 : 0;
  }
  if (payload.delivery_category !== undefined || payload.transport_type !== undefined) {
    vehicle.delivery_category = ['delivery', 'both'].includes(vehicle.transport_type)
      ? normalizeDeliveryCategory(payload.delivery_category ?? vehicle.delivery_category)
      : '';
  }
  if (payload.delivery_distance_pricing !== undefined || payload.transport_type !== undefined) {
    vehicle.delivery_distance_pricing = ['delivery', 'both'].includes(vehicle.transport_type)
      ? normalizeDeliveryDistancePricing(payload.delivery_distance_pricing, vehicle.delivery_distance_pricing)
      : normalizeDeliveryDistancePricing();
  }
  if (payload.status !== undefined) {
    vehicle.status = Number(payload.status) ? 1 : 0;
    vehicle.active = vehicle.status === 1;
  }
  // Absent means "not sent, leave alone" -- the same rule the fields around
  // this one follow.
  for (const key of ['bid_step_amount', 'bid_step_count', 'bid_max_increase']) {
    if (payload[key] !== undefined) {
      const value = Number(payload[key]);
      if (Number.isFinite(value) && value >= 0) vehicle[key] = value;
    }
  }

  // An empty array is a real choice here ("offer under every module"), so
  // only an absent key means leave it alone.
  if (payload.app_modules !== undefined) {
    vehicle.app_modules = Array.isArray(payload.app_modules)
      ? payload.app_modules.filter(Boolean).map(toObjectId)
      : [];
  }
  if (payload.supported_other_vehicle_types !== undefined) {
    vehicle.supported_other_vehicle_types = Array.isArray(payload.supported_other_vehicle_types)
      ? payload.supported_other_vehicle_types.filter(Boolean).map(toObjectId)
      : [];
  }
  if (payload.vehicle_preference !== undefined) {
    vehicle.vehicle_preference = Array.isArray(payload.vehicle_preference)
      ? payload.vehicle_preference.filter(Boolean).map(toObjectId)
      : [];
  }

  await vehicle.save();
  publicVehicleCatalogCache = { byModule: {} };
  return vehicle.toObject();
};

export const deleteVehicleType = async (id) => {
  const deleted = await Vehicle.findByIdAndDelete(id);
  if (!deleted) {
    throw new ApiError(404, 'Vehicle type not found');
  }
  publicVehicleCatalogCache = { byModule: {} };
  return true;
};

export const listSetPrices = async (queryArgs = {}, currentAdmin = null) => {
  const scope = String(queryArgs.scope || '').trim();
  const query = scope ? { pricing_scope: scope } : {};

  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'set_prices.view', 'set prices');
    const scopedZoneIds = await getScopedZoneIds(currentAdmin);
    const { serviceLocationIds } = getAdminScope(currentAdmin);

    if (!isSuperAdmin(currentAdmin)) {
      query.$or = [];
      if (scopedZoneIds.length > 0) {
        query.$or.push({ zone_id: { $in: scopedZoneIds } });
      }
      if (serviceLocationIds.length > 0) {
        query.$or.push({ service_location_id: { $in: serviceLocationIds } });
      }
      if (query.$or.length === 0) {
        query._id = { $in: [] };
      }
    }
  }

  const items = await SetPrice.find(query)
    .populate('vehicle_type')
    .populate('service_location_id')
    .populate('package_type_id')
    .populate('package_vehicle_prices.vehicle_type')
    .populate({
      path: 'zone_id',
      populate: { path: 'service_location_id' }
    })
    .sort({ createdAt: -1 })
    .lean();

  const results = items.map((item) => {
    const vType = item.vehicle_type || {};
    const zone = item.zone_id || {};
    const sl = zone.service_location_id || {};
    const directServiceLocation = item.service_location_id || {};
    const effectiveServiceLocation = directServiceLocation._id ? directServiceLocation : sl;
    const packageType = item.package_type_id || {};

    return {
      id: String(item._id),
      pricing_scope: item.pricing_scope || 'ride',
      type_id: vType._id ? String(vType._id) : null,
      name: vType.name || '',
      icon: vType.icon || '',
      capacity: vType.capacity || item.capacity || 0,
      active: item.active || 0,
      currency: effectiveServiceLocation.currency_symbol || '?',
      unit: Number(zone.unit || 1),
      unit_in_words: 'Km',
      zone_name: zone.name || '',
      service_location_name: effectiveServiceLocation.name || effectiveServiceLocation.service_location_name || '',
      vehicle_type_name: vType.name || '',
      drop_zone_name: null,
      transport_type: item.transport_type || 'both',
      package_type_id: packageType._id ? String(packageType._id) : null,
      package_type_name: packageType.name || '',
      package_destination: item.package_destination || '',
      package_availability: item.package_availability || 'available',
      package_vehicle_prices: Array.isArray(item.package_vehicle_prices)
        ? item.package_vehicle_prices.map((price) => ({
            vehicle_type: price.vehicle_type?._id ? String(price.vehicle_type._id) : null,
            vehicle_type_name: price.vehicle_type?.name || '',
            base_price: Number(price.base_price ?? 0),
            free_distance: Number(price.free_distance ?? 0),
            distance_price: Number(price.distance_price ?? 0),
            free_time: Number(price.free_time ?? 0),
            time_price: Number(price.time_price ?? 0),
            active: Number(price.active ?? 1),
          }))
        : [],
      // Ride fare inputs. These are what the rider app's fare calculator
      // reads; they were present in the pre-merge public response and were
      // dropped from this mapping, leaving every fare blank in the app.
      base_price: Number(item.base_price ?? 0),
      base_distance: Number(item.base_distance ?? 0),
      price_per_distance: Number(item.price_per_distance ?? 0),
      time_price: Number(item.time_price ?? 0),
      waiting_charge: Number(item.waiting_charge ?? 0),
      free_waiting_before: Number(item.free_waiting_before ?? 0),
      free_waiting_after: Number(item.free_waiting_after ?? 0),
      service_tax: Number(item.service_tax ?? 0),
      outstation_base_price: Number(item.outstation_base_price ?? 0),
      outstation_base_distance: Number(item.outstation_base_distance ?? 0),
      outstation_price_per_distance: Number(item.outstation_price_per_distance ?? 0),
      outstation_time_price: Number(item.outstation_time_price ?? 0),
      payment_type: Array.isArray(item.payment_type)
        ? item.payment_type
        : (item.payment_type ? String(item.payment_type).split(',') : ['cash', 'online', 'wallet']),
    };
  });

  const paginatorData = items.map((item) => {
    const vType = item.vehicle_type || {};
    const zone = item.zone_id || {};
    const sl = zone.service_location_id || {};
    const directServiceLocation = item.service_location_id || {};
    const effectiveServiceLocation = directServiceLocation._id ? directServiceLocation : sl;
    const packageType = item.package_type_id || {};

    return {
      ...item,
      id: String(item._id),
      pricing_scope: item.pricing_scope || 'ride',
      vehicle_type_name: vType.name || '',
      icon: vType.icon || '',
      zone_name: zone.name || '',
      drop_zone_name: null,
      package_type_name: packageType.name || '',
      service_location_name: effectiveServiceLocation.name || effectiveServiceLocation.service_location_name || '',
      vehicle_type: vType
        ? {
            ...vType,
            id: String(vType._id),
            icon_types_for: vType.icon_types,
            trip_dispatch_type: vType.dispatch_type,
          }
        : null,
      service_location: effectiveServiceLocation
        ? {
            ...effectiveServiceLocation,
            id: String(effectiveServiceLocation._id || effectiveServiceLocation.id || ''),
          }
        : null,
      package_type: packageType
        ? {
            ...packageType,
            id: String(packageType._id || packageType.id || ''),
          }
        : null,
      package_vehicle_prices: Array.isArray(item.package_vehicle_prices)
        ? item.package_vehicle_prices.map((price, index) => ({
            ...price,
            id: String(price._id || index),
            vehicle_type: price.vehicle_type
              ? {
                  ...price.vehicle_type,
                  id: String(price.vehicle_type._id || price.vehicle_type.id || ''),
                }
              : null,
          }))
        : [],
      zone: zone
        ? {
            ...zone,
            id: String(zone._id),
            service_location: sl
              ? {
                  ...sl,
                  id: String(sl._id),
                }
              : null,
          }
        : null,
    };
  });

  return {
    results,
    paginator: {
      current_page: 1,
      data: paginatorData,
      from: 1,
      to: paginatorData.length,
      total: paginatorData.length,
      last_page: 1,
      per_page: 10,
    }
  };
};

export const createSetPrice = async (payload, currentAdmin = null) => {
  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'set_prices.view', 'set prices');
    if (payload.service_location_id) {
      assertServiceLocationAccess(currentAdmin, payload.service_location_id?._id || payload.service_location_id?.id || payload.service_location_id);
    }
    if (payload.zone_id) {
      await assertZoneAccess(currentAdmin, payload.zone_id?._id || payload.zone_id?.id || payload.zone_id);
    }
  }

  const payment_type = Array.isArray(payload.payment_type)
    ? payload.payment_type
    : typeof payload.payment_type === 'string'
      ? payload.payment_type.split(',').map(s => s.trim())
      : ['cash', 'online', 'wallet'];

  const zone_id = toObjectId(payload.zone_id?._id || payload.zone_id?.id || payload.zone_id);
  const vehicle_type = toObjectId(payload.vehicle_type?._id || payload.vehicle_type?.id || payload.vehicle_type || payload.type_id);
  const service_location_id = toObjectId(payload.service_location_id?._id || payload.service_location_id?.id || payload.service_location_id || payload.zone?._id || payload.zone?.service_location_id);

  const setPrice = await SetPrice.create({
    zone_id,
    vehicle_type,
    service_location_id,
    pricing_scope: payload.pricing_scope || 'ride',
    transport_type: normalizeVehicleTransportType(payload.transport_type || 'taxi'),
    package_type_id: toObjectId(payload.package_type_id?._id || payload.package_type_id?.id || payload.package_type_id),
    package_destination: String(payload.package_destination || '').trim(),
    package_availability: payload.package_availability || 'available',
    package_vehicle_prices: Array.isArray(payload.package_vehicle_prices)
      ? payload.package_vehicle_prices.map((item) => normalizePackageVehiclePriceItem(item))
      : [],
    payment_type,
    active: Number(payload.active ?? 1),

    admin_commision_type: Number(payload.admin_commision_type ?? (payload.customer_commission_type === 'percentage' ? 1 : 0)),
    admin_commision: Number(payload.admin_commision ?? payload.customer_commission ?? 0),
    admin_commission_type_for_owner: Number(payload.admin_commission_type_for_owner ?? 1),
    admin_commission_for_owner: Number(payload.admin_commission_for_owner ?? 0),
    admin_commission_type_from_driver: Number(payload.admin_commission_type_from_driver ?? 1),
    admin_commission_from_driver: Number(payload.admin_commission_from_driver ?? 0),

    service_tax: Number(payload.service_tax ?? 0),
    airport_surge: Number(payload.airport_surge ?? 0),
    support_airport_fee: Number(payload.support_airport_fee ?? 0),
    support_outstation: Number(payload.support_outstation ?? 0),
    enable_airport_ride: payload.enable_airport_ride ?? !!payload.support_airport_fee,
    enable_outstation_ride: payload.enable_outstation_ride ?? !!payload.support_outstation,

    base_price: Number(payload.base_price ?? 0),
    base_distance: Number(payload.base_distance ?? 0),
    price_per_distance: Number(payload.price_per_distance ?? 0),
    time_price: Number(payload.time_price ?? 0),
    waiting_charge: Number(payload.waiting_charge ?? 0),
    ride_surge_amount: Number(payload.ride_surge_amount ?? 0),
    outstation_base_price: Number(payload.outstation_base_price ?? 0),
    outstation_base_distance: Number(payload.outstation_base_distance ?? 0),
    outstation_price_per_distance: Number(payload.outstation_price_per_distance ?? 0),
    outstation_time_price: Number(payload.outstation_time_price ?? 0),
    free_waiting_before: Number(payload.free_waiting_before ?? 0),
    free_waiting_after: Number(payload.free_waiting_after ?? 0),

    user_cancellation_fee: Number(payload.user_cancellation_fee ?? payload.cancellation_fee_for_user ?? 0),
    driver_cancellation_fee: Number(payload.driver_cancellation_fee ?? payload.cancellation_fee_for_driver ?? 0),
    cancellation_fee_goes_to: payload.cancellation_fee_goes_to ?? payload.fee_goes_to ?? 'admin',
    user_cancellation_fee_type: payload.user_cancellation_fee_type || 'percentage',
    driver_cancellation_fee_type: payload.driver_cancellation_fee_type || 'percentage',
    enable_cancellation_charge: payload.enable_cancellation_charge ?? true,
    free_cancellation_time: Number(payload.free_cancellation_time ?? 2),
    fixed_cancellation_charge: Number(payload.fixed_cancellation_charge ?? 0),
    percentage_cancellation_charge: Number(payload.percentage_cancellation_charge ?? 0),
    charge_after_driver_accepted: payload.charge_after_driver_accepted ?? true,
    charge_after_driver_reached_pickup: payload.charge_after_driver_reached_pickup ?? true,
    charge_after_otp: payload.charge_after_otp ?? false,
    max_cancellation_fee: Number(payload.max_cancellation_fee ?? 0),
    enable_cancellation_reasons: payload.enable_cancellation_reasons ?? true,
    cancellation_policy_message: String(payload.cancellation_policy_message || ''),

    order_number: Number(payload.order_number ?? payload.eta_sequence ?? 1),
    bill_status: Number(payload.bill_status ?? 1),
    status: payload.status || 'active',
  });

  return setPrice.toObject();
};

export const updateSetPrice = async (id, payload, currentAdmin = null) => {
  const setPrice = await SetPrice.findById(id);
  if (!setPrice) throw new ApiError(404, 'Set Price not found');
  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'set_prices.view', 'set prices');
    if (setPrice.zone_id) {
      await assertZoneAccess(currentAdmin, setPrice.zone_id);
    } else {
      assertServiceLocationAccess(currentAdmin, setPrice.service_location_id);
    }
  }

  const fields = [
    'zone_id', 'vehicle_type', 'service_location_id', 'transport_type',
    'pricing_scope', 'package_type_id', 'package_destination', 'package_availability',
    'payment_type', 'active', 'admin_commision_type', 'admin_commision',
    'admin_commission_type_for_owner', 'admin_commission_for_owner',
    'admin_commission_type_from_driver', 'admin_commission_from_driver',
    'service_tax', 'airport_surge', 'support_airport_fee', 'support_outstation',
    'enable_airport_ride', 'enable_outstation_ride',
    'base_price', 'base_distance', 'price_per_distance', 'time_price',
    'waiting_charge', 'ride_surge_amount', 'outstation_base_price', 'outstation_base_distance',
    'outstation_price_per_distance', 'outstation_time_price',
    'free_waiting_before', 'free_waiting_after',
    'user_cancellation_fee', 'driver_cancellation_fee', 'cancellation_fee_goes_to',
    'user_cancellation_fee_type', 'driver_cancellation_fee_type',
    'enable_cancellation_charge', 'free_cancellation_time', 'fixed_cancellation_charge',
    'percentage_cancellation_charge', 'charge_after_driver_accepted', 'charge_after_driver_reached_pickup',
    'charge_after_otp', 'max_cancellation_fee', 'enable_cancellation_reasons', 'cancellation_policy_message',
    'order_number', 'bill_status', 'status'
  ];

  fields.forEach(field => {
    let value = payload[field];

    if (field === 'zone_id') value = payload.zone_id?._id || payload.zone_id?.id || payload.zone_id;
    if (field === 'vehicle_type') value = payload.vehicle_type?._id || payload.vehicle_type?.id || payload.vehicle_type || payload.type_id;
    if (field === 'service_location_id') value = payload.service_location_id?._id || payload.service_location_id?.id || payload.service_location_id || payload.zone?._id || payload.zone?.service_location_id;
    if (field === 'package_type_id') value = payload.package_type_id?._id || payload.package_type_id?.id || payload.package_type_id;
    if (field === 'transport_type' && value !== undefined) value = normalizeVehicleTransportType(value);

    if (currentAdmin && value !== undefined) {
      if (field === 'zone_id' && value) {
        assertZoneAccess(currentAdmin, value);
      }
      if (field === 'service_location_id' && value) {
        assertServiceLocationAccess(currentAdmin, value);
      }
    }

    if (value === undefined) {
      if (field === 'admin_commision') value = payload.customer_commission;
      if (field === 'admin_commision_type') value = payload.customer_commission_type === 'percentage' ? 1 : (payload.customer_commission_type === 'fixed' ? 0 : undefined);
      if (field === 'order_number') value = payload.eta_sequence;
      if (field === 'user_cancellation_fee') value = payload.cancellation_fee_for_user;
      if (field === 'driver_cancellation_fee') value = payload.cancellation_fee_for_driver;
      if (field === 'cancellation_fee_goes_to') value = payload.fee_goes_to;
    }

    if (value !== undefined) {
      if (field.includes('_id') || field === 'vehicle_type') {
        setPrice[field] = value ? toObjectId(value) : null;
      } else if (field === 'payment_type') {
        setPrice[field] = Array.isArray(value) ? value : (typeof value === 'string' ? value.split(',').map(s => s.trim()) : value);
      } else if (typeof setPrice[field] === 'number' || ['admin_commision', 'service_tax', 'base_price', 'base_distance', 'price_per_distance', 'time_price', 'order_number'].includes(field)) {
        setPrice[field] = Number(value);
      } else {
        setPrice[field] = value;
      }
    }
  });

  if (payload.package_vehicle_prices !== undefined) {
    setPrice.package_vehicle_prices = Array.isArray(payload.package_vehicle_prices)
      ? payload.package_vehicle_prices.map((item) => normalizePackageVehiclePriceItem(item))
      : [];
  }

  await setPrice.save();
  return setPrice.toObject();
};

export const deleteSetPrice = async (id, currentAdmin = null) => {
  if (currentAdmin) {
    const setPrice = await SetPrice.findById(id).select('service_location_id zone_id').lean();
    if (!setPrice) throw new ApiError(404, 'Set Price not found');
    assertAdminPermission(currentAdmin, 'set_prices.view', 'set prices');
    if (setPrice.zone_id) {
      await assertZoneAccess(currentAdmin, setPrice.zone_id);
    } else {
      assertServiceLocationAccess(currentAdmin, setPrice.service_location_id);
    }
  }
  const deleted = await SetPrice.findByIdAndDelete(id);
  if (!deleted) throw new ApiError(404, 'Set Price not found');
  return true;
};

/*
 * Time-slot surge (models/SurgeSlot.js, common/surgeSlot.js). Gated like Set
 * Price; a sub-admin sees and edits only slots whose zones are all theirs.
 */
const serializeSurgeSlot = (slot) => ({
  ...slot,
  id: String(slot._id),
  zone_ids: (slot.zone_ids || []).map(String),
  vehicle_type_ids: (slot.vehicle_type_ids || []).map(String),
  all_vehicles: (slot.vehicle_type_ids || []).length === 0,
});

const assertSurgeSlotZones = async (currentAdmin, zoneIds = []) => {
  if (!currentAdmin) return;
  assertAdminPermission(currentAdmin, 'set_prices.view', 'surge pricing');
  for (const zoneId of zoneIds) {
    await assertZoneAccess(currentAdmin, zoneId);
  }
};

export const listSurgeSlots = async (currentAdmin = null) => {
  const query = {};
  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'set_prices.view', 'surge pricing');
    if (!isSuperAdmin(currentAdmin)) {
      const scoped = await getScopedZoneIds(currentAdmin);
      query.zone_ids = { $not: { $elemMatch: { $nin: scoped } } };
    }
  }
  const slots = await SurgeSlot.find(query).sort({ createdAt: -1 }).lean();
  return slots.map(serializeSurgeSlot);
};

const saveSurgeSlot = async (id, payload, currentAdmin) => {
  let slot;
  try {
    slot = normalizeSurgeSlot(payload);
  } catch (error) {
    throw new ApiError(400, error.message);
  }
  if (slot.zone_ids.some((z) => !mongoose.Types.ObjectId.isValid(z))
    || slot.vehicle_type_ids.some((v) => !mongoose.Types.ObjectId.isValid(v))) {
    throw new ApiError(400, 'Unknown zone or vehicle');
  }
  if (id) {
    const existing = await SurgeSlot.findById(id).select('zone_ids').lean();
    if (!existing) throw new ApiError(404, 'Surge slot not found');
    await assertSurgeSlotZones(currentAdmin, existing.zone_ids);
  }
  await assertSurgeSlotZones(currentAdmin, slot.zone_ids);

  const others = await SurgeSlot.find({
    zone_ids: { $in: slot.zone_ids },
    active: true,
    ...(id ? { _id: { $ne: id } } : {}),
  }).lean();
  const clash = findOverlappingSlot(slot, others);
  if (clash) {
    throw new ApiError(409, `Overlaps "${clash.name || `${clash.start_time}-${clash.end_time}`}" (${clash.percent}%) for the same zone and vehicle`);
  }

  const saved = id
    ? await SurgeSlot.findByIdAndUpdate(id, slot, { new: true }).lean()
    : (await SurgeSlot.create(slot)).toObject();
  return serializeSurgeSlot(saved);
};

export const createSurgeSlot = (payload, currentAdmin = null) => saveSurgeSlot(null, payload, currentAdmin);
export const updateSurgeSlot = (id, payload, currentAdmin = null) => saveSurgeSlot(id, payload, currentAdmin);

export const deleteSurgeSlot = async (id, currentAdmin = null) => {
  const existing = await SurgeSlot.findById(id).select('zone_ids').lean();
  if (!existing) throw new ApiError(404, 'Surge slot not found');
  await assertSurgeSlotZones(currentAdmin, existing.zone_ids);
  await SurgeSlot.deleteOne({ _id: id });
  return true;
};

  const normalizeAdminEarningOption = (value) => String(value || '').trim();

  const formatAdminEarningDate = (value) => {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
  };

  const getRideCompletedDate = (ride) => formatAdminEarningDate(ride.completedAt || ride.updatedAt || ride.createdAt);

  const matchesAdminEarningDateRange = (ride, startDate, endDate) => {
    if (!startDate && !endDate) return true;

    const completedDate = getRideCompletedDate(ride);
    if (!completedDate) return false;

    if (startDate && completedDate < startDate) return false;
    if (endDate && completedDate > endDate) return false;
    return true;
  };

  const groupAdminEarnings = (rows, keyGetter, labelGetter) => {
    const map = new Map();

    rows.forEach((row) => {
      const key = keyGetter(row) || 'unknown';
      const label = labelGetter(row) || 'Unknown';
      const current = map.get(key) || {
        key,
        label,
        trips: 0,
        grossFare: 0,
        adminCommission: 0,
        driverEarnings: 0,
      };

      current.trips += 1;
      current.grossFare += row.grossFare;
      current.adminCommission += row.adminCommission;
      current.driverEarnings += row.driverEarnings;
      map.set(key, current);
    });

    return [...map.values()]
      .map((item) => ({
        ...item,
        grossFare: Number(item.grossFare.toFixed(2)),
        adminCommission: Number(item.adminCommission.toFixed(2)),
        driverEarnings: Number(item.driverEarnings.toFixed(2)),
      }))
      .sort((a, b) => b.adminCommission - a.adminCommission);
  };

  export const getAdminEarnings = async (query = {}) => {
    const {
      from,
      to,
      zone,
      vehicle,
      riderType,
      paymentMethod,
      search,
      page = 1,
      limit = 10,
    } = query;

    const startDate = from ? new Date(from) : null;
    const endDate = to ? new Date(to) : null;

    if (startDate && Number.isNaN(startDate.getTime())) {
      throw new ApiError(400, 'Invalid from date');
    }

    if (endDate && Number.isNaN(endDate.getTime())) {
      throw new ApiError(400, 'Invalid to date');
    }

    if (endDate) {
      endDate.setHours(23, 59, 59, 999);
    }

    const rides = await Ride.find({ status: RIDE_STATUS.COMPLETED })
      .sort({ completedAt: -1, updatedAt: -1, createdAt: -1 })
      .populate('userId', 'name phone')
      .populate({
        path: 'driverId',
        select: 'name phone vehicleType vehicleNumber zoneId',
        populate: { path: 'zoneId', select: 'name' },
      })
      .populate('vehicleTypeId', 'name type_name transport_type icon_types')
      .lean();

    const zoneFilter = normalizeAdminEarningOption(zone);
    const vehicleFilter = normalizeAdminEarningOption(vehicle);
    const riderTypeFilter = normalizeAdminEarningOption(riderType).toLowerCase();
    const paymentFilter = normalizeAdminEarningOption(paymentMethod).toLowerCase();
    const searchFilter = normalizeAdminEarningOption(search).toLowerCase();

    let rows = rides
      .filter((ride) => matchesAdminEarningDateRange(ride, startDate, endDate))
      .map((ride) => {
        const vehicleDoc = ride.vehicleTypeId || {};
        const driver = ride.driverId || {};
        const zoneDoc = driver.zoneId || {};
        const requestId = `REQ_${String(ride._id).slice(-12).toUpperCase()}`;
        const grossFare = Number(ride.fare || 0);
        const adminCommission = Number(ride.commissionAmount || 0);
        const driverEarnings = Number(ride.driverEarnings || Math.max(grossFare - adminCommission, 0));
        const completedDate = getRideCompletedDate(ride);

        return {
          id: String(ride._id),
          requestId,
          completedAt: completedDate,
          userName: ride.userId?.name || 'Unknown Rider',
          userPhone: ride.userId?.phone || '',
          driverName: driver.name || 'Unassigned Driver',
          driverPhone: driver.phone || '',
          riderType: ride.serviceType || 'ride',
          paymentMethod: ride.paymentMethod || 'cash',
          zoneId: zoneDoc?._id ? String(zoneDoc._id) : '',
          zoneName: zoneDoc?.name || 'Unmapped Zone',
          vehicleId: vehicleDoc?._id ? String(vehicleDoc._id) : '',
          vehicleName: vehicleDoc?.name || vehicleDoc?.type_name || ride.vehicleIconType || driver.vehicleType || 'Vehicle',
          transportType: vehicleDoc?.transport_type || ride.transport_type || 'taxi',
          grossFare: Number(grossFare.toFixed(2)),
          adminCommission: Number(adminCommission.toFixed(2)),
          driverEarnings: Number(driverEarnings.toFixed(2)),
          commissionRate: Number(ride.pricingSnapshot?.admin_commission_from_driver || 0),
          commissionType: Number(ride.pricingSnapshot?.admin_commission_type_from_driver || 1) === 1 ? 'percentage' : 'fixed',
        };
      });

    if (zoneFilter) {
      rows = rows.filter((row) => row.zoneId === zoneFilter || row.zoneName.toLowerCase() === zoneFilter.toLowerCase());
    }

    if (vehicleFilter) {
      rows = rows.filter((row) => row.vehicleId === vehicleFilter || row.vehicleName.toLowerCase() === vehicleFilter.toLowerCase());
    }

    if (riderTypeFilter) {
      rows = rows.filter((row) => String(row.riderType || '').toLowerCase() === riderTypeFilter);
    }

    if (paymentFilter) {
      rows = rows.filter((row) => String(row.paymentMethod || '').toLowerCase() === paymentFilter);
    }

    if (searchFilter) {
      rows = rows.filter((row) =>
        [
          row.requestId,
          row.userName,
          row.userPhone,
          row.driverName,
          row.driverPhone,
          row.zoneName,
          row.vehicleName,
          row.riderType,
          row.paymentMethod,
        ].some((value) => String(value || '').toLowerCase().includes(searchFilter)),
      );
    }

    const totals = rows.reduce(
      (acc, row) => {
        acc.totalTrips += 1;
        acc.grossFare += row.grossFare;
        acc.adminCommission += row.adminCommission;
        acc.driverEarnings += row.driverEarnings;
        if (row.paymentMethod === 'cash') acc.byCash += row.adminCommission;
        if (row.paymentMethod === 'online') acc.byOnline += row.adminCommission;
        return acc;
      },
      { totalTrips: 0, grossFare: 0, adminCommission: 0, driverEarnings: 0, byCash: 0, byOnline: 0 },
    );

    const roundedTotals = Object.fromEntries(
      Object.entries(totals).map(([key, value]) => [key, typeof value === 'number' ? Number(value.toFixed(2)) : value]),
    );

    return {
      summary: {
        ...roundedTotals,
        averageCommission: rows.length ? Number((totals.adminCommission / rows.length).toFixed(2)) : 0,
      },
      breakdowns: {
        zones: groupAdminEarnings(rows, (row) => row.zoneId, (row) => row.zoneName),
        vehicles: groupAdminEarnings(rows, (row) => row.vehicleId, (row) => row.vehicleName),
        riderTypes: groupAdminEarnings(rows, (row) => row.riderType, (row) => row.riderType),
      },
      filters: {
        from: from || '',
        to: to || '',
        zone: zoneFilter,
        vehicle: vehicleFilter,
        riderType: riderTypeFilter,
        paymentMethod: paymentFilter,
        search: searchFilter,
      },
      ...buildPaginator(rows, Number(page) || 1, Number(limit) || 10),
    };
  };

export const getDashboardData = async () => {
  const [totalUsers, totalDrivers, approvedDrivers, rides, supportTicketStats] = await Promise.all([
    User.countDocuments(),
    Driver.countDocuments(),
    Driver.countDocuments({ approve: true }),
    Ride.find()
      .select('status liveStatus fare paymentMethod commissionAmount driverEarnings driverId createdAt updatedAt completedAt')
      .sort({ createdAt: -1 })
      .lean(),
    SupportTicket.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  const getRideEventDate = (ride) => {
    const status = String(ride?.status || '').toLowerCase();
    if (status === RIDE_STATUS.COMPLETED) {
      return ride?.completedAt || ride?.updatedAt || ride?.createdAt || null;
    }
    if (status === RIDE_STATUS.CANCELLED) {
      return ride?.updatedAt || ride?.createdAt || null;
    }
    return ride?.createdAt || ride?.updatedAt || null;
  };

  const isWithinRange = (date, rangeStart, rangeEnd) => {
    const value = date ? new Date(date) : null;
    if (!value || Number.isNaN(value.getTime())) return false;
    return value >= rangeStart && value <= rangeEnd;
  };

  const isCompletedRide = (ride) => String(ride?.status || '').toLowerCase() === RIDE_STATUS.COMPLETED;
  const isCancelledRide = (ride) => String(ride?.status || '').toLowerCase() === RIDE_STATUS.CANCELLED;
  const isScheduledRide = (ride) => !isCompletedRide(ride) && !isCancelledRide(ride);

  const completedRides = rides.filter(isCompletedRide);
  const cancelledRides = rides.filter(isCancelledRide);
  const scheduledRides = rides.filter(isScheduledRide);

  const todayCompletedRides = completedRides.filter((ride) => isWithinRange(getRideEventDate(ride), startOfToday, endOfToday));
  const todayCancelledRides = cancelledRides.filter((ride) => isWithinRange(getRideEventDate(ride), startOfToday, endOfToday));
  const todayScheduledRides = scheduledRides.filter((ride) => isWithinRange(getRideEventDate(ride), startOfToday, endOfToday));

  const sumFare = (items) =>
    items.reduce((total, ride) => total + Number(ride?.fare || 0), 0);
  const sumCommission = (items) =>
    items.reduce((total, ride) => {
      const fare = Number(ride?.fare || 0);
      const explicitCommission = Number(ride?.commissionAmount);
      const fallbackCommission = Math.max(fare - Number(ride?.driverEarnings || 0), 0);
      return total + (Number.isFinite(explicitCommission) ? explicitCommission : fallbackCommission);
    }, 0);
  const sumDriverEarnings = (items) =>
    items.reduce((total, ride) => {
      const fare = Number(ride?.fare || 0);
      const commission = Number(ride?.commissionAmount || 0);
      const earning = Number.isFinite(Number(ride?.driverEarnings))
        ? Number(ride?.driverEarnings)
        : Math.max(fare - commission, 0);
      return total + earning;
    }, 0);

  const totalOverallFare = sumFare(completedRides);
  const totalTodayFare = sumFare(todayCompletedRides);
  const totalOverallCommission = sumCommission(completedRides);
  const totalTodayCommission = sumCommission(todayCompletedRides);
  const totalOverallDriverEarnings = sumDriverEarnings(completedRides);
  const totalTodayDriverEarnings = sumDriverEarnings(todayCompletedRides);

  const overallByCash = sumFare(completedRides.filter((ride) => String(ride?.paymentMethod || 'cash').toLowerCase() === 'cash'));
  const overallByCard = sumFare(completedRides.filter((ride) => String(ride?.paymentMethod || '').toLowerCase() === 'online'));
  const todayByCash = sumFare(todayCompletedRides.filter((ride) => String(ride?.paymentMethod || 'cash').toLowerCase() === 'cash'));
  const todayByCard = sumFare(todayCompletedRides.filter((ride) => String(ride?.paymentMethod || '').toLowerCase() === 'online'));

  const buildRecentMonthKeys = (monthCount = 4) => {
    const months = [];
    for (let index = monthCount - 1; index >= 0; index -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      months.push({
        key,
        label: date.toLocaleString('en-IN', { month: 'short' }),
      });
    }
    return months;
  };

  const recentMonths = buildRecentMonthKeys(4);
  const recentMonthMap = new Map(
    recentMonths.map((month) => [
      month.key,
      {
        ...month,
        amount: 0,
        total: 0,
        byUser: 0,
        byDriver: 0,
        noDriver: 0,
      },
    ]),
  );

  completedRides.forEach((ride) => {
    const eventDate = getRideEventDate(ride);
    if (!eventDate) return;
    const date = new Date(eventDate);
    if (Number.isNaN(date.getTime())) return;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const month = recentMonthMap.get(key);
    if (!month) return;
    month.amount += Number(ride?.fare || 0);
  });

  cancelledRides.forEach((ride) => {
    const eventDate = getRideEventDate(ride);
    if (!eventDate) return;
    const date = new Date(eventDate);
    if (Number.isNaN(date.getTime())) return;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const month = recentMonthMap.get(key);
    if (!month) return;
    month.total += 1;
    if (!ride?.driverId) {
      month.noDriver += 1;
    } else {
      month.byUser += 1;
    }
  });

  const overallChart = recentMonths.map((month) => {
    const entry = recentMonthMap.get(month.key);
    return {
      label: month.label,
      amount: Number((entry?.amount || 0).toFixed(2)),
    };
  });

  const cancelChartSeries = recentMonths.map((month) => {
    const entry = recentMonthMap.get(month.key);
    return {
      label: month.label,
      total: entry?.total || 0,
      byUser: entry?.byUser || 0,
      byDriver: entry?.byDriver || 0,
      noDriver: entry?.noDriver || 0,
    };
  });

  const supportTicketCounts = supportTicketStats.reduce(
    (acc, item) => {
      const key = String(item?._id || '').toLowerCase();
      acc[key] = Number(item?.count || 0);
      return acc;
    },
    { pending: 0, assigned: 0, closed: 0 },
  );

  return {
      totalUsers,
      totalDrivers: {
        total: totalDrivers,
        approved: approvedDrivers,
        declined: totalDrivers - approvedDrivers
      },
      total_earnings: Number(totalOverallFare.toFixed(2)),
      payment_success_rate: 99.4,
      notifiedSos: {
        total: supportTicketCounts.pending + supportTicketCounts.assigned,
        pending: supportTicketCounts.pending,
        assigned: supportTicketCounts.assigned,
        closed: supportTicketCounts.closed,
      },
      todayTrips: {
        total: todayCompletedRides.length + todayCancelledRides.length + todayScheduledRides.length,
        completed: todayCompletedRides.length,
        cancelled: todayCancelledRides.length,
        scheduled: todayScheduledRides.length,
      },
      overallTrips: {
        total: rides.length,
        completed: completedRides.length,
        cancelled: cancelledRides.length,
        scheduled: scheduledRides.length,
      },
      todayEarnings: {
        total: Number(totalTodayFare.toFixed(2)),
        by_cash: Number(todayByCash.toFixed(2)),
        by_wallet: 0,
        by_card: Number(todayByCard.toFixed(2)),
        admin_commission: Number(totalTodayCommission.toFixed(2)),
        driver_earnings: Number(totalTodayDriverEarnings.toFixed(2)),
      },
      overallEarnings: {
        total: Number(totalOverallFare.toFixed(2)),
        by_cash: Number(overallByCash.toFixed(2)),
        by_wallet: 0,
        by_card: Number(overallByCard.toFixed(2)),
        admin_commission: Number(totalOverallCommission.toFixed(2)),
        driver_earnings: Number(totalOverallDriverEarnings.toFixed(2)),
        chart: overallChart,
      },
      cancelChart: {
        total: cancelledRides.length,
        byUser: cancelledRides.filter((ride) => ride?.driverId).length,
        byDriver: 0,
        noDriver: cancelledRides.filter((ride) => !ride?.driverId).length,
        chart: cancelChartSeries,
      },
      performance_index: rides.length
        ? Number((((completedRides.length || 0) / rides.length) * 100).toFixed(1))
        : 0,
    };
  };

  export const getOverallEarnings = async () => (await getDashboardData()).overallEarnings;
  export const getTodayEarnings = async () => (await getDashboardData()).todayEarnings;
  export const getCancelChart = async () => (await getDashboardData()).cancelChart;

  export const listWithdrawals = async () => WithdrawalRequest.find().populate('driver_id').sort({ createdAt: -1 }).lean();

  export const listZones = async (currentAdmin = null) => {
    if (currentAdmin) {
      assertAdminPermission(currentAdmin, 'zones.view', 'zones');
    }
    const query = currentAdmin ? buildServiceLocationScopeQuery(currentAdmin) : {};
    const zones = await Zone.find(query)
      .populate('service_location_id', 'name service_location_name country timezone')
      .sort({ createdAt: -1 })
      .lean();

    return zones.map(serializeZone);
  };

    /**
   * The landmarks an admin set for whichever zone [lat],[lng] falls in.
   *
   * Nearest first, each with the distance from the rider. Returns an
   * empty list -- never an error -- when the point is outside every zone
   * or the zone has no landmarks: the destination screen shows its other
   * shortcuts and the rider types as they always did.
   */
  export const listPopularPlacesNear = async ({ lat, lng }) => {
    const originLat = Number(lat);
    const originLng = Number(lng);
    if (!Number.isFinite(originLat) || !Number.isFinite(originLng)) {
      return { zoneId: null, zoneName: '', places: [] };
    }

    const zone = await Zone.findOne({
      active: { $ne: false },
      geometry: {
        $geoIntersects: {
          $geometry: { type: 'Point', coordinates: [originLng, originLat] },
        },
      },
    })
      .select('_id name popular_places')
      .lean();

    if (!zone) return { zoneId: null, zoneName: '', places: [] };

    const places = normalizeZonePopularPlaces(zone.popular_places)
      .filter((place) => place.active)
      .map((place) => ({
        ...place,
        distanceKm: haversineKm(
          { lat: originLat, lng: originLng },
          place.location,
        ),
      }))
      // Nearest first: a rider scanning one row of cards reads left to
      // right, and the admin's order is not about where the rider is.
      .sort((a, b) => a.distanceKm - b.distanceKm);

    return { zoneId: String(zone._id), zoneName: zone.name || '', places };
  };

export const createZone = async (payload, currentAdmin = null) => {
    if (!payload.name?.trim()) {
      throw new ApiError(400, 'Zone name is required');
    }
    if (currentAdmin) {
      assertAdminPermission(currentAdmin, 'zones.view', 'zones');
      assertServiceLocationAccess(currentAdmin, payload.service_location_id);
    }

    const normalizedGeometry = normalizeZoneGeometryPayload(payload);

    const zone = await Zone.create({
      name: String(payload.name).trim(),
      service_location_id: payload.service_location_id ? toObjectId(payload.service_location_id) : null,
      unit: payload.unit || 'km',
      peak_zone_ride_count: toNullableNumber(payload.peak_zone_ride_count),
      peak_zone_radius: toNullableNumber(payload.peak_zone_radius),
      peak_zone_selection_duration: toNullableNumber(payload.peak_zone_selection_duration),
      peak_zone_duration: toNullableNumber(payload.peak_zone_duration),
      peak_zone_surge_percentage: toNullableNumber(payload.peak_zone_surge_percentage),
      ride_surge_enabled: payload.ride_surge_enabled === true,
      maximum_distance_for_regular_rides: toNullableNumber(payload.maximum_distance_for_regular_rides),
      maximum_distance_for_outstation_rides: toNullableNumber(payload.maximum_distance_for_outstation_rides),
      active: payload.status ? payload.status === 'active' : true,
      status: payload.status || 'active',
      boundary_mode: normalizedGeometry.boundary_mode,
      circle_center: normalizedGeometry.circle_center,
      circle_radius_meters: normalizedGeometry.circle_radius_meters,
      popular_places: normalizeZonePopularPlaces(payload.popular_places),
      geometry: normalizedGeometry.geometry,
    });

    const populatedZone = await Zone.findById(zone._id)
      .populate('service_location_id', 'name service_location_name country timezone')
      .lean();

    return serializeZone(populatedZone);
  };

  export const updateZone = async (id, payload, currentAdmin = null) => {
    const zone = await Zone.findById(id);
    if (!zone) throw new ApiError(404, 'Zone not found');
    if (currentAdmin) {
      assertAdminPermission(currentAdmin, 'zones.view', 'zones');
      await assertZoneAccess(currentAdmin, zone._id);
    }

    if (payload.name !== undefined) {
      zone.name = String(payload.name).trim();
    }
    if (payload.service_location_id !== undefined) {
      if (currentAdmin && payload.service_location_id) {
        assertServiceLocationAccess(currentAdmin, payload.service_location_id);
      }
      zone.service_location_id = payload.service_location_id ? toObjectId(payload.service_location_id) : null;
    }
    if (payload.unit !== undefined) {
      zone.unit = payload.unit || 'km';
    }
    if (payload.peak_zone_ride_count !== undefined) {
      zone.peak_zone_ride_count = toNullableNumber(payload.peak_zone_ride_count);
    }
    if (payload.peak_zone_radius !== undefined) {
      zone.peak_zone_radius = toNullableNumber(payload.peak_zone_radius);
    }
    if (payload.peak_zone_selection_duration !== undefined) {
      zone.peak_zone_selection_duration = toNullableNumber(payload.peak_zone_selection_duration);
    }
    if (payload.peak_zone_duration !== undefined) {
      zone.peak_zone_duration = toNullableNumber(payload.peak_zone_duration);
    }
    if (payload.peak_zone_surge_percentage !== undefined) {
      zone.peak_zone_surge_percentage = toNullableNumber(payload.peak_zone_surge_percentage);
    }
    if (payload.ride_surge_enabled !== undefined) {
      zone.ride_surge_enabled = payload.ride_surge_enabled === true;
    }
    if (payload.maximum_distance_for_regular_rides !== undefined) {
      zone.maximum_distance_for_regular_rides = toNullableNumber(payload.maximum_distance_for_regular_rides);
    }
    if (payload.maximum_distance_for_outstation_rides !== undefined) {
      zone.maximum_distance_for_outstation_rides = toNullableNumber(payload.maximum_distance_for_outstation_rides);
    }
    if (payload.status !== undefined) {
      zone.status = payload.status || 'active';
      zone.active = zone.status === 'active';
    }
    // Absent means "not sent, leave alone"; an empty array is a real choice
    // (the admin removed the last one) and clears them.
    if (payload.popular_places !== undefined) {
      zone.popular_places = normalizeZonePopularPlaces(payload.popular_places);
    }
    if (
      payload.coordinates !== undefined ||
      payload.boundary_mode !== undefined ||
      payload.circle_center !== undefined ||
      payload.circle_radius_meters !== undefined
    ) {
      const normalizedGeometry = normalizeZoneGeometryPayload(payload, zone);
      zone.boundary_mode = normalizedGeometry.boundary_mode;
      zone.circle_center = normalizedGeometry.circle_center;
      zone.circle_radius_meters = normalizedGeometry.circle_radius_meters;
      zone.geometry = normalizedGeometry.geometry;
    }

    await zone.save();

    const populatedZone = await Zone.findById(zone._id)
      .populate('service_location_id', 'name service_location_name country timezone')
      .lean();

    return serializeZone(populatedZone);
  };

  export const deleteZone = async (id, currentAdmin = null) => {
    if (currentAdmin) {
      assertAdminPermission(currentAdmin, 'zones.view', 'zones');
      await assertZoneAccess(currentAdmin, id);
    }
    const deleted = await Zone.findByIdAndDelete(id);
    if (!deleted) throw new ApiError(404, 'Zone not found');
    return true;
  };

  export const toggleZoneStatus = async (id, currentAdmin = null) => {
    const zone = await Zone.findById(id);
    if (!zone) throw new ApiError(404, 'Zone not found');
    if (currentAdmin) {
      assertAdminPermission(currentAdmin, 'zones.view', 'zones');
      await assertZoneAccess(currentAdmin, zone._id);
    }
    zone.active = !zone.active;
    zone.status = zone.active ? 'active' : 'inactive';
    await zone.save();

    const populatedZone = await Zone.findById(zone._id)
      .populate('service_location_id', 'name service_location_name country timezone')
      .lean();

    return serializeZone(populatedZone);
  };


  export const listAirports = async (currentAdmin = null) => {
    if (currentAdmin) {
      assertAdminPermission(currentAdmin, 'airports.view', 'airports');
    }
    const query = currentAdmin ? buildServiceLocationScopeQuery(currentAdmin) : {};
    const items = await Airport.find(query)
      .populate('service_location_id', 'name service_location_name country')
      .populate('zone_id', 'name')
      .sort({ createdAt: -1 })
      .lean();

    return items.map(serializeAirport);
  };

  export const createAirport = async (payload, currentAdmin = null) => {
    if (!payload.name?.trim()) {
      throw new ApiError(400, 'Airport name is required');
    }

    if (!payload.service_location_id) {
      throw new ApiError(400, 'Service location is required');
    }
    if (currentAdmin) {
      assertAdminPermission(currentAdmin, 'airports.view', 'airports');
      assertServiceLocationAccess(currentAdmin, payload.service_location_id);
      if (payload.zone_id) {
        await assertZoneAccess(currentAdmin, payload.zone_id);
      }
    }

    const latitude = toNullableNumber(payload.latitude);
    const longitude = toNullableNumber(payload.longitude);
    const status = payload.status || (normalizeBoolean(payload.active ?? true) ? 'active' : 'inactive');

    const item = await Airport.create({
      name: String(payload.name).trim(),
      code: String(payload.code || '').trim().toUpperCase(),
      service_location_id: toObjectId(payload.service_location_id),
      zone_id: payload.zone_id ? toObjectId(payload.zone_id) : null,
      terminal: String(payload.terminal || '').trim(),
      address: String(payload.address || '').trim(),
      contact_number: String(payload.contact_number || '').trim(),
      latitude,
      longitude,
      location:
        latitude !== null && longitude !== null
          ? {
            type: 'Point',
            coordinates: [longitude, latitude],
          }
          : undefined,
      boundary:
        Array.isArray(payload.boundary_coordinates) && payload.boundary_coordinates.length >= 3
          ? {
            type: 'Polygon',
            coordinates: [normalizeAirportBoundary(payload.boundary_coordinates)],
          }
          : undefined,
      airport_surge: Math.max(0, Number(payload.airport_surge ?? 0) || 0),
      support_airport_fee: Math.max(0, Number(payload.support_airport_fee ?? 0) || 0),
      status,
      active: status === 'active',
    });

    const populatedItem = await Airport.findById(item._id)
      .populate('service_location_id', 'name service_location_name country')
      .populate('zone_id', 'name')
      .lean();

    return serializeAirport(populatedItem);
  };

  export const updateAirport = async (id, payload, currentAdmin = null) => {
    const item = await Airport.findById(id);
    if (!item) throw new ApiError(404, 'Airport not found');
    if (currentAdmin) {
      assertAdminPermission(currentAdmin, 'airports.view', 'airports');
      assertServiceLocationAccess(currentAdmin, item.service_location_id);
    }

    if (payload.name !== undefined) {
      item.name = String(payload.name || '').trim();
    }
    if (payload.code !== undefined) {
      item.code = String(payload.code || '').trim().toUpperCase();
    }
    if (payload.service_location_id !== undefined) {
      if (currentAdmin && payload.service_location_id) {
        assertServiceLocationAccess(currentAdmin, payload.service_location_id);
      }
      item.service_location_id = payload.service_location_id ? toObjectId(payload.service_location_id) : null;
    }
    if (payload.zone_id !== undefined) {
      if (currentAdmin && payload.zone_id) {
        await assertZoneAccess(currentAdmin, payload.zone_id);
      }
      item.zone_id = payload.zone_id ? toObjectId(payload.zone_id) : null;
    }
    if (payload.terminal !== undefined) {
      item.terminal = String(payload.terminal || '').trim();
    }
    if (payload.address !== undefined) {
      item.address = String(payload.address || '').trim();
    }
    if (payload.contact_number !== undefined) {
      item.contact_number = String(payload.contact_number || '').trim();
    }
    if (payload.latitude !== undefined) {
      item.latitude = toNullableNumber(payload.latitude);
    }
    if (payload.longitude !== undefined) {
      item.longitude = toNullableNumber(payload.longitude);
    }
    if (payload.status !== undefined || payload.active !== undefined) {
      item.status = payload.status || (normalizeBoolean(payload.active) ? 'active' : 'inactive');
      item.active = item.status === 'active';
    }
    if (payload.boundary_coordinates !== undefined) {
      item.boundary =
        Array.isArray(payload.boundary_coordinates) && payload.boundary_coordinates.length >= 3
          ? {
            type: 'Polygon',
            coordinates: [normalizeAirportBoundary(payload.boundary_coordinates)],
          }
          : undefined;
    }
    if (payload.airport_surge !== undefined) {
      item.airport_surge = Math.max(0, Number(payload.airport_surge ?? 0) || 0);
    }
    if (payload.support_airport_fee !== undefined) {
      item.support_airport_fee = Math.max(0, Number(payload.support_airport_fee ?? 0) || 0);
    }

    item.location =
      item.latitude !== null && item.longitude !== null
        ? {
          type: 'Point',
          coordinates: [item.longitude, item.latitude],
        }
        : undefined;

    await item.save();

    const populatedItem = await Airport.findById(item._id)
      .populate('service_location_id', 'name service_location_name country')
      .populate('zone_id', 'name')
      .lean();

    return serializeAirport(populatedItem);
  };

  export const deleteAirport = async (id, currentAdmin = null) => {
    if (currentAdmin) {
      const existingAirport = await Airport.findById(id).select('service_location_id').lean();
      if (!existingAirport) throw new ApiError(404, 'Airport not found');
      assertAdminPermission(currentAdmin, 'airports.view', 'airports');
      assertServiceLocationAccess(currentAdmin, existingAirport.service_location_id);
    }
    const item = await Airport.findByIdAndDelete(id);
    if (!item) throw new ApiError(404, 'Airport not found');
    return true;
  };


  export const listRentalPackageTypes = async () => {
    const items = await RentalPackageType.find().sort({ createdAt: -1 }).lean();
    const results = items.map(serializeRentalPackageType);

    return {
      results,
      paginator: {
        current_page: 1,
        data: results,
        total: results.length,
        last_page: 1,
        per_page: 50,
        from: 1,
        to: results.length,
        links: [
          { url: null, label: "&laquo; Previous", active: false },
          { url: "https://k9rides.onrender.com/api/v1/admin/rental-package-types?page=1", label: "1", active: true },
          { url: null, label: "Next &raquo;", active: false }
        ],
        path: "https://k9rides.onrender.com/api/v1/admin/rental-package-types"
      }
    };
  };

  export const createRentalPackageType = async (payload) => {
    if (!payload.name?.trim()) {
      throw new ApiError(400, 'Rental package type name is required');
    }

    if (!payload.transport_type?.trim()) {
      throw new ApiError(400, 'Transport type is required');
    }

    const status = payload.status || (normalizeBoolean(payload.active ?? true) ? 'active' : 'inactive');

    const item = await RentalPackageType.create({
      transport_type: String(payload.transport_type).trim().toLowerCase(),
      name: String(payload.name).trim(),
      short_description: String(payload.short_description || '').trim(),
      description: String(payload.description || '').trim(),
      status,
      active: status === 'active',
    });

    return serializeRentalPackageType(item.toObject());
  };

  export const updateRentalPackageType = async (id, payload) => {
    const item = await RentalPackageType.findById(id);
    if (!item) throw new ApiError(404, 'Rental package type not found');

    if (payload.transport_type !== undefined) {
      item.transport_type = String(payload.transport_type || 'taxi').trim().toLowerCase();
    }
    if (payload.name !== undefined) {
      item.name = String(payload.name || '').trim();
    }
    if (payload.short_description !== undefined) {
      item.short_description = String(payload.short_description || '').trim();
    }
    if (payload.description !== undefined) {
      item.description = String(payload.description || '').trim();
    }
    if (payload.status !== undefined) {
      item.status = payload.status || 'active';
      item.active = item.status === 'active';
    } else if (payload.active !== undefined) {
      item.active = normalizeBoolean(payload.active);
      item.status = item.active ? 'active' : 'inactive';
    }

    await item.save();
    return serializeRentalPackageType(item.toObject());
  };

  export const deleteRentalPackageType = async (id) => {
    const deleted = await RentalPackageType.findByIdAndDelete(id);
    if (!deleted) throw new ApiError(404, 'Rental package type not found');
    return true;
  };

  const buildDriverNeededDocumentKeys = (payload = {}, existing = null) => {
    const imageType = String(payload.image_type || existing?.image_type || 'front_back').trim();
    const baseKey = toDocumentKey(payload.name || existing?.name || 'document');

    if (imageType === 'front_back') {
      return {
        key: '',
        front_key:
          existing?.front_key ||
          String(payload.front_key || '').trim() ||
          `${baseKey}Front`,
        back_key:
          existing?.back_key ||
          String(payload.back_key || '').trim() ||
          `${baseKey}Back`,
      };
    }

    const suffix = imageType === 'front' ? 'Front' : imageType === 'back' ? 'Back' : '';

    return {
      key:
        existing?.key ||
        String(payload.key || '').trim() ||
        `${baseKey}${suffix}`,
      front_key: '',
      back_key: '',
    };
  };

  export const listDriverNeededDocuments = async ({ activeOnly = false, includeFields = false, templateType = 'document' } = {}) => {
    await cleanupLegacySeededDriverNeededDocuments();
    await ensureDefaultDriverVehicleFields();

    const normalizedTemplateType = String(templateType || 'document').trim().toLowerCase();
    const query = {
      ...(activeOnly ? { active: true } : {}),
      ...(normalizedTemplateType === 'all'
        ? {}
        : normalizedTemplateType === 'vehicle_field'
          ? { template_type: 'vehicle_field' }
          : {
              $or: [
                { template_type: 'document' },
                { template_type: { $exists: false } },
                { template_type: null },
                { template_type: '' },
              ],
            }),
    };
    const items = await DriverNeededDocument.find(query).sort({ createdAt: -1 }).lean();
    return items.map((item) => {
      if (normalizeDriverTemplateType(item.template_type) === 'vehicle_field') {
        return serializeDriverVehicleField(item);
      }

      return includeFields ? serializeDriverNeededDocumentTemplate(item) : serializeDriverNeededDocument(item);
    });
  };

  export const getDriverNeededDocumentById = async (id) => {
    await cleanupLegacySeededDriverNeededDocuments();
    await ensureDefaultDriverVehicleFields();

    const item = await DriverNeededDocument.findById(id).lean();
    if (!item) {
      throw new ApiError(404, 'Driver needed document not found');
    }

    return normalizeDriverTemplateType(item.template_type) === 'vehicle_field'
      ? serializeDriverVehicleField(item)
      : serializeDriverNeededDocument(item);
  };

export const listDriverVehicleFieldTemplates = async ({ activeOnly = true } = {}) =>
  listDriverNeededDocuments({ activeOnly, templateType: 'vehicle_field' });

export const listDriverDocumentUploadFields = async ({ activeOnly = true } = {}) => {
  const items = await listDriverNeededDocuments({ activeOnly, includeFields: true });
  return items.flatMap((item) =>
    item.fields.map((field) => ({
      ...field,
      template_id: item.id,
      template_name: item.name,
      account_type: item.account_type,
      image_type: item.image_type,
      has_expiry_date: item.has_expiry_date,
      has_identify_number: item.has_identify_number,
    })),
  );
};

  export const createDriverNeededDocument = async (payload) => {
    if (!payload.name?.trim()) {
      throw new ApiError(400, 'Document name is required');
    }

    await cleanupLegacySeededDriverNeededDocuments();
    await ensureDefaultDriverVehicleFields();

    const templateType = normalizeDriverTemplateType(payload.template_type);

    const name = String(payload.name).trim();
    const slug = slugify(payload.slug || (templateType === 'vehicle_field' ? `vehicle-field-${payload.field_key || name}` : name));
    const existing = await DriverNeededDocument.findOne({ slug });
    if (existing) {
      throw new ApiError(409, `A driver ${templateType === 'vehicle_field' ? 'field' : 'document'} with this name already exists`);
    }

    if (templateType === 'vehicle_field') {
      const fieldKey = String(payload.field_key || '').trim();
      const definition = DRIVER_VEHICLE_FIELD_DEFINITIONS[fieldKey];
      const normalizedFieldType = normalizeDriverVehicleFieldType(payload.field_type || definition?.field_type || 'text');
      const normalizedFieldKey = fieldKey || `custom_${slugify(name).replace(/-/g, '_')}`;

      if (!normalizedFieldKey) {
        throw new ApiError(400, 'A valid vehicle field key is required');
      }

      const duplicateField = await DriverNeededDocument.findOne({
        template_type: 'vehicle_field',
        field_key: normalizedFieldKey,
      }).lean();
      if (duplicateField) {
        throw new ApiError(409, 'A vehicle field with this key already exists');
      }

      const item = await DriverNeededDocument.create({
        template_type: 'vehicle_field',
        name,
        slug,
        account_type: normalizeDriverAccountType(payload.account_type || definition?.account_type),
        image_type: 'image',
        has_expiry_date: false,
        has_identify_number: false,
        identify_number_key: '',
        is_editable: payload.is_editable !== undefined ? normalizeBoolean(payload.is_editable) : true,
        is_required: payload.is_required !== undefined ? normalizeBoolean(payload.is_required) : true,
        active: payload.active !== undefined ? normalizeBoolean(payload.active) : true,
        field_key: normalizedFieldKey,
        field_type: normalizedFieldType,
        field_group: String(payload.field_group || definition?.field_group || '').trim(),
        placeholder: String(payload.placeholder || definition?.placeholder || '').trim(),
        help_text: String(payload.help_text || '').trim(),
        sort_order: Number(payload.sort_order ?? definition?.sort_order ?? 0),
        options: Array.isArray(payload.options) ? payload.options.map((item) => String(item || '').trim()).filter(Boolean) : (definition?.options || []),
        key: '',
        front_key: '',
        back_key: '',
      });

      return serializeDriverVehicleField(item.toObject());
    }

    const keys = buildDriverNeededDocumentKeys(payload);
    const item = await DriverNeededDocument.create({
      template_type: 'document',
      name,
      slug,
      account_type: normalizeDriverAccountType(payload.account_type),
      image_type: String(payload.image_type || 'front_back').trim(),
      has_expiry_date: normalizeBoolean(payload.has_expiry_date),
      has_identify_number: normalizeBoolean(payload.has_identify_number),
      identify_number_key: normalizeBoolean(payload.has_identify_number)
        ? String(payload.identify_number_key || '').trim()
        : '',
      is_editable: normalizeBoolean(payload.is_editable),
      is_required: normalizeBoolean(payload.is_required),
      active: payload.active !== undefined ? normalizeBoolean(payload.active) : true,
      applies_to: normalizeDocumentAppliesTo(payload.applies_to),
      ...keys,
    });

    return serializeDriverNeededDocument(item.toObject());
  };

  export const updateDriverNeededDocument = async (id, payload) => {
    const item = await DriverNeededDocument.findById(id);
    if (!item) {
      throw new ApiError(404, 'Driver needed document not found');
    }

    const templateType = normalizeDriverTemplateType(item.template_type || payload.template_type);

    if (templateType === 'vehicle_field') {
      if (payload.name !== undefined) {
        item.name = String(payload.name || '').trim();
      }
      if (payload.account_type !== undefined) {
        item.account_type = normalizeDriverAccountType(payload.account_type);
      }
      if (payload.field_key !== undefined) {
        const fieldKey = String(payload.field_key || '').trim();
        if (!fieldKey) {
          throw new ApiError(400, 'A valid vehicle field key is required');
        }
        item.field_key = fieldKey;
      }
      if (payload.field_type !== undefined) {
        item.field_type = normalizeDriverVehicleFieldType(payload.field_type);
      }
      if (payload.field_group !== undefined) {
        item.field_group = String(payload.field_group || '').trim();
      }
      if (payload.placeholder !== undefined) {
        item.placeholder = String(payload.placeholder || '').trim();
      }
      if (payload.help_text !== undefined) {
        item.help_text = String(payload.help_text || '').trim();
      }
      if (payload.sort_order !== undefined) {
        item.sort_order = Number(payload.sort_order || 0);
      }
      if (payload.options !== undefined) {
        item.options = Array.isArray(payload.options)
          ? payload.options.map((entry) => String(entry || '').trim()).filter(Boolean)
          : [];
      }
      if (payload.is_editable !== undefined) {
        item.is_editable = normalizeBoolean(payload.is_editable);
      }
      if (payload.is_required !== undefined) {
        item.is_required = normalizeBoolean(payload.is_required);
      }
      if (payload.active !== undefined) {
        item.active = normalizeBoolean(payload.active);
      }

      await item.save();
      return serializeDriverVehicleField(item.toObject());
    }

    if (payload.name !== undefined) {
      item.name = String(payload.name || '').trim();
    }
    if (payload.account_type !== undefined) {
      item.account_type = normalizeDriverAccountType(payload.account_type);
    }
    if (payload.image_type !== undefined) {
      item.image_type = String(payload.image_type || 'front_back').trim();
    }
    if (payload.has_expiry_date !== undefined) {
      item.has_expiry_date = normalizeBoolean(payload.has_expiry_date);
    }
    if (payload.has_identify_number !== undefined) {
      item.has_identify_number = normalizeBoolean(payload.has_identify_number);
    }
    if (payload.identify_number_key !== undefined || payload.has_identify_number !== undefined) {
      item.identify_number_key = item.has_identify_number
        ? String(payload.identify_number_key ?? item.identify_number_key ?? '').trim()
        : '';
    }
    if (payload.is_editable !== undefined) {
      item.is_editable = normalizeBoolean(payload.is_editable);
    }
    if (payload.is_required !== undefined) {
      item.is_required = normalizeBoolean(payload.is_required);
    }
    if (payload.active !== undefined) {
      item.active = normalizeBoolean(payload.active);
    }

    const keys = buildDriverNeededDocumentKeys(
      {
        ...item.toObject(),
        ...payload,
        name: item.name,
        image_type: item.image_type,
      },
      item.toObject(),
    );

    item.key = keys.key;
    item.front_key = keys.front_key;
    item.back_key = keys.back_key;

    // Which classes of driver must produce this. Absent means "not sent,
    // leave alone"; an empty ARRAY is a real value meaning "everyone", so
    // clearing all three boxes has to be savable.
    if (payload.applies_to !== undefined) {
      item.applies_to = normalizeDocumentAppliesTo(payload.applies_to);
    }

    await item.save();
    return serializeDriverNeededDocument(item.toObject());
  };

  export const deleteDriverNeededDocument = async (id) => {
    const deleted = await DriverNeededDocument.findByIdAndDelete(id);
    if (!deleted) {
      throw new ApiError(404, 'Driver needed document not found');
    }

    return true;
  };


  export const listReferralTranslations = async () => {
    const [languages, translations] = await Promise.all([
      AppLanguage.find().sort({ default_status: -1, code: 1 }).lean(),
      ReferralTranslation.find().sort({ language_code: 1 }).lean(),
    ]);

    const translationMap = new Map(
      translations.map((item) => [String(item.language_code || '').toLowerCase(), item]),
    );

    const languageRows = languages.map((language) =>
      serializeReferralTranslation({
        language,
        translation: translationMap.get(String(language.code || '').toLowerCase()) || null,
      }),
    );

    const existingCodes = new Set(languageRows.map((item) => item.language_code));

    const orphanRows = translations
      .filter((item) => !existingCodes.has(String(item.language_code || '').toLowerCase()))
      .map((item) =>
        serializeReferralTranslation({
          language: null,
          translation: item,
        }),
      );

    return [...languageRows, ...orphanRows];
  };

  export const updateReferralTranslation = async (languageCode, payload = {}) => {
    const normalizedLanguageCode = String(languageCode || '').trim().toLowerCase();

    if (!normalizedLanguageCode) {
      throw new ApiError(400, 'languageCode is required');
    }

    const language = await AppLanguage.findOne({ code: normalizedLanguageCode }).lean();

    const item = await ReferralTranslation.findOneAndUpdate(
      { language_code: normalizedLanguageCode },
      {
        $set: {
          language_code: normalizedLanguageCode,
          language_name: language?.name || String(payload.language_name || ''),
          user_referral: normalizeReferralTranslationSection(payload.user_referral),
          driver_referral: normalizeReferralTranslationSection(payload.driver_referral),
        },
      },
      {
        returnDocument: 'after',
        upsert: true,
        setDefaultsOnInsert: true,
      },
    ).lean();

    return serializeReferralTranslation({
      language,
      translation: item,
    });
  };

  export const getReferralTranslationContent = async (languageCode = '') => {
    const { languages, preferredLanguage, normalizedLanguageCode } =
      await resolveReferralTranslationLanguage(languageCode);

    const codesToTry = [
      normalizedLanguageCode,
      preferredLanguage?.code,
      languages.find((item) => Number(item.default_status) === 1)?.code,
      'en',
    ]
      .map((item) => String(item || '').trim().toLowerCase())
      .filter(Boolean);

    let translation = null;
    let resolvedLanguage = preferredLanguage;

    if (codesToTry.length > 0) {
      translation = await ReferralTranslation.findOne({
        language_code: { $in: codesToTry },
      })
        .sort({ updatedAt: -1 })
        .lean();

      if (translation) {
        resolvedLanguage =
          languages.find(
            (item) =>
              String(item.code || '').toLowerCase() === String(translation.language_code || '').toLowerCase(),
          ) || resolvedLanguage;
      }
    }

    return {
      language_code: String(
        resolvedLanguage?.code || translation?.language_code || normalizedLanguageCode || 'en',
      )
        .trim()
        .toLowerCase(),
      language_name: resolvedLanguage?.name || translation?.language_name || '',
      user_referral: {
        ...REFERRAL_TRANSLATION_DEFAULTS,
        ...normalizeReferralTranslationSection(translation?.user_referral),
      },
      driver_referral: {
        ...REFERRAL_TRANSLATION_DEFAULTS,
        ...normalizeReferralTranslationSection(translation?.driver_referral),
      },
      available_languages: languages.map((item) => ({
        code: String(item.code || '').toLowerCase(),
        name: item.name || '',
        active: Number(item.active ?? 1) === 1,
        default_status: Number(item.default_status ?? 0) === 1,
      })),
    };
  };



  export const listLanguages = async () => AppLanguage.find().sort({ code: 1 }).lean();

  export const updateLanguageStatus = async (id, payload) => {
    const language = await AppLanguage.findByIdAndUpdate(id, { active: Number(payload.active) }, { returnDocument: 'after' });
    if (!language) throw new ApiError(404, 'Language not found');
    return language.toObject();
  };

  export const deleteLanguage = async (id) => {
    const deleted = await AppLanguage.findByIdAndDelete(id);
    if (!deleted) throw new ApiError(404, 'Language not found');
    return true;
  };

  export const listPreferences = async () => UserPreference.find().sort({ createdAt: -1 }).lean();

  export const createPreference = async (payload) => {
    const firstLetter = (payload.name || 'P').trim().charAt(0).toUpperCase() || 'P';
    const preference = await UserPreference.create({
      name: payload.name,
      icon: payload.icon || `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect rx="16" width="64" height="64" fill="%23E0E7FF"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-size="28">${firstLetter}</text></svg>`,
      active: 1,
    });
    return preference.toObject();
  };

  export const updatePreferenceStatus = async (id, payload) => {
    const preference = await UserPreference.findByIdAndUpdate(id, { active: Number(payload.active) }, { returnDocument: 'after' });
    if (!preference) throw new ApiError(404, 'Preference not found');
    return preference.toObject();
  };

  export const deletePreference = async (id) => {
    const deleted = await UserPreference.findByIdAndDelete(id);
    if (!deleted) throw new ApiError(404, 'Preference not found');
    return true;
  };

  export const listRoles = async () => AdminRole.find().sort({ createdAt: -1 }).lean();

  export const createRole = async (payload) => {
    const role = await AdminRole.create({
      name: payload.name,
      description: payload.description || '',
      slug: payload.name?.trim().toLowerCase().replace(/\s+/g, '-') || `role-${Date.now()}`,
    });
    return role.toObject();
  };

  export const deleteRole = async (id) => {
    const deleted = await AdminRole.findByIdAndDelete(id);
    if (!deleted) throw new ApiError(404, 'Role not found');
    return true;
  };



  export const listNotificationChannels = async () => NotificationChannel.find().sort({ createdAt: 1 }).lean();

  export const toggleChannelPush = async (id, status) => {
    const channel = await NotificationChannel.findByIdAndUpdate(id, { push_notification: !!status }, { returnDocument: 'after' });
    if (!channel) throw new ApiError(404, 'Channel not found');
    return channel.toObject();
  };

  export const toggleChannelMail = async (id, status) => {
    const channel = await NotificationChannel.findByIdAndUpdate(id, { mail: !!status }, { returnDocument: 'after' });
    if (!channel) throw new ApiError(404, 'Channel not found');
    return channel.toObject();
  };

  export const listPaymentGateways = async () => PaymentGateway.find().sort({ name: 1 }).lean();

  export const listPaymentMethods = async () =>
    PaymentMethod.find().sort({ createdAt: -1 }).lean();

  export const createPaymentMethod = async (payload = {}) => {
    const name = String(payload.method_name ?? payload.name ?? '').trim();
    if (!name) {
      throw new ApiError(400, 'Method name is required');
    }

    const fields = Array.isArray(payload.fields)
      ? payload.fields
        .map((field) => ({
          type: String(field?.type || 'text'),
          name: String(field?.name || '').trim(),
          placeholder: String(field?.placeholder || '').trim(),
          is_required: Boolean(field?.is_required),
        }))
        .filter((field) => field.name)
      : [];

    const method = await PaymentMethod.create({
      name,
      fields,
      active: payload.active !== undefined ? Boolean(payload.active) : true,
    });

    return method.toObject();
  };

  export const updatePaymentMethod = async (id, payload = {}) => {
    const update = {};

    if (payload.method_name !== undefined || payload.name !== undefined) {
      const name = String(payload.method_name ?? payload.name ?? '').trim();
      if (!name) {
        throw new ApiError(400, 'Method name is required');
      }
      update.name = name;
    }

    if (payload.fields !== undefined) {
      const fields = Array.isArray(payload.fields)
        ? payload.fields
          .map((field) => ({
            type: String(field?.type || 'text'),
            name: String(field?.name || '').trim(),
            placeholder: String(field?.placeholder || '').trim(),
            is_required: Boolean(field?.is_required),
          }))
          .filter((field) => field.name)
        : [];
      update.fields = fields;
    }

    if (payload.active !== undefined) {
      update.active = Boolean(payload.active);
    }

    const method = await PaymentMethod.findByIdAndUpdate(id, update, {
      returnDocument: 'after',
      runValidators: true,
    });
    if (!method) {
      throw new ApiError(404, 'Payment method not found');
    }
    return method.toObject();
  };

  export const deletePaymentMethod = async (id) => {
    const deleted = await PaymentMethod.findByIdAndDelete(id);
    if (!deleted) {
      throw new ApiError(404, 'Payment method not found');
    }
    return true;
  };

  export const getPaymentSettings = async () => {
    const settings = await ensureThirdPartySettings();
    const activeGateway = await getActivePaymentGateway();
    return { settings: settings.payment || {}, active_gateway: activeGateway };
  };

  export const updatePaymentSettings = async (payload) => {
    const settings = await ensureThirdPartySettings();
    settings.payment = normalizePaymentSettingsPayload(
      settings.payment || {},
      deepMerge(settings.payment || {}, payload),
    );
    settings.markModified('payment');
    await settings.save();
    const activeGateway = await getActivePaymentGateway();
    return { settings: settings.payment, active_gateway: activeGateway };
  };

  export const getSMSSettings = async () => {
    const settings = await ensureThirdPartySettings();
    return { settings: settings.sms || {} };
  };

  export const updateSMSSettings = async (payload) => {
    const settings = await ensureThirdPartySettings();
    settings.sms = deepMerge(settings.sms || {}, payload);
    settings.markModified('sms');
    await settings.save();
    return { settings: settings.sms };
  };

  export const getFirebaseSettings = async () => {
    const settings = await ensureThirdPartySettings();
    return { settings: settings.firebase || {} };
  };

  export const updateFirebaseSettings = async (payload) => {
    const settings = await ensureThirdPartySettings();
    settings.firebase = {
      ...settings.firebase,
      ...payload,
      firebase_json_name: payload.firebase_json_name || settings.firebase.firebase_json_name,
    };
    settings.markModified('firebase');
    await settings.save();
    // core/settings/firebaseSettings.service.js caches this for 30s so it is not
    // read per request. Drop the cache here so a save in the admin panel is visible
    // on the very next page load rather than up to half a minute later.
    const { invalidateFirebaseSettingsCache } = await import('../../../../core/settings/firebaseSettings.service.js');
    invalidateFirebaseSettingsCache();
    // The push sender caches the service account and an OAuth token minted from
    // it. Without this, changing the Firebase project here would keep signing
    // pushes with the previous key until the token expired an hour later, and
    // every notification in between would be rejected as a SenderId mismatch.
    const { invalidateFirebaseSenderCache } = await import('../../../../core/notifications/firebase.service.js');
    invalidateFirebaseSenderCache();
    return { settings: settings.firebase };
  };

  export const getMapSettings = async () => {
    const settings = await ensureThirdPartySettings();
    return { settings: settings.map_apis || {} };
  };

  export const updateMapSettings = async (payload) => {
    const settings = await ensureThirdPartySettings();
    settings.map_apis = { ...settings.map_apis, ...payload };
    settings.markModified('map_apis');
    await settings.save();
    // /api/v1/env/public serves this key to every frontend; drop its cache so the
    // panel feels immediate instead of waiting out the TTL.
    invalidateMapSettingsCache();
    return { settings: settings.map_apis };
  };

  export const getMailSettings = async () => {
    const settings = await ensureThirdPartySettings();
    return { settings: settings.mail || {} };
  };

  export const updateMailSettings = async (payload) => {
    const settings = await ensureThirdPartySettings();
    settings.mail = { ...settings.mail, ...payload };
    settings.markModified('mail');
    await settings.save();
    return { settings: settings.mail };
  };



  const buildDateFilter = (date_option, from_date, to_date) => {
    const filter = {};
    const now = new Date();
    
    if (date_option === 'today') {
      filter.$gte = new Date(now.setHours(0,0,0,0));
    } else if (date_option === 'yesterday') {
      const yesterday = new Date(now.setDate(now.getDate() - 1));
      filter.$gte = new Date(yesterday.setHours(0,0,0,0));
      filter.$lt = new Date(new Date().setHours(0,0,0,0));
    } else if (date_option === 'this_week') {
      const first = now.getDate() - now.getDay();
      filter.$gte = new Date(now.setDate(first));
    } else if (date_option === 'this_month') {
      filter.$gte = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (date_option === 'this_year') {
      filter.$gte = new Date(now.getFullYear(), 0, 1);
    } else if (date_option === 'range' && from_date && to_date) {
      filter.$gte = new Date(new Date(from_date).setHours(0,0,0,0));
      filter.$lte = new Date(new Date(to_date).setHours(23,59,59,999));
    }
    
    return Object.keys(filter).length > 0 ? filter : null;
  };

  export const buildUserReport = async (query = {}) => {
    const { status, date_option, from_date, to_date } = query;
    const filter = { deletedAt: null };
    
    if (status === 'active') filter.active = true;
    else if (status === 'inactive') filter.active = false;

    const dateFilter = buildDateFilter(date_option, from_date, to_date);
    if (dateFilter) filter.createdAt = dateFilter;

    const users = await User.find(filter).sort({ createdAt: -1 }).lean();
    return {
      headers: ['name', 'email', 'mobile', 'active', 'createdAt'],
      rows: users.map((item) => ({
        name: item.name || '',
        email: item.email || '',
        mobile: item.phone || item.mobile || '',
        active: item.active !== false && !item.deletedAt,
        createdAt: item.createdAt ? new Date(item.createdAt).toLocaleString() : ''
      }))
    };
  };

  export const buildDriverReport = async (query = {}) => {
    const { transport_type, vehicle_type, status, date_option, from_date, to_date } = query;
    const filter = {};
    
    if (transport_type === 'both') {
      filter.registerFor = { $in: ['taxi', 'bike', 'both'] };
    } else if (transport_type) {
      filter.registerFor = transport_type;
    }

    if (vehicle_type) filter.vehicleType = vehicle_type;
    if (status) filter.status = status;

    const dateFilter = buildDateFilter(date_option, from_date, to_date);
    if (dateFilter) filter.createdAt = dateFilter;

    const items = await Driver.find(filter).lean();
    return {
      headers: ['name', 'mobile', 'city', 'transport_type', 'vehicle_type', 'status', 'createdAt'],
      rows: items.map((item) => ({ 
        name: item.name, 
        mobile: item.phone, 
        city: item.city, 
        transport_type: item.registerFor,
        vehicle_type: item.vehicleType,
        status: item.status,
        createdAt: item.createdAt ? new Date(item.createdAt).toLocaleString() : ''
      }))
    };
  };

export const buildDriverDutyReport = async (query = {}) => {
    const {
      service_location_id,
      driver_id,
      driver,
      status,
      date_option,
      from_date,
      to_date,
    } = query;
    const selectedDriverId = driver_id || driver;
    const driverFilter = {};

    if (service_location_id) {
      driverFilter.service_location_id = service_location_id;
    }
    if (selectedDriverId) {
      driverFilter._id = selectedDriverId;
    }

    const drivers = await Driver.find(driverFilter)
      .select('name phone city registerFor vehicleType service_location_id')
      .lean();
    const driverIds = drivers.map((item) => item._id);
    const driverMap = new Map(drivers.map((item) => [String(item._id), item]));

    if (driverIds.length === 0) {
      return {
        headers: ['ride_id', 'driver', 'driver_phone', 'transport_type', 'vehicle_type', 'pickup', 'drop', 'payment_method', 'fare', 'status', 'ride_time'],
        rows: [],
      };
    }

    const rideFilter = {
      driverId: { $in: driverIds },
    };

    if (status) {
      rideFilter.status = String(status).trim().toLowerCase();
    }

    const dateFilter = buildDateFilter(date_option, from_date, to_date);
    if (dateFilter) {
      rideFilter.createdAt = dateFilter;
    }

    const rides = await Ride.find(rideFilter)
      .sort({ createdAt: -1 })
      .select('driverId pickupAddress dropAddress paymentMethod fare status createdAt transport_type vehicleTypeId')
      .populate('vehicleTypeId', 'name type_name transport_type')
      .lean();

    return {
      headers: ['ride_id', 'driver', 'driver_phone', 'transport_type', 'vehicle_type', 'pickup', 'drop', 'payment_method', 'fare', 'status', 'ride_time'],
      rows: rides.map((ride) => {
        const rideDriver = driverMap.get(String(ride.driverId || '')) || {};
        const vehicleType =
          ride?.vehicleTypeId?.type_name ||
          ride?.vehicleTypeId?.name ||
          rideDriver?.vehicleType ||
          '';

        return {
          ride_id: String(ride._id),
          driver: rideDriver.name || 'Unknown Driver',
          driver_phone: rideDriver.phone || '',
          transport_type:
            ride?.vehicleTypeId?.transport_type ||
            ride?.transport_type ||
            rideDriver?.registerFor ||
            'taxi',
          vehicle_type: vehicleType,
          pickup: ride.pickupAddress || '',
          drop: ride.dropAddress || '',
          payment_method: ride.paymentMethod || '',
          fare: Number(ride.fare || 0),
          status: ride.status || '',
          ride_time: ride.createdAt ? new Date(ride.createdAt).toLocaleString() : '',
        };
      }),
    };
  };

  export const buildFinanceReport = async (query = {}) => {
    const {
      transport_type,
      vehicle_type,
      status,
      trip_status,
      payment_type,
      date_option,
      from_date,
      to_date,
    } = query;
    const rideFilter = {};
    const effectiveStatus = status || trip_status;

    if (effectiveStatus) {
      rideFilter.status = String(effectiveStatus).trim().toLowerCase();
    }
    if (payment_type) {
      rideFilter.paymentMethod = String(payment_type).trim().toLowerCase();
    }

    const dateFilter = buildDateFilter(date_option, from_date, to_date);
    if (dateFilter) {
      rideFilter.createdAt = dateFilter;
    }

    const items = await Ride.find(rideFilter)
      .sort({ createdAt: -1 })
      .select('driverId userId fare status paymentMethod createdAt transport_type commissionAmount driverEarnings')
      .populate('driverId', 'name phone registerFor vehicleType')
      .populate('userId', 'name phone')
      .lean();

    const normalizedTransportType = String(transport_type || '').trim().toLowerCase();
    const normalizedVehicleType = String(vehicle_type || '').trim().toLowerCase();

    const rows = items
      .map((item) => {
        const resolvedTransportType =
          String(
            item.transport_type ||
            item.driverId?.registerFor ||
            item.driverId?.vehicleType ||
            'taxi',
          )
            .trim()
            .toLowerCase();
        const resolvedVehicleType = String(item.driverId?.vehicleType || '').trim().toLowerCase();
        const fare = Number(item.fare || 0);
        const commission =
          item.commissionAmount !== undefined && item.commissionAmount !== null
            ? Number(item.commissionAmount || 0)
            : Math.max(fare - Number(item.driverEarnings || 0), 0);

        return {
          ride_id: String(item._id),
          driver: item.driverId?.name || 'Unassigned',
          driver_phone: item.driverId?.phone || '',
          user: item.userId?.name || '',
          user_phone: item.userId?.phone || '',
          transport_type: resolvedTransportType,
          vehicle_type: resolvedVehicleType,
          payment_method: String(item.paymentMethod || '').toLowerCase(),
          fare,
          admin_commission: Number(commission.toFixed(2)),
          driver_earnings: Number(Math.max(fare - commission, 0).toFixed(2)),
          status: item.status || '',
          createdAt: item.createdAt ? new Date(item.createdAt).toLocaleString() : '',
        };
      })
      .filter((item) => {
        const transportMatches =
          !normalizedTransportType ||
          normalizedTransportType === 'all' ||
          normalizedTransportType === 'both' ||
          item.transport_type === normalizedTransportType;
        const vehicleMatches =
          !normalizedVehicleType ||
          item.vehicle_type === normalizedVehicleType;
        return transportMatches && vehicleMatches;
      });

    return {
      headers: ['ride_id', 'driver', 'driver_phone', 'user', 'user_phone', 'transport_type', 'vehicle_type', 'payment_method', 'fare', 'admin_commission', 'driver_earnings', 'status', 'createdAt'],
      rows,
    };
  };

  export const ensureBusinessSettings = async () => {
    let settings = await AdminBusinessSetting.findOne({ scope: 'default' });
    if (!settings) {
      settings = await AdminBusinessSetting.create(createDefaultBusinessSettings());
    }
    return settings;
  };

  /**
   * Ensures a default third-party settings document exists.
   */
  export const ensureThirdPartySettings = async () => {
    let settings = await AdminThirdPartySetting.findOne({ scope: 'default' });
    if (!settings) {
      settings = await AdminThirdPartySetting.create(createDefaultThirdPartySettings());
    }
    return settings;
  };

  /**
   * Ensures a default administrative application settings document exists.
   */
  export const ensureAppSettings = async () => {
    let settings = await AdminAppSetting.findOne({ scope: 'default' });
    if (!settings) {
      settings = await AdminAppSetting.create(createDefaultAppSettings());
    }
    return settings;
  };

  export const ensureAppModules = async () => {
    // No-op: AppModule is now nested inside AdminAppSetting
    return;
  };

  const businessSettingsCategoryMap = {
    customize: 'customization',
    'transport-ride': 'transport_ride',
    'bid-ride': 'bid_ride',
    general: 'general',
  };

  const appSettingsCategoryMap = {
    wallet: 'wallet_setting',
    tip: 'tip_setting',
  };

  const generalBusinessSettingsProjection = {
    _id: 0,
    general: {
      app_name: '$general.app_name',
      contact_phone_1: '$general.contact_phone_1',
      contact_phone_2: '$general.contact_phone_2',
      contact_booking_number: '$general.contact_booking_number',
      footer_1: '$general.footer_1',
      footer_2: '$general.footer_2',
      default_lat: '$general.default_lat',
      default_lng: '$general.default_lng',
      logo: '$general.logo',
      favicon: '$general.favicon',
      brand_logo: '$general.brand_logo',
      landing_video_url: '$general.landing_video_url',
    },
  };

  const getGeneralBusinessSettingsSection = async () => {
    let results = await AdminBusinessSetting.aggregate([
      { $match: { scope: 'default' } },
      { $project: generalBusinessSettingsProjection },
      { $limit: 1 },
    ]);

    if (results.length === 0) {
      const created = await AdminBusinessSetting.create(createDefaultBusinessSettings());
      return created.general || {};
    }

    // Master settings win where set (core/settings/platformProfile.service.js).
    const general = { ...(results[0]?.general || {}) };
    const b = await managedBrand();
    if (b.name) general.app_name = b.name;
    if (b.logoUrl) general.logo = b.logoUrl;
    if (b.faviconUrl) general.favicon = b.faviconUrl;
    if (b.phone) general.contact_booking_number = `${b.phoneCountryCode || ''}${b.phone}`;
    if (b.currencySymbol) general.currency_symbol = b.currencySymbol;
    if (b.currencyCode) general.default_currency_code_for_mobile_app = b.currencyCode;
    return general;
  };

  const getProjectedSettingsSection = async (Model, defaultFactory, key) => {
    if (!Model.schema.path(key)) {
      return {};
    }

    let settings = await Model.findOne(
      { scope: 'default' },
      { [key]: 1, _id: 0 },
    ).lean();

    if (!settings) {
      const created = await Model.create(defaultFactory());
      return created[key] || {};
    }

    return settings[key] || {};
  };

  export const getGeneralSettings = async (category) => {
    const appKey = appSettingsCategoryMap[category];
    if (appKey) {
      return {
        settings: await getProjectedSettingsSection(
          AdminAppSetting,
          createDefaultAppSettings,
          appKey,
        ),
      };
    }

    const businessKey = businessSettingsCategoryMap[category] || category;
    if (businessKey === 'general') {
      return {
        settings: await getGeneralBusinessSettingsSection(),
      };
    }

    return {
      settings: await getProjectedSettingsSection(
        AdminBusinessSetting,
        createDefaultBusinessSettings,
        businessKey,
      ),
    };
  };

  export const updateGeneralSettings = async (category, payload) => {
    const bizSettings = await ensureBusinessSettings();
    const appSettings = await ensureAppSettings();

    const newValues = payload.settings || payload;

    if (appSettingsCategoryMap[category]) {
      const key = appSettingsCategoryMap[category];
      appSettings[key] = { ...(appSettings[key] || {}), ...newValues };
      appSettings.markModified(key);
      await appSettings.save();
      return { settings: appSettings[key] };
    }

    const bizKey = businessSettingsCategoryMap[category] || category;
    if (!bizSettings.schema.path(bizKey)) {
      return { settings: {} };
    }

    bizSettings[bizKey] = { ...(bizSettings[bizKey] || {}), ...newValues };
    bizSettings.markModified(bizKey);
    await bizSettings.save();
    return { settings: bizSettings[bizKey] };
  };

  export const listAppModules = async (query = {}) => {
    const safePage = Number(query.page) || 1;
    const safeLimit = Number(query.limit) || 10;
    const start = (safePage - 1) * safeLimit;

    const [modules, total] = await Promise.all([
      TaxiAppModule.find()
        .sort({ order_by: 1, createdAt: -1 })
        .skip(start)
        .limit(safeLimit)
        .lean(),
      TaxiAppModule.countDocuments(),
    ]);

    const results = modules.map(m => ({
      _id: m._id,
      id: String(m._id),
      name: m.name,
      transport_type: m.transport_type,
      service_type: m.service_type,
      icon_types_for: m.icon_types_for,
      order_by: m.order_by,
      short_description: m.short_description,
      description: m.description,
      mobile_menu_icon: m.mobile_menu_icon,
      mobile_menu_cover_image: m.mobile_menu_cover_image,
      active: m.active,
      created_at: m.createdAt,
      updated_at: m.updatedAt
    }));

    return {
      results,
      paginator: {
        total,
        current_page: safePage,
        per_page: safeLimit,
        last_page: Math.max(1, Math.ceil(total / safeLimit)),
      },
    };
  };

  export const createAppModule = async (payload) => {
    const item = await TaxiAppModule.create({
      name: String(payload.name || '').trim(),
      transport_type: payload.transport_type || 'taxi',
      service_type: payload.service_type || 'normal',
      icon_types_for: payload.icon_types_for || null,
      order_by: Number(payload.order_by || 1),
      short_description: String(payload.short_description || '').trim(),
      description: String(payload.description || '').trim(),
      mobile_menu_icon: String(payload.mobile_menu_icon || '').trim(),
      mobile_menu_cover_image: payload.mobile_menu_cover_image || null,
      active: payload.active !== undefined ? (normalizeBoolean(payload.active) ? 1 : 0) : 1,
      company_key: payload.company_key || null
    });
    return item.toObject();
  };

  export const updateAppModule = async (id, payload) => {
    const update = {};
    if (payload.name !== undefined) update.name = String(payload.name).trim();
    if (payload.transport_type !== undefined) update.transport_type = payload.transport_type;
    if (payload.service_type !== undefined) update.service_type = payload.service_type;
    if (payload.icon_types_for !== undefined) update.icon_types_for = payload.icon_types_for;
    if (payload.order_by !== undefined) update.order_by = Number(payload.order_by);
    if (payload.short_description !== undefined) update.short_description = String(payload.short_description);
    if (payload.description !== undefined) update.description = String(payload.description);
    if (payload.mobile_menu_icon !== undefined) update.mobile_menu_icon = String(payload.mobile_menu_icon);
    if (payload.mobile_menu_cover_image !== undefined) update.mobile_menu_cover_image = payload.mobile_menu_cover_image;
    if (payload.active !== undefined) update.active = normalizeBoolean(payload.active) ? 1 : 0;
    if (payload.company_key !== undefined) update.company_key = payload.company_key;

    const item = await TaxiAppModule.findByIdAndUpdate(id, { $set: update }, { returnDocument: 'after' });
    if (!item) throw new ApiError(404, 'App module not found in database registry');
    return item.toObject();
  };

  export const deleteAppModule = async (id) => {
    const deleted = await TaxiAppModule.findByIdAndDelete(id);
    if (!deleted) throw new ApiError(404, 'App module registration not found');
    return true;
  };

  export const listOnboardingScreens = async (audience) => {
    const query = {};
    if (audience) {
      query.$or = [{ audience: audience }, { screen: audience }];
    }
    return OnboardingScreen.find(query).sort({ order: 1 }).lean();
  };

  export const createOnboardingScreen = async (payload = {}) => {
    const audience = String(payload.audience || payload.screen || 'user').trim().toLowerCase();
    if (!['user', 'driver'].includes(audience)) {
      throw new ApiError(400, 'Valid onboarding audience is required');
    }

    const title = String(payload.title || '').trim();
    if (!title) {
      throw new ApiError(400, 'Onboarding title is required');
    }

    const item = await OnboardingScreen.create({
      audience,
      screen: audience,
      order: Number(payload.order || 1),
      title,
      description: String(payload.description || '').trim(),
      active: payload.active !== undefined ? normalizeBoolean(payload.active) : true,
    });

    return item.toObject();
  };

  export const updateOnboardingScreen = async (id, payload = {}) => {
    const update = {};

    if (payload.audience !== undefined || payload.screen !== undefined) {
      const audience = String(payload.audience || payload.screen || '').trim().toLowerCase();
      if (!['user', 'driver'].includes(audience)) {
        throw new ApiError(400, 'Valid onboarding audience is required');
      }
      update.audience = audience;
      update.screen = audience;
    }
    if (payload.order !== undefined) {
      update.order = Number(payload.order || 1);
    }
    if (payload.title !== undefined) {
      const title = String(payload.title || '').trim();
      if (!title) {
        throw new ApiError(400, 'Onboarding title is required');
      }
      update.title = title;
    }
    if (payload.description !== undefined) {
      update.description = String(payload.description || '').trim();
    }
    if (payload.active !== undefined) {
      update.active = normalizeBoolean(payload.active);
    }

    const item = await OnboardingScreen.findByIdAndUpdate(
      id,
      { $set: update },
      { returnDocument: 'after', runValidators: true },
    );
    if (!item) {
      throw new ApiError(404, 'Onboarding screen not found');
    }

    return item.toObject();
  };

  export const deleteOnboardingScreen = async (id) => {
    const deleted = await OnboardingScreen.findByIdAndDelete(id);
    if (!deleted) {
      throw new ApiError(404, 'Onboarding screen not found');
    }
    return true;
  };

  export const listTransportTypes = async () => {
    // Legacy 'pooling' rows may still be in the collection; shared rides are gone.
    const query = { active: true, name: { $ne: 'pooling' } };
    let types = await TaxiTransportType.find(query).lean();
    const bothType = types.find(t => t.name === 'both');
    const needsBothUpdate = bothType && bothType.display_name !== 'Taxi & Delivery';
    if (types.length === 0 || !bothType || needsBothUpdate) {
      await seedTransportTypes();
      types = await TaxiTransportType.find(query).lean();
    }
    return types;
  };

  export const seedTransportTypes = async () => {
    const defaults = [
      { name: 'taxi', display_name: 'Taxi' },
      { name: 'delivery', display_name: 'Delivery' },
      { name: 'both', display_name: 'Taxi & Delivery' }
    ];
    
    const results = [];
    for (const item of defaults) {
      const existing = await TaxiTransportType.findOne({ name: item.name });
      if (!existing) {
        results.push(await TaxiTransportType.create(item));
      } else {
        if (existing.display_name !== item.display_name) {
          existing.display_name = item.display_name;
          await existing.save();
        }
        results.push(existing);
      }
    }
    return results;
  };
