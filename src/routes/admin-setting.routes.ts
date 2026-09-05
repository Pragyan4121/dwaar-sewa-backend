import { Router } from "express";

import { ROLE_NAMES } from "../constants/roles";
import {
  getAllSettingsForAdmin,
  getPublicSettings,
  updateMultipleSettingsForAdmin,
  updateSettingForAdmin,
} from "../controllers/admin-setting.controller";
import { authenticateUser } from "../middlewares/auth.middleware";
import { allowRoles } from "../middlewares/role.middleware";

const router = Router();

/*
|--------------------------------------------------------------------------
| Public settings route
|--------------------------------------------------------------------------
*/

// Public settings needed by customer and provider apps
router.get("/public", getPublicSettings);

/*
|--------------------------------------------------------------------------
| Admin settings routes
|--------------------------------------------------------------------------
*/

// Get all system settings
router.get(
  "/admin",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  getAllSettingsForAdmin,
);

// Update multiple settings
router.patch(
  "/admin",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  updateMultipleSettingsForAdmin,
);

// Update one setting
router.patch(
  "/admin/:key",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  updateSettingForAdmin,
);

export default router;
