import { Router } from "express";

import { ROLE_NAMES } from "../constants/roles";
import {
  changeMyPassword,
  createProvider,
  getMyProfile,
  getProviders,
  loginUser,
  registerUser,
  updateMyProfile,
  updateProviderStatus,
} from "../controllers/user.controller";
import { authenticateUser } from "../middlewares/auth.middleware";
import { allowRoles } from "../middlewares/role.middleware";

const router = Router();

/*
|--------------------------------------------------------------------------
| Existing customer authentication routes
|--------------------------------------------------------------------------
| These remain available so the completed customer app does not break.
|--------------------------------------------------------------------------
*/

router.post("/register", registerUser);

router.post("/login", loginUser);

/*
|--------------------------------------------------------------------------
| Logged-in user profile routes
|--------------------------------------------------------------------------
*/

router.get("/me", authenticateUser, getMyProfile);

router.patch("/me", authenticateUser, updateMyProfile);

router.patch("/me/password", authenticateUser, changeMyPassword);

/*
|--------------------------------------------------------------------------
| Admin provider-management routes
|--------------------------------------------------------------------------
*/

router.post(
  "/providers",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  createProvider,
);

router.get(
  "/providers",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  getProviders,
);

router.patch(
  "/providers/:id/status",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  updateProviderStatus,
);

export default router;
