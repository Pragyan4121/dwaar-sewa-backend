import { Router } from "express";

import { ROLE_NAMES } from "../constants/roles";
import {
  createService,
  deleteServiceForAdmin,
  getAllServicesForAdmin,
  getServiceByIdForAdmin,
  updateService,
} from "../controllers/admin-service.controller";
import {
  getActiveServiceById,
  getActiveServices,
} from "../controllers/service.controller";
import { authenticateUser } from "../middlewares/auth.middleware";
import { allowRoles } from "../middlewares/role.middleware";

const router = Router();

/*
|--------------------------------------------------------------------------
| Public service routes
|--------------------------------------------------------------------------
*/

// Get all active services.
// Optional filter: /api/services?categoryId=2
router.get("/", getActiveServices);

/*
|--------------------------------------------------------------------------
| Admin service routes
|--------------------------------------------------------------------------
| Keep these routes above the public /:id route.
|--------------------------------------------------------------------------
*/

// Get all services, including inactive services
router.get(
  "/admin/all",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  getAllServicesForAdmin,
);

// Delete a service
router.delete(
  "/admin/:id",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  deleteServiceForAdmin,
);

// Get one service for admin
router.get(
  "/admin/:id",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  getServiceByIdForAdmin,
);

// Create a service
router.post("/", authenticateUser, allowRoles(ROLE_NAMES.ADMIN), createService);

// Update a service
router.patch(
  "/:id",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  updateService,
);

/*
|--------------------------------------------------------------------------
| Public service details route
|--------------------------------------------------------------------------
| This dynamic route must remain last so "admin" is not treated as an ID.
|--------------------------------------------------------------------------
*/

// Get one active service
router.get("/:id", getActiveServiceById);

export default router;
