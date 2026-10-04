// Test-only configuration, loaded after .env and before the app's env checks.
// Razorpay calls are served by tests/fakeRazorpay.js, so these keys never
// reach Razorpay; they only make payments "enabled" and sign test payloads.
import "dotenv/config";

process.env.RAZORPAY_KEY_ID ||= "rzp_test_FakeKeyForTests";
process.env.RAZORPAY_KEY_SECRET ||= "fake_key_secret_for_tests_only";
process.env.RAZORPAY_WEBHOOK_SECRET ||= "fake_webhook_secret_for_tests_only";
process.env.CRON_SECRET ||= "fake_cron_secret_for_tests_only";
process.env.GROK_API_KEY ||= "fake_grok_key_for_tests_only";
