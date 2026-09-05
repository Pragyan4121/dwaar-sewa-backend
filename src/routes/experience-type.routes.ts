import { Router } from "express";

import { ROLE_NAMES } from "../constants/roles";
import {
  createExperienceType,
  deleteExperienceType,
  getAllExperienceTypesForAdmin,
  getExperienceTypeByIdForAdmin,
  updateExperienceType,
} from "../controllers/experience-type.controller";
import { authenticateUser } from "../middlewares/auth.middleware";
import { allowRoles } from "../middlewares/role.middleware";

const router = Router();

/*
|--------------------------------------------------------------------------
| Admin experience type routes
|--------------------------------------------------------------------------
*/

// Get all experience types
router.get(
  "/admin/all",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  getAllExperienceTypesForAdmin,
);

// Get one experience type
router.get(
  "/admin/:id",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  getExperienceTypeByIdForAdmin,
);

// Create experience type
router.post(
  "/admin",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  createExperienceType,
);

// Update experience type
router.patch(
  "/admin/:id",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  updateExperienceType,
);

// Delete an unused experience type
router.delete(
  "/admin/:id",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  deleteExperienceType,
);

export default router;
