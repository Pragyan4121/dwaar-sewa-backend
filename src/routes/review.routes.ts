import { Router } from "express";
import { createReview } from "../controllers/review.controller";
import { authenticateUser } from "../middlewares/auth.middleware";
import { allowRoles } from "../middlewares/role.middleware";

const router = Router();

router.post(
  "/booking/:bookingId",
  authenticateUser,
  allowRoles(1),
  createReview,
);

export default router;
