import { FoodOrder } from '../../orders/models/order.model.js';
import { FoodTransaction } from '../../orders/models/foodTransaction.model.js';
import { FoodRestaurant } from '../models/restaurant.model.js';
import { FoodRestaurantWithdrawal } from '../models/foodRestaurantWithdrawal.model.js';
import { Settlement } from '../../../../core/payments/models/settlement.model.js';
import { FoodUser } from '../../../../core/users/user.model.js';
import { buildRestaurantPayoutBreakdown, resolveRestaurantFundedDiscounts } from '../../shared/restaurantPayout.js';
import { createStoreReports, REPORT_TYPES, REPORT_FORMATS } from '../../../../../../core/reports/storeReports.service.js';
import { customerAnalytics } from '../../../../../../core/analytics/customerAnalytics.js';

/**
 * Store analytics, downloadable reports and settlement statements for
 * quick-commerce sellers -- the food pipeline (core/reports) bound to the qc_*
 * collections, so /qc/restaurant/{analytics/sales,reports,settlements} answer
 * with exactly the shapes /food/restaurant/... does.
 *
 * What differs from food, and why:
 *
 *   GST     QC prices are exclusive and taxed per product slab; the order stores
 *           the goods' GST as pricing.tax (order-pricing.service computeItemsTax).
 *           There is no order-wide rate to multiply, so tax is read as stored.
 *           The seller, not the platform, owes GST on goods (s.9(5) is for
 *           restaurant service only), so the food footnote is not printed.
 *   multi-store  each store's child order sits in qc_orders with its own
 *           restaurantId and its own subtotal, so it counts once per store with
 *           that store's share. Rows carry parentOrderId for reference.
 *   pickup  a collected pickup order is `delivered`; its delivery fee is zero
 *           and none of the delivery fee is the store's money anyway. Rows carry
 *           fulfilmentType and deliveryFee so the difference is visible.
 *   customers  /analytics/sales also returns `customerInsights` (repeat rate,
 *           top customers, core/analytics/customerAnalytics.js) -- an extra key,
 *           the food shape is otherwise unchanged.
 */
const reports = createStoreReports({
    Order: FoodOrder,
    Transaction: FoodTransaction,
    Restaurant: FoodRestaurant,
    Withdrawal: FoodRestaurantWithdrawal,
    Settlement,
    buildPayoutBreakdown: buildRestaurantPayoutBreakdown,
    resolveFundedDiscounts: resolveRestaurantFundedDiscounts,
    gst: {
        expr: { $ifNull: ['$pricing.tax', 0] },
        fromOrder: (order) => Number(order?.pricing?.tax) || 0,
    },
    entityLabel: 'Store',
    codePrefix: 'STORE',
    gstNote: 'GST on goods is charged at each product\'s slab and is reported in your own GST returns.',
    statementGstLabel: 'GST on goods (collected from customers at each product\'s slab)',
    extraOrderFields: 'fulfilmentType parentOrderId',
    extraRowFields: (order) => ({
        fulfilmentType: order.fulfilmentType || 'delivery',
        deliveryFee: order.fulfilmentType === 'pickup' ? 0 : Math.round((Number(order.pricing?.deliveryFee) || 0) * 100) / 100,
        parentOrderId: order.parentOrderId ? String(order.parentOrderId) : null,
    }),
    extraAnalytics: async (rid, range, query) => ({
        customerInsights: await customerAnalytics({
            OrderModel: FoodOrder,
            UserModel: FoodUser,
            storeId: rid,
            from: range.start,
            to: new Date(range.end.getTime() - 1),
            limit: query.topCustomers || 10,
        }),
    }),
});

export { REPORT_TYPES, REPORT_FORMATS };
export const {
    getSalesAnalytics,
    buildRestaurantReport,
    listSettlementStatements,
    getSettlementStatement,
    buildSettlementStatementFile,
} = reports;
