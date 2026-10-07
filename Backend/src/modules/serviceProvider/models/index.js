// Eagerly register every SP model.
//
// Without this, a model is only registered when some controller happens to
// require() it first. Any populate() against a not-yet-required model throws
// MissingSchemaError at request time -- a bug that only shows up on the one
// endpoint nobody tested. Requiring the whole set at boot makes registration
// order-independent.
//
// SPVendorService is deliberately included even though nothing uses it yet: it
// was already an orphan in the standalone project (see the TODO in
// controllers/vendorControllers/vendorServiceController.js).

require('./Admin');
require('./Booking');
require('./BookingRequest');
require('./Brand');
require('./Cart');
require('./Category');
require('./City');
require('./HomeContent');
require('./Notification');
require('./NotificationLog');
require('./Plan');
require('./PlatformEarning');
require('./Review');
require('./Scrap');
require('./Service');
require('./Settings');
require('./Settlement');
require('./Token');
require('./Transaction');
require('./User');
require('./UserService');
require('./Vendor');
require('./VendorBill');
require('./VendorPartsCatalog');
require('./VendorService');
require('./VendorServiceCatalog');
require('./Withdrawal');
require('./Worker');
require('./SpPaymentReceipt');
require('./WorkerSubscriptionPlan');
require('./CommissionRule');
