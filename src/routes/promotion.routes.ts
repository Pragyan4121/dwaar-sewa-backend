import { Router } from "express";

import {
  getPublicHomePromotion,
  validatePromotion,
} from "../controllers/promotion.controller";

import {
  createPromotion,
  getAdminPromotionById,
  getAdminPromotions,
  setPromotionStatus,
  updatePromotion,
  deletePromotion,
} from "../controllers/admin-promotion.controller";

import { authenticateUser } from "../middlewares/auth.middleware";
import { allowRoles } from "../middlewares/role.middleware";
import { ROLE_NAMES } from "../constants/roles";

const router = Router();

/**
 * Public
 */
router.get("/public/home", getPublicHomePromotion);

/**
 * Customer
 */
router.post("/validate", authenticateUser, validatePromotion);

/**
 * Admin
 */
router.get(
  "/admin",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  getAdminPromotions,
);

router.get(
  "/admin/:id",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  getAdminPromotionById,
);

router.post(
  "/admin",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  createPromotion,
);

router.put(
  "/admin/:id",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  updatePromotion,
);

router.patch(
  "/admin/:id/status",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  setPromotionStatus,
);
router.delete(
  "/admin/:id",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  deletePromotion,
);

export default router;
