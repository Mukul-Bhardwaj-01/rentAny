// Scheduled maintenance, called by Vercel Cron (see backend/vercel.json).
// Everything here also happens lazily on normal requests; the cron only
// makes sure it happens even when nobody is using the app.
import crypto from "node:crypto";
import { AppError } from "../utils/AppError.js";
import { expireStalePendingBookings } from "./booking.controller.js";
import { expireUnpaidBookings, reconcileOpenPayments, retryRefunds } from "../utils/payments.js";
import { releaseDueDeposits } from "../utils/deposits.js";

// Vercel Cron sends "Authorization: Bearer <CRON_SECRET>".
function assertCronSecret(req) {
  const secret = process.env.CRON_SECRET || "";
  const given = req.get("authorization") || "";
  const expected = `Bearer ${secret}`;
  const ok = secret && given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) throw new AppError(401, "Unauthorized");
}

export async function runPaymentSweep() {
  const started = Date.now();
  await expireStalePendingBookings();
  await expireUnpaidBookings({ limit: 100 }); // checks Razorpay first for started checkouts
  const reconciled = await reconcileOpenPayments();
  const refundsChecked = await retryRefunds();
  const depositsReleased = await releaseDueDeposits();
  return { reconciled, refundsChecked, depositsReleased, ms: Date.now() - started };
}

// GET /api/internal/payments/sweep  (cron)
export async function paymentSweep(req, res) {
  assertCronSecret(req);
  res.json({ status: "ok", ...(await runPaymentSweep()) });
}
