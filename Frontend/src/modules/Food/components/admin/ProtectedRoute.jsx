import { useEffect, useState } from "react"
import { Navigate, useLocation } from "react-router-dom"
import { isModuleAuthenticated, getModuleRefreshToken } from "@food/utils/auth"

// A live access token OR a refresh token still on hand counts as a session: the access
// token only lasts 15m, and the axios interceptor silently refreshes it. Bouncing to
// login the moment it expired would log admins out mid-task.
const hasAdminSession = () =>
  isModuleAuthenticated("admin") || Boolean(getModuleRefreshToken("admin"))

export default function ProtectedRoute({ children }) {
  const location = useLocation()
  const [authenticated, setAuthenticated] = useState(hasAdminSession)

  // The interceptor wipes the session when a refresh fails. Without this listener the
  // panel stays mounted on a dead session and every admin request 401s in silence --
  // which is exactly what zone-setup (and the navbar polls) were doing.
  useEffect(() => {
    const sync = () => setAuthenticated(hasAdminSession())
    window.addEventListener("authRefreshFailed", sync)
    window.addEventListener("storage", sync)
    return () => {
      window.removeEventListener("authRefreshFailed", sync)
      window.removeEventListener("storage", sync)
    }
  }, [])

  if (!authenticated) {
    return <Navigate to="/admin/login" state={{ from: location.pathname }} replace />
  }

  return children
}
