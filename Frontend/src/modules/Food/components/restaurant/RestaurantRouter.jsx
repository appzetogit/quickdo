import { Suspense, lazy } from "react"
import { Routes, Route } from "react-router-dom"
import ProtectedRoute from "@food/components/ProtectedRoute"
import Loader from "@food/components/Loader"
import RestaurantLayout from "@food/components/restaurant/RestaurantLayout"

// Lazy Loading Components
const AllOrdersPage = lazy(() => import("@food/pages/restaurant/AllOrdersPage"))
const OrdersMain = lazy(() => import("@food/pages/restaurant/OrdersMain"))
const RestaurantNotifications = lazy(() => import("@food/pages/restaurant/Notifications"))
const RestaurantOnboarding = lazy(() => import("@food/pages/restaurant/Onboarding"))
const CouponListPage = lazy(() => import("@food/pages/restaurant/CouponListPage"))
const FreebieOffersPage = lazy(() => import("@food/pages/restaurant/FreebieOffersPage"))
const BogoOffersPage = lazy(() => import("@food/pages/restaurant/BogoOffersPage"))
const CombosPage = lazy(() => import("@food/pages/restaurant/CombosPage"))
const AddCouponPage = lazy(() => import("@food/pages/restaurant/AddCouponPage"))
const EditCouponPage = lazy(() => import("@food/pages/restaurant/EditCouponPage"))
const MenuCategoriesPage = lazy(() => import("@food/pages/restaurant/MenuCategoriesPage"))
const DeliverySettings = lazy(() => import("@food/pages/restaurant/DeliverySettings"))
const GstSettings = lazy(() => import("@food/pages/restaurant/GstSettings"))
const DeliveryRadius = lazy(() => import("@food/pages/restaurant/DeliveryRadius"))
const RushHour = lazy(() => import("@food/pages/restaurant/RushHour"))
const OutletTimings = lazy(() => import("@food/pages/restaurant/OutletTimings"))
const DaySlots = lazy(() => import("@food/pages/restaurant/DaySlots"))
const OutletInfo = lazy(() => import("@food/pages/restaurant/OutletInfo"))
const RatingsReviews = lazy(() => import("@food/pages/restaurant/RatingsReviews"))
const EditOwner = lazy(() => import("@food/pages/restaurant/EditOwner"))
const EditCuisines = lazy(() => import("@food/pages/restaurant/EditCuisines"))
const EditRestaurantAddress = lazy(() => import("@food/pages/restaurant/EditRestaurantAddress"))
const Inventory = lazy(() => import("@food/pages/restaurant/Inventory"))
const StockManager = lazy(() => import("@food/pages/shared/StockManager"))
const Feedback = lazy(() => import("@food/pages/restaurant/Feedback"))
const ShareFeedback = lazy(() => import("@food/pages/restaurant/ShareFeedback"))
const DishRatings = lazy(() => import("@food/pages/restaurant/DishRatings"))
const RestaurantSupport = lazy(() => import("@food/pages/restaurant/RestaurantSupport"))
const FssaiDetails = lazy(() => import("@food/pages/restaurant/FssaiDetails"))
const FssaiUpdate = lazy(() => import("@food/pages/restaurant/FssaiUpdate"))
const Hyperpure = lazy(() => import("@food/pages/restaurant/Hyperpure"))
const ItemDetailsPage = lazy(() => import("@food/pages/restaurant/ItemDetailsPage"))
const HubFinance = lazy(() => import("@food/pages/restaurant/HubFinance"))
const FinanceDetailsPage = lazy(() => import("@food/pages/restaurant/FinanceDetailsPage"))
const WithdrawalHistoryPage = lazy(() => import("@food/pages/restaurant/WithdrawalHistoryPage"))
const PhoneNumbersPage = lazy(() => import("@food/pages/restaurant/PhoneNumbersPage"))
const DownloadReport = lazy(() => import("@food/pages/restaurant/DownloadReport"))
const ManageOutlets = lazy(() => import("@food/pages/restaurant/ManageOutlets"))
const UpdateBankDetails = lazy(() => import("@food/pages/restaurant/UpdateBankDetails"))
const ZoneSetup = lazy(() => import("@food/pages/restaurant/ZoneSetup"))
const DiningReservations = lazy(() => import("@food/pages/restaurant/DiningReservations"))
const RestaurantStatus = lazy(() => import("@food/pages/restaurant/RestaurantStatus"))
const ExploreMore = lazy(() => import("@food/pages/restaurant/ExploreMore"))
const Analytics = lazy(() => import("@food/pages/restaurant/Analytics"))

const Welcome = lazy(() => import("@food/pages/restaurant/auth/Welcome"))
const Login = lazy(() => import("@food/pages/restaurant/auth/Login"))
const OTP = lazy(() => import("@food/pages/restaurant/auth/OTP"))
const Signup = lazy(() => import("@food/pages/restaurant/auth/Signup"))
const ForgotPassword = lazy(() => import("@food/pages/restaurant/auth/ForgotPassword"))
const VerificationPending = lazy(() => import("@food/pages/restaurant/auth/VerificationPending"))

export default function RestaurantRouter() {
  return (
    <Suspense fallback={<Loader />}>
      <Routes>
        {/* Auth Routes */}
        <Route path="welcome" element={<Welcome />} />
        <Route path="login" element={<Login />} />
        <Route path="otp" element={<OTP />} />
        <Route path="signup" element={<Signup />} />
        <Route path="forgot-password" element={<ForgotPassword />} />
        <Route path="pending-verification" element={<VerificationPending />} />
        <Route path="onboarding" element={<RestaurantOnboarding />} />

        {/* Protected Routes — wrapped in the desktop shell (sidebar at lg+) */}
        <Route element={<RestaurantLayout />}>
        <Route element={<ProtectedRoute requiredRole="restaurant" loginPath="/food/restaurant/login"><OrdersMain /></ProtectedRoute>} path="" />
        <Route element={<ProtectedRoute requiredRole="restaurant" loginPath="/food/restaurant/login"><RestaurantNotifications /></ProtectedRoute>} path="notifications" />
        <Route element={<ProtectedRoute requiredRole="restaurant" loginPath="/food/restaurant/login"><AllOrdersPage /></ProtectedRoute>} path="orders/all" />
        <Route element={<ProtectedRoute requiredRole="restaurant" loginPath="/food/restaurant/login"><CouponListPage /></ProtectedRoute>} path="coupon" />
        <Route element={<ProtectedRoute requiredRole="restaurant" loginPath="/food/restaurant/login"><FreebieOffersPage /></ProtectedRoute>} path="free-item-offers" />
        <Route element={<ProtectedRoute requiredRole="restaurant" loginPath="/food/restaurant/login"><BogoOffersPage /></ProtectedRoute>} path="bogo-offers" />
        <Route element={<ProtectedRoute requiredRole="restaurant" loginPath="/food/restaurant/login"><CombosPage /></ProtectedRoute>} path="combos" />
        <Route element={<ProtectedRoute requiredRole="restaurant" loginPath="/food/restaurant/login"><AddCouponPage /></ProtectedRoute>} path="coupon/new" />
        <Route element={<ProtectedRoute requiredRole="restaurant" loginPath="/food/restaurant/login"><EditCouponPage /></ProtectedRoute>} path="coupon/:id/edit" />
        <Route element={<ProtectedRoute requiredRole="restaurant" loginPath="/food/restaurant/login"><DeliverySettings /></ProtectedRoute>} path="delivery-settings" />
        <Route element={<ProtectedRoute requiredRole="restaurant" loginPath="/food/restaurant/login"><GstSettings /></ProtectedRoute>} path="gst-settings" />
        <Route element={<ProtectedRoute requiredRole="restaurant" loginPath="/food/restaurant/login"><DeliveryRadius /></ProtectedRoute>} path="delivery-radius" />
        <Route element={<ProtectedRoute requiredRole="restaurant" loginPath="/food/restaurant/login"><RushHour /></ProtectedRoute>} path="rush-hour" />
        <Route element={<ProtectedRoute requiredRole="restaurant" loginPath="/food/restaurant/login"><MenuCategoriesPage /></ProtectedRoute>} path="menu-categories" />
        <Route element={<ProtectedRoute requiredRole="restaurant" loginPath="/food/restaurant/login"><RestaurantStatus /></ProtectedRoute>} path="status" />
        <Route element={<ProtectedRoute requiredRole="restaurant" loginPath="/food/restaurant/login"><ExploreMore /></ProtectedRoute>} path="explore" />
        <Route element={<ProtectedRoute requiredRole="restaurant" loginPath="/food/restaurant/login"><Analytics /></ProtectedRoute>} path="analytics" />
        <Route element={<ProtectedRoute requiredRole="restaurant" loginPath="/food/restaurant/login"><OutletTimings /></ProtectedRoute>} path="outlet-timings" />
        <Route element={<ProtectedRoute requiredRole="restaurant" loginPath="/food/restaurant/login"><DaySlots /></ProtectedRoute>} path="outlet-timings/:day" />
        <Route element={<ProtectedRoute requiredRole="restaurant" loginPath="/food/restaurant/login"><OutletInfo /></ProtectedRoute>} path="outlet-info" />
        <Route element={<ProtectedRoute requiredRole="restaurant" loginPath="/food/restaurant/login"><RatingsReviews /></ProtectedRoute>} path="ratings-reviews" />
        <Route element={<ProtectedRoute requiredRole="restaurant" loginPath="/food/restaurant/login"><EditOwner /></ProtectedRoute>} path="edit-owner" />
        <Route element={<ProtectedRoute requiredRole="restaurant" loginPath="/food/restaurant/login"><EditCuisines /></ProtectedRoute>} path="edit-cuisines" />
        <Route element={<ProtectedRoute requiredRole="restaurant" loginPath="/food/restaurant/login"><EditRestaurantAddress /></ProtectedRoute>} path="edit-address" />
        <Route element={<ProtectedRoute requiredRole="restaurant" loginPath="/food/restaurant/login"><Inventory /></ProtectedRoute>} path="inventory" />
        <Route element={<ProtectedRoute requiredRole="restaurant" loginPath="/food/restaurant/login"><StockManager scope="restaurant" /></ProtectedRoute>} path="stock" />
        <Route element={<ProtectedRoute requiredRole="restaurant" loginPath="/food/restaurant/login"><Feedback /></ProtectedRoute>} path="feedback" />
        <Route element={<ProtectedRoute requiredRole="restaurant" loginPath="/food/restaurant/login"><ShareFeedback /></ProtectedRoute>} path="share-feedback" />
        <Route element={<ProtectedRoute requiredRole="restaurant" loginPath="/food/restaurant/login"><DishRatings /></ProtectedRoute>} path="dish-ratings" />
        <Route element={<ProtectedRoute requiredRole="restaurant" loginPath="/food/restaurant/login"><RestaurantSupport /></ProtectedRoute>} path="help-centre/support" />
        <Route element={<ProtectedRoute requiredRole="restaurant" loginPath="/food/restaurant/login"><FssaiDetails /></ProtectedRoute>} path="fssai" />
        <Route element={<ProtectedRoute requiredRole="restaurant" loginPath="/food/restaurant/login"><FssaiUpdate /></ProtectedRoute>} path="fssai/update" />
        <Route element={<ProtectedRoute requiredRole="restaurant" loginPath="/food/restaurant/login"><Hyperpure /></ProtectedRoute>} path="hyperpure" />
        <Route element={<ProtectedRoute requiredRole="restaurant" loginPath="/food/restaurant/login"><ItemDetailsPage /></ProtectedRoute>} path="hub-menu/item/:id" />
        <Route element={<ProtectedRoute requiredRole="restaurant" loginPath="/food/restaurant/login"><HubFinance /></ProtectedRoute>} path="hub-finance" />
        <Route element={<ProtectedRoute requiredRole="restaurant" loginPath="/food/restaurant/login"><WithdrawalHistoryPage /></ProtectedRoute>} path="withdrawal-history" />
        <Route element={<ProtectedRoute requiredRole="restaurant" loginPath="/food/restaurant/login"><FinanceDetailsPage /></ProtectedRoute>} path="finance-details" />
        <Route element={<ProtectedRoute requiredRole="restaurant" loginPath="/food/restaurant/login"><PhoneNumbersPage /></ProtectedRoute>} path="phone" />
        <Route element={<ProtectedRoute requiredRole="restaurant" loginPath="/food/restaurant/login"><DownloadReport /></ProtectedRoute>} path="download-report" />
        <Route element={<ProtectedRoute requiredRole="restaurant" loginPath="/food/restaurant/login"><ManageOutlets /></ProtectedRoute>} path="manage-outlets" />
        <Route element={<ProtectedRoute requiredRole="restaurant" loginPath="/food/restaurant/login"><UpdateBankDetails /></ProtectedRoute>} path="update-bank-details" />
        <Route element={<ProtectedRoute requiredRole="restaurant" loginPath="/food/restaurant/login"><DiningReservations /></ProtectedRoute>} path="reservations" />
        <Route element={<ProtectedRoute requiredRole="restaurant" loginPath="/food/restaurant/login"><ZoneSetup /></ProtectedRoute>} path="zone-setup" />
        </Route>
      </Routes>
    </Suspense>
  )
}
