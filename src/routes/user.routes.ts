import { Router } from "express";
import {
  registerUser,
  loginUser,
  getMyProfile,
} from "../controllers/user.controller";
import { authenticateUser } from "../middlewares/auth.middleware";

const router = Router();

router.post("/register", registerUser);
router.post("/login", loginUser);
router.get("/me", authenticateUser, getMyProfile);

export default router;
