import { Router } from "express";
import {
  createBooking,
  getMyBookings,
  getMyBookingById,
  cancelMyBooking,
} from "../controllers/booking.controller";
import { authenticateUser } from "../middlewares/auth.middleware";

const router = Router();

router.post("/", authenticateUser, createBooking);
router.get("/me", authenticateUser, getMyBookings);
router.get("/:id", authenticateUser, getMyBookingById);
router.patch("/:id/cancel", authenticateUser, cancelMyBooking);

export default router;
