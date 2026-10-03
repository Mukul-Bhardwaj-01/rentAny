import { checkString } from "../middleware/validate.middleware.js";
import { ISSUED_PUBLIC_ID, MEDIA_LIMITS } from "../utils/mediaRules.js";
import { checkMoney } from "./money.validators.js";

const MAX_SECURITY_DEPOSIT = 50000;

function checkSecurityDeposit(input, values, errors, { required }) {
  checkMoney(input, "securityDeposit", "Security deposit", { min: 0, max: MAX_SECURITY_DEPOSIT, required }, values, errors);
  if (!required && values.securityDeposit === undefined && !errors.securityDeposit) values.securityDeposit = "0.00";
}

// PATCH /api/items/:id/security-deposit  body: { securityDeposit }
// Only affects bookings requested after the change.
export function securityDepositValidator(input) {
  const values = {};
  const errors = {};
  checkSecurityDeposit(input, values, errors, { required: true });
  return { values, errors };
}

const MAX_PRICE = 100000;

// `media`: public ids of files uploaded directly to Cloudinary with
// signatures from POST /api/media/signatures, in display order. Only the
// format is checked here; ownership and the uploads themselves are verified
// in utils/directUploads.js.
function checkMediaIds(input, values, errors, { required }) {
  const raw = input.media;
  if (raw === undefined || raw === null) {
    if (required) errors.media = "Choose at least one photo or video";
    else values.media = [];
    return;
  }
  if (!Array.isArray(raw) || raw.some((id) => typeof id !== "string" || !ISSUED_PUBLIC_ID.test(id))) {
    errors.media = "media must be a list of uploaded file ids";
  } else if (required && raw.length === 0) {
    errors.media = "Choose at least one photo or video";
  } else if (raw.length > MEDIA_LIMITS.maxTotal) {
    errors.media = `A listing can have at most ${MEDIA_LIMITS.maxTotal} photos and videos`;
  } else if (new Set(raw).size !== raw.length) {
    errors.media = "The same file was listed twice";
  } else {
    values.media = raw;
  }
}

// POST /api/items/:id/media  body: { media: [publicId, ...] }
export function registerMediaValidator(input) {
  const values = {};
  const errors = {};
  checkMediaIds(input, values, errors, { required: true });
  return { values, errors };
}

export function createItemValidator(input) {
  const values = {};
  const errors = {};

  checkString(input, "title", "Title", { min: 3, max: 100 }, values, errors);
  checkString(input, "description", "Description", { min: 10, max: 2000 }, values, errors);
  checkString(input, "category", "Category", { min: 2, max: 50 }, values, errors);
  checkString(input, "location", "Location", { min: 2, max: 200 }, values, errors);
  checkMediaIds(input, values, errors, { required: false });
  checkSecurityDeposit(input, values, errors, { required: false });

  // Multipart form fields always arrive as strings.
  const rawPrice = typeof input.pricePerHour === "string" ? input.pricePerHour.trim() : input.pricePerHour;
  const price = Number(rawPrice);
  if (rawPrice === undefined || rawPrice === null || rawPrice === "") {
    errors.pricePerHour = "Price per hour is required";
  } else if (!Number.isFinite(price)) {
    errors.pricePerHour = "Price per hour must be a number";
  } else if (price <= 0) {
    errors.pricePerHour = "Price per hour must be greater than 0";
  } else if (price > MAX_PRICE) {
    errors.pricePerHour = `Price per hour must be at most ₹${MAX_PRICE}`;
  } else {
    // Kept as a fixed 2-decimal string so it maps exactly onto Decimal(10,2).
    values.pricePerHour = price.toFixed(2);
  }

  return { values, errors };
}

export function itemIdValidator(input) {
  const id = Number(input.id);
  if (!/^\d+$/.test(String(input.id)) || !Number.isSafeInteger(id) || id <= 0) {
    return { values: {}, errors: { id: "Item id must be a positive whole number" } };
  }
  return { values: { id }, errors: {} };
}

export function listItemsValidator(input) {
  const values = {};
  const errors = {};
  checkString(input, "search", "Search", { required: false, max: 100 }, values, errors);
  checkString(input, "category", "Category", { required: false, max: 50 }, values, errors);
  return { values, errors };
}

// Params for DELETE /items/:id/media/:mediaId
export function itemMediaParamsValidator(input) {
  const errors = {};
  const values = {};
  for (const key of ["id", "mediaId"]) {
    const n = Number(input[key]);
    if (!/^\d+$/.test(String(input[key])) || !Number.isSafeInteger(n) || n <= 0) {
      errors[key] = `${key} must be a positive whole number`;
    } else values[key] = n;
  }
  return { values, errors };
}
