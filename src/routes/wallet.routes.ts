import { Router } from "express";

import { ROLE_NAMES } from "../constants/roles";
import { getMyWallet } from "../controllers/wallet.controller";
import { authenticateUser } from "../middlewares/auth.middleware";
import { requireApprovedProvider } from "../middlewares/provider-approval.middleware";
import { allowRoles } from "../middlewares/role.middleware";
import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "../middlewares/auth.middleware";

const router = Router();

/*
|--------------------------------------------------------------------------
| Wallet routes (customer + provider)
|--------------------------------------------------------------------------
|
| Both customers and providers have a wallet. Providers must additionally
| be an approved provider; customers do not go through that check.
|--------------------------------------------------------------------------
*/

function requireApprovedProviderIfProvider(
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
) {
  if (request.user?.roleName === ROLE_NAMES.PROVIDER) {
    return requireApprovedProvider(request, response, next);
  }

  return next();
}

// Get the logged-in user's own wallet (customer or approved provider)
router.get(
  "/me",
  authenticateUser,
  allowRoles(ROLE_NAMES.CUSTOMER, ROLE_NAMES.PROVIDER),
  requireApprovedProviderIfProvider,
  getMyWallet,
);

export default router;
