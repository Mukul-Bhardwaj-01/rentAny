// Parses a rupee amount from a request (number or string) without ever
// rounding: more than 2 decimals is an error, not a silent change.
// On success sets values[field] to a fixed "1234.50" string (maps exactly
// onto Decimal(10,2)).
export function checkMoney(input, field, label, { min = 0, max, required = true, positive = false } = {}, values, errors) {
  const raw = input[field];
  if (raw === undefined || raw === null || raw === "") {
    if (required) errors[field] = `${label} is required`;
    return;
  }
  const str = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : null;
  if (str === null || !/^\d+(\.\d{1,2})?$/.test(str)) {
    errors[field] = `${label} must be an amount in rupees with at most 2 decimals`;
    return;
  }
  const value = Number(str);
  if (positive && value <= 0) errors[field] = `${label} must be greater than 0`;
  else if (value < min) errors[field] = `${label} must be at least ₹${min}`;
  else if (max !== undefined && value > max) errors[field] = `${label} must be at most ₹${max.toLocaleString("en-IN")}`;
  else values[field] = value.toFixed(2);
}
