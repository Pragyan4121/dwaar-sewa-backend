import { Router } from "express";

import { ROLE_NAMES } from "../constants/roles";

import {
  approveWithdrawalForAdmin,
  getAllWithdrawalsForAdmin,
  getWithdrawalByIdForAdmin,
  markWithdrawalPaidForAdmin,
  rejectWithdrawalForAdmin,
} from "../controllers/admin-withdrawal.controller";

import { authenticateUser } from "../middlewares/auth.middleware";
import { allowRoles } from "../middlewares/role.middleware";

const router = Router();

router.use(authenticateUser, allowRoles(ROLE_NAMES.ADMIN));

router.get("/", getAllWithdrawalsForAdmin);

router.get("/:id", getWithdrawalByIdForAdmin);

router.patch("/:id/approve", approveWithdrawalForAdmin);

router.patch("/:id/paid", markWithdrawalPaidForAdmin);

router.patch("/:id/reject", rejectWithdrawalForAdmin);

export default router;
