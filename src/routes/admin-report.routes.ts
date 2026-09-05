import { Router } from "express";

import { ROLE_NAMES } from "../constants/roles";
import {
  getAdminReportsOverview,
  getDailyTrendsReport,
  getTopProvidersReport,
  getTopServicesReport,
} from "../controllers/admin-report.controller";
import { authenticateUser } from "../middlewares/auth.middleware";
import { allowRoles } from "../middlewares/role.middleware";

const router = Router();

/*
|--------------------------------------------------------------------------
| Admin report routes
|--------------------------------------------------------------------------
*/

// Main reports overview
router.get(
  "/overview",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  getAdminReportsOverview,
);

// Top services report
router.get(
  "/top-services",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  getTopServicesReport,
);

// Top providers report
router.get(
  "/top-providers",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  getTopProvidersReport,
);

// Daily bookings and revenue trends
router.get(
  "/daily-trends",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  getDailyTrendsReport,
);

export default router;
