// Fails fast at startup if required configuration is missing, instead of
// surfacing as a confusing 500 on the first request that needs it.
const required = [
  "DATABASE_URL",
  "JWT_SECRET",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
];

const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(", ")}`);
  console.error("Copy backend/.env.example to backend/.env and fill them in.");
  process.exit(1);
}

// Razorpay (optional: without keys the app runs but payments are disabled).
// This project uses TEST MODE only: live keys are refused unless explicitly
// allowed with ALLOW_LIVE_RAZORPAY=true.
const razorpayKeyId = process.env.RAZORPAY_KEY_ID || "";
if (razorpayKeyId) {
  if (!razorpayKeyId.startsWith("rzp_test_") && process.env.ALLOW_LIVE_RAZORPAY !== "true") {
    console.error("RAZORPAY_KEY_ID is not a test key (rzp_test_...). Refusing to start with live payment keys.");
    process.exit(1);
  }
  if (!process.env.RAZORPAY_KEY_SECRET) {
    console.error("RAZORPAY_KEY_SECRET is required when RAZORPAY_KEY_ID is set.");
    process.exit(1);
  }
  if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
    console.warn("RAZORPAY_WEBHOOK_SECRET is not set: webhooks will be rejected (verification and reconciliation still work).");
  }
} else {
  console.warn("Razorpay keys are not set: online payments are disabled.");
}
if (!process.env.CRON_SECRET) {
  console.warn("CRON_SECRET is not set: the scheduled payment sweep endpoint is disabled.");
}

// Grok (xAI) for the rental assistant (optional: without a key the chat
// falls back to a plain catalog search).
if (!process.env.GROK_API_KEY) {
  console.warn("GROK_API_KEY is not set: the rental assistant will use plain catalog search.");
}

// Comma-separated list of frontend origins allowed to call the API.
export const allowedOrigins = (process.env.CLIENT_URL || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
