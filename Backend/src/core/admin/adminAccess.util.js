import { ADMIN_LEVELS } from './adminHierarchy.constants.js';

/**
 * Parses a permission key into resource and action.
 * @param {string} key - e.g., "orders.read", "orders.write" or "*"
 * @returns {{resource: string, action: string}}
 */
export function parsePermissionKey(key) {
  if (key === '*') {
    return { resource: '*', action: '*' };
  }
  const parts = key.split('.');
  return {
    resource: parts[0] || '',
    action: parts[1] || ''
  };
}

/**
 * Builds a permission key from resource and action.
 * @param {string} resource
 * @param {string} action
 * @returns {string}
 */
export function buildPermissionKey(resource, action) {
  if (resource === '*' || action === '*') {
    return '*';
  }
  return `${resource}.${action}`;
}

/**
 * Checks if a flat list of permissions contains the required permission (or *).
 * @param {string[]} permissions
 * @param {string} resource
 * @param {string} [action] - 'read' or 'write'. If empty, checks for either or exact match
 * @returns {boolean}
 */
export function hasResourcePermission(permissions, resource, action = '') {
  if (!Array.isArray(permissions)) return false;
  if (permissions.includes('*')) return true;

  if (!action) {
    return permissions.some(p => {
      const parsed = parsePermissionKey(p);
      return parsed.resource === resource;
    });
  }

  // write implies read
  const keysToCheck = [buildPermissionKey(resource, action)];
  if (action === 'read') {
    keysToCheck.push(buildPermissionKey(resource, 'write'));
  }

  return keysToCheck.some(key => permissions.includes(key));
}

/**
 * Checks if childPermissions is a subset of parentPermissions.
 * @param {string[]} parentPermissions
 * @param {string[]} childPermissions
 * @returns {boolean}
 */
export function assertPermissionsSubset(parentPermissions, childPermissions) {
  if (!Array.isArray(parentPermissions) || !Array.isArray(childPermissions)) return false;
  if (parentPermissions.includes('*')) return true;

  for (const childPerm of childPermissions) {
    if (childPerm === '*') return false; // Child cannot have * if parent doesn't have it
    const { resource, action } = parsePermissionKey(childPerm);
    if (!hasResourcePermission(parentPermissions, resource, action)) {
      return false;
    }
  }
  return true;
}

/**
 * Checks if childIds is a subset of parentIds (supporting mongoose ObjectId comparison).
 * @param {any[]} parentIds
 * @param {any[]} childIds
 * @returns {boolean}
 */
export function assertIdSubset(parentIds, childIds) {
  if (!Array.isArray(parentIds) || !Array.isArray(childIds)) return false;
  const parentStrSet = new Set(parentIds.map(id => String(id)));
  return childIds.every(id => parentStrSet.has(String(id)));
}

/**
 * Normalizes permissions by deduplicating and sorting.
 * Also expands legacy subadmins.manage to subadmins.write/subadmins.read
 * @param {string[]} permissions
 * @returns {string[]}
 */
export function normalizeAdminPermissions(permissions) {
  if (!Array.isArray(permissions)) return [];
  const expanded = expandLegacyPermissions(permissions);
  const unique = [...new Set(expanded)];
  return unique.sort();
}

/**
 * Expands legacy permissions to standard resource.action format.
 * e.g., 'subadmins.manage' -> ['subadmins.write', 'subadmins.read']
 * @param {string[]} permissions
 * @returns {string[]}
 */
export function expandLegacyPermissions(permissions) {
  if (!Array.isArray(permissions)) return [];
  const result = [];
  for (const p of permissions) {
    if (p === 'subadmins.manage') {
      result.push('subadmins.write', 'subadmins.read');
    } else {
      result.push(p);
    }
  }
  return result;
}

/**
 * Helper to construct flat permission list from structure like { dashboard: { read: true, write: false } }
 * @param {Object} struct
 * @returns {string[]}
 */
export function flattenResourcePermissions(struct) {
  if (!struct || typeof struct !== 'object') return [];
  const list = [];
  for (const [resource, actions] of Object.entries(struct)) {
    if (actions === '*') {
      list.push('*');
      continue;
    }
    if (actions && typeof actions === 'object') {
      if (actions.write) {
        list.push(buildPermissionKey(resource, 'write'));
      }
      if (actions.read) {
        list.push(buildPermissionKey(resource, 'read'));
      }
    }
  }
  return normalizeAdminPermissions(list);
}

/**
 * Helper to reconstruct structured object from flat list
 * @param {string[]} permissions
 * @param {string[]} allResources
 * @returns {Object}
 */
export function resourcePermissionsFromFlat(permissions, allResources = []) {
  const struct = {};
  if (!Array.isArray(permissions)) return struct;

  const isSuper = permissions.includes('*');

  for (const res of allResources) {
    if (isSuper) {
      struct[res] = { read: true, write: true };
    } else {
      struct[res] = {
        read: hasResourcePermission(permissions, res, 'read'),
        write: hasResourcePermission(permissions, res, 'write')
      };
    }
  }
  return struct;
}
