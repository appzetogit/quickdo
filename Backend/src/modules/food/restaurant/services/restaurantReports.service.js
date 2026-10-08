import { FoodOrder } from '../../orders/models/order.model.js';
import { FoodTransaction } from '../../orders/models/foodTransaction.model.js';
import { FoodRestaurant } from '../models/restaurant.model.js';
import { FoodRestaurantWithdrawal } from '../models/foodRestaurantWithdrawal.model.js';
import { Settlement } from '../../../../core/payments/models/settlement.model.js';
import { buildRestaurantPayoutBreakdown, resolveRestaurantFundedDiscounts } from '../../shared/restaurantPayout.js';
import { createStoreReports, REPORT_TYPES, REPORT_FORMATS } from '../../../../core/reports/storeReports.service.js';

/**
 * Restaurant analytics, downloadable reports and settlement statements
 * (SOW plan 6.1, 6.2, 6.3) for the food vertical.
 *
 * The pipeline lives in core/reports/storeReports.service.js and is shared with
 * quick-commerce stores; this binds it to the food collections. See that file
 * for how each figure is defined.
 */
const reports = createStoreReports({
    Order: FoodOrder,
    Transaction: FoodTransaction,
    Restaurant: FoodRestaurant,
    Withdrawal: FoodRestaurantWithdrawal,
    Settlement,
    buildPayoutBreakdown: buildRestaurantPayoutBreakdown,
    resolveFundedDiscounts: resolveRestaurantFundedDiscounts,
});

export { REPORT_TYPES, REPORT_FORMATS };
export const {
    getSalesAnalytics,
    buildRestaurantReport,
    listSettlementStatements,
    getSettlementStatement,
    buildSettlementStatementFile,
} = reports;
