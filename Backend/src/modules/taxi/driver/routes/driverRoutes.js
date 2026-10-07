import { Router } from "express";
import { asyncHandler } from "../../../../utils/asyncHandler.js";
import { authenticate } from "../../middlewares/authMiddleware.js";
import { getCurrentDriverIncentiveController } from "../../../../core/incentives/controllers/incentiveController.js";
import {
  addDriverEmergencyContact,
  completeOnboarding,
  createDriverPaymentQr,
  createDriverWithdrawalRequest,
  createOwnerFleetDriver,
  updateOwnerFleetDriver,
  updateOwnerFleetVehicle,
  deleteCurrentDriverAccount,
  deleteDriverEmergencyContact,
  claimDriverIncentiveReward,
  goOffline,
  goOnline,
  setWorkMode,
  getCurrentDriver,
  getDriverPaymentQrStatus,
  getDriverApprovalStatus,
  getDriverDocumentTemplates,
  getDriverVehicleFieldTemplates,
  getDriverEmergencyContacts,
  getDriverIncentives,
  getDriverNotifications,
  cancelDriverScheduledRide,
  cancelDriverActiveRide,
  declineDriverRideOffer,
  getDriverScheduledRides,
  getOwnerFleetDrivers,
  getOwnerFleetDashboard,
  getMyWallet,
  getOnboardingSession,
  getServiceLocations,
  loginDriver,
  startDriverLoginOtpRequest,
  saveOnboardingDocuments,
  saveOnboardingPersonal,
  saveOnboardingReferral,
  saveOnboardingVehicle,
  registerDriver,
  requestDriverAccountDeletion,
    startOnboarding,
    topUpMyWallet,
    createDriverWalletTopupOrder,
    createDriverPhonePeWalletTopupOrder,
    verifyDriverWalletTopup,
    verifyDriverPhonePeWalletTopup,

  updateCurrentDriver,
  updateDriverVehicle,
  verifyOnboardingOtp,
  verifyDriverLoginOtpRequest,
  addOwnerVehicle,
  getOwnerFleetVehicles,
  deleteOwnerFleetVehicle,
  updateCurrentDriverDocument,
} from "../controllers/driverController.js";
import { triggerDriverSosAlert } from '../../safety/controllers/safetyController.js';

export const driverRouter = Router();

driverRouter.post("/register", asyncHandler(registerDriver));
driverRouter.post("/login", asyncHandler(loginDriver));
driverRouter.post("/auth/send-otp", asyncHandler(startDriverLoginOtpRequest));
driverRouter.post(
  "/auth/verify-otp",
  asyncHandler(verifyDriverLoginOtpRequest),
);
driverRouter.get(
  "/me",
  authenticate(["driver", "owner"], { allowPending: true }),
  asyncHandler(getCurrentDriver),
);
driverRouter.patch(
  "/me",
  authenticate(["driver", "owner"]),
  asyncHandler(updateCurrentDriver),
);
driverRouter.delete(
  "/me",
  authenticate(["driver"]),
  asyncHandler(deleteCurrentDriverAccount),
);
driverRouter.post(
  "/me/delete-request",
  authenticate(["driver"]),
  asyncHandler(requestDriverAccountDeletion),
);
driverRouter.post(
  "/sos",
  authenticate(["driver", "owner"]),
  asyncHandler(triggerDriverSosAlert),
);
driverRouter.get(
  "/emergency-contacts",
  authenticate(["driver"]),
  asyncHandler(getDriverEmergencyContacts),
);
driverRouter.post(
  "/emergency-contacts",
  authenticate(["driver"]),
  asyncHandler(addDriverEmergencyContact),
);
driverRouter.delete(
  "/emergency-contacts/:contactId",
  authenticate(["driver"]),
  asyncHandler(deleteDriverEmergencyContact),
);
driverRouter.patch(
  "/documents/:documentKey",
  authenticate(["driver", "owner"], { allowPending: true }),
  asyncHandler(updateCurrentDriverDocument),
);
driverRouter.get(
  "/notifications",
  authenticate(["driver"]),
  asyncHandler(getDriverNotifications),
);
driverRouter.get(
  "/scheduled-rides",
  authenticate(["driver"]),
  asyncHandler(getDriverScheduledRides),
);
driverRouter.post(
  "/scheduled-rides/:rideId/cancel",
  authenticate(["driver"]),
  asyncHandler(cancelDriverScheduledRide),
);
driverRouter.post(
  "/rides/:rideId/cancel",
  authenticate(["driver"]),
  asyncHandler(cancelDriverActiveRide),
);
driverRouter.post(
  "/rides/:rideId/decline",
  authenticate(["driver"]),
  asyncHandler(declineDriverRideOffer),
);
driverRouter.get(
  "/wallet",
  authenticate(["driver"]),
  asyncHandler(getMyWallet),
);
driverRouter.get(
  "/incentives",
  authenticate(["driver"]),
  asyncHandler(getDriverIncentives),
);
// The same order/ride-count ladder card Food/Quick/Medical riders see, for
// taxiAndPorter — see core/incentives/. Distinct path from "/incentives"
// above, which is an unrelated milestone/streak gamification system.
driverRouter.get(
  "/incentives/ladder/current",
  authenticate(["driver"]),
  asyncHandler(getCurrentDriverIncentiveController),
);
driverRouter.post(
  "/incentives/claim",
  authenticate(["driver"]),
  asyncHandler(claimDriverIncentiveReward),
);
driverRouter.post(
  "/wallet/top-up",
  authenticate(["driver"]),
  asyncHandler(topUpMyWallet),
);
  driverRouter.post(
    "/wallet/top-up/razorpay/order",
    authenticate(["driver"]),
    asyncHandler(createDriverWalletTopupOrder),
  );
  driverRouter.post(
    "/wallet/top-up/phonepe/order",
    authenticate(["driver"]),
    asyncHandler(createDriverPhonePeWalletTopupOrder),
  );
  driverRouter.post(
    "/wallet/top-up/razorpay/verify",
    authenticate(["driver"]),
    asyncHandler(verifyDriverWalletTopup),
  );
  driverRouter.get(
    "/wallet/top-up/phonepe/status/:merchantTransactionId",
    authenticate(["driver"]),
    asyncHandler(verifyDriverPhonePeWalletTopup),
  );
driverRouter.post(
  "/wallet/withdrawals",
  authenticate(["driver"]),
  asyncHandler(createDriverWithdrawalRequest),
);

driverRouter.post(
  "/payments/qr",
  authenticate(["driver"]),
  asyncHandler(createDriverPaymentQr),
);
driverRouter.get(
  "/payments/qr/status",
  authenticate(["driver"]),
  asyncHandler(getDriverPaymentQrStatus),
);
driverRouter.patch(
  "/vehicle",
  authenticate(["driver"]),
  asyncHandler(updateDriverVehicle),
);
driverRouter.get("/approval-status", asyncHandler(getDriverApprovalStatus));
driverRouter.get(
  "/fleet/dashboard",
  authenticate(["owner"]),
  asyncHandler(getOwnerFleetDashboard),
);
driverRouter.get(
  "/fleet/drivers",
  authenticate(["driver", "owner"]),
  asyncHandler(getOwnerFleetDrivers),
);
driverRouter.post(
  "/fleet/drivers",
  authenticate(["driver", "owner"]),
  asyncHandler(createOwnerFleetDriver),
);
driverRouter.patch(
  "/fleet/drivers/:driverId",
  authenticate(["driver", "owner"]),
  asyncHandler(updateOwnerFleetDriver),
);
driverRouter.get(
  "/fleet/vehicles",
  authenticate(["driver", "owner"]),
  asyncHandler(getOwnerFleetVehicles),
);
driverRouter.post(
  "/fleet/vehicles",
  authenticate(["driver", "owner"]),
  asyncHandler(addOwnerVehicle),
);
driverRouter.patch(
  "/fleet/vehicles/:vehicleId",
  authenticate(["driver", "owner"]),
  asyncHandler(updateOwnerFleetVehicle),
);
driverRouter.delete(
  "/fleet/vehicles/:vehicleId",
  authenticate(["driver", "owner"]),
  asyncHandler(deleteOwnerFleetVehicle),
);
driverRouter.get("/service-locations", asyncHandler(getServiceLocations));
driverRouter.get(
  "/document-templates",
  asyncHandler(getDriverDocumentTemplates),
);
driverRouter.get(
  "/vehicle-field-templates",
  asyncHandler(getDriverVehicleFieldTemplates),
);
driverRouter.post("/onboarding/send-otp", asyncHandler(startOnboarding));
driverRouter.post("/onboarding/verify-otp", asyncHandler(verifyOnboardingOtp));
driverRouter.patch(
  "/onboarding/personal",
  asyncHandler(saveOnboardingPersonal),
);
driverRouter.patch(
  "/onboarding/referral",
  asyncHandler(saveOnboardingReferral),
);
driverRouter.patch("/onboarding/vehicle", asyncHandler(saveOnboardingVehicle));
driverRouter.patch(
  "/onboarding/documents",
  asyncHandler(saveOnboardingDocuments),
);
driverRouter.post("/onboarding/complete", asyncHandler(completeOnboarding));
driverRouter.get(
  "/onboarding/session/:registrationId",
  asyncHandler(getOnboardingSession),
);
driverRouter.patch("/online", authenticate(["driver"]), asyncHandler(goOnline));
driverRouter.patch("/work-mode", authenticate(["driver"]), asyncHandler(setWorkMode));
driverRouter.patch(
  "/offline",
  authenticate(["driver"]),
  asyncHandler(goOffline),
);
