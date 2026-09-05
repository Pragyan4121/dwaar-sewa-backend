import { Router } from "express";
import {
  deleteMyNotification,
  getMyNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from "../controllers/notification.controller";
import { ROLE_NAMES } from "../constants/roles";
import { authenticateUser } from "../middlewares/auth.middleware";
import { allowRoles } from "../middlewares/role.middleware";

const router = Router();

// Get own notifications
router.get(
  "/",
  authenticateUser,
  allowRoles(ROLE_NAMES.CUSTOMER, ROLE_NAMES.PROVIDER),
  getMyNotifications,
);

// Mark all own notifications as read
router.patch("/me/read-all", authenticateUser, markAllNotificationsAsRead);

// Mark one own notification as read
router.patch(
  "/:id/read",
  authenticateUser,
  allowRoles(ROLE_NAMES.CUSTOMER, ROLE_NAMES.PROVIDER),
  markNotificationAsRead,
);

// Delete one own notification
router.delete("/:id", authenticateUser, deleteMyNotification);

export default router;
