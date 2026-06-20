import { Router } from "express";
import {
  createBooking,
  getMyBookings,
  getMyBookingById,
  cancelMyBooking,
  getAllBookingsForAdmin,
  assignProviderToBooking,
  getAssignedBookingsForProvider,
  startAssignedBooking,
  completeAssignedBooking,
} from "../controllers/booking.controller";
import { authenticateUser } from "../middlewares/auth.middleware";
import { allowRoles } from "../middlewares/role.middleware";

const router = Router();

// Customer routes
router.post("/", authenticateUser, allowRoles(1), createBooking);

router.get("/me", authenticateUser, allowRoles(1), getMyBookings);

router.patch("/:id/cancel", authenticateUser, allowRoles(1), cancelMyBooking);

// Provider routes
router.get(
  "/provider/assigned",
  authenticateUser,
  allowRoles(2),
  getAssignedBookingsForProvider,
);

router.patch(
  "/provider/:id/start",
  authenticateUser,
  allowRoles(2),
  startAssignedBooking,
);

router.patch(
  "/provider/:id/complete",
  authenticateUser,
  allowRoles(2),
  completeAssignedBooking,
);

// Admin routes
router.get(
  "/admin/all",
  authenticateUser,
  allowRoles(3),
  getAllBookingsForAdmin,
);

router.patch(
  "/admin/:id/assign-provider",
  authenticateUser,
  allowRoles(3),
  assignProviderToBooking,
);

// Keep dynamic route at the bottom
router.get("/:id", authenticateUser, allowRoles(1), getMyBookingById);

export default router;
