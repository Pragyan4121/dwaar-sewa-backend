import { Router } from "express";
import { ROLE_NAMES } from "../constants/roles";

import {
  getCurrentSession,
  getProviderModeStatus,
  loginAdmin,
  loginCustomer,
  loginProvider,
  registerCustomer,
  registerProvider,
  resendProviderRegistrationOtp,
  verifyProviderRegistrationOtp,
  forgotProviderPassword,
  verifyProviderPasswordResetOtp,
  resetProviderPassword,
  forgotCustomerPassword,
  verifyCustomerPasswordResetOtp,
  resetCustomerPassword,
} from "../controllers/auth.controller";
import { authenticateUser } from "../middlewares/auth.middleware";
import { allowRoles } from "../middlewares/role.middleware";
const router = Router();

/*
|--------------------------------------------------------------------------
| Customer authentication
|--------------------------------------------------------------------------
*/
/*
|--------------------------------------------------------------------------
| Current authenticated session
|--------------------------------------------------------------------------
*/

router.get("/me", authenticateUser, getCurrentSession);
/*
|--------------------------------------------------------------------------
| Switch to Provider Mode
|--------------------------------------------------------------------------
*/

router.get(
  "/provider-mode/status",
  authenticateUser,
  allowRoles(ROLE_NAMES.CUSTOMER),
  getProviderModeStatus,
);
/*
|--------------------------------------------------------------------------
| Admin authentication
|--------------------------------------------------------------------------
*/

router.post("/admin/login", loginAdmin);
router.post("/customer/register", registerCustomer);

router.post("/customer/login", loginCustomer);
router.post("/customer/forgot-password", forgotCustomerPassword);

router.post(
  "/customer/verify-password-reset-otp",
  verifyCustomerPasswordResetOtp,
);

router.post("/customer/reset-password", resetCustomerPassword);

/*
|--------------------------------------------------------------------------
| Provider authentication
|--------------------------------------------------------------------------
*/

router.post("/provider/register", registerProvider);
router.post("/provider/verify-email", verifyProviderRegistrationOtp);

router.post("/provider/resend-verification-otp", resendProviderRegistrationOtp);

router.post("/provider/login", loginProvider);
router.post("/provider/forgot-password", forgotProviderPassword);
router.post(
  "/provider/verify-password-reset-otp",
  verifyProviderPasswordResetOtp,
);
router.post("/provider/reset-password", resetProviderPassword);

export default router;
