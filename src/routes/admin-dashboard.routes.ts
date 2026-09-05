import { Router } from "express";

import { ROLE_NAMES } from "../constants/roles";
import { getAdminDashboardSummary } from "../controllers/admin-dashboard.controller";
import { authenticateUser } from "../middlewares/auth.middleware";
import { allowRoles } from "../middlewares/role.middleware";

const router = Router();

router.get(
  "/summary",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  getAdminDashboardSummary,
);

export default router;
