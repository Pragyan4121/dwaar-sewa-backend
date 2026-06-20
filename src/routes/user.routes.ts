import { Router } from "express";
import {
  registerUser,
  loginUser,
  getMyProfile,
  createProvider,
  getProviders,
} from "../controllers/user.controller";
import { authenticateUser } from "../middlewares/auth.middleware";
import { allowRoles } from "../middlewares/role.middleware";

const router = Router();

router.post("/register", registerUser);
router.post("/login", loginUser);

router.get("/me", authenticateUser, getMyProfile);

router.post("/providers", authenticateUser, allowRoles(3), createProvider);

router.get("/providers", authenticateUser, allowRoles(3), getProviders);

export default router;
