import { useState, useEffect, useRef } from "react"
import { useNavigate, useLocation } from "react-router-dom"
import { adminAPI } from "@food/api"
import { setAuthData } from "@food/utils/auth"
import { loadBusinessSettings, getCachedSettings, normalizeCompanyName } from "@food/utils/businessSettings"
import { useSettings } from "../../../../Taxi/shared/context/SettingsContext"
import { Button } from "@food/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@food/components/ui/card"
import { Input } from "@food/components/ui/input"
import { Label } from "@food/components/ui/label"
import { Eye, EyeOff } from "lucide-react"
import quickSpicyLogo from "@food/assets/k9-logo.jpg"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}


export default function AdminLogin() {
  const navigate = useNavigate()
  const location = useLocation()
  const { activeLogo, settings: taxiSettings } = useSettings() || {}
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [successMessage, setSuccessMessage] = useState("")
  const [businessLogo, setBusinessLogo] = useState(() => getCachedSettings()?.logo?.url || null)
  const [companyName, setCompanyName] = useState(() => getCachedSettings()?.companyName || "Quick Drop")
  const submittingRef = useRef(false)

  const resolvedLogo = activeLogo ||
    taxiSettings?.customization?.logos?.admin ||
    taxiSettings?.logos?.admin ||
    taxiSettings?.customization?.logos?.landing ||
    taxiSettings?.logos?.landing ||
    taxiSettings?.general?.logo ||
    businessLogo;

  useEffect(() => {
    const message = location.state?.message
    if (message) {
      setSuccessMessage(message)
      window.history.replaceState({}, document.title, location.pathname)
    }
  }, [location.state?.message, location.pathname])

  // Fetch business settings logo on mount
  useEffect(() => {
    const fetchLogo = async () => {
      try {
        const settings = await loadBusinessSettings()
        if (settings?.logo?.url) {
          setBusinessLogo(settings.logo.url)
        }
        if (settings?.companyName) {
          setCompanyName(normalizeCompanyName(settings.companyName))
        }
      } catch (error) {
        debugWarn("Failed to load business settings logo:", error)
      }
    }
    fetchLogo()

    // Listen for business settings updates
    const handleSettingsUpdate = async () => {
      const settings = await loadBusinessSettings();
      if (settings?.logo?.url) {
        setBusinessLogo(settings.logo.url);
      }
      if (settings?.companyName) {
        setCompanyName(normalizeCompanyName(settings.companyName));
      }
    };
    window.addEventListener('businessSettingsUpdated', handleSettingsUpdate);
    return () => window.removeEventListener('businessSettingsUpdated', handleSettingsUpdate);
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError("")
    setSuccessMessage("")
    if (submittingRef.current) return

    const trimmedEmail = email.trim()
    if (!trimmedEmail) {
      setError("Email is required")
      return
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(trimmedEmail)) {
      setError("Please enter a valid email address")
      return
    }
    if (!password) {
      setError("Password is required")
      return
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters")
      return
    }

    submittingRef.current = true
    setIsLoading(true)

    try {
      const response = await adminAPI.login(trimmedEmail, password)
      const data = response?.data?.data || response?.data || {}

      const accessToken = data.accessToken
      const adminUser = data.user || data.admin
      const refreshToken = data.refreshToken ?? null

      if (!accessToken || !adminUser) {
        throw new Error("Invalid response from server")
      }
      if (!refreshToken) {
        throw new Error("Invalid response from server: missing refresh token")
      }
      setAuthData("admin", accessToken, adminUser, refreshToken)
      navigate("/admin/food", { replace: true })
    } catch (err) {
      const message =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err?.message ||
        "Login failed. Please check your credentials."
      setError(message)
    } finally {
      setIsLoading(false)
      submittingRef.current = false
    }
  }

  return (
    <div className="min-h-screen bg-linear-to-br from-neutral-50 via-gray-100 to-white relative">
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-24 -top-24 h-64 w-64 rounded-full bg-neutral-900/5 blur-3xl" />
        <div className="absolute right-[-80px] bottom-[-80px] h-72 w-72 rounded-full bg-gray-700/5 blur-3xl" />
      </div>

      <div className="flex min-h-screen items-center justify-center px-4 py-12">
        <Card className="w-full max-w-lg bg-white/90 backdrop-blur border-neutral-200 shadow-2xl">
          <CardHeader className="pb-4">
            <div className="flex w-full items-center gap-4 sm:gap-5">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white ring-1 ring-neutral-200 overflow-hidden p-1.5 shadow-sm">
                {resolvedLogo ? (
                  <img
                    src={resolvedLogo}
                    alt={companyName || "Logo"}
                    className="h-full w-full object-contain"
                    loading="eager"
                  />
                ) : (
                  <div className="text-xl font-bold text-gray-900">
                    {(companyName || "QD").substring(0, 2).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <CardTitle className="text-3xl leading-tight text-gray-900">Admin Login</CardTitle>
                <CardDescription className="text-base text-gray-600">
                  Sign in to access the admin dashboard.
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {successMessage && (
                <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                  {successMessage}
                </div>
              )}
              {error && (
                <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="email" className="text-base font-medium text-gray-900">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="admin@domain.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading}
                  autoComplete="off"
                  required
                  className="h-12 text-base"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-base font-medium text-gray-900">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isLoading}
                    autoComplete="new-password"
                    required
                    className="h-12 pr-12 text-base [&::-ms-reveal]:hidden [&::-webkit-password-reveal-button]:hidden"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 transition-colors hover:text-gray-800"
                    disabled={isLoading}
                  >
                    {showPassword ? (
                      <EyeOff className="h-5 w-5" />
                    ) : (
                      <Eye className="h-5 w-5" />
                    )}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Use your admin credentials to continue.</span>
                <button
                  type="button"
                  onClick={() => navigate("/admin/forgot-password")}
                  className="text-black font-medium hover:underline focus:outline-none focus:underline"
                  disabled={isLoading}
                >
                  Forgot Password?
                </button>
              </div>

              <Button
                type="submit"
                className="h-12 w-full bg-black text-white transition-colors hover:bg-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
                disabled={isLoading}
              >
                {isLoading ? "Logging in..." : "Login"}
              </Button>
            </form>
          </CardContent>

          <CardFooter className="flex-col items-start gap-2 text-sm text-gray-500">
            <span>Secure sign-in helps protect admin tools.</span>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}



