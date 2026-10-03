import crypto from "node:crypto";
import prisma from "../config/prisma.js";
import { AppError } from "../utils/AppError.js";
import { fmt, toPaise, dec, sum } from "../utils/money.js";
import { razorpayClient, RazorpayError, verifyCheckoutSignature, verifyWebhookSignature, paymentsEnabled } from "../utils/razorpay.js";
import {
  getOrCreateOrder,
  recordCapturedPayment,
  recordPaymentFailure,
  reconcilePayment,
  expireUnpaidBookings,
  refreshRefund,
  applyRefundUpdate,
  isDuplicateEvent,
  logEvent,
  amountsOf,
} from "../utils/payments.js";
import { releaseDepositIfDue, suggestedLateFee } from "../utils/deposits.js";
import { computeCancellationRefund, policySummary } from "../utils/cancellationPolicy.js";

// The booking, if the caller is its renter or owner (otherwise "not found").
async function loadBookingForParty(bookingId, userId) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: { payment: true } });
  if (!booking || (booking.renterId !== userId && booking.ownerId !== userId)) throw new AppError(404, "Booking not found");
  return booking;
}

// POST /api/bookings/:id/payment/order  (renter)
export async function createPaymentOrder(req, res) {
  res.json(await getOrCreateOrder(req.params.id, req.userId));
}

// POST /api/bookings/:id/payment/verify  (renter)
// body: { razorpay_order_id, razorpay_payment_id, razorpay_signature } from Checkout.
// The browser's word is never enough: the signature must match AND the payment
// is fetched from Razorpay, whose data alone decides the outcome.
export async function verifyPayment(req, res) {
  if (!paymentsEnabled()) throw new AppError(503, "Online payments are not configured yet");
  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body;

  const booking = await loadBookingForParty(req.params.id, req.userId);
  if (booking.renterId !== req.userId) throw new AppError(403, "Only the renter can pay for this booking");
  if (!booking.payment || booking.payment.razorpayOrderId !== orderId) {
    throw new AppError(400, "This payment does not belong to this booking");
  }
  if (!verifyCheckoutSignature(orderId, paymentId, signature)) {
    await logEvent(prisma, {
      bookingId: booking.id, paymentId: booking.payment.id, type: "CHECKOUT_SIGNATURE_INVALID", source: "CHECKOUT_CALLBACK",
      actorId: req.userId, data: { orderId, paymentId },
    });
    throw new AppError(400, "Payment signature is invalid");
  }

  let rp;
  try {
    rp = await razorpayClient.fetchPayment(paymentId);
    if (rp.order_id !== orderId) throw new AppError(400, "This payment does not belong to this booking");
    // Auto-capture is expected; capture here only if it is still authorized
    // for exactly the booking's amount.
    if (rp.status === "authorized" && rp.amount === toPaise(booking.payment.amount)) {
      rp = await razorpayClient.capturePayment(rp.id, rp.amount);
    }
  } catch (err) {
    if (err instanceof RazorpayError) {
      // We couldn't confirm right now; the webhook or reconciliation will.
      throw new AppError(502, "We couldn't confirm the payment with Razorpay yet. We'll keep checking — please refresh in a moment.");
    }
    throw err;
  }

  if (rp.status === "captured") {
    await recordCapturedPayment(rp, { source: "CHECKOUT_CALLBACK", actorId: req.userId });
  } else if (rp.status === "failed") {
    await recordPaymentFailure(rp, { source: "CHECKOUT_CALLBACK", actorId: req.userId });
  }

  res.json(await paymentSummary(booking.id, req.userId));
}

// GET /api/bookings/:id/payment  (renter or owner)
// Also the lazy fallback for everything the cron does: expiry, reconciliation
// of a pending payment, refund status, deposit release.
export async function getPaymentStatus(req, res) {
  const booking = await loadBookingForParty(req.params.id, req.userId);
  await expireUnpaidBookings({ bookingId: booking.id });

  if (paymentsEnabled()) {
    const payment = await prisma.payment.findUnique({ where: { bookingId: booking.id } });
    if (payment?.status === "CREATED") await reconcilePayment(payment).catch((e) => console.error("reconcile:", e.message));
    const inFlight = await prisma.refund.findMany({ where: { bookingId: booking.id, status: { in: ["REQUESTED", "PENDING"] } } });
    for (const r of inFlight) await refreshRefund(r).catch((e) => console.error("refund refresh:", e.message));
  }
  await releaseDepositIfDue(booking.id);

  res.json(await paymentSummary(booking.id, req.userId));
}

// GET /api/bookings/:id/cancellation-preview  (renter or owner)
// Exactly what cancelling now would refund (same function as the real refund).
export async function getCancellationPreview(req, res) {
  const booking = await loadBookingForParty(req.params.id, req.userId);
  const role = booking.ownerId === req.userId ? "OWNER" : "RENTER";
  const cancellable = ["PENDING", "ACCEPTED", "CONFIRMED"].includes(booking.status) && booking.startTime > new Date()
    && !(role === "OWNER" && booking.status === "PENDING");
  const paid = booking.payment?.status === "CAPTURED";
  const r = computeCancellationRefund(booking, role, new Date(), paid);
  res.json({
    cancellable,
    cancelledBy: role,
    paid,
    refund: { rental: fmt(r.rental), platformFee: fmt(r.platformFee), deposit: fmt(r.deposit), total: fmt(r.total) },
    explanation: r.explanation,
    policy: policySummary(booking.policyCode),
  });
}

// Payment/deposit view of a booking for its renter or owner.
export async function paymentSummary(bookingId, userId) {
  const b = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      payment: true,
      refunds: { orderBy: { requestedAt: "asc" } },
      depositClaims: { orderBy: { createdAt: "asc" } },
    },
  });
  const isRenter = b.renterId === userId;
  const now = new Date();
  const deducted = sum(b.depositClaims.filter((c) => ["ACCEPTED", "APPROVED"].includes(c.status)).map((c) => c.amountApproved));
  const canClaim = !isRenter && b.status === "COMPLETED" && ["HELD", "CLAIM_OPEN"].includes(b.depositStatus)
    && b.depositReleaseAt && b.depositReleaseAt > now;

  return {
    bookingId: b.id,
    bookingStatus: b.status,
    role: isRenter ? "renter" : "owner",
    policyCode: b.policyCode,
    policy: policySummary(b.policyCode),
    amounts: amountsOf(b),
    paymentDueAt: b.paymentDueAt,
    paidAt: b.paidAt,
    paymentsEnabled: paymentsEnabled(),
    canPay: isRenter && b.status === "ACCEPTED" && !!b.paymentDueAt && b.paymentDueAt > now && paymentsEnabled(),
    payment: b.payment && {
      status: b.payment.status,
      method: b.payment.method,
      capturedAt: b.payment.capturedAt,
      failedAttempts: b.payment.failedAttempts,
      lastError: b.payment.lastErrorDescription,
      // The payer may see the Razorpay reference for their own records.
      ...(isRenter ? { razorpayPaymentId: b.payment.razorpayPaymentId } : {}),
    },
    refunds: b.refunds.map((r) => ({
      id: r.id, purpose: r.purpose, amount: fmt(r.amount), breakdown: r.breakdown, status: r.status, reason: r.reason,
      requestedAt: r.requestedAt, processedAt: r.processedAt,
    })),
    deposit: {
      amount: fmt(b.securityDeposit),
      status: b.depositStatus,
      releaseAt: b.depositReleaseAt,
      deducted: fmt(deducted),
      canClaim,
      available: fmt(dec(b.securityDeposit).sub(sum(b.depositClaims.map((c) =>
        ["ACCEPTED", "APPROVED"].includes(c.status) ? c.amountApproved : ["OPEN", "DISPUTED"].includes(c.status) ? c.amountClaimed : 0)))),
      suggestedLateFee: !isRenter && b.status === "COMPLETED" ? fmt(suggestedLateFee(b)) : null,
      claims: b.depositClaims.map((c) => ({
        id: c.id, reason: c.reason, description: c.description, amountClaimed: fmt(c.amountClaimed),
        amountApproved: c.amountApproved === null ? null : fmt(c.amountApproved), status: c.status,
        renterResponse: c.renterResponse, resolutionNote: c.resolutionNote, createdAt: c.createdAt, resolvedAt: c.resolvedAt,
      })),
    },
  };
}

// POST /api/payments/webhook  (Razorpay; mounted with a raw body parser)
// Verified by signature; each event processed at most once (event id).
export async function razorpayWebhook(req, res) {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  if (!verifyWebhookSignature(raw, req.get("x-razorpay-signature"))) {
    return res.status(400).json({ message: "Invalid webhook signature" });
  }
  let event;
  try {
    event = JSON.parse(raw.toString("utf8"));
  } catch {
    return res.status(400).json({ message: "Invalid webhook body" });
  }
  const eventId = req.get("x-razorpay-event-id") || `sha256:${crypto.createHash("sha256").update(raw).digest("hex")}`;
  const ctx = { source: "WEBHOOK", razorpayEventId: eventId };

  try {
    // The signature proves the webhook came from someone holding the webhook
    // secret; as defence in depth (in case that secret ever leaks) the
    // payment or refund is re-fetched from Razorpay with our API keys, and
    // only Razorpay's own answer is acted on.
    const paymentId = event.payload?.payment?.entity?.id;
    const refundEntity = event.payload?.refund?.entity;
    switch (event.event) {
      case "payment.captured":
      case "order.paid": {
        const payment = paymentId ? await razorpayClient.fetchPayment(paymentId) : null;
        if (payment?.status === "captured") await recordCapturedPayment(payment, ctx);
        else await logEvent(prisma, { type: `WEBHOOK_${event.event}`, ...ctx, data: { payment: paymentId ?? null, status: payment?.status ?? null } });
        break;
      }
      case "payment.failed": {
        const payment = paymentId ? await razorpayClient.fetchPayment(paymentId) : null;
        if (payment?.status === "failed") await recordPaymentFailure(payment, { ...ctx, notify: true });
        else await logEvent(prisma, { type: "WEBHOOK_payment.failed", ...ctx, data: { payment: paymentId ?? null, status: payment?.status ?? null } });
        break;
      }
      case "refund.created":
      case "refund.processed":
      case "refund.failed": {
        const refund = refundEntity?.id
          ? await razorpayClient.fetchRefund(refundEntity.payment_id, refundEntity.id)
          : null;
        if (refund) await applyRefundUpdate(refund, ctx);
        break;
      }
      default:
        await logEvent(prisma, { type: "WEBHOOK_IGNORED", ...ctx, data: { event: event.event } });
    }
  } catch (err) {
    if (isDuplicateEvent(err)) return res.json({ status: "duplicate" });
    // Razorpay says the referenced payment/refund doesn't exist: retrying
    // won't help, so acknowledge and keep a record.
    if (err instanceof RazorpayError && !err.retryable) {
      await logEvent(prisma, { type: "WEBHOOK_REFERENCE_NOT_FOUND", ...ctx, data: { event: event.event, error: err.message } }).catch(() => {});
      return res.json({ status: "ignored" });
    }
    throw err; // 500 -> Razorpay retries later
  }
  res.json({ status: "ok" });
}
