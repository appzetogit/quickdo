import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { getRouteResource, canReadFood, canWriteFood, normalizeFoodAdminProfile } from '../../constants/foodAdminAccess';
import { getCurrentUser } from '@food/utils/auth';

/**
 * Route protection wrapper based on Food Admin hierarchical resource permissions.
 * Redirects unauthorized users back to the dashboard /admin/food
 */
export default function FoodAdminPermissionRoute({ children, action = 'read', requiredResource = '' }) {
  const location = useLocation();
  const rawUser = getCurrentUser('admin');
  const profile = normalizeFoodAdminProfile(rawUser);

  if (!profile) {
    return <Navigate to="/admin/login" state={{ from: location.pathname }} replace />;
  }

  // Determine resource key
  const resource = requiredResource || getRouteResource(location.pathname);
  
  if (!resource) {
    // If no specific resource mapping found, allow entry
    return children;
  }

  const isAllowed = action === 'write' 
    ? canWriteFood(profile, resource)
    : canReadFood(profile, resource);

  if (!isAllowed) {
    console.warn(`Access Denied: Path ${location.pathname} requires ${action} permission for resource ${resource}`);
    return <Navigate to="/admin/food" replace />;
  }

  return children;
}
