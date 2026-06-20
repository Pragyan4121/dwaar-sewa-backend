import { Router } from "express";
import { getActiveServices } from "../controllers/service.controller";
import { createService } from "../controllers/admin-service.controller";
import { authenticateUser } from "../middlewares/auth.middleware";
import { allowRoles } from "../middlewares/role.middleware";

const router = Router();

// Public route
router.get("/", getActiveServices);

// Admin-only route
router.post("/", authenticateUser, allowRoles(3), createService);

export default router;
