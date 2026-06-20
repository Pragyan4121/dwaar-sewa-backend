import { Router } from "express";
import {
  createBooking,
  getMyBookings,
} from "../controllers/booking.controller";
import { authenticateUser } from "../middlewares/auth.middleware";

const router = Router();

router.post("/", authenticateUser, createBooking);
router.get("/me", authenticateUser, getMyBookings);

export default router;
