// Razorpay (Standard Checkout, TEST MODE) using plain fetch + Node crypto.
// Secrets never leave the server: only the key id is sent to browsers.
import crypto from "node:crypto";

const API_BASE = "https://api.razorpay.com/v1";
const TIMEOUT_MS = 15000;

export function razorpayConfig() {
  return {
    keyId: process.env.RAZORPAY_KEY_ID || "",
    keySecret: process.env.RAZORPAY_KEY_SECRET || "",
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || "",
  };
}

export const paymentsEnabled = () => {
  const { keyId, keySecret } = razorpayConfig();
  return Boolean(keyId && keySecret);
};

// An error from Razorpay. `retryable` = the outcome is unknown or temporary
// (network error, timeout, 5xx), so the same request may be tried again.
export class RazorpayError extends Error {
  constructor(message, { status = null, code = null, retryable = false, raw = null } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.raw = raw;
  }
}

async function request(method, path, body) {
  const { keyId, keySecret } = razorpayConfig();
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers: {
        Authorization: "Basic " + Buffer.from(`${keyId}:${keySecret}`).toString("base64"),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new RazorpayError(`Could not reach Razorpay: ${err.message}`, { retryable: true });
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON body
  }
  if (!res.ok) {
    throw new RazorpayError(data?.error?.description || `Razorpay error ${res.status}`, {
      status: res.status,
      code: data?.error?.code || null,
      retryable: res.status >= 500 || res.status === 429,
      raw: data?.error || null,
    });
  }
  return data;
}

// Swappable (tests replace these methods with an in-memory fake).
// All amounts are integer paise.
export const razorpayClient = {
  createOrder: ({ amountPaise, receipt, notes }) =>
    request("POST", "/orders", { amount: amountPaise, currency: "INR", receipt, notes }),
  fetchPayment: (paymentId) => request("GET", `/payments/${encodeURIComponent(paymentId)}`),
  fetchOrderPayments: async (orderId) =>
    (await request("GET", `/orders/${encodeURIComponent(orderId)}/payments`)).items || [],
  capturePayment: (paymentId, amountPaise) =>
    request("POST", `/payments/${encodeURIComponent(paymentId)}/capture`, { amount: amountPaise, currency: "INR" }),
  createRefund: (paymentId, { amountPaise, notes, receipt }) =>
    request("POST", `/payments/${encodeURIComponent(paymentId)}/refund`, { amount: amountPaise, speed: "normal", notes, receipt }),
  fetchRefunds: async (paymentId) =>
    (await request("GET", `/payments/${encodeURIComponent(paymentId)}/refunds?count=100`)).items || [],
  fetchRefund: (paymentId, refundId) =>
    request("GET", `/payments/${encodeURIComponent(paymentId)}/refunds/${encodeURIComponent(refundId)}`),
};

function hmacHex(secret, payload) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function safeEqualHex(expected, received) {
  if (typeof received !== "string" || !/^[a-f0-9]+$/i.test(received)) return false;
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(received, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Checkout handler response: HMAC_SHA256(order_id + "|" + payment_id, key_secret).
export function verifyCheckoutSignature(orderId, paymentId, signature) {
  const { keySecret } = razorpayConfig();
  return Boolean(keySecret) && safeEqualHex(hmacHex(keySecret, `${orderId}|${paymentId}`), signature);
}

// Webhooks: HMAC_SHA256(raw request body, webhook secret) in X-Razorpay-Signature.
export function verifyWebhookSignature(rawBody, signature) {
  const { webhookSecret } = razorpayConfig();
  return Boolean(webhookSecret) && safeEqualHex(hmacHex(webhookSecret, rawBody), signature);
}

// Exposed for tests that need to produce valid signatures.
export const signForTests = { checkout: (o, p) => hmacHex(razorpayConfig().keySecret, `${o}|${p}`), webhook: (b) => hmacHex(razorpayConfig().webhookSecret, b) };
