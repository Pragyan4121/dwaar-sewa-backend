import { Router } from "express";

import { ROLE_NAMES } from "../constants/roles";
import {
  getAllProvidersForAdmin,
  getProviderByIdForAdmin,
  reactivateProviderForAdmin,
  rejectProviderForAdmin,
  suspendProviderForAdmin,
  verifyProviderForAdmin,
} from "../controllers/admin-provider.controller";
import {
  getProviderDocumentsForAdmin,
  reviewProviderDocumentForAdmin,
} from "../controllers/admin-provider-document.controller";
import { authenticateUser } from "../middlewares/auth.middleware";
import { allowRoles } from "../middlewares/role.middleware";

const router = Router();

/*
|--------------------------------------------------------------------------
| Admin provider management routes
|--------------------------------------------------------------------------
*/

// Get all providers with search, filters and pagination
router.get(
  "/",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  getAllProvidersForAdmin,
);

// Get one provider with full details
router.get(
  "/:id",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  getProviderByIdForAdmin,
);
router.get(
  "/:providerId/documents",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  getProviderDocumentsForAdmin,
);

router.patch(
  "/:providerId/documents/:documentId/review",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  reviewProviderDocumentForAdmin,
);
// Approve provider
router.patch(
  "/:id/verify",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  verifyProviderForAdmin,
);

// Reject provider
router.patch(
  "/:id/reject",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  rejectProviderForAdmin,
);

// Suspend provider
router.patch(
  "/:id/suspend",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  suspendProviderForAdmin,
);

// Reactivate provider
router.patch(
  "/:id/reactivate",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  reactivateProviderForAdmin,
);

export default router;
