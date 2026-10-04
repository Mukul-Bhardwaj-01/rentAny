// Grok (xAI) chat completions via plain fetch. The API key is only ever read
// here, on the server; nothing about it is sent to browsers.
const DEFAULT_URL = "https://api.x.ai/v1";
const DEFAULT_MODEL = "grok-3-mini";
export const GROK_TIMEOUT_MS = 20000;

// Reasoning models think before answering, and that thinking counts against
// max_tokens. A short answer like ours needs little of it, so ask for less
// (otherwise the budget can run out before any answer is written).
// GROK_REASONING_EFFORT overrides it ("none" sends nothing).
function defaultReasoningEffort(model) {
  if (/^openai\/gpt-oss/.test(model)) return "low"; // Groq: gpt-oss-20b / 120b
  if (/^grok-3-mini/.test(model)) return "low"; // xAI
  return null;
}

export function grokConfig() {
  const model = process.env.GROK_MODEL || DEFAULT_MODEL;
  const effort = process.env.GROK_REASONING_EFFORT;
  return {
    apiKey: process.env.GROK_API_KEY || "",
    baseUrl: (process.env.GROK_API_URL || DEFAULT_URL).replace(/\/+$/, ""),
    model,
    reasoningEffort: effort === "none" ? null : effort || defaultReasoningEffort(model),
  };
}

export const grokEnabled = () => Boolean(grokConfig().apiKey);

// Why a Grok call failed: "timeout", "rate_limited", "unavailable" (network,
// 5xx), "rejected" (4xx such as a bad key or model) or "bad_response".
export class GrokError extends Error {
  constructor(message, kind, status = null) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

// Swappable (tests replace `complete` with a fake).
export const grokClient = {
  // messages: [{ role: "system" | "user" | "assistant", content }]
  // json: ask the API to return a single JSON object (JSON mode).
  // Returns the assistant's reply text.
  async complete(messages, { maxTokens = 1500, temperature = 0.3, json = false } = {}) {
    const { apiKey, baseUrl, model, reasoningEffort } = grokConfig();
    const body = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      ...(json ? { response_format: { type: "json_object" } } : {}),
    };
    let res;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(GROK_TIMEOUT_MS),
      });
    } catch (err) {
      if (err?.name === "TimeoutError" || err?.name === "AbortError") throw new GrokError("Grok timed out", "timeout");
      throw new GrokError(`Could not reach Grok: ${err.message}`, "unavailable");
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const kind = res.status === 429 ? "rate_limited" : res.status >= 500 ? "unavailable" : "rejected";
      throw new GrokError(data?.error?.message || data?.error || `Grok error ${res.status}`, kind, res.status);
    }
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new GrokError("Grok returned no content", "bad_response");
    return content;
  },
};
