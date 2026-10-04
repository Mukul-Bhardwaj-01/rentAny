import { checkString } from "../middleware/validate.middleware.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?\d{10,15}$/;

// Emails are compared case-insensitively, so always store/look up lowercase.
function checkEmail(input, values, errors) {
  checkString(input, "email", "Email", { max: 254 }, values, errors);
  if (values.email === undefined) return;
  values.email = values.email.toLowerCase();
  if (!EMAIL_RE.test(values.email)) {
    delete values.email;
    errors.email = "Enter a valid email address";
  }
}

export function registerValidator(input) {
  const values = {};
  const errors = {};

  checkString(input, "name", "Name", { min: 2, max: 50 }, values, errors);
  checkEmail(input, values, errors);

  // Not trimmed: spaces in passwords are intentional. bcrypt ignores
  // anything past 72 bytes, so cap it there.
  const { password } = input;
  if (!password) errors.password = "Password is required";
  else if (typeof password !== "string") errors.password = "Password must be text";
  else if (password.length < 8) errors.password = "Password must be at least 8 characters";
  else if (Buffer.byteLength(password) > 72) errors.password = "Password is too long";
  else values.password = password;

  // Required for new accounts: owners and renters contact each other by phone
  // once a booking is accepted.
  checkPhone(input, values, errors);

  return { values, errors };
}

function checkPhone(input, values, errors) {
  checkString(input, "phone", "Phone", { max: 20 }, values, errors);
  if (values.phone !== undefined) {
    const phone = values.phone.replace(/[\s-]/g, "");
    if (!PHONE_RE.test(phone)) {
      delete values.phone;
      errors.phone = "Phone must be 10–15 digits, optionally starting with +";
    } else values.phone = phone;
  }
}

// PATCH /api/auth/me  body: { name?, phone? }
// Email and password changes are not supported yet.
export function updateProfileValidator(input) {
  const values = {};
  const errors = {};
  const unknown = Object.keys(input).filter((k) => !["name", "phone"].includes(k));
  if (unknown.length) errors[unknown[0]] = `${unknown[0]} cannot be changed here`;
  if (input.name !== undefined) checkString(input, "name", "Name", { min: 2, max: 50 }, values, errors);
  if (input.phone !== undefined) checkPhone(input, values, errors);
  if (Object.keys(errors).length === 0 && Object.keys(values).length === 0) errors.form = "Nothing to update";
  return { values, errors };
}

export function loginValidator(input) {
  const values = {};
  const errors = {};

  checkString(input, "email", "Email", { max: 254 }, values, errors);
  if (values.email !== undefined) values.email = values.email.toLowerCase();

  if (!input.password) errors.password = "Password is required";
  else if (typeof input.password !== "string") errors.password = "Password must be text";
  else values.password = input.password;

  return { values, errors };
}
