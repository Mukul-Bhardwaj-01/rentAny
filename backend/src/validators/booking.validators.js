import { checkString } from "../middleware/validate.middleware.js";

export const MIN_HOURS = 1;
export const MAX_HOURS = 72;
const MIN_LEAD_MINUTES = 30;
const MAX_ADVANCE_DAYS = 30;
const MAX_AVAILABILITY_WINDOW_DAYS = 31;

export const BOOKING_STATUSES = ["PENDING", "ACCEPTED", "REJECTED", "CANCELLED", "EXPIRED", "ACTIVE", "COMPLETED"];

// Times must carry an explicit timezone (Z or ±hh:mm); a bare "2026-10-03T10:00"
// would be interpreted in the server's timezone, which may differ from the user's.
const ISO_WITH_TZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

function parseIsoDate(raw) {
  if (typeof raw !== "string" || !ISO_WITH_TZ.test(raw.trim())) return null;
  const date = new Date(raw.trim());
  return Number.isNaN(date.getTime()) ? null : date;
}

function parsePositiveInt(raw) {
  const str = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  if (!/^\d+$/.test(str)) return null;
  const n = Number(str);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function createBookingValidator(input) {
  const values = {};
  const errors = {};

  const itemId = parsePositiveInt(input.itemId);
  if (input.itemId === undefined || input.itemId === "") errors.itemId = "Item is required";
  else if (itemId === null) errors.itemId = "Item id must be a positive whole number";
  else values.itemId = itemId;

  const startTime = parseIsoDate(input.startTime);
  if (!input.startTime) {
    errors.startTime = "Start time is required";
  } else if (!startTime) {
    errors.startTime = "Start time must be an ISO date-time with timezone, e.g. 2026-10-03T10:00:00.000Z";
  } else if (startTime.getUTCSeconds() !== 0 || startTime.getUTCMilliseconds() !== 0) {
    errors.startTime = "Start time must be on a whole minute";
  } else {
    const now = Date.now();
    if (startTime.getTime() < now + MIN_LEAD_MINUTES * 60 * 1000) {
      errors.startTime = `Start time must be at least ${MIN_LEAD_MINUTES} minutes from now`;
    } else if (startTime.getTime() > now + MAX_ADVANCE_DAYS * 24 * 60 * 60 * 1000) {
      errors.startTime = `Start time must be within the next ${MAX_ADVANCE_DAYS} days`;
    } else {
      values.startTime = startTime;
    }
  }

  const hours = parsePositiveInt(input.hours);
  if (input.hours === undefined || input.hours === "") errors.hours = "Number of hours is required";
  else if (hours === null || hours < MIN_HOURS || hours > MAX_HOURS) {
    errors.hours = `Hours must be a whole number from ${MIN_HOURS} to ${MAX_HOURS}`;
  } else values.hours = hours;

  checkString(input, "note", "Note", { required: false, max: 500 }, values, errors);
  if (!values.note) delete values.note;

  return { values, errors };
}

export function bookingIdValidator(input) {
  const id = parsePositiveInt(input.id);
  if (id === null) return { values: {}, errors: { id: "Booking id must be a positive whole number" } };
  return { values: { id }, errors: {} };
}

export function listBookingsValidator(input) {
  const values = {};
  const errors = {};

  const as = input.as ?? "renter";
  if (as !== "renter" && as !== "owner") errors.as = 'Must be "renter" or "owner"';
  else values.as = as;

  if (input.status !== undefined && input.status !== "") {
    const status = typeof input.status === "string" ? input.status.trim().toUpperCase() : null;
    if (!BOOKING_STATUSES.includes(status)) errors.status = `Status must be one of ${BOOKING_STATUSES.join(", ")}`;
    else values.status = status;
  }

  return { values, errors };
}

// Optional free-text reason (reject); `required` makes it mandatory (owner cancel
// is checked in the controller because it depends on who is cancelling).
export function reasonValidator(input) {
  const values = {};
  const errors = {};
  checkString(input, "reason", "Reason", { required: false, max: 500 }, values, errors);
  if (!values.reason) delete values.reason;
  return { values, errors };
}

export function availabilityValidator(input) {
  const values = {};
  const errors = {};
  const now = new Date();

  const from = input.from ? parseIsoDate(input.from) : now;
  if (!from) errors.from = "from must be an ISO date-time with timezone";

  const to = input.to
    ? parseIsoDate(input.to)
    : new Date((from || now).getTime() + MAX_ADVANCE_DAYS * 24 * 60 * 60 * 1000);
  if (!to) errors.to = "to must be an ISO date-time with timezone";

  if (from && to) {
    if (to <= from) errors.to = "to must be after from";
    else if (to - from > MAX_AVAILABILITY_WINDOW_DAYS * 24 * 60 * 60 * 1000) {
      errors.to = `The window can be at most ${MAX_AVAILABILITY_WINDOW_DAYS} days`;
    } else {
      values.from = from;
      values.to = to;
    }
  }

  return { values, errors };
}
