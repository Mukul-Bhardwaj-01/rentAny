const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export function listNotificationsValidator(input) {
  if (input.limit === undefined || input.limit === "") return { values: { limit: DEFAULT_LIMIT }, errors: {} };
  const limit = Number(input.limit);
  if (!/^\d+$/.test(String(input.limit)) || limit < 1 || limit > MAX_LIMIT) {
    return { values: {}, errors: { limit: `Limit must be a whole number from 1 to ${MAX_LIMIT}` } };
  }
  return { values: { limit }, errors: {} };
}

export function notificationIdValidator(input) {
  const id = Number(input.id);
  if (!/^\d+$/.test(String(input.id)) || !Number.isSafeInteger(id) || id <= 0) {
    return { values: {}, errors: { id: "Notification id must be a positive whole number" } };
  }
  return { values: { id }, errors: {} };
}
