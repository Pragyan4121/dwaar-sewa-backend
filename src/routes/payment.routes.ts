import { Router } from "express";

import {
  confirmCashPaymentReceived,
  initiateEsewaPayment,
  verifyEsewaPayment,
  initiateKhaltiPayment,
  verifyKhaltiPayment,
  initiateConnectIpsPayment,
  verifyConnectIpsPayment,
} from "../controllers/payment.controller";

import { authenticateUser } from "../middlewares/auth.middleware";
import { allowRoles } from "../middlewares/role.middleware";
import { paymentRateLimiter } from "../middlewares/rate-limit.middleware";

const router = Router();

router.use(paymentRateLimiter);

/*
|--------------------------------------------------------------------------
| CASH
|--------------------------------------------------------------------------
*/

router.post(
  "/:bookingId/cash/received",
  authenticateUser,
  allowRoles("provider"),
  confirmCashPaymentReceived,
);

/*
|--------------------------------------------------------------------------
| ESEWA
|--------------------------------------------------------------------------
*/

router.post(
  "/:bookingId/esewa/initiate",
  authenticateUser,
  allowRoles("customer"),
  initiateEsewaPayment,
);

router.post(
  "/:bookingId/esewa/verify",
  authenticateUser,
  allowRoles("customer"),
  verifyEsewaPayment,
);

/*
|--------------------------------------------------------------------------
| KHALTI
|--------------------------------------------------------------------------
*/

router.post(
  "/:bookingId/khalti/initiate",
  authenticateUser,
  allowRoles("customer"),
  initiateKhaltiPayment,
);

router.post(
  "/:bookingId/khalti/verify",
  authenticateUser,
  allowRoles("customer"),
  verifyKhaltiPayment,
);

/*
|--------------------------------------------------------------------------
| CONNECTIPS
|--------------------------------------------------------------------------
|
| Development:
| routed through Khalti KPG.
|
| Production:
| can later be replaced with direct NCHL ConnectIPS APIs after merchant
| credentials/onboarding are provided.
|--------------------------------------------------------------------------
*/

router.post(
  "/:bookingId/connectips/initiate",
  authenticateUser,
  allowRoles("customer"),
  initiateConnectIpsPayment,
);

router.post(
  "/:bookingId/connectips/verify",
  authenticateUser,
  allowRoles("customer"),
  verifyConnectIpsPayment,
);

export default router;
