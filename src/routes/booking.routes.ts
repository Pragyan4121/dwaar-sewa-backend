import { Router } from "express";
import {
  createBooking,
  getMyBookings,
  getMyBookingById,
  cancelMyBooking,
  getAllBookingsForAdmin,
  assignProviderToBooking,
  getAssignedBookingsForProvider,
} from "../controllers/booking.controller";
import { authenticateUser } from "../middlewares/auth.middleware";
import { allowRoles } from "../middlewares/role.middleware";

const router = Router();

router.post("/", authenticateUser, createBooking);
router.get("/me", authenticateUser, getMyBookings);

router.get(
  "/provider/assigned",
  authenticateUser,
  allowRoles(2),
  getAssignedBookingsForProvider,
);

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

router.get("/:id", authenticateUser, getMyBookingById);
router.patch("/:id/cancel", authenticateUser, cancelMyBooking);

export default router;
