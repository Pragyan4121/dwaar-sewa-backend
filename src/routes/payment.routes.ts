import { Router } from "express";
import {
  createPaymentForBooking,
  getAllPaymentsForAdmin,
  getMyBookingPayment,
} from "../controllers/payment.controller";
import { authenticateUser } from "../middlewares/auth.middleware";
import { allowRoles } from "../middlewares/role.middleware";

const router = Router();

// Admin-only route
router.get(
  "/admin/all",
  authenticateUser,
  allowRoles(3),
  getAllPaymentsForAdmin,
);

// Customer-only route
router.get(
  "/booking/:bookingId",
  authenticateUser,
  allowRoles(1),
  getMyBookingPayment,
);

// Admin-only route
router.post(
  "/booking/:bookingId",
  authenticateUser,
  allowRoles(3),
  createPaymentForBooking,
);

export default router;
