// Runs a validator function on the request. A validator returns
// { values, errors }: on success the cleaned values replace req[source],
// otherwise a 400 with per-field errors is sent.
import { AppError } from "../utils/AppError.js";

export const validate = (validator, source = "body") => (req, res, next) => {
  const { values, errors } = validator(req[source] || {});
  if (Object.keys(errors).length > 0) {
    return next(new AppError(400, "Please fix the highlighted fields", errors));
  }
  req[source] = values;
  next();
};

// Shared helper: trims a string field and checks its length.
export function checkString(input, field, label, { min = 0, max, required = true }, values, errors) {
  const raw = input[field];
  if (raw === undefined || raw === null || raw === "") {
    if (required) errors[field] = `${label} is required`;
    return;
  }
  if (typeof raw !== "string") {
    errors[field] = `${label} must be text`;
    return;
  }
  const value = raw.trim();
  if (required && value.length === 0) errors[field] = `${label} is required`;
  else if (value.length < min) errors[field] = `${label} must be at least ${min} characters`;
  else if (max && value.length > max) errors[field] = `${label} must be at most ${max} characters`;
  else values[field] = value;
}
