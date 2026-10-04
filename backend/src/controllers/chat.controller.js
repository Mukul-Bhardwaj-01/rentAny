import { AppError } from "../utils/AppError.js";
import { answerChat } from "../utils/chatAssistant.js";

// Each chat turn calls a paid AI API, so each user gets a modest allowance.
// In memory: per server instance, reset on restart (enough for this project).
export const CHAT_LIMIT = { max: 20, windowMs: 10 * 60 * 1000 };
const recent = new Map(); // userId -> request timestamps

export function resetChatLimits() {
  recent.clear();
}

function checkAllowance(userId) {
  const now = Date.now();
  const times = (recent.get(userId) || []).filter((t) => now - t < CHAT_LIMIT.windowMs);
  if (times.length >= CHAT_LIMIT.max) {
    throw new AppError(429, "You've sent a lot of messages. Please wait a few minutes and try again.");
  }
  times.push(now);
  recent.set(userId, times);
}

// POST /api/chat  (logged in)  body: { message, history?, filters? }
// -> { reply, recommendations: [{ item, reason }], fallback }
export async function chat(req, res) {
  checkAllowance(req.userId);
  const { message, history, filters } = req.body;
  res.json(await answerChat({ message, history, filters, userId: req.userId }));
}
