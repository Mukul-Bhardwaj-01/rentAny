import { checkString } from "../middleware/validate.middleware.js";
import { checkMoney } from "./money.validators.js";

const CLAIM_REASONS = ["DAMAGE", "LATE_RETURN", "MISSING_PARTS", "OTHER"];
const CLAIM_STATUSES = ["OPEN", "ACCEPTED", "DISPUTED", "APPROVED", "REJECTED", "WITHDRAWN"];

// POST /bookings/:id/payment/verify — what Razorpay Checkout's handler returns.
// Format checks only; the signature and Razorpay itself are checked by the server.
export function verifyPaymentValidator(input) {
  const values = {};
  const errors = {};
  const patterns = {
    razorpay_order_id: /^order_[A-Za-z0-9]{6,40}$/,
    razorpay_payment_id: /^pay_[A-Za-z0-9]{6,40}$/,
    razorpay_signature: /^[a-f0-9]{64}$/,
  };
  for (const [field, re] of Object.entries(patterns)) {
    if (typeof input[field] !== "string" || !re.test(input[field])) errors[field] = `${field} is missing or invalid`;
    else values[field] = input[field];
  }
  return { values, errors };
}

const positiveInt = (raw) => (/^\d+$/.test(String(raw)) && Number(raw) > 0 && Number.isSafeInteger(Number(raw)) ? Number(raw) : null);

// :id and :claimId route params
export function claimParamsValidator(input) {
  const values = {};
  const errors = {};
  for (const key of ["id", "claimId"]) {
    const n = positiveInt(input[key]);
    if (n === null) errors[key] = `${key} must be a positive whole number`;
    else values[key] = n;
  }
  return { values, errors };
}

// POST /bookings/:id/deposit/claims  body: { reason, description, amount }
export function raiseClaimValidator(input) {
  const values = {};
  const errors = {};
  if (!CLAIM_REASONS.includes(input.reason)) errors.reason = `Reason must be one of ${CLAIM_REASONS.join(", ")}`;
  else values.reason = input.reason;
  checkString(input, "description", "Description", { min: 10, max: 1000 }, values, errors);
  checkMoney(input, "amount", "Amount", { positive: true, max: 50000 }, values, errors);
  return { values, errors };
}

// POST /bookings/:id/deposit/claims/:claimId/dispute  body: { response }
export function disputeClaimValidator(input) {
  const values = {};
  const errors = {};
  checkString(input, "response", "Your response", { min: 5, max: 1000 }, values, errors);
  return { values, errors };
}

// POST /admin/deposit-claims/:id/resolve  body: { approvedAmount, note }
export function resolveClaimValidator(input) {
  const values = {};
  const errors = {};
  checkMoney(input, "approvedAmount", "Approved amount", { min: 0, max: 50000 }, values, errors);
  checkString(input, "note", "Resolution note", { min: 5, max: 1000 }, values, errors);
  return { values, errors };
}

// GET /admin/deposit-claims?status=DISPUTED
export function listClaimsValidator(input) {
  const values = {};
  const errors = {};
  if (input.status !== undefined && input.status !== "") {
    const s = String(input.status).toUpperCase();
    if (!CLAIM_STATUSES.includes(s)) errors.status = `Status must be one of ${CLAIM_STATUSES.join(", ")}`;
    else values.status = s;
  }
  return { values, errors };
}

export function idParamValidator(input) {
  const n = positiveInt(input.id);
  return n === null ? { values: {}, errors: { id: "id must be a positive whole number" } } : { values: { id: n }, errors: {} };
}
