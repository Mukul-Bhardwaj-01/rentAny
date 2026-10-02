import { Router } from "express";
import {
  getItems,
  getItemById,
  getMyItems,
  createItem,
  requireItemOwner,
  addItemMedia,
  deleteItemMedia,
} from "../controllers/item.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { uploadMedia } from "../middleware/upload.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import {
  createItemValidator,
  itemIdValidator,
  listItemsValidator,
  itemMediaParamsValidator,
} from "../validators/item.validators.js";
import { getItemAvailability } from "../controllers/booking.controller.js";
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

// Files land in a temporary folder first; the text fields are validated
// before anything is uploaded to Cloudinary (see upload.middleware.js).
router.post("/", requireAuth, uploadMedia, validate(createItemValidator), asyncHandler(createItem));

// Owner-only media management. Ownership is checked before the upload is read.
router.post(
  "/:id/media",
  requireAuth,
  validate(itemIdValidator, "params"),
  asyncHandler(requireItemOwner),
  uploadMedia,
  asyncHandler(addItemMedia)
);
router.delete(
  "/:id/media/:mediaId",
  requireAuth,
  validate(itemMediaParamsValidator, "params"),
  asyncHandler(requireItemOwner),
  asyncHandler(deleteItemMedia)
);

export default router;
