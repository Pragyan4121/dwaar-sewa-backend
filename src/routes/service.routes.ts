import { Router } from "express";
import { getActiveServices } from "../controllers/service.controller";

const router = Router();

router.get("/", getActiveServices);

export default router;
