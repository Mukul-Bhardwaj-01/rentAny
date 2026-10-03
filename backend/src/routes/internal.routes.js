import { Router } from "express";
import { paymentSweep } from "../controllers/internal.controller.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// Called by Vercel Cron (GET, with Authorization: Bearer <CRON_SECRET>).
const router = Router();
router.get("/payments/sweep", asyncHandler(paymentSweep));
router.post("/payments/sweep", asyncHandler(paymentSweep));

export default router;
