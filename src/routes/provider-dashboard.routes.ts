import { Router } from "express";

import {
  getProviderDashboard,
  updateProviderAvailability,
} from "../controllers/provider-dashboard.controller";

import { authenticateUser } from "../middlewares/auth.middleware";
import { allowRoles } from "../middlewares/role.middleware";

const router = Router();

router.use(authenticateUser, allowRoles("provider"));

router.get("/", getProviderDashboard);

router.patch("/availability", updateProviderAvailability);

export default router;
