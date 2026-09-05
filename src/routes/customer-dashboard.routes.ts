import { Router } from "express";

import { ROLE_NAMES } from "../constants/roles";
import { getCustomerDashboardSummary } from "../controllers/customer-dashboard.controller";
import { authenticateUser } from "../middlewares/auth.middleware";
import { allowRoles } from "../middlewares/role.middleware";

const router = Router();

/*
|--------------------------------------------------------------------------
| Customer dashboard routes
|--------------------------------------------------------------------------
*/

// Get logged-in customer's booking, notification and review summary
router.get(
  "/summary",
  authenticateUser,
  allowRoles(ROLE_NAMES.CUSTOMER),
  getCustomerDashboardSummary,
);

export default router;
