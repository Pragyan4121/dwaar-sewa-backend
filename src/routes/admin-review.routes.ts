import { Router } from "express";

import { ROLE_NAMES } from "../constants/roles";
import {
  getAllReviewsForAdmin,
  getReviewByIdForAdmin,
  updateReviewVisibilityForAdmin,
} from "../controllers/admin-review.controller";
import { authenticateUser } from "../middlewares/auth.middleware";
import { allowRoles } from "../middlewares/role.middleware";

const router = Router();

/*
|--------------------------------------------------------------------------
| Admin review management routes
|--------------------------------------------------------------------------
*/

// Get all reviews with search, filters and pagination
router.get(
  "/",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  getAllReviewsForAdmin,
);

// Get one review with complete details
router.get(
  "/:id",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  getReviewByIdForAdmin,
);

// Show or hide review
router.patch(
  "/:id/visibility",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  updateReviewVisibilityForAdmin,
);

export default router;
