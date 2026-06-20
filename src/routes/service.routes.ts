import { Router } from "express";
import { getActiveServices } from "../controllers/service.controller";
import {
  createService,
  updateService,
} from "../controllers/admin-service.controller";
import { authenticateUser } from "../middlewares/auth.middleware";
import { allowRoles } from "../middlewares/role.middleware";

const router = Router();

// Public route
router.get("/", getActiveServices);

// Admin-only routes
router.post("/", authenticateUser, allowRoles(3), createService);

router.patch("/:id", authenticateUser, allowRoles(3), updateService);

export default router;
