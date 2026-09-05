import { Router } from "express";

import { ROLE_NAMES } from "../constants/roles";

import {
  assignProviderToBooking,
  cancelBookingForAdmin,
  getAllBookingsForAdmin,
  getBookingByIdForAdmin,
} from "../controllers/admin-booking.controller";

import {
  cancelMyBooking,
  completeAssignedBooking,
  createBooking,
  getAssignedBookingsForProvider,
  getMyBookingById,
  getMyBookings,
  startAssignedBooking,
} from "../controllers/booking.controller";

import {
  acceptBookingForProvider,
  getAvailableBookingsForProvider,
  getProviderBookingById,
  markAssignedBookingArrived,
  markAssignedBookingTravelling,
  rejectBookingForProvider,
} from "../controllers/provider-booking.controller";

import { authenticateUser } from "../middlewares/auth.middleware";
import { requireApprovedProvider } from "../middlewares/provider-approval.middleware";
import { allowRoles } from "../middlewares/role.middleware";

const router = Router();

/*
|--------------------------------------------------------------------------
| Customer booking routes
|--------------------------------------------------------------------------
*/

router.post(
  "/",
  authenticateUser,
  allowRoles(ROLE_NAMES.CUSTOMER),
  createBooking,
);

router.get(
  "/me",
  authenticateUser,
  allowRoles(ROLE_NAMES.CUSTOMER),
  getMyBookings,
);

router.patch(
  "/:id/cancel",
  authenticateUser,
  allowRoles(ROLE_NAMES.CUSTOMER),
  cancelMyBooking,
);

/*
|--------------------------------------------------------------------------
| Provider booking routes
|--------------------------------------------------------------------------
|
| Keep static provider routes before dynamic /provider/:id.
|--------------------------------------------------------------------------
*/

router.get(
  "/provider/available",
  authenticateUser,
  allowRoles(ROLE_NAMES.PROVIDER),
  requireApprovedProvider,
  getAvailableBookingsForProvider,
);

router.get(
  "/provider/assigned",
  authenticateUser,
  allowRoles(ROLE_NAMES.PROVIDER),
  requireApprovedProvider,
  getAssignedBookingsForProvider,
);

router.patch(
  "/provider/:id/accept",
  authenticateUser,
  allowRoles(ROLE_NAMES.PROVIDER),
  requireApprovedProvider,
  acceptBookingForProvider,
);

router.patch(
  "/provider/:id/travelling",
  authenticateUser,
  allowRoles(ROLE_NAMES.PROVIDER),
  requireApprovedProvider,
  markAssignedBookingTravelling,
);

router.patch(
  "/provider/:id/arrived",
  authenticateUser,
  allowRoles(ROLE_NAMES.PROVIDER),
  requireApprovedProvider,
  markAssignedBookingArrived,
);

router.patch(
  "/provider/:id/start",
  authenticateUser,
  allowRoles(ROLE_NAMES.PROVIDER),
  requireApprovedProvider,
  startAssignedBooking,
);

router.patch(
  "/provider/:id/complete",
  authenticateUser,
  allowRoles(ROLE_NAMES.PROVIDER),
  requireApprovedProvider,
  completeAssignedBooking,
);

router.post(
  "/provider/:id/reject",
  authenticateUser,
  allowRoles(ROLE_NAMES.PROVIDER),
  requireApprovedProvider,
  rejectBookingForProvider,
);

router.get(
  "/provider/:id",
  authenticateUser,
  allowRoles(ROLE_NAMES.PROVIDER),
  requireApprovedProvider,
  getProviderBookingById,
);

/*
|--------------------------------------------------------------------------
| Admin booking routes
|--------------------------------------------------------------------------
*/

router.get(
  "/admin/all",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  getAllBookingsForAdmin,
);

router.get(
  "/admin/:id",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  getBookingByIdForAdmin,
);

router.patch(
  "/admin/:id/assign-provider",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  assignProviderToBooking,
);

router.patch(
  "/admin/:id/cancel",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  cancelBookingForAdmin,
);

/*
|--------------------------------------------------------------------------
| Customer dynamic booking route
|--------------------------------------------------------------------------
|
| Keep this route last so "admin" and "provider" are not interpreted as IDs.
|--------------------------------------------------------------------------
*/

router.get(
  "/:id",
  authenticateUser,
  allowRoles(ROLE_NAMES.CUSTOMER),
  getMyBookingById,
);

export default router;
