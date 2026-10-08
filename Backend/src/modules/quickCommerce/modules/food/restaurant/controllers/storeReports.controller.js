import { createStoreReportsControllers } from '../../../../../../core/reports/storeReports.service.js';
import * as reports from '../services/storeReports.service.js';

/** /qc/restaurant/{analytics/sales,reports,settlements}: same handlers as food. */
export const {
    getSalesAnalyticsController,
    downloadReportController,
    listSettlementStatementsController,
    getSettlementStatementController,
    downloadSettlementStatementController,
} = createStoreReportsControllers(reports, { authMessage: 'Store authentication required' });
