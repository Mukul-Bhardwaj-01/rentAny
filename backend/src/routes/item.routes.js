import { Router } from "express";
import { getItems, getItemById, getMyItems, createItem } from "../controllers/item.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { upload } from "../middleware/upload.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { createItemValidator, itemIdValidator, listItemsValidator } from "../validators/item.validators.js";
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
// multer has to parse the multipart body before the text fields can be
// validated, so the image is uploaded first; the error handler deletes it
// from Cloudinary if validation or the insert fails.
router.post("/", requireAuth, upload.single("image"), validate(createItemValidator), asyncHandler(createItem));

export default router;
