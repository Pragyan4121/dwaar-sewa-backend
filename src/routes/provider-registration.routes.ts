import { Router } from "express";

import { ROLE_NAMES } from "../constants/roles";
import {
  createProviderDocument,
  deleteMyProviderDocument,
  getMyProviderDocuments,
  getProviderRegistrationProgress,
} from "../controllers/provider-document.controller";
import {
  uploadDocumentFile,
  uploadProfilePhoto,
} from "../controllers/provider-upload.controller";
import { getProviderRegistrationOptions } from "../controllers/provider-registration.controller";
import { authenticateUser } from "../middlewares/auth.middleware";
import { allowRoles } from "../middlewares/role.middleware";
import {
  uploadProviderDocument,
  uploadProviderProfilePhoto,
} from "../middlewares/provider-upload.middleware";

const router = Router();

/*
|--------------------------------------------------------------------------
| Public provider registration data
|--------------------------------------------------------------------------
*/

router.get("/options", getProviderRegistrationOptions);

/*
|--------------------------------------------------------------------------
| Authenticated provider registration
|--------------------------------------------------------------------------
*/

router.post(
  "/documents",
  authenticateUser,
  allowRoles(ROLE_NAMES.PROVIDER),
  createProviderDocument,
);

router.get(
  "/documents",
  authenticateUser,
  allowRoles(ROLE_NAMES.PROVIDER),
  getMyProviderDocuments,
);

router.delete(
  "/documents/:id",
  authenticateUser,
  allowRoles(ROLE_NAMES.PROVIDER),
  deleteMyProviderDocument,
);

router.get(
  "/progress",
  authenticateUser,
  allowRoles(ROLE_NAMES.PROVIDER),
  getProviderRegistrationProgress,
);
router.get("/options", getProviderRegistrationOptions);

router.post(
  "/upload/profile-photo",
  authenticateUser,
  allowRoles(ROLE_NAMES.PROVIDER),
  uploadProviderProfilePhoto,
  uploadProfilePhoto,
);

router.post(
  "/upload/document",
  authenticateUser,
  allowRoles(ROLE_NAMES.PROVIDER),
  uploadProviderDocument,
  uploadDocumentFile,
);

router.post(
  "/documents",
  authenticateUser,
  allowRoles(ROLE_NAMES.PROVIDER),
  createProviderDocument,
);

export default router;
