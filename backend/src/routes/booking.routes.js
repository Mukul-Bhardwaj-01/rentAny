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
import { createPaymentOrder, verifyPayment, getPaymentStatus, getCancellationPreview } from "../controllers/payment.controller.js";
import { createClaim, acceptDepositClaim, disputeDepositClaim, withdrawDepositClaim } from "../controllers/deposit.controller.js";
import {
  verifyPaymentValidator,
  claimParamsValidator,
  raiseClaimValidator,
  disputeClaimValidator,
} from "../validators/payment.validators.js";
import { createReview, getBookingReviews } from "../controllers/review.controller.js";
import { reviewValidator } from "../validators/review.validators.js";

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

// Payment (Razorpay Standard Checkout, renter) and the payment/deposit view.
router.post("/:id/payment/order", byId, asyncHandler(createPaymentOrder));
router.post("/:id/payment/verify", byId, validate(verifyPaymentValidator), asyncHandler(verifyPayment));
router.get("/:id/payment", byId, asyncHandler(getPaymentStatus));
router.get("/:id/cancellation-preview", byId, asyncHandler(getCancellationPreview));

// Security-deposit claims (owner raises/withdraws, renter accepts/disputes).
const byClaim = validate(claimParamsValidator, "params");
router.post("/:id/deposit/claims", byId, validate(raiseClaimValidator), asyncHandler(createClaim));
router.post("/:id/deposit/claims/:claimId/accept", byClaim, asyncHandler(acceptDepositClaim));
router.post("/:id/deposit/claims/:claimId/dispute", byClaim, validate(disputeClaimValidator), asyncHandler(disputeDepositClaim));
router.post("/:id/deposit/claims/:claimId/withdraw", byClaim, asyncHandler(withdrawDepositClaim));

// Reviews (renter and owner of a completed booking, one each).
router.post("/:id/reviews", byId, validate(reviewValidator), asyncHandler(createReview));
router.get("/:id/reviews", byId, asyncHandler(getBookingReviews));

export default router;
