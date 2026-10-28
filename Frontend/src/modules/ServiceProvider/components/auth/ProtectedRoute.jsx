import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { toast } from 'react-hot-toast';

/**
 * Protected Route Component
 * Checks if user is authenticated before allowing access
 */
const ProtectedRoute = ({ children, userType = 'user', redirectTo = null }) => {
  const location = useLocation();
  const [isAuthenticated, setIsAuthenticated] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      let tokenKey = 'accessToken';
      let refreshTokenKey = 'refreshToken';
      let dataKey = 'userData';

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

      const token = sessionStorage.getItem(tokenKey) || localStorage.getItem(tokenKey);
      const refreshToken = sessionStorage.getItem(refreshTokenKey) || localStorage.getItem(refreshTokenKey);
      const userData = sessionStorage.getItem(dataKey) || localStorage.getItem(dataKey);

      if (token && userData) {
        try {
          const parts = token.split('.');
          if (parts.length === 3) {
            const payload = JSON.parse(atob(parts[1]));
            const currentTime = Math.floor(Date.now() / 1000);

            // If token is expired but we have a refresh token, let's try to let it proceed.
            // The axios interceptor in api.js will handle the actual refresh when the first request fails.
            // We only logout here if there's NO refresh token or if the refresh token itself is expired.
            
            if (payload.exp && payload.exp > currentTime) {
              setIsAuthenticated(true);
              setIsLoading(false);
            } else if (refreshToken) {
              // Access token expired but refresh token exists.
              // We'll give it a chance. If the first API call fails to refresh, it will logout then.
              // This prevents an aggressive logout before the interceptor can do its job.
              console.log(`[Auth] Access token expired for ${userType}, but refresh token exists. Proveding...`);
              setIsAuthenticated(true);
              setIsLoading(false);
            } else {
              // Truly expired and no way to refresh
              handleExpiredSession(tokenKey, refreshTokenKey, dataKey);
            }
          } else {
            setIsAuthenticated(false);
            setIsLoading(false);
          }
        } catch (error) {
          console.error('Token validation error:', error);
          setIsAuthenticated(false);
          setIsLoading(false);
        }
      } else {
        setIsAuthenticated(false);
        setIsLoading(false);
      }
    };

    const handleExpiredSession = (tokenKey, refreshTokenKey, dataKey) => {
      console.log('Session truly expired, clearing auth data');
      localStorage.removeItem(tokenKey);
      localStorage.removeItem(refreshTokenKey);
      localStorage.removeItem(dataKey);
      sessionStorage.removeItem(tokenKey);
      sessionStorage.removeItem(refreshTokenKey);
      sessionStorage.removeItem(dataKey);
      setIsAuthenticated(false);
      setIsLoading(false);
    };

    checkAuth();
  }, [userType, location.pathname]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2" style={{ borderColor: '#00a6a6' }}></div>
          <p className="text-gray-600 text-sm">Checking authentication...</p>
        </div>
      </div>
    );
  }

  if (isAuthenticated === false) {
    // Determine redirect path
    const defaultRedirects = {
      user: '/user/login',
      vendor: '/vendor/login',
      worker: '/worker/login',
      admin: '/admin/login'
    };

    const redirectPath = redirectTo || defaultRedirects[userType] || '/user/login';

    // Toast removed from render phase to prevent "Cannot update a component while rendering" error
    // If you need a toast, trigger it in useEffect before setting isAuthenticated(false) or rely on LoginPage to show "Please login"

    return <Navigate to={redirectPath} state={{ from: location }} replace />;
  }

  return children;
};

export default ProtectedRoute;


