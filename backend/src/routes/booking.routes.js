import { Router } from "express";
import {
  createBooking,
  getMyBookings,
  getBookingById,
  acceptBooking,
  rejectBooking,
  cancelBooking,
  startBooking,
  completeBooking,
} from "../controllers/booking.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import {
  createBookingValidator,
  bookingIdValidator,
  listBookingsValidator,
  reasonValidator,
} from "../validators/booking.validators.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();
const byId = validate(bookingIdValidator, "params");

// Every booking route needs a logged-in user.
router.use(requireAuth);

router.post("/", validate(createBookingValidator), asyncHandler(createBooking));
router.get("/", validate(listBookingsValidator, "query"), asyncHandler(getMyBookings));
router.get("/:id", byId, asyncHandler(getBookingById));
router.patch("/:id/accept", byId, asyncHandler(acceptBooking));
router.patch("/:id/reject", byId, validate(reasonValidator), asyncHandler(rejectBooking));
router.patch("/:id/cancel", byId, validate(reasonValidator), asyncHandler(cancelBooking));
router.patch("/:id/start", byId, asyncHandler(startBooking));
router.patch("/:id/complete", byId, asyncHandler(completeBooking));

export default router;
