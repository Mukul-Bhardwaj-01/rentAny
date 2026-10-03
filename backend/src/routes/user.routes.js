import { Router } from "express";
import { getUserReviews } from "../controllers/review.controller.js";
import { validate } from "../middleware/validate.middleware.js";
import { idParamValidator } from "../validators/payment.validators.js";
import { userReviewsValidator } from "../validators/review.validators.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

// Public: reviews a user received as an owner or as a renter.
router.get("/:id/reviews", validate(idParamValidator, "params"), validate(userReviewsValidator, "query"), asyncHandler(getUserReviews));

export default router;
