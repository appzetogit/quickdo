import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

/**
 * Public Route Component
 * Redirects to dashboard if user is already authenticated
 */
const PublicRoute = ({ children, userType = 'user', redirectTo = null }) => {
  const location = useLocation();
  const [isAuthenticated, setIsAuthenticated] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkAuth = () => {
      let tokenKey = 'accessToken';
      let refreshTokenKey = 'refreshToken';
      let dataKey = 'userData';

      // Determine keys based on userType
      switch (userType) {
        case 'vendor':
          tokenKey = 'vendorAccessToken';
          refreshTokenKey = 'vendorRefreshToken';
          dataKey = 'vendorData';
          break;
        case 'worker':
          tokenKey = 'workerAccessToken';
          refreshTokenKey = 'workerRefreshToken';
          dataKey = 'workerData';
          break;
        case 'admin':
          tokenKey = 'adminAccessToken';
          refreshTokenKey = 'adminRefreshToken';
          dataKey = 'adminData';
          break;
        case 'user':
        default:
          tokenKey = 'accessToken';
          refreshTokenKey = 'refreshToken';
          dataKey = 'userData';
          break;
      }

      const token = localStorage.getItem(tokenKey);
      const userData = localStorage.getItem(dataKey);

      if (token && userData) {
        try {
          // Decode JWT token to check expiry and role
          const parts = token.split('.');
          if (parts.length === 3) {
            const payload = JSON.parse(atob(parts[1]));
            const currentTime = Date.now() / 1000;

            // Check if token is expired
            if (!payload.exp || payload.exp <= currentTime) {
              // Clear expired tokens
              localStorage.removeItem(tokenKey);
              localStorage.removeItem(refreshTokenKey);
              localStorage.removeItem(dataKey);
              sessionStorage.removeItem(tokenKey);
              sessionStorage.removeItem(refreshTokenKey);
              sessionStorage.removeItem(dataKey);
              setIsAuthenticated(false);
              return;
            }

            // Check if token role matches expected userType
            const roleMap = {
              user: 'user',
              vendor: 'vendor',
              worker: 'worker',
              admin: 'admin'
            };

            if (payload.role === roleMap[userType]) {
              setIsAuthenticated(true);
            } else {
              // Role mismatch
              setIsAuthenticated(false);
            }
          } else {
            // Invalid token format
            setIsAuthenticated(false);
          }
        } catch (error) {
          // Invalid token
          console.error('Token validation error:', error);
          setIsAuthenticated(false);
        }
      } else {
        setIsAuthenticated(false);
      }

      setIsLoading(false);
    };

    checkAuth();
  }, [userType, location.pathname]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2" style={{ borderColor: '#00a6a6' }}></div>
          <p className="text-gray-600 text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  if (isAuthenticated) {
    // Determine redirect path
    const defaultRedirects = {
      user: '/user',
      vendor: '/vendor/dashboard',
      worker: '/worker/dashboard',
      admin: '/admin/dashboard'
    };

    const redirectPath = redirectTo || defaultRedirects[userType] || '/user';
    return <Navigate to={redirectPath} replace />;
  }

  return children;
};

export default PublicRoute;


