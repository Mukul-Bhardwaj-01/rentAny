import { Router } from "express";
import { register, login, getProfile } from "../controllers/auth.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { registerValidator, loginValidator } from "../validators/auth.validators.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.post("/register", validate(registerValidator), asyncHandler(register));
router.post("/login", validate(loginValidator), asyncHandler(login));
router.get("/me", requireAuth, asyncHandler(getProfile));

export default router;
