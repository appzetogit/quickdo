import { SERVICE_PROVIDER_ENABLED } from "@/config/features"

/**
 * The Master panel's own menu: everything that is managed once for the whole
 * platform, in the ten groups the business asked for.
 *
 * Kept apart from adminSidebarMenu on purpose. That menu is rebased per
 * vertical -- /admin/food paths are rewritten to /admin/quick-commerce, words
 * like "Food" become "Product", and medical keeps an allowlist -- which is right
 * for screens that exist once per vertical and wrong here: a link to Food's
 * banners must stay Food's banners whichever panel the operator came from.
 *
 * Two kinds of entry:
 *  - /admin/master/* screens hold ONE value for every service (Master settings,
 *    delivery earnings, promo limits, customers, admins).
 *  - "Food · ...", "Quick · ...", "Taxi · ..." entries are the services' own
 *    screens, gathered here so each group is managed from one place. Quick
 *    covers Medical too: pharmacies run on the quick-commerce API and share its
 *    banners, referral, customers and support.
 *
 * Zones are deliberately absent: every service keeps its own map.
 *
 * Every entry is still filtered by the admin's permissions (filterMenuForAccess),
 * so a sub-admin sees only the screens they can open.
 */

const sp = (items) => (SERVICE_PROVIDER_ENABLED ? items : [])

export const masterSidebarMenu = [
  {
    type: "section",
    label: "MASTER",
    items: [
      {
        type: "expandable",
        label: "Master Settings",
        icon: "SlidersHorizontal",
        subItems: [
          { label: "Brand & Contact", path: "/admin/master/settings/brand" },
          { label: "Payments & Messages", path: "/admin/master/settings/integrations" },
          { label: "Money Rules & Cash Limit", path: "/admin/master/settings/money" },
          { label: "Platform Fee & GST", path: "/admin/master/fees" },
          { label: "Cancellation Policy", path: "/admin/master/cancellation" },
          { label: "Promo Limits", path: "/admin/master/promotions" },
        ],
      },
      {
        type: "link",
        label: "All Orders",
        path: "/admin/master/orders",
        icon: "Package",
      },
      {
        type: "link",
        label: "Admin Accounts",
        path: "/admin/master/admins",
        icon: "UserCog",
      },
      {
        type: "expandable",
        label: "Delivery Management",
        icon: "Truck",
        subItems: [
          { label: "Delivery Earnings (all services)", path: "/admin/master/delivery-earnings" },
          { label: "Delivery Incentives", path: "/admin/master/delivery-incentives" },
          { label: "Order Batching", path: "/admin/master/order-batching" },
          // One catalogue for every partner: the partner app's sign-up (Food rider,
          // Quick & Medical rider, bike taxi, cab, parcel) reads it for all of
          // them, filtered by vehicle class. It lives on Taxi's screen, which is
          // why it used to be labelled "Taxi · Driver Documents".
          { label: "Partner Documents (all partners)", path: "/admin/master/partner-documents" },
          // Food, Quick and Medical share one rider pool: every rider signs up and
          // works on the Food record, and Quick keeps linked copies. One list.
          // Taxi drivers are a separate pool. countKey / alertKey name the
          // sidebar-badges total shown beside the entry (alert = needs action).
          // Master's own pages (AdminRouter master/*), so the admin stays in Master.
          { label: "Delivery Partners", path: "/admin/master/delivery-partners", countKey: "masterRiders" },
          { label: "Delivery Join Requests", path: "/admin/master/delivery-partners/join-requests", alertKey: "masterRiderRequests" },
          { label: "Taxi Drivers", path: "/admin/master/taxi-drivers", countKey: "masterTaxiDrivers" },
          { label: "Taxi Pending Drivers", path: "/admin/master/taxi-drivers/pending", alertKey: "masterTaxiPending" },
          ...sp([{ label: "Services · Workers", path: "/admin/sp/workers/all" }]),
        ],
      },
      {
        type: "expandable",
        label: "Report Management",
        icon: "Receipt",
        subItems: [
          { label: "Platform Earnings (all services)", path: "/admin/master/platform-earnings" },
          { label: "Commission Overview (all services)", path: "/admin/master/commission" },
          { label: "Food · Transactions", path: "/admin/food/transaction-report" },
          { label: "Food · Orders", path: "/admin/food/order-report/regular" },
          { label: "Food · Tax", path: "/admin/food/tax-report" },
          { label: "Quick · Transactions", path: "/admin/quick-commerce/transaction-report" },
          { label: "Quick · Orders", path: "/admin/quick-commerce/order-report/regular" },
          { label: "Quick · Tax", path: "/admin/quick-commerce/tax-report" },
          { label: "Taxi · Finance", path: "/taxi/admin/reports/finance" },
          { label: "Taxi · Drivers", path: "/taxi/admin/reports/driver" },
          ...sp([{ label: "Services · Reports", path: "/admin/sp/reports" }]),
        ],
      },
      {
        type: "expandable",
        label: "Banner & Settings",
        icon: "Image",
        subItems: [
          { label: "Home Screen Banners (all services)", path: "/admin/master/home-screen" },
          { label: "Food · Banners", path: "/admin/food/banners" },
          { label: "Food · Promotional Banners", path: "/admin/food/promotional-banner" },
          { label: "Food · Landing Page", path: "/admin/food/hero-banner-management" },
          { label: "Quick · Banners", path: "/admin/quick-commerce/banners" },
          { label: "Quick · Promotional Banners", path: "/admin/quick-commerce/promotional-banner" },
          { label: "Taxi · Banners", path: "/taxi/admin/promotions/banner-image" },
          { label: "Taxi · Onboarding Screens", path: "/taxi/admin/settings/app/onboard" },
        ],
      },
      {
        type: "expandable",
        label: "System Settings",
        icon: "Settings",
        subItems: [
          { label: "App Services", path: "/admin/master/app-services" },
          { label: "Business Setup", path: "/admin/food/business-setup" },
          { label: "Google Maps Key", path: "/admin/food/map-settings" },
          { label: "Order Cancellation", path: "/admin/food/order-cancellation" },
          { label: "Food · Push Notifications", path: "/admin/food/broadcast-notification" },
          { label: "Quick · Push Notifications", path: "/admin/quick-commerce/broadcast-notification" },
          { label: "Taxi · Push Notifications", path: "/taxi/admin/promotions/send-notification" },
          { label: "Taxi · Wallet Settings", path: "/taxi/admin/settings/app/wallet" },
        ],
      },
      {
        type: "expandable",
        label: "Pages & Social Media",
        icon: "FileText",
        subItems: [
          { label: "Website Legal Pages", path: "/admin/master/settings/legal" },
          { label: "App Terms (all apps)", path: "/admin/master/settings/appTerms" },
          { label: "About Us", path: "/admin/food/pages-social-media/about" },
          { label: "Help & Support Content", path: "/admin/food/pages-social-media/help-support" },
          { label: "Taxi · User Pages", path: "/taxi/admin/settings/cms/user" },
          { label: "Taxi · Driver Pages", path: "/taxi/admin/settings/cms/driver" },
        ],
      },
      {
        type: "expandable",
        label: "Referral Management",
        icon: "Gift",
        subItems: [
          { label: "Referral Rewards (all services)", path: "/admin/master/referral" },
          { label: "All Coupons & Promo Codes", path: "/admin/master/coupons" },
          { label: "Food · Referral", path: "/admin/food/referral-settings" },
          { label: "Quick · Referral", path: "/admin/quick-commerce/referral-settings" },
          { label: "Taxi · User Referral", path: "/taxi/admin/referrals/user-settings" },
          { label: "Taxi · Driver Referral", path: "/taxi/admin/referrals/driver-settings" },
          { label: "Food · Coupons & Offers", path: "/admin/food/coupons" },
          { label: "Quick · Coupons & Offers", path: "/admin/quick-commerce/coupons" },
          { label: "Taxi · Promo Codes", path: "/taxi/admin/promotions/promo-codes" },
        ],
      },
      {
        type: "expandable",
        label: "Customer Management",
        icon: "Users",
        subItems: [
          // Customers are one `users` collection for every app, so one list.
          { label: "All Customers", path: "/admin/master/customers", countKey: "masterCustomers" },
          { label: "Account Deletion Requests", path: "/taxi/admin/users/delete-requests", alertKey: "masterDeletionRequests" },
          ...sp([{ label: "Services · Users", path: "/admin/sp/users/all" }]),
        ],
      },
      {
        type: "expandable",
        label: "Help & Support",
        icon: "MessageSquare",
        subItems: [
          { label: "All Tickets", path: "/admin/master/support" },
          { label: "Food · Customer Tickets", path: "/admin/food/support-tickets" },
          { label: "Food · Rider Tickets", path: "/admin/food/delivery-support-tickets" },
          { label: "Food · Restaurant Complaints", path: "/admin/food/restaurants/complaints" },
          { label: "Quick · Customer Tickets", path: "/admin/quick-commerce/support-tickets" },
          { label: "Quick · Rider Tickets", path: "/admin/quick-commerce/delivery-support-tickets" },
          { label: "Taxi · Support Tickets", path: "/taxi/admin/support/tickets" },
          { label: "Taxi · SOS", path: "/taxi/admin/safety/sos" },
          { label: "User Feedback", path: "/admin/food/contact-messages" },
          { label: "Safety Reports", path: "/admin/food/safety-emergency-reports" },
        ],
      },
    ],
  },
]
