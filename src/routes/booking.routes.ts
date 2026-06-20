import { Router } from "express";
import { createBooking } from "../controllers/booking.controller";
import { authenticateUser } from "../middlewares/auth.middleware";

const router = Router();

router.post("/", authenticateUser, createBooking);

export default router;
