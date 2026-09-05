import { Router } from "express";

import {
  deactivateCustomerForAdmin,
  getAllCustomersForAdmin,
  getCustomerByIdForAdmin,
  reactivateCustomerForAdmin,
} from "../controllers/admin-customer.controller";
import { ROLE_NAMES } from "../constants/roles";
import { authenticateUser } from "../middlewares/auth.middleware";
import { allowRoles } from "../middlewares/role.middleware";

const router = Router();

/*
|--------------------------------------------------------------------------
| Admin customer management routes
|--------------------------------------------------------------------------
*/

// Get all customers with search, status filter and pagination
router.get(
  "/",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  getAllCustomersForAdmin,
);

// Get one customer with full details
router.get(
  "/:id",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  getCustomerByIdForAdmin,
);

// Deactivate customer account
router.patch(
  "/:id/deactivate",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  deactivateCustomerForAdmin,
);

// Reactivate customer account
router.patch(
  "/:id/reactivate",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  reactivateCustomerForAdmin,
);

export default router;
