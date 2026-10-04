import { checkString } from "../middleware/validate.middleware.js";
import { checkMoney } from "./money.validators.js";

const MAX_HISTORY = 10;
const MAX_HISTORY_CHARS = 2000;

// POST /api/chat
// body: { message, history?: [{ role: "user"|"assistant", content }], filters?: { maxPricePerHour?, category? } }
export function chatValidator(input) {
  const values = {};
  const errors = {};

  checkString(input, "message", "Message", { min: 1, max: 1000 }, values, errors);

  const history = input.history ?? [];
  if (!Array.isArray(history) || history.length > MAX_HISTORY) {
    errors.history = `History must be a list of at most ${MAX_HISTORY} messages`;
  } else if (
    history.some(
      (h) => !h || !["user", "assistant"].includes(h.role) || typeof h.content !== "string" || !h.content.trim() || h.content.length > MAX_HISTORY_CHARS
    )
  ) {
    errors.history = "Each history message needs a role (user or assistant) and non-empty content";
  } else {
    values.history = history.map((h) => ({ role: h.role, content: h.content.trim() }));
  }

  const filters = input.filters ?? {};
  if (typeof filters !== "object" || Array.isArray(filters)) {
    errors.filters = "Filters must be an object";
  } else {
    const f = {};
    checkMoney(filters, "maxPricePerHour", "Budget per hour", { positive: true, max: 100000, required: false }, f, errors);
    checkString(filters, "category", "Category", { required: false, max: 50 }, f, errors);
    values.filters = { ...(f.maxPricePerHour ? { maxPricePerHour: f.maxPricePerHour } : {}), ...(f.category ? { category: f.category } : {}) };
  }

  return { values, errors };
}
