import { Router } from "express";

import { ROLE_NAMES } from "../constants/roles";

import {
  getProviderEarningsHistory,
  getProviderEarningsStatement,
  getProviderEarningsSummary,
  getProviderWalletTransactions,
} from "../controllers/provider-earnings.controller";

import { authenticateUser } from "../middlewares/auth.middleware";
import { requireApprovedProvider } from "../middlewares/provider-approval.middleware";
import { allowRoles } from "../middlewares/role.middleware";

const router = Router();

router.use(
  authenticateUser,
  allowRoles(ROLE_NAMES.PROVIDER),
  requireApprovedProvider,
);

router.get("/summary", getProviderEarningsSummary);

router.get("/history", getProviderEarningsHistory);

router.get("/statement", getProviderEarningsStatement);

router.get("/transactions", getProviderWalletTransactions);

export default router;
