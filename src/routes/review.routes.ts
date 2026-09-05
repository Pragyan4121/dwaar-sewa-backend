import { Router } from "express";

import { ROLE_NAMES } from "../constants/roles";
import { getProviderReviews } from "../controllers/provider-review.controller";
import {
  createReview,
  getAllReviewsForAdmin,
  updateReviewVisibility,
} from "../controllers/review.controller";
import { authenticateUser } from "../middlewares/auth.middleware";
import { allowRoles } from "../middlewares/role.middleware";

const router = Router();

/*
|--------------------------------------------------------------------------
| Public review routes
|--------------------------------------------------------------------------
*/

// Get public reviews for one provider
router.get("/provider/:providerId", getProviderReviews);

/*
|--------------------------------------------------------------------------
| Customer review routes
|--------------------------------------------------------------------------
*/

// Customer creates a review for a completed booking
router.post(
  "/booking/:bookingId",
  authenticateUser,
  allowRoles(ROLE_NAMES.CUSTOMER),
  createReview,
);

/*
|--------------------------------------------------------------------------
| Admin review routes
|--------------------------------------------------------------------------
*/

// Get all reviews
router.get(
  "/admin/all",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  getAllReviewsForAdmin,
);

// Show or hide a review
router.patch(
  "/admin/:id/visibility",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  updateReviewVisibility,
);

export default router;
