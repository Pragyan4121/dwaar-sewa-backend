import { Router } from "express";
import {
  registerUser,
  loginUser,
  getMyProfile,
  updateMyProfile,
  changeMyPassword,
  createProvider,
  getProviders,
  updateProviderStatus,
} from "../controllers/user.controller";
import { authenticateUser } from "../middlewares/auth.middleware";
import { allowRoles } from "../middlewares/role.middleware";

const router = Router();

// Public routes
router.post("/register", registerUser);
router.post("/login", loginUser);

// Logged-in user routes
router.get("/me", authenticateUser, getMyProfile);
router.patch("/me", authenticateUser, updateMyProfile);
router.patch("/me/password", authenticateUser, changeMyPassword);

// Admin-only provider routes
router.post("/providers", authenticateUser, allowRoles(3), createProvider);

router.get("/providers", authenticateUser, allowRoles(3), getProviders);

router.patch(
  "/providers/:id/status",
  authenticateUser,
  allowRoles(3),
  updateProviderStatus,
);

export default router;
