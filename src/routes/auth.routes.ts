import { Router } from "express";
import { ROLE_NAMES } from "../constants/roles";

import {
  getCurrentSession,
  getProviderModeStatus,
  loginAdmin,
  logoutAdmin,
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
import {
  loginRateLimiter,
  otpRateLimiter,
} from "../middlewares/rate-limit.middleware";
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

router.post("/admin/login", loginRateLimiter, loginAdmin);
router.post("/admin/logout", logoutAdmin);
router.post("/customer/register", registerCustomer);

router.post("/customer/login", loginRateLimiter, loginCustomer);
router.post(
  "/customer/forgot-password",
  otpRateLimiter,
  forgotCustomerPassword,
);

router.post(
  "/customer/verify-password-reset-otp",
  otpRateLimiter,
  verifyCustomerPasswordResetOtp,
);

router.post("/customer/reset-password", resetCustomerPassword);

/*
|--------------------------------------------------------------------------
| Provider authentication
|--------------------------------------------------------------------------
*/

router.post("/provider/register", registerProvider);
router.post(
  "/provider/verify-email",
  otpRateLimiter,
  verifyProviderRegistrationOtp,
);

router.post(
  "/provider/resend-verification-otp",
  otpRateLimiter,
  resendProviderRegistrationOtp,
);

router.post("/provider/login", loginRateLimiter, loginProvider);
router.post(
  "/provider/forgot-password",
  otpRateLimiter,
  forgotProviderPassword,
);
router.post(
  "/provider/verify-password-reset-otp",
  otpRateLimiter,
  verifyProviderPasswordResetOtp,
);
router.post("/provider/reset-password", resetProviderPassword);

export default router;
