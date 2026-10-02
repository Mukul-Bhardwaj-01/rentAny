import { Router } from "express";
import { createUploadSignatures } from "../controllers/media.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { signatureRequestValidator } from "../validators/media.validators.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

// Signed direct-to-Cloudinary uploads for listing media.
router.post("/signatures", requireAuth, validate(signatureRequestValidator), asyncHandler(createUploadSignatures));

export default router;
