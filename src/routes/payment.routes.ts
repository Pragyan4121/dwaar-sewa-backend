import { Router } from "express";
import { createPaymentForBooking } from "../controllers/payment.controller";
import { authenticateUser } from "../middlewares/auth.middleware";
import { allowRoles } from "../middlewares/role.middleware";

const router = Router();

router.post(
  "/booking/:bookingId",
  authenticateUser,
  allowRoles(3),
  createPaymentForBooking,
);

export default router;
