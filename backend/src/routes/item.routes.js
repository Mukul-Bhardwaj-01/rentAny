import { Router } from "express";
import {
  getItems,
  getItemById,
  getMyItems,
  createItem,
  requireItemOwner,
  addItemMedia,
  deleteItemMedia,
  updateSecurityDeposit,
} from "../controllers/item.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { legacyImageUpload } from "../middleware/upload.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import {
  createItemValidator,
  itemIdValidator,
  listItemsValidator,
  itemMediaParamsValidator,
  registerMediaValidator,
  securityDepositValidator,
} from "../validators/item.validators.js";
import { getItemAvailability } from "../controllers/booking.controller.js";
import { getItemReviews } from "../controllers/review.controller.js";
import { availabilityValidator } from "../validators/booking.validators.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.get("/", validate(listItemsValidator, "query"), asyncHandler(getItems));
router.get("/mine", requireAuth, asyncHandler(getMyItems));
router.get("/:id", validate(itemIdValidator, "params"), asyncHandler(getItemById));
// Booked time ranges for an item; the logic lives with the other booking code.
router.get(
  "/:id/availability",
  validate(itemIdValidator, "params"),
  validate(availabilityValidator, "query"),
  asyncHandler(getItemAvailability)
);

// JSON with uploaded media ids, or (legacy) multipart with one "image" file.
router.post("/", requireAuth, legacyImageUpload, validate(createItemValidator), asyncHandler(createItem));

// Owner-only media management. Files are uploaded straight to Cloudinary
// (POST /api/media/signatures with itemId); this attaches them.
router.post(
  "/:id/media",
  requireAuth,
  validate(itemIdValidator, "params"),
  asyncHandler(requireItemOwner),
  validate(registerMediaValidator),
  asyncHandler(addItemMedia)
);
router.delete(
  "/:id/media/:mediaId",
  requireAuth,
  validate(itemMediaParamsValidator, "params"),
  asyncHandler(requireItemOwner),
  asyncHandler(deleteItemMedia)
);


// Public: renters' reviews of this item, with the average rating.
router.get("/:id/reviews", validate(itemIdValidator, "params"), asyncHandler(getItemReviews));

// Owner sets the refundable deposit for future bookings (0 to 50,000).
router.patch(
  "/:id/security-deposit",
  requireAuth,
  validate(itemIdValidator, "params"),
  asyncHandler(requireItemOwner),
  validate(securityDepositValidator),
  asyncHandler(updateSecurityDeposit)
);

export default router;
