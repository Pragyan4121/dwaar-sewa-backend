import { Router } from "express";

import {
  getActiveProviders,
  getMyProviderProfile,
  getProviderProfile,
  updateMyProviderProfile,
} from "../controllers/provider.controller";

import { authenticateUser } from "../middlewares/auth.middleware";
import { allowRoles } from "../middlewares/role.middleware";

const router = Router();

/*
|--------------------------------------------------------------------------
| Authenticated provider routes
|--------------------------------------------------------------------------
*/

router.get(
  "/me/profile",
  authenticateUser,
  allowRoles("provider"),
  getMyProviderProfile,
);

router.patch(
  "/me/profile",
  authenticateUser,
  allowRoles("provider"),
  updateMyProviderProfile,
);

/*
|--------------------------------------------------------------------------
| Public provider routes
|--------------------------------------------------------------------------
*/

router.get("/", getActiveProviders);
router.get("/:id", getProviderProfile);

export default router;
