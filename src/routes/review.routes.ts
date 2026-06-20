import { Router } from "express";
import {
  createReview,
  updateReviewVisibility,
} from "../controllers/review.controller";
import { getProviderReviews } from "../controllers/provider-review.controller";
import { authenticateUser } from "../middlewares/auth.middleware";
import { allowRoles } from "../middlewares/role.middleware";

const router = Router();

// Public route
router.get("/provider/:providerId", getProviderReviews);

// Customer-only route
router.post(
  "/booking/:bookingId",
  authenticateUser,
  allowRoles(1),
  createReview,
);

// Admin-only route
router.patch(
  "/admin/:id/visibility",
  authenticateUser,
  allowRoles(3),
  updateReviewVisibility,
);

export default router;
