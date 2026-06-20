import { Router } from "express";
import {
  createPaymentForBooking,
  getAllPaymentsForAdmin,
} from "../controllers/payment.controller";
import { authenticateUser } from "../middlewares/auth.middleware";
import { allowRoles } from "../middlewares/role.middleware";

const router = Router();

router.get(
  "/admin/all",
  authenticateUser,
  allowRoles(3),
  getAllPaymentsForAdmin,
);

router.post(
  "/booking/:bookingId",
  authenticateUser,
  allowRoles(3),
  createPaymentForBooking,
);

export default router;
