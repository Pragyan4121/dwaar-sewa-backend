import { Router } from "express";
import {
  getProviderProfile,
  getActiveProviders,
} from "../controllers/provider.controller";

const router = Router();

router.get("/", getActiveProviders);
router.get("/:id", getProviderProfile);

export default router;
