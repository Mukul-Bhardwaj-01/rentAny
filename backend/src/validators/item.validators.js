import { checkString } from "../middleware/validate.middleware.js";

const MAX_PRICE = 100000;

export function createItemValidator(input) {
  const values = {};
  const errors = {};

  checkString(input, "title", "Title", { min: 3, max: 100 }, values, errors);
  checkString(input, "description", "Description", { min: 10, max: 2000 }, values, errors);
  checkString(input, "category", "Category", { min: 2, max: 50 }, values, errors);
  checkString(input, "location", "Location", { min: 2, max: 200 }, values, errors);

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
