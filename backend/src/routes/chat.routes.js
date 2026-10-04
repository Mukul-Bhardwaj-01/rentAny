import { Router } from "express";
import { chat } from "../controllers/chat.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { chatValidator } from "../validators/chat.validators.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

// Rental assistant (Grok, grounded in the live catalog). Login required, so
// the paid AI API can't be used anonymously.
router.post("/", requireAuth, validate(chatValidator), asyncHandler(chat));

export default router;
