import { checkString } from "../middleware/validate.middleware.js";

// POST /api/bookings/:id/reviews  body: { rating: 1-5, comment? }
// Anything else in the body (who is reviewed, which item...) is ignored:
// the server derives it from the booking.
export function reviewValidator(input) {
  const values = {};
  const errors = {};
  const raw = typeof input.rating === "string" ? input.rating.trim() : input.rating;
  if (raw === undefined || raw === null || raw === "") errors.rating = "Choose a rating from 1 to 5 stars";
  else if (!/^[1-5]$/.test(String(raw))) errors.rating = "Rating must be a whole number from 1 to 5";
  else values.rating = Number(raw);

  checkString(input, "comment", "Review", { required: false, max: 1000 }, values, errors);
  if (!values.comment) values.comment = null;
  return { values, errors };
}

// GET /api/users/:id/reviews?as=owner|renter
export function userReviewsValidator(input) {
  const as = input.as ?? "owner";
  if (as !== "owner" && as !== "renter") return { values: {}, errors: { as: 'Must be "owner" or "renter"' } };
  return { values: { as }, errors: {} };
}
