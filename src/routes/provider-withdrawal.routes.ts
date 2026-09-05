import { Router } from "express";

import { ROLE_NAMES } from "../constants/roles";

import {
  createProviderWithdrawal,
  getProviderWithdrawals,
} from "../controllers/provider-withdrawal.controller";

import { authenticateUser } from "../middlewares/auth.middleware";
import { requireApprovedProvider } from "../middlewares/provider-approval.middleware";
import { allowRoles } from "../middlewares/role.middleware";

const router = Router();

router.use(
  authenticateUser,
  allowRoles(ROLE_NAMES.PROVIDER),
  requireApprovedProvider,
);

router.get("/", getProviderWithdrawals);

router.post("/", createProviderWithdrawal);

export default router;
