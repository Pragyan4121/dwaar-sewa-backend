import { Router } from "express";

import { ROLE_NAMES } from "../constants/roles";
import {
  createMyAddress,
  deleteMyAddress,
  getMyAddressById,
  getMyAddresses,
  setMyDefaultAddress,
  updateMyAddress,
} from "../controllers/customer-address.controller";
import { authenticateUser } from "../middlewares/auth.middleware";
import { allowRoles } from "../middlewares/role.middleware";

const router = Router();

/*
|--------------------------------------------------------------------------
| Customer address routes
|--------------------------------------------------------------------------
*/

// Get all saved addresses
router.get(
  "/",
  authenticateUser,
  allowRoles(ROLE_NAMES.CUSTOMER),
  getMyAddresses,
);

// Get one saved address
router.get(
  "/:id",
  authenticateUser,
  allowRoles(ROLE_NAMES.CUSTOMER),
  getMyAddressById,
);

// Create a new saved address
router.post(
  "/",
  authenticateUser,
  allowRoles(ROLE_NAMES.CUSTOMER),
  createMyAddress,
);

// Set one address as default
router.patch(
  "/:id/default",
  authenticateUser,
  allowRoles(ROLE_NAMES.CUSTOMER),
  setMyDefaultAddress,
);

// Update one saved address
router.patch(
  "/:id",
  authenticateUser,
  allowRoles(ROLE_NAMES.CUSTOMER),
  updateMyAddress,
);

// Delete or disable one saved address
router.delete(
  "/:id",
  authenticateUser,
  allowRoles(ROLE_NAMES.CUSTOMER),
  deleteMyAddress,
);

export default router;
