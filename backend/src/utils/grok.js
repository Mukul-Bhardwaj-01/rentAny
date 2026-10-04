// Grok (xAI) chat completions via plain fetch. The API key is only ever read
// here, on the server; nothing about it is sent to browsers.
const DEFAULT_URL = "https://api.x.ai/v1";
const DEFAULT_MODEL = "grok-3-mini";
export const GROK_TIMEOUT_MS = 20000;

export function grokConfig() {
  return {
    apiKey: process.env.GROK_API_KEY || "",
    baseUrl: (process.env.GROK_API_URL || DEFAULT_URL).replace(/\/+$/, ""),
    model: process.env.GROK_MODEL || DEFAULT_MODEL,
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
  // Returns the assistant's reply text.
  async complete(messages, { maxTokens = 700, temperature = 0.3 } = {}) {
    const { apiKey, baseUrl, model } = grokConfig();
    let res;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens }),
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
