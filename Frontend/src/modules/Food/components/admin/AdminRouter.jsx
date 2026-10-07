import { Suspense, lazy } from "react";
import { Routes, Route, Navigate, Outlet, useParams, useLocation } from "react-router-dom";
import { currentAdminBase } from "./AdminSidebar";

/** Old per-panel edit links land on the one Master screen. */
function RedirectAdminEdit() {
  const { id } = useParams();
  return <Navigate to={`/admin/master/admins/edit/${id}`} replace />;
}
import VerticalVocabulary from "./VerticalVocabulary";
import ProtectedRoute from "./ProtectedRoute";
import AdminLayout from "./AdminLayout";
import Loader from "@food/components/Loader";

const AdminHome = lazy(() => import("@food/pages/admin/AdminHome"));
const PointOfSale = lazy(() => import("@food/pages/admin/PointOfSale"));
const StatusMonitor = lazy(() => import("@food/pages/admin/dashboard/StatusMonitor"));
const AdminProfile = lazy(() => import("@food/pages/admin/AdminProfile"));
const AdminSettings = lazy(() => import("@food/pages/admin/AdminSettings"));
const PlatformSettings = lazy(() => import("@food/pages/admin/master/PlatformSettings"))
const SupportInbox = lazy(() => import("@food/pages/admin/master/SupportInbox"))
const MasterReferral = lazy(() => import("@food/pages/admin/master/MasterReferral"))
const MasterCoupons = lazy(() => import("@food/pages/admin/master/MasterCoupons"))
const PlatformEarnings = lazy(() => import("@food/pages/admin/master/PlatformEarnings"))
const MasterFees = lazy(() => import("@food/pages/admin/master/MasterFees"))
const MasterCancellation = lazy(() => import("@food/pages/admin/master/MasterCancellation"))
const HomeScreenArtwork = lazy(() => import("@food/pages/admin/master/HomeScreenArtwork"))
const CommissionOverview = lazy(() => import("@food/pages/admin/master/CommissionOverview"))
const AppServices = lazy(() => import("@food/pages/admin/master/AppServices"))
const MasterCustomers = lazy(() => import("@food/pages/admin/master/GlobalUsers"))
const MasterOrders = lazy(() => import("@food/pages/admin/master/MasterOrders"))
const MasterDeliveryEarnings = lazy(() => import("@food/pages/admin/master/DeliveryEarnings"))
const MasterDeliveryIncentives = lazy(() => import("@food/pages/admin/master/DeliveryIncentives"))
const MasterPromotions = lazy(() => import("@food/pages/admin/master/PromoCeiling"))
const OrderBatching = lazy(() => import("@food/pages/admin/master/OrderBatching"))
const AdminActivityLog = lazy(() => import("@food/pages/admin/master/AdminActivityLog"))
const MasterRefunds = lazy(() => import("@food/pages/admin/master/MasterRefunds"))
// SOW §5: FAQs, loyalty points, delivery slots (pages/admin/marketplace).
const MasterFaqs = lazy(() => import("@food/pages/admin/marketplace/Faqs"))
const MasterLoyalty = lazy(() => import("@food/pages/admin/marketplace/LoyaltyPoints"))
const MasterDeliverySlots = lazy(() => import("@food/pages/admin/marketplace/DeliverySlots"))
// Cross-vertical Master screens (plan §7): dashboard, reports, GST, subscriptions, broadcasts, insights.
const MasterDashboard = lazy(() => import("@food/pages/admin/master/MasterDashboard"))
const MasterReports = lazy(() => import("@food/pages/admin/master/MasterReports"))
const MasterTaxReport = lazy(() => import("@food/pages/admin/master/MasterTaxReport"))
const MasterSubscriptions = lazy(() => import("@food/pages/admin/master/MasterSubscriptions"))
const MasterBroadcasts = lazy(() => import("@food/pages/admin/master/MasterBroadcasts"))
const MasterInsights = lazy(() => import("@food/pages/admin/master/MasterInsights"))
// Master's own Delivery Management pages: the same screens as the Food and Taxi
// panels, opened inside Master (links between them stay in Master).
const TaxiDriverList = lazy(() => import("@/modules/Taxi/modules/admin/pages/drivers/DriverList"))
const TaxiPendingDrivers = lazy(() => import("@/modules/Taxi/modules/admin/pages/drivers/PendingDrivers"))
const TaxiDriverDetails = lazy(() => import("@/modules/Taxi/modules/admin/pages/drivers/DriverDetails"))
const TaxiDriverCreate = lazy(() => import("@/modules/Taxi/modules/admin/pages/drivers/CreateDriver"))
const TaxiDriverEdit = lazy(() => import("@/modules/Taxi/modules/admin/pages/drivers/EditDriver"))
const PartnerDocuments = lazy(() => import("@/modules/Taxi/modules/admin/pages/drivers/GlobalDocuments"))
const PartnerDocumentForm = lazy(() => import("@/modules/Taxi/modules/admin/pages/drivers/DriverDocumentForm"))
const FoodApproval = lazy(() => import("@food/pages/admin/restaurant/FoodApproval"));
const OrdersPage = lazy(() => import("@food/pages/admin/orders/OrdersPage"));
const OrderDetectDelivery = lazy(() => import("@food/pages/admin/OrderDetectDelivery"));
const Category = lazy(() => import("@food/pages/admin/categories/Category"));
const FeeSettings = lazy(() => import("@food/pages/admin/fee-settings/FeeSettings"));
const FreeDeliveryPage = lazy(() => import("@food/pages/admin/free-delivery/FreeDeliveryPage"));
const DeliveryRadiusPage = lazy(() => import("@food/pages/admin/delivery-radius/DeliveryRadiusPage"));
const NinetyNineStore = lazy(() => import("@food/pages/admin/promotions/NinetyNineStore"));
const PackagingCharges = lazy(() => import("@food/pages/admin/packaging/PackagingCharges"));
const MapSettings = lazy(() => import("@food/pages/admin/settings/MapSettings"));
const ReferralSettings = lazy(() => import("@food/pages/admin/referral-settings/ReferralSettings"));
// Restaurant Management
const ZoneSetup = lazy(() => import("@food/pages/admin/restaurant/ZoneSetup"));
const AddZone = lazy(() => import("@food/pages/admin/restaurant/AddZone"));
const ViewZone = lazy(() => import("@food/pages/admin/restaurant/ViewZone"));
const AllZonesMap = lazy(() => import("@food/pages/admin/restaurant/AllZonesMap"));
const DeliveryBoyViewMap = lazy(() => import("@food/pages/admin/restaurant/DeliveryBoyViewMap"));
const RestaurantsList = lazy(() => import("@food/pages/admin/restaurant/RestaurantsList"));
const AddRestaurant = lazy(() => import("@food/pages/admin/restaurant/AddRestaurant"));
const JoiningRequest = lazy(() => import("@food/pages/admin/restaurant/JoiningRequest"));
const RestaurantCommission = lazy(() => import("@food/pages/admin/restaurant/RestaurantCommission"));
const MonetizationMode = lazy(() => import("@food/pages/admin/settings/MonetizationMode"));
const RestaurantFreebieOffers = lazy(() => import("@food/pages/admin/restaurant/RestaurantFreebieOffers"));
const RestaurantBogoOffers = lazy(() => import("@food/pages/admin/restaurant/RestaurantBogoOffers"));
const RestaurantCombos = lazy(() => import("@food/pages/admin/restaurant/RestaurantCombos"));
const RestaurantComplaints = lazy(() => import("@food/pages/admin/restaurant/RestaurantComplaints"));
const RestaurantReviews = lazy(() => import("@food/pages/admin/restaurant/RestaurantReviews"));
const RestaurantsBulkImport = lazy(() => import("@food/pages/admin/restaurant/RestaurantsBulkImport"));
const RestaurantsBulkExport = lazy(() => import("@food/pages/admin/restaurant/RestaurantsBulkExport"));
// Food Management
const FoodsList = lazy(() => import("@food/pages/admin/foods/FoodsList"));
const GlobalPricing = lazy(() => import("@food/pages/admin/pricing/GlobalPricing"));
const AddonsList = lazy(() => import("@food/pages/admin/addons/AddonsList"));
// Promotions Management
const BasicCampaign = lazy(() => import("@food/pages/admin/campaigns/BasicCampaign"));
const FoodCampaign = lazy(() => import("@food/pages/admin/campaigns/FoodCampaign"));
const Coupons = lazy(() => import("@food/pages/admin/Coupons"));
const Cashback = lazy(() => import("@food/pages/admin/Cashback"));
const Banners = lazy(() => import("@food/pages/admin/Banners"));
const PromotionalBanner = lazy(() => import("@food/pages/admin/PromotionalBanner"));
const NewAdvertisement = lazy(() => import("@food/pages/admin/advertisement/NewAdvertisement"));
const AdRequests = lazy(() => import("@food/pages/admin/advertisement/AdRequests"));
const AdsList = lazy(() => import("@food/pages/admin/advertisement/AdsList"));

// Help & Support
const Chattings = lazy(() => import("@food/pages/admin/Chattings"));
const ContactMessages = lazy(() => import("@food/pages/admin/ContactMessages"));
const SafetyEmergencyReports = lazy(() => import("@food/pages/admin/SafetyEmergencyReports"));
// Customer Management
const Customers = lazy(() => import("@food/pages/admin/Customers"));
const SupportTickets = lazy(() => import("@food/pages/admin/SupportTickets"));
const AddFund = lazy(() => import("@food/pages/admin/wallet/AddFund"));
const Bonus = lazy(() => import("@food/pages/admin/wallet/Bonus"));
const LoyaltyPointReport = lazy(() => import("@food/pages/admin/loyalty-point/Report"));
const SubscribedMailList = lazy(() => import("@food/pages/admin/SubscribedMailList"));
// Deliveryman Management
const DeliveryCashLimit = lazy(() => import("@food/pages/admin/DeliveryCashLimit"));
const CashLimitSettlement = lazy(() => import("@food/pages/admin/CashLimitSettlement"));
const DeliveryWithdrawal = lazy(() => import("@food/pages/admin/DeliveryWithdrawal"));
const DeliveryBoyWallet = lazy(() => import("@food/pages/admin/DeliveryBoyWallet"));
const DeliveryEmergencyHelp = lazy(() => import("@food/pages/admin/DeliveryEmergencyHelp"));
const DeliverySupportTickets = lazy(() => import("@food/pages/admin/DeliverySupportTickets"));
const JoinRequest = lazy(() => import("@food/pages/admin/delivery-partners/JoinRequest"));
const AddDeliveryman = lazy(() => import("@food/pages/admin/delivery-partners/AddDeliveryman"));
const DeliverymanList = lazy(() => import("@food/pages/admin/delivery-partners/DeliverymanList"));
const DeliverymanReviews = lazy(() => import("@food/pages/admin/delivery-partners/DeliverymanReviews"));
const DeliverymanBonus = lazy(() => import("@food/pages/admin/delivery-partners/DeliverymanBonus"));
const EarningAddonHistory = lazy(() => import("@food/pages/admin/delivery-partners/EarningAddonHistory"));
const DeliveryEarnings = lazy(() => import("@food/pages/admin/delivery-partners/DeliveryEarnings"));
// Disbursement Management
// Report Management
const TransactionReport = lazy(() => import("@food/pages/admin/reports/TransactionReport"));
const ExpenseReport = lazy(() => import("@food/pages/admin/reports/ExpenseReport"));
const DisbursementReportRestaurants = lazy(() => import("@food/pages/admin/reports/DisbursementReportRestaurants"));
const DisbursementReportDeliverymen = lazy(() => import("@food/pages/admin/reports/DisbursementReportDeliverymen"));
const RegularOrderReport = lazy(() => import("@food/pages/admin/reports/RegularOrderReport"));
const CampaignOrderReport = lazy(() => import("@food/pages/admin/reports/CampaignOrderReport"));
const RestaurantReport = lazy(() => import("@food/pages/admin/reports/RestaurantReport"));
const FeedbackExperienceReport = lazy(() => import("@food/pages/admin/reports/FeedbackExperienceReport"));
const TaxReport = lazy(() => import("@food/pages/admin/reports/TaxReport"));
const RestaurantVATReport = lazy(() => import("@food/pages/admin/reports/RestaurantVATReport"));
// Transaction Management
const RestaurantWithdraws = lazy(() => import("@food/pages/admin/transactions/RestaurantWithdraws"));
const WithdrawMethod = lazy(() => import("@food/pages/admin/transactions/WithdrawMethod"));
// Employee Management
const EmployeeRole = lazy(() => import("@food/pages/admin/employees/EmployeeRole"));
const AddEmployee = lazy(() => import("@food/pages/admin/employees/AddEmployee"));
const EmployeeList = lazy(() => import("@food/pages/admin/employees/EmployeeList"));
// Business Settings
const BusinessSetup = lazy(() => import("@food/pages/admin/settings/BusinessSetup"));
const PetpoojaSettings = lazy(() => import("@food/pages/admin/settings/PetpoojaSettings"));
const OrderCancellation = lazy(() => import("@food/pages/admin/OrderCancellation"));
const DeliveryInstructions = lazy(() => import("@food/pages/admin/DeliveryInstructions"));
const EmailTemplate = lazy(() => import("@food/pages/admin/settings/EmailTemplate"));
const ThemeSettings = lazy(() => import("@food/pages/admin/settings/ThemeSettings"));
const Gallery = lazy(() => import("@food/pages/admin/settings/Gallery"));
const LoginSetup = lazy(() => import("@food/pages/admin/settings/LoginSetup"));
const TermsAndCondition = lazy(() => import("@food/pages/admin/settings/TermsAndCondition"));
const PrivacyPolicy = lazy(() => import("@food/pages/admin/settings/PrivacyPolicy"));
const AboutUs = lazy(() => import("@food/pages/admin/settings/AboutUs"));
const RefundPolicy = lazy(() => import("@food/pages/admin/settings/RefundPolicy"));
const ShippingPolicy = lazy(() => import("@food/pages/admin/settings/ShippingPolicy"));
const CancellationPolicy = lazy(() => import("@food/pages/admin/settings/CancellationPolicy"));
const ReactRegistration = lazy(() => import("@food/pages/admin/settings/ReactRegistration"));
const HelpSupportContent = lazy(() => import("@food/pages/admin/settings/HelpSupportContent"));
// System Settings
const ThirdParty = lazy(() => import("@food/pages/admin/system/ThirdParty"));
const FirebaseNotification = lazy(() => import("@food/pages/admin/system/FirebaseNotification"));
const OfflinePaymentSetup = lazy(() => import("@food/pages/admin/system/OfflinePaymentSetup"));
const JoinUsPageSetup = lazy(() => import("@food/pages/admin/system/JoinUsPageSetup"));
const AnalyticsScript = lazy(() => import("@food/pages/admin/system/AnalyticsScript"));
const AppWebSettings = lazy(() => import("@food/pages/admin/system/AppWebSettings"));
const NotificationChannels = lazy(() => import("@food/pages/admin/system/NotificationChannels"));
const NotificationBroadcast = lazy(() => import("@food/pages/admin/system/NotificationBroadcast"));
const AdminNotifications = lazy(() => import("@food/pages/admin/system/AdminNotifications"));
const LandingPageSettings = lazy(() => import("@food/pages/admin/system/LandingPageSettings"));
const PageMetaData = lazy(() => import("@food/pages/admin/system/PageMetaData"));
const ReactSite = lazy(() => import("@food/pages/admin/system/ReactSite"));
const CleanDatabase = lazy(() => import("@food/pages/admin/system/CleanDatabase"));
const AddonActivation = lazy(() => import("@food/pages/admin/system/AddonActivation"));
const LandingPageManagement = lazy(() => import("@food/pages/admin/system/LandingPageManagement"));
const EditRestaurant = lazy(() => import("@food/pages/admin/restaurant/EditRestaurant"));
const AdminLogin = lazy(() => import("@food/pages/admin/auth/AdminLogin"));
const AdminSignup = lazy(() => import("@food/pages/admin/auth/AdminSignup"));
const AdminForgotPassword = lazy(() => import("@food/pages/admin/auth/AdminForgotPassword"));
import { SERVICE_PROVIDER_ENABLED } from "@/config/features";
// The Services admin, on for sites that set VITE_ENABLE_SERVICE_PROVIDER
// (config/features.js). Lazy, so a site with it off never downloads it.
const SPAdminRoutes = lazy(() => import("@sp/admin/routes"));
// One admin-accounts screen for every panel (food, quick commerce, taxi).
// Stock per product size, per store (quick commerce only).
const StockManager = lazy(() => import("@food/pages/shared/StockManager"));
const AdminAccounts = lazy(() => import("@food/pages/admin/management/AdminAccounts"));

/**
 * The admin pages for one vertical.
 *
 * Rendered at BOTH /admin/food and /admin/quick-commerce. Quick-commerce is a fork of
 * this repo's own food module, so its admin API is the same route table on a different
 * prefix (/v1/qc/admin instead of /v1/food/admin) -- there is no second UI to port, and
 * shipping one would mean maintaining two copies of the same screens.
 *
 * The prefix swap happens once, in the axios request interceptor, keyed on the browser
 * path. Nothing below needs to know which vertical it is serving.
 */
/** Seller pages, by sub-path: shown under /restaurants (Food) and /stores (Quick). */
const SELLER_PAGES = [
  ["", RestaurantsList],
  ["add", AddRestaurant],
  ["edit/:id", EditRestaurant],
  ["joining-request", JoiningRequest],
  ["commission", RestaurantCommission],
  ["monetization-mode", MonetizationMode],
  ["free-item-offers", RestaurantFreebieOffers],
  ["bogo-offers", RestaurantBogoOffers],
  ["combos", RestaurantCombos],
  ["complaints", RestaurantComplaints],
  ["reviews", RestaurantReviews],
  ["bulk-import", RestaurantsBulkImport],
  ["bulk-export", RestaurantsBulkExport],
]

/** In the Quick panel a /restaurants address is the /stores one. */
function StoresRedirect({ children }) {
  const location = useLocation()
  const base = currentAdminBase(location.pathname)
  if (base !== "/admin/food" && location.pathname.startsWith(`${base}/restaurants`)) {
    const to = location.pathname.replace(`${base}/restaurants`, `${base}/stores`) + location.search
    return <Navigate to={to} replace />
  }
  return children
}

const verticalAdminRoutes = (
  <>
            <Route index element={<AdminHome />} />
            <Route path="point-of-sale" element={<PointOfSale />} />
            <Route path="status-monitor" element={<StatusMonitor />} />
            <Route path="profile" element={<AdminProfile />} />
            <Route path="settings" element={<AdminSettings />} />
            
            {/* ORDER MANAGEMENT */}
            <Route path="orders/all" element={<OrdersPage statusKey="all" />} />
            <Route path="orders/scheduled" element={<OrdersPage statusKey="scheduled" />} />
            <Route path="orders/pending" element={<OrdersPage statusKey="pending" />} />
            {/* ... other order routes ... */}
            <Route path="orders/accepted" element={<OrdersPage statusKey="accepted" />} />
            <Route path="orders/processing" element={<OrdersPage statusKey="processing" />} />
            <Route path="orders/food-on-the-way" element={<OrdersPage statusKey="food-on-the-way" />} />
            <Route path="orders/delivered" element={<OrdersPage statusKey="delivered" />} />
            <Route path="orders/canceled" element={<OrdersPage statusKey="canceled" />} />
            <Route path="orders/restaurant-cancelled" element={<OrdersPage statusKey="restaurant-cancelled" />} />
            <Route path="orders/payment-failed" element={<OrdersPage statusKey="payment-failed" />} />
            <Route path="orders/refunded" element={<OrdersPage statusKey="refunded" />} />
            <Route path="orders/offline-payments" element={<OrdersPage statusKey="offline-payments" />} />
            <Route path="order-detect-delivery" element={<OrderDetectDelivery />} />
            {/* The old request list had no backend; every refund, with its gateway status, is on Master > Refunds. */}
            <Route path="order-refunds/new" element={<Navigate to="/admin/master/refunds" replace />} />

            {/* RESTAURANT MANAGEMENT */}
            <Route path="zone-setup" element={<ZoneSetup />} />
            <Route path="zone-setup/map" element={<AllZonesMap />} />
            <Route path="zone-setup/delivery-boy-view" element={<DeliveryBoyViewMap />} />
            <Route path="zone-setup/add" element={<AddZone />} />
            <Route path="zone-setup/edit/:id" element={<AddZone />} />
            <Route path="zone-setup/view/:id" element={<ViewZone />} />
            <Route path="food-approval" element={<FoodApproval />} />
            {/* The seller pages. Food calls them restaurants; Quick
                calls them stores, under /stores (a /restaurants address there
                redirects). Same screens either way, from one list. */}
            {SELLER_PAGES.map(([sub, Page]) => (
              <Route key={`restaurants/${sub}`} path={sub ? `restaurants/${sub}` : "restaurants"} element={<StoresRedirect><Page /></StoresRedirect>} />
            ))}
            {SELLER_PAGES.map(([sub, Page]) => (
              <Route key={`stores/${sub}`} path={sub ? `stores/${sub}` : "stores"} element={<Page />} />
            ))}

            {/* FOOD & CATEGORY MANAGEMENT */}
            <Route path="categories" element={<Category />} />
            <Route path="fee-settings" element={<FeeSettings />} />
            <Route path="free-delivery" element={<FreeDeliveryPage />} />
            <Route path="delivery-radius" element={<DeliveryRadiusPage />} />
            <Route path="99-store" element={<NinetyNineStore />} />
            <Route path="packaging-charges" element={<PackagingCharges />} />
            <Route path="map-settings" element={<MapSettings />} />
            <Route path="referral-settings" element={<ReferralSettings />} />
            <Route path="foods" element={<FoodsList />} />
            <Route path="food/list" element={<FoodsList />} />
            <Route path="addons" element={<AddonsList />} />
            <Route path="global-pricing" element={<GlobalPricing />} />

            {/* PROMOTIONS, CUSTOMERS, DELIVERYMEN, etc. */}
            <Route path="campaigns/basic" element={<BasicCampaign />} />
            <Route path="campaigns/food" element={<FoodCampaign />} />
            <Route path="coupons" element={<Coupons />} />
            <Route path="cashback" element={<Cashback />} />
            <Route path="banners" element={<Banners />} />
            <Route path="promotional-banner" element={<PromotionalBanner />} />
            <Route path="advertisement" element={<AdsList />} />
            <Route path="advertisement/new" element={<NewAdvertisement />} />
            <Route path="advertisement/requests" element={<AdRequests />} />
            
            <Route path="chattings" element={<Chattings />} />
            <Route path="contact-messages" element={<ContactMessages />} />
            <Route path="safety-emergency-reports" element={<SafetyEmergencyReports />} />
            
            <Route path="customers" element={<Customers />} />
            <Route path="support-tickets" element={<SupportTickets />} />
            <Route path="wallet/add-fund" element={<AddFund />} />
            <Route path="wallet/bonus" element={<Bonus />} />
            <Route path="loyalty-point/report" element={<LoyaltyPointReport />} />
            <Route path="subscribed-mail-list" element={<SubscribedMailList />} />

            <Route path="delivery-cash-limit" element={<DeliveryCashLimit />} />
            <Route path="cash-limit-settlement" element={<CashLimitSettlement />} />
            <Route path="delivery-withdrawal" element={<DeliveryWithdrawal />} />
            <Route path="delivery-boy-wallet" element={<DeliveryBoyWallet />} />
            <Route path="delivery-emergency-help" element={<DeliveryEmergencyHelp />} />
            <Route path="delivery-support-tickets" element={<DeliverySupportTickets />} />
            <Route path="delivery-partners" element={<DeliverymanList />} />
            <Route path="delivery-partners/add" element={<AddDeliveryman />} />
            <Route path="delivery-partners/join-request" element={<JoinRequest />} />
            <Route path="delivery-partners/reviews" element={<DeliverymanReviews />} />
            <Route path="delivery-partners/bonus" element={<DeliverymanBonus />} />
            {/* Earning Addon is retired: one incentive ladder for every order type lives in Master. */}
            <Route path="delivery-partners/earning-addon" element={<Navigate to="/admin/master/delivery-incentives" replace />} />
            <Route path="delivery-partners/earning-addon-history" element={<EarningAddonHistory />} />
            <Route path="delivery-partners/earnings" element={<DeliveryEarnings />} />


            {/* REPORTS & SETTINGS */}
            <Route path="transaction-report" element={<TransactionReport />} />
            <Route path="expense-report" element={<ExpenseReport />} />
            <Route path="disbursement-report/restaurants" element={<DisbursementReportRestaurants />} />
            <Route path="disbursement-report/deliverymen" element={<DisbursementReportDeliverymen />} />
            <Route path="order-report/regular" element={<RegularOrderReport />} />
            <Route path="order-report/campaign" element={<CampaignOrderReport />} />
            <Route path="restaurant-report" element={<RestaurantReport />} />
            <Route path="customer-report/feedback-experience" element={<FeedbackExperienceReport />} />
            <Route path="tax-report" element={<TaxReport />} />
            <Route path="restaurant-vat-report" element={<RestaurantVATReport />} />
            
            <Route path="restaurant-withdraws" element={<RestaurantWithdraws />} />
            <Route path="withdraw-method" element={<WithdrawMethod />} />
            
             <Route path="employee-role" element={<Navigate to="../management/admins" replace />} />
             <Route path="employees" element={<Navigate to="../management/admins" replace />} />
             <Route path="employees/add" element={<Navigate to="../management/admins/create" replace />} />

            {/* SUBADMIN MANAGEMENT */}
            {/* One admin-accounts screen for every panel, under Master. */}
            <Route path="management/admins" element={<Navigate to="/admin/master/admins" replace />} />
            <Route path="management/admins/create" element={<Navigate to="/admin/master/admins/create" replace />} />
            <Route path="management/admins/edit/:id" element={<RedirectAdminEdit />} />

            {/* SYSTEM & BUSINESS SETTINGS */}
            <Route path="business-setup" element={<BusinessSetup />} />
            <Route path="petpooja-settings" element={<PetpoojaSettings />} />
            <Route path="order-cancellation" element={<OrderCancellation />} />
            <Route path="delivery-instructions" element={<DeliveryInstructions />} />
            <Route path="email-template" element={<EmailTemplate />} />
            <Route path="theme-settings" element={<ThemeSettings />} />
            <Route path="gallery" element={<Gallery />} />
            <Route path="login-setup" element={<LoginSetup />} />
            <Route path="business-settings/fcm-index" element={<FirebaseNotification />} />
            <Route path="pages-social-media/terms" element={<TermsAndCondition />} />
            <Route path="pages-social-media/privacy" element={<PrivacyPolicy />} />
            <Route path="pages-social-media/about" element={<AboutUs />} />
            <Route path="pages-social-media/refund" element={<RefundPolicy />} />
            <Route path="pages-social-media/shipping" element={<ShippingPolicy />} />
            <Route path="pages-social-media/cancellation" element={<CancellationPolicy />} />
            <Route path="pages-social-media/react-registration" element={<ReactRegistration />} />
            <Route path="pages-social-media/help-support" element={<HelpSupportContent />} />
            
            <Route path="3rd-party-configurations/party" element={<ThirdParty />} />
            <Route path="3rd-party-configurations/firebase" element={<FirebaseNotification />} />
            <Route path="3rd-party-configurations/offline-payment" element={<OfflinePaymentSetup />} />
            <Route path="3rd-party-configurations/join-us" element={<JoinUsPageSetup />} />
            <Route path="3rd-party-configurations/analytics" element={<AnalyticsScript />} />
            {/* The old AI setup page stored keys nothing used. Insights are computed in-house: Master > Insights. */}
            <Route path="3rd-party-configurations/ai" element={<Navigate to="/admin/master/insights" replace />} />
            <Route path="app-web-settings" element={<AppWebSettings />} />
            <Route path="notifications" element={<AdminNotifications />} />
            <Route path="broadcast-notification" element={<NotificationBroadcast />} />
            <Route path="notification-channels" element={<NotificationChannels />} />
            <Route path="landing-page-settings/admin" element={<LandingPageSettings type="admin" />} />
            <Route path="landing-page-settings/react" element={<LandingPageSettings type="react" />} />
            <Route path="page-meta-data" element={<PageMetaData />} />
            <Route path="react-site" element={<ReactSite />} />
            <Route path="clean-database" element={<CleanDatabase />} />
            <Route path="addon-activation" element={<AddonActivation />} />
            <Route path="hero-banner-management" element={<LandingPageManagement />} />
  </>
);

export default function AdminRouter() {
  return (
    <Suspense fallback={<Loader />}>
      <Routes>
        {/* Protected Routes - With Layout */}
        {/* Admin Login - Same as earlier */}
        <Route path="login" element={<AdminLogin />} />
        <Route path="forgot-password" element={<AdminForgotPassword />} />
        <Route path="signup" element={<AdminSignup />} />

        {/* SERVICE PROVIDER ADMIN -- per site, not per branch.
            On only where VITE_ENABLE_SERVICE_PROVIDER=true (config/features.js),
            and the Services tab in both panel switchers reads the same flag, so a
            route and its tab can never be out of step: a route without its tab is
            unreachable, and a tab without its route lands on the catch-all.

            Deliberately OUTSIDE master's AdminLayout: the SP pages ship their own
            AdminLayout (sidebar + a position:fixed header), so nesting them inside
            master's shell stacked two sidebars and overlapped two headers. Taxi has
            the same shape and is handled the same way -- it owns its chrome inside
            TaxiApp. Auth is still shared: same ProtectedRoute, same /admin/login,
            same token. */}
        {SERVICE_PROVIDER_ENABLED && (
          <Route
            path="sp/*"
            element={
              <ProtectedRoute>
                <SPAdminRoutes />
              </ProtectedRoute>
            }
          />
        )}

        {/* Protected Routes - With Layout */}
        <Route
          element={
            <ProtectedRoute>
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          {/* Default Admin Redirect */}
          {/* The admin home is the cross-vertical dashboard; each admin sees the services they may. */}
          <Route path="/" element={<Navigate to="master/dashboard" replace />} />
          <Route path="master/dashboard" element={<MasterDashboard />} />
          <Route path="master/reports" element={<Navigate to="/admin/master/reports/sales" replace />} />
          <Route path="master/reports/:kind" element={<MasterReports />} />
          <Route path="master/tax" element={<MasterTaxReport />} />
          <Route path="master/subscriptions" element={<MasterSubscriptions />} />
          <Route path="master/broadcasts" element={<MasterBroadcasts />} />
          <Route path="master/insights" element={<MasterInsights />} />

          {/*
            MASTER / GLOBAL
            Outside every vertical, on purpose. These are the rules that apply to all
            of them, so the screen exists ONCE and is reached at the same URL whatever
            panel the operator came from. It is deliberately not part of
            verticalAdminRoutes: those get re-pointed per vertical by rewriting URLs
            and substituting words in the menu, which is right for screens that exist
            once per vertical and wrong for a screen that does not.
          */}
          <Route path="master/settings" element={<PlatformSettings />} />
          <Route path="master/settings/:tab" element={<PlatformSettings />} />
          <Route path="master/support" element={<SupportInbox />} />
          <Route path="master/referral" element={<MasterReferral />} />
          <Route path="master/coupons" element={<MasterCoupons />} />
          <Route path="master/platform-earnings" element={<PlatformEarnings />} />
          <Route path="master/fees" element={<MasterFees />} />
          <Route path="master/cancellation" element={<MasterCancellation />} />
          <Route path="master/home-screen" element={<HomeScreenArtwork />} />
          <Route path="master/commission" element={<CommissionOverview />} />
          <Route path="master/app-services" element={<AppServices />} />
          <Route path="master/customers" element={<MasterCustomers />} />
          <Route path="master/orders" element={<MasterOrders />} />
          <Route path="master/orders/:tab" element={<MasterOrders />} />
          <Route path="master/delivery-earnings" element={<MasterDeliveryEarnings />} />
          <Route path="master/delivery-incentives" element={<MasterDeliveryIncentives />} />
          <Route path="master/promotions" element={<MasterPromotions />} />
          <Route path="master/order-batching" element={<OrderBatching />} />
          <Route path="master/activity-log" element={<AdminActivityLog />} />
          <Route path="master/refunds" element={<MasterRefunds />} />
          <Route path="master/faqs" element={<MasterFaqs />} />
          <Route path="master/loyalty" element={<MasterLoyalty />} />
          <Route path="master/delivery-slots" element={<MasterDeliverySlots />} />
          <Route path="master/delivery-partners" element={<DeliverymanList />} />
          <Route path="master/delivery-partners/join-requests" element={<JoinRequest />} />
          <Route path="master/taxi-drivers" element={<TaxiDriverList />} />
          <Route path="master/taxi-drivers/pending" element={<TaxiPendingDrivers />} />
          <Route path="master/taxi-drivers/create" element={<TaxiDriverCreate />} />
          <Route path="master/taxi-drivers/edit/:id" element={<TaxiDriverEdit />} />
          <Route path="master/taxi-drivers/:id" element={<TaxiDriverDetails />} />
          <Route path="master/partner-documents" element={<PartnerDocuments />} />
          <Route path="master/partner-documents/create" element={<PartnerDocumentForm />} />
          <Route path="master/partner-documents/edit/:id" element={<PartnerDocumentForm />} />
          <Route path="master/admins" element={<AdminAccounts />} />
          <Route path="master/admins/create" element={<AdminAccounts />} />
          <Route path="master/admins/edit/:id" element={<AdminAccounts />} />

          {/* FOOD ADMIN - All food related routes nested here */}
          {/* FOOD ADMIN */}
          <Route path="food/*">{verticalAdminRoutes}</Route>

          {/* TAXI ADMIN - Redirect to integrated taxi admin */}
          <Route path="taxi/*" element={<Navigate to="/taxi/admin/dashboard" replace />} />


                    {/* QUICK COMMERCE ADMIN - the same screens, pointed at /v1/qc/admin. */}
          {/* The vocabulary layer rewrites the shared screens' copy (Food -> Product,
              Restaurant -> Seller) for every screen in this subtree, present and
              future, instead of forking dozens of components for their strings. */}
          <Route
            path="quick-commerce/*"
            element={
              <VerticalVocabulary>
                <Outlet />
              </VerticalVocabulary>
            }
          >
            {verticalAdminRoutes}
            <Route path="stock" element={<StockManager scope="admin" />} />
          </Route>
        </Route>

        {/* Redirect unknown admin routes to food admin */}
        <Route path="*" element={<Navigate to="/admin/food" replace />} />
      </Routes>
    </Suspense>
  );
}
