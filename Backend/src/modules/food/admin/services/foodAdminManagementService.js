import { FoodAdmin } from '../../../../core/admin/admin.model.js';
// Deleting or editing an admin must evict the cached copy the auth middleware serves.
import { invalidateAdminCache } from '../middlewares/foodAdmin.middleware.js';
import { FoodZone } from '../models/zone.model.js';
import { listFoodPermissionCatalog } from './foodAdminAccessService.js';
import {
  serializeAdminContext,
  buildDescendantAdminQuery,
  assertCanManageTargetAdmin,
  assertCanCreateAdmin,
  isPlatformSuperAdmin,
  isModuleSuperAdmin,
  resolveAdminModule,
} from '../../../../core/admin/adminHierarchy.service.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { ApiError } from '../../../../utils/ApiError.js';
import { normalizeAdminPermissions } from '../../../../core/admin/adminAccess.util.js';
import mongoose from 'mongoose';

/** Zone ids from whatever the panel sent: ids, or { _id } / { id } objects. */
const normalizeZoneIdList = (value) => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (entry && typeof entry === 'object' ? entry._id || entry.id : entry))
    .map((id) => String(id || '').trim())
    .filter((id) => /^[a-f0-9]{24}$/i.test(id));
};

/**
 * Lists the catalog of food permission resources.
 */
export async function listFoodAdminPermissions(req) {
  return listFoodPermissionCatalog();
}

/**
 * Lists all active food zones that the current admin is authorized to assign.
 */
export async function listAssignableFoodZones(adminContext) {
  const isSuper = adminContext.adminLevel === 'platform_superadmin' || 
                  (adminContext.adminLevel === 'food_superadmin' && adminContext.module === 'food');

  if (isSuper) {
    return FoodZone.find({ isActive: true }).select('_id name zoneName').lean();
  }

  // Subadmins can only assign from their own food_zone_ids
  if (!adminContext.food_zone_ids || adminContext.food_zone_ids.length === 0) {
    return [];
  }

  return FoodZone.find({
    _id: { $in: adminContext.food_zone_ids },
    isActive: true
  }).select('_id name zoneName').lean();
}

/**
 * Lists food admins under current admin hierarchy.
 */
export async function listFoodAdmins(currentAdmin, query = {}) {
  const hierarchyFilter = await buildDescendantAdminQuery(currentAdmin);
  
  // Filter only food module admins
  const filter = {
    ...hierarchyFilter,
    module: 'food',
  };

  const limit = Math.max(1, Number(query.limit) || 10);
  const page = Math.max(1, Number(query.page) || 1);
  const skip = (page - 1) * limit;

  const total = await FoodAdmin.countDocuments(filter);
  const results = await FoodAdmin.find(filter)
    .populate('food_zone_ids', 'name zoneName')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const serializedResults = results.map(admin => {
    const context = serializeAdminContext(admin);
    return {
      ...admin,
      ...context,
      id: admin._id.toString()
    };
  });

  return {
    results: serializedResults,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
}

/**
 * Retrieves a single food admin under the hierarchy by ID.
 */
export async function getFoodAdminById(currentAdmin, targetId) {
  await assertCanManageTargetAdmin(currentAdmin, targetId);

  const admin = await FoodAdmin.findOne({ _id: targetId, module: 'food' })
    .populate('food_zone_ids', 'name zoneName')
    .lean();

  if (!admin) {
    throw new ApiError(404, 'Food admin account not found');
  }

  const context = serializeAdminContext(admin);
  return {
    ...admin,
    ...context,
    id: admin._id.toString()
  };
}

/**
 * Creates a new food subadmin or food superadmin under current admin.
 */
export async function createFoodAdminAccount(currentAdmin, payload) {
  const {
    name,
    email,
    phone,
    adminLevel,
    permissions = [],
    password,
    password_confirmation,
    active
  } = payload;
  const food_zone_ids = normalizeZoneIdList(payload.food_zone_ids) || [];

  if (!password || password.length < 6) {
    throw new ValidationError('Password must be at least 6 characters');
  }

  if (password !== password_confirmation) {
    throw new ValidationError('Passwords do not match');
  }

  const normalizedPermissions = normalizeAdminPermissions(permissions);

  const childData = {
    adminLevel: adminLevel || 'subadmin',
    module: 'food',
    permissions: adminLevel === 'food_superadmin' ? ['*'] : normalizedPermissions,
    food_zone_ids: adminLevel === 'food_superadmin' ? [] : food_zone_ids,
  };

  // Assert hierarchy constraints
  assertCanCreateAdmin(currentAdmin, childData);

  // If subadmin: must have at least one permission and zone
  if (childData.adminLevel === 'subadmin') {
    if (childData.permissions.length === 0) {
      throw new ValidationError('Subadmin must have at least one permission');
    }
    if (childData.food_zone_ids.length === 0) {
      throw new ValidationError('Subadmin must have at least one assigned zone');
    }
  }

  const existing = await FoodAdmin.findOne({ email: String(email).trim().toLowerCase() });
  if (existing) {
    throw new ValidationError('Email is already registered');
  }

  const admin = await FoodAdmin.create({
    name: String(name || '').trim(),
    email: String(email || '').trim().toLowerCase(),
    phone: String(phone || '').trim(),
    password,
    adminLevel: childData.adminLevel,
    admin_type: childData.adminLevel === 'food_superadmin' ? 'superadmin' : 'subadmin',
    module: 'food',
    permissions: childData.permissions,
    food_zone_ids: childData.food_zone_ids,
    parentAdminId: currentAdmin._id,
    isActive: active !== false,
    servicesAccess: ['food']
  });

  return serializeAdminContext(admin);
}

/**
 * Updates a food subadmin or food superadmin under current admin.
 */
export async function updateFoodAdminAccount(currentAdmin, targetId, payload) {
  await assertCanManageTargetAdmin(currentAdmin, targetId);

  const admin = await FoodAdmin.findOne({ _id: targetId, module: 'food' });
  if (!admin) {
    throw new ApiError(404, 'Food admin account not found');
  }

  // Cannot update platform superadmin via this endpoint
  if (admin.adminLevel === 'platform_superadmin') {
    throw new ApiError(403, 'Platform superadmin cannot be modified via food management');
  }

  const {
    name,
    phone,
    permissions,
    password,
    password_confirmation,
    active
  } = payload;
  // The edit form loads zones populated ({ _id, name }) and posts them back
  // mixed with plain ids, which failed the cast and answered 500. Ids only.
  const food_zone_ids = normalizeZoneIdList(payload.food_zone_ids);

  if (password || password_confirmation) {
    if (!password || password.length < 6) {
      throw new ValidationError('Password must be at least 6 characters');
    }
    if (password !== password_confirmation) {
      throw new ValidationError('Passwords do not match');
    }
    admin.password = password;
  }

  if (name !== undefined) admin.name = String(name || '').trim();
  if (phone !== undefined) admin.phone = String(phone || '').trim();
  if (active !== undefined) admin.isActive = active !== false;

  // Permissions and zones subset validation for subadmins
  if (admin.adminLevel === 'subadmin') {
    if (permissions !== undefined) {
      const normalizedPermissions = normalizeAdminPermissions(permissions);
      const childData = {
        adminLevel: 'subadmin',
        module: 'food',
        permissions: normalizedPermissions,
        food_zone_ids: food_zone_ids || admin.food_zone_ids || []
      };
      assertCanCreateAdmin(currentAdmin, childData);
      
      if (normalizedPermissions.length === 0) {
        throw new ValidationError('Subadmin must have at least one permission');
      }
      admin.permissions = normalizedPermissions;
    }

    if (food_zone_ids !== undefined) {
      const childData = {
        adminLevel: 'subadmin',
        module: 'food',
        permissions: admin.permissions || [],
        food_zone_ids
      };
      assertCanCreateAdmin(currentAdmin, childData);

      if (food_zone_ids.length === 0) {
        throw new ValidationError('Subadmin must have at least one assigned zone');
      }
      admin.food_zone_ids = food_zone_ids;
    }
  }

  await admin.save();
  // attachFoodAdminContext caches admin documents for 15s. Without this, a
  // permission change or a deactivation would not reach the affected admin until the
  // TTL lapsed -- so revoking access would appear to do nothing for a quarter minute.
  invalidateAdminCache(targetId);
  return serializeAdminContext(admin);
}

/**
 * Deletes a food admin under the hierarchy by ID.
 */
export async function deleteFoodAdminAccount(currentAdmin, targetId) {
  await assertCanManageTargetAdmin(currentAdmin, targetId);

  const admin = await FoodAdmin.findOne({ _id: targetId, module: 'food' });
  if (!admin) {
    throw new ApiError(404, 'Food admin account not found');
  }

  if (admin.adminLevel === 'platform_superadmin' || admin.adminLevel === 'food_superadmin') {
    throw new ApiError(403, 'Superadmins cannot be deleted via this endpoint');
  }

  await FoodAdmin.deleteOne({ _id: targetId });
  // Without this the deleted admin's cached document keeps satisfying
  // attachFoodAdminContext until the TTL lapses, so their session outlives the
  // account by up to 15 seconds.
  invalidateAdminCache(targetId);
  return { success: true };
}

/**
 * Query helper to scope listing of food resources by assigned food zone.
 */
export function buildFoodZoneScopeQuery(adminContext, queryKey = 'zone_id') {
  const isSuper = adminContext.adminLevel === 'platform_superadmin' || 
                  (adminContext.adminLevel === 'food_superadmin' && adminContext.module === 'food');

  if (isSuper) {
    return {};
  }

  return {
    [queryKey]: { $in: adminContext.food_zone_ids || [] }
  };
}
