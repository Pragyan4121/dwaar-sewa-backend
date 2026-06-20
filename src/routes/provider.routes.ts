import { Router } from "express";
import { getProviderProfile } from "../controllers/provider.controller";

const router = Router();

router.get("/:id", getProviderProfile);

export default router;
