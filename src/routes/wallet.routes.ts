import { Router } from "express";
import { getMyWallet } from "../controllers/wallet.controller";
import { authenticateUser } from "../middlewares/auth.middleware";

const router = Router();

router.get("/me", authenticateUser, getMyWallet);

export default router;
