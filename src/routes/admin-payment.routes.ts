import { Router } from "express";

import { ROLE_NAMES } from "../constants/roles";
import {
  getAllPaymentsForAdmin,
  getCashCommissionDueForAdmin,
  getPaymentByIdForAdmin,
  updatePaymentStatusForAdmin,
} from "../controllers/admin-payment.controller";
import { authenticateUser } from "../middlewares/auth.middleware";
import { allowRoles } from "../middlewares/role.middleware";

const router = Router();

/*
|--------------------------------------------------------------------------
| Admin payment management routes
|--------------------------------------------------------------------------
*/

// Get all payments with search, filters and pagination
router.get(
  "/",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  getAllPaymentsForAdmin,
);

// Providers currently owing commission on cash bookings
router.get(
  "/cash-commission-due",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  getCashCommissionDueForAdmin,
);

// Get one payment with full details
router.get(
  "/:id",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  getPaymentByIdForAdmin,
);

// Update payment status
router.patch(
  "/:id/status",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  updatePaymentStatusForAdmin,
);

export default router;
