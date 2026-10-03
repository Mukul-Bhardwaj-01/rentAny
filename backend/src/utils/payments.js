// Payments and refunds (Razorpay Standard Checkout, test mode).
//
// Rules this module follows:
// - Only recordCapturedPayment() can confirm a booking, and only with payment
//   data fetched from Razorpay or delivered by a signed webhook: never with
//   amounts or statuses sent by the browser.
// - No database transaction is ever kept open across a Razorpay HTTP call.
// - Every step is safe to repeat: duplicate callbacks, webhooks and retries
//   are absorbed by row locks, conditional updates and unique keys.
// - Every money event is written to the append-only PaymentEvent log.
import { Prisma } from "@prisma/client";
import prisma from "../config/prisma.js";
import { AppError } from "./AppError.js";
import { razorpayClient, RazorpayError, paymentsEnabled } from "./razorpay.js";
import { dec, toPaise, fromPaise, fmt, sum, ZERO } from "./money.js";
import { notifyBooking, notifyBookings } from "./notifications.js";

export const PAYMENT_WINDOW_MS = 12 * 60 * 60 * 1000;
export const MAX_REFUND_ATTEMPTS = 5;

export const bookingInclude = {
  item: { select: { id: true, title: true } },
  renter: { select: { id: true, name: true } },
  owner: { select: { id: true, name: true } },
};

const PURPOSE_TEXT = {
  CANCELLATION: "booking cancelled",
  DEPOSIT_RELEASE: "security deposit",
  BOOKING_NOT_PAYABLE: "payment received after the booking had ended or been cancelled",
  DUPLICATE_PAYMENT: "duplicate payment",
  ADMIN_ADJUSTMENT: "adjustment",
};

// When the renter must pay by: 12 hours after acceptance, never past the start.
export function paymentDeadline(acceptedAt, startTime) {
  return new Date(Math.min(acceptedAt.getTime() + PAYMENT_WINDOW_MS, new Date(startTime).getTime()));
}

export const lockBooking = (tx, bookingId) => tx.$queryRaw`SELECT id FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;

// Only the fields worth keeping from Razorpay entities (never card details).
function pickPayment(rp) {
  const { id, order_id, amount, currency, status, method, captured, error_code, error_reason, error_description, created_at } = rp || {};
  return { id, order_id, amount, currency, status, method, captured, error_code, error_reason, error_description, created_at };
}
function pickRefund(rf) {
  const { id, payment_id, amount, status, notes, created_at } = rf || {};
  return { id, payment_id, amount, status, notes, created_at };
}

export function logEvent(client, { bookingId, paymentId, refundId, claimId, type, source, actorId, razorpayEventId, amount, data }) {
  return client.paymentEvent.create({
    data: {
      bookingId: bookingId ?? null,
      paymentId: paymentId ?? null,
      refundId: refundId ?? null,
      claimId: claimId ?? null,
      type,
      source,
      actorId: actorId ?? null,
      razorpayEventId: razorpayEventId ?? null,
      amount: amount ?? null,
      data: data ?? {},
    },
  });
}

// True for the unique-violation a redelivered webhook causes.
export function isDuplicateEvent(err) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && String(err.meta?.target).includes("razorpayEventId");
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

// Creates (or reuses) the Razorpay order for an accepted booking and returns
// what Standard Checkout needs. The amount always comes from the booking's
// snapshot, never from the client.
export async function getOrCreateOrder(bookingId, userId) {
  if (!paymentsEnabled()) throw new AppError(503, "Online payments are not configured yet");
  await expireUnpaidBookings({ bookingId });

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { ...bookingInclude, renter: { select: { id: true, name: true, email: true, phone: true } }, payment: true },
  });
  if (!booking || (booking.renterId !== userId && booking.ownerId !== userId)) throw new AppError(404, "Booking not found");
  if (booking.renterId !== userId) throw new AppError(403, "Only the renter can pay for this booking");
  if (booking.payment?.status === "CAPTURED") throw new AppError(409, "This booking is already paid");
  if (booking.status !== "ACCEPTED") throw new AppError(409, `A ${booking.status.toLowerCase()} booking can't be paid for`);
  if (!booking.paymentDueAt) throw new AppError(409, "This booking doesn't need an online payment");
  if (booking.paymentDueAt <= new Date()) throw new AppError(409, "The payment deadline for this booking has passed");

  let payment = booking.payment;
  if (!payment) {
    const amountPaise = toPaise(booking.totalPayable);
    // Razorpay first, outside any transaction. An unused order is harmless.
    const order = await razorpayClient.createOrder({
      amountPaise,
      receipt: `bk_${booking.id}`,
      notes: { bookingId: String(booking.id) },
    });
    if (!order?.id || order.amount !== amountPaise || order.currency !== "INR") {
      throw new AppError(502, "Razorpay returned an unexpected order");
    }
    try {
      payment = await prisma.$transaction(async (tx) => {
        await lockBooking(tx, booking.id);
        const created = await tx.payment.create({
          data: { bookingId: booking.id, razorpayOrderId: order.id, amount: booking.totalPayable },
        });
        await logEvent(tx, {
          bookingId: booking.id, paymentId: created.id, type: "ORDER_CREATED", source: "USER", actorId: userId,
          amount: booking.totalPayable, data: { orderId: order.id, amountPaise },
        });
        return created;
      });
    } catch (err) {
      // A concurrent request created the order first: use that one.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        payment = await prisma.payment.findUnique({ where: { bookingId: booking.id } });
      } else throw err;
    }
  }

  return {
    keyId: process.env.RAZORPAY_KEY_ID,
    orderId: payment.razorpayOrderId,
    amount: toPaise(payment.amount),
    currency: payment.currency,
    bookingId: booking.id,
    paymentDueAt: booking.paymentDueAt,
    name: "RentAny",
    description: `Booking #${booking.id}: ${booking.item.title}`,
    breakdown: amountsOf(booking),
    prefill: { name: booking.renter.name, email: booking.renter.email, contact: booking.renter.phone || "" },
  };
}

export function amountsOf(booking) {
  return {
    rentalAmount: fmt(booking.rentalAmount),
    platformFee: fmt(booking.platformFee),
    securityDeposit: fmt(booking.securityDeposit),
    totalPayable: fmt(booking.totalPayable),
  };
}

// ---------------------------------------------------------------------------
// Captured / failed payments
// ---------------------------------------------------------------------------

// Records a captured Razorpay payment (`rp` = payment entity fetched from
// Razorpay or from a verified webhook). The ONLY way a booking becomes
// CONFIRMED. Idempotent; also handles late, duplicate and mismatched payments
// by refunding them in full.
export async function recordCapturedPayment(rp, { source, razorpayEventId, actorId } = {}) {
  const payment = await prisma.payment.findUnique({ where: { razorpayOrderId: rp.order_id ?? "" } });
  if (!payment) {
    await logEvent(prisma, { type: "PAYMENT_FOR_UNKNOWN_ORDER", source, razorpayEventId, data: pickPayment(rp) });
    return { outcome: "unknown_order" };
  }

  const refundIds = [];
  const outcome = await prisma.$transaction(async (tx) => {
    await lockBooking(tx, payment.bookingId);
    const p = await tx.payment.findUnique({ where: { id: payment.id } });
    const booking = await tx.booking.findUnique({ where: { id: payment.bookingId }, include: bookingInclude });
    const capturedAmount = fromPaise(rp.amount);
    let result;

    if (p.status === "CAPTURED" && p.razorpayPaymentId === rp.id) {
      result = "already_recorded";
    } else if (p.status === "CAPTURED") {
      // A second successful payment for the same booking: give it back.
      const refund = await createRefundRecord(tx, {
        booking, payment: p, razorpayPaymentId: rp.id, capturedAmount,
        purpose: "DUPLICATE_PAYMENT", amount: capturedAmount, breakdown: { duplicate: fmt(capturedAmount) },
        reason: "A second payment was made for the same booking", initiatedBy: "SYSTEM", idempotencyKey: `dup:${rp.id}`,
      });
      refundIds.push(refund.id);
      result = "duplicate_refunded";
    } else {
      const amountOk = rp.amount === toPaise(p.amount) && rp.currency === "INR";
      const payable = booking.status === "ACCEPTED";
      await tx.payment.update({
        where: { id: p.id },
        data: { status: "CAPTURED", razorpayPaymentId: rp.id, method: rp.method ?? null, capturedAt: new Date() },
      });
      if (amountOk && payable) {
        const confirmed = await tx.booking.update({
          where: { id: booking.id },
          data: {
            status: "CONFIRMED",
            paidAt: new Date(),
            depositStatus: dec(booking.securityDeposit).gt(0) ? "HELD" : "NOT_COLLECTED",
          },
          include: bookingInclude,
        });
        await notifyBooking(tx, confirmed, "PAYMENT_RECEIVED");
        result = "confirmed";
      } else {
        // Money arrived but the booking can't take it (expired/cancelled) or
        // the amount is wrong: refund everything that was captured.
        const refund = await createRefundRecord(tx, {
          booking, payment: { ...p, razorpayPaymentId: rp.id }, razorpayPaymentId: rp.id, capturedAmount,
          purpose: "BOOKING_NOT_PAYABLE", amount: capturedAmount, breakdown: { payment: fmt(capturedAmount) },
          reason: amountOk ? `Payment received after the booking was ${booking.status.toLowerCase()}` : "Payment amount did not match the booking",
          initiatedBy: "SYSTEM", idempotencyKey: `notpayable:${rp.id}`,
        });
        refundIds.push(refund.id);
        result = "refunded";
      }
    }

    // Written last: for a redelivered webhook the unique event id makes this
    // throw, rolling everything back (the caller treats it as a duplicate).
    await logEvent(tx, {
      bookingId: booking.id, paymentId: p.id, type: "PAYMENT_CAPTURED", source, actorId, razorpayEventId,
      amount: capturedAmount, data: { ...pickPayment(rp), outcome: result },
    });
    return result;
  });

  for (const id of refundIds) await sendRefund(id);
  return { outcome, bookingId: payment.bookingId };
}

// Records a failed payment attempt. The order stays usable for a retry.
export async function recordPaymentFailure(rp, { source, razorpayEventId, actorId, notify = false } = {}) {
  const payment = await prisma.payment.findUnique({ where: { razorpayOrderId: rp.order_id ?? "" } });
  if (!payment) {
    await logEvent(prisma, { type: "PAYMENT_FAILED_UNKNOWN_ORDER", source, razorpayEventId, data: pickPayment(rp) });
    return;
  }
  await prisma.$transaction(async (tx) => {
    await lockBooking(tx, payment.bookingId);
    const p = await tx.payment.findUnique({ where: { id: payment.id } });
    // The same failed attempt can reach us twice (callback + webhook): count it once.
    const seen = await tx.paymentEvent.findFirst({
      where: { paymentId: p.id, type: "PAYMENT_FAILED", data: { path: ["id"], equals: rp.id } },
      select: { id: true },
    });
    if (p.status === "CREATED" && !seen) {
      await tx.payment.update({
        where: { id: p.id },
        data: {
          failedAttempts: { increment: 1 },
          lastErrorCode: rp.error_code ?? null,
          lastErrorReason: rp.error_reason ?? null,
          lastErrorDescription: rp.error_description ?? null,
        },
      });
      if (notify) {
        const booking = await tx.booking.findUnique({ where: { id: p.bookingId }, include: bookingInclude });
        if (booking.status === "ACCEPTED") {
          await notifyBooking(tx, booking, "PAYMENT_FAILED", { key: `payment:${rp.id}`, extra: { reason: rp.error_description } });
        }
      }
    }
    await logEvent(tx, {
      bookingId: p.bookingId, paymentId: p.id, type: "PAYMENT_FAILED", source, actorId, razorpayEventId,
      amount: rp.amount ? fromPaise(rp.amount) : null, data: pickPayment(rp),
    });
  });
}

// Checks Razorpay for payments on an order we haven't seen captured yet
// (lost callback, missing webhook). Captures authorized ones if needed.
export async function reconcilePayment(payment) {
  if (!paymentsEnabled() || payment.status !== "CREATED") return;
  const attempts = await razorpayClient.fetchOrderPayments(payment.razorpayOrderId);
  for (let rp of attempts) {
    if (rp.status === "authorized" && rp.amount === toPaise(payment.amount)) {
      rp = await razorpayClient.capturePayment(rp.id, rp.amount);
    }
    if (rp.status === "captured") await recordCapturedPayment(rp, { source: "RECONCILIATION" });
  }
}

// Lazily (and from the cron sweep): accepted bookings not paid by their
// deadline expire and free the slot. If checkout was started, Razorpay is
// checked first so a payment that did go through is never thrown away.
export async function expireUnpaidBookings({ bookingId, limit = 50 } = {}) {
  const now = new Date();
  const due = await prisma.booking.findMany({
    where: { status: "ACCEPTED", paymentDueAt: { lte: now }, ...(bookingId ? { id: bookingId } : {}) },
    include: { payment: true },
    take: limit,
  });
  for (const b of due) {
    if (b.payment?.status === "CREATED") {
      try {
        await reconcilePayment(b.payment);
      } catch (err) {
        // Razorpay unreachable: expire anyway; a late capture is refunded in full.
        console.error(`Reconciliation failed for booking ${b.id}:`, err.message);
      }
    }
    await prisma.$transaction(async (tx) => {
      await lockBooking(tx, b.id);
      const { count } = await tx.booking.updateMany({
        where: { id: b.id, status: "ACCEPTED", paymentDueAt: { lte: now } },
        data: { status: "EXPIRED" },
      });
      if (count === 0) return; // paid or changed meanwhile
      await tx.payment.updateMany({ where: { bookingId: b.id, status: "CREATED" }, data: { status: "VOIDED" } });
      const expired = await tx.booking.findUnique({ where: { id: b.id }, include: bookingInclude });
      await notifyBooking(tx, expired, "BOOKING_PAYMENT_EXPIRED");
      await logEvent(tx, { bookingId: b.id, paymentId: b.payment?.id, type: "BOOKING_PAYMENT_EXPIRED", source: "SYSTEM", data: { paymentDueAt: b.paymentDueAt } });
    });
  }
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

// Inside the caller's transaction (booking row already locked): records a
// refund to be sent. One idempotency key = one refund, ever. Never lets the
// refunds of a payment exceed what was captured.
export async function createRefundRecord(tx, {
  booking, payment, razorpayPaymentId, capturedAmount, purpose, amount, breakdown, reason, initiatedBy, initiatedById, idempotencyKey,
}) {
  const existing = await tx.refund.findUnique({ where: { idempotencyKey } });
  if (existing) return existing;

  const amt = dec(amount);
  if (!amt.gt(0)) throw new AppError(400, "Refund amount must be greater than zero");
  const rpId = razorpayPaymentId ?? payment.razorpayPaymentId;
  const already = await tx.refund.findMany({ where: { razorpayPaymentId: rpId }, select: { amount: true } });
  const ceiling = dec(capturedAmount ?? payment.amount);
  if (sum(already.map((r) => r.amount)).add(amt).gt(ceiling)) {
    throw new AppError(409, "Refunds would exceed the amount paid");
  }

  const refund = await tx.refund.create({
    data: {
      paymentId: payment.id, bookingId: booking.id, razorpayPaymentId: rpId, idempotencyKey, purpose,
      amount: amt, breakdown, reason, initiatedBy, initiatedById: initiatedById ?? null,
    },
  });
  await logEvent(tx, {
    bookingId: booking.id, paymentId: payment.id, refundId: refund.id, type: "REFUND_REQUESTED",
    source: initiatedBy === "ADMIN" ? "ADMIN" : initiatedBy === "SYSTEM" ? "SYSTEM" : "USER", actorId: initiatedById,
    amount: amt, data: { purpose, breakdown, reason, idempotencyKey },
  });
  await notifyBooking(tx, booking, "REFUND_INITIATED", {
    key: `refund:${refund.id}`, extra: { amount: amt, purposeText: PURPOSE_TEXT[purpose] },
  });
  return refund;
}

// Sends a recorded refund to Razorpay (outside any transaction). Safe to call
// repeatedly: if an earlier attempt's outcome is unknown, Razorpay is checked
// for a refund with our idempotency key before creating a new one.
const SEND_LEASE_MS = 2 * 60 * 1000; // well above the 15 s Razorpay timeout

export async function sendRefund(refundId) {
  if (!paymentsEnabled()) return prisma.refund.findUnique({ where: { id: refundId } });

  // Take the send lease atomically: if another process is already sending
  // this refund (or it is no longer sendable), do nothing.
  const now = new Date();
  const { count } = await prisma.refund.updateMany({
    where: {
      id: refundId,
      status: { in: ["REQUESTED", "FAILED"] },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    },
    data: { lockedUntil: new Date(now.getTime() + SEND_LEASE_MS), attempts: { increment: 1 } },
  });
  if (count === 0) return prisma.refund.findUnique({ where: { id: refundId } });
  const refund = await prisma.refund.findUnique({ where: { id: refundId } });

  let rz = null;
  try {
    // Not the first attempt: an earlier call may have reached Razorpay even if
    // we never saw the answer. Look for it by our key before creating another.
    if (refund.attempts > 1) {
      const list = await razorpayClient.fetchRefunds(refund.razorpayPaymentId);
      rz = list.find((r) => r.notes?.idempotencyKey === refund.idempotencyKey && r.status !== "failed") || null;
    }
    if (!rz) {
      rz = await razorpayClient.createRefund(refund.razorpayPaymentId, {
        amountPaise: toPaise(refund.amount),
        notes: { idempotencyKey: refund.idempotencyKey, bookingId: String(refund.bookingId), purpose: refund.purpose },
        receipt: refund.idempotencyKey.slice(0, 40),
      });
    }
  } catch (err) {
    const definite = err instanceof RazorpayError && !err.retryable;
    await prisma.$transaction(async (tx) => {
      const updated = await tx.refund.update({
        where: { id: refund.id },
        data: {
          lockedUntil: null,
          lastErrorCode: err.code ?? null,
          lastErrorDescription: String(err.message).slice(0, 500),
          ...(definite ? { status: "FAILED", failedAt: new Date() } : {}),
        },
      });
      await logEvent(tx, {
        bookingId: refund.bookingId, paymentId: refund.paymentId, refundId: refund.id,
        type: definite ? "REFUND_FAILED" : "REFUND_ATTEMPT_UNCERTAIN", source: "SYSTEM",
        amount: refund.amount, data: { error: err.message, code: err.code ?? null, status: err.status ?? null },
      });
      if (definite) {
        const booking = await tx.booking.findUnique({ where: { id: refund.bookingId }, include: bookingInclude });
        await notifyBooking(tx, booking, "REFUND_FAILED", { key: `refund:${refund.id}`, extra: { amount: updated.amount } });
      }
    });
    return prisma.refund.findUnique({ where: { id: refund.id } });
  }

  await applyRefundUpdate(rz, { source: "SYSTEM" });
  await prisma.refund.update({ where: { id: refund.id }, data: { lockedUntil: null } });
  return prisma.refund.findUnique({ where: { id: refund.id } });
}

const REFUND_STATUS = { processed: "PROCESSED", pending: "PENDING", created: "PENDING", failed: "FAILED" };

// Applies a Razorpay refund entity (from our API call, a fetch, or a verified
// webhook) to our record. Matches by refund id, or by our idempotency key in
// its notes. Never moves a PROCESSED refund backwards.
export async function applyRefundUpdate(rz, { source, razorpayEventId } = {}) {
  const key = rz?.notes?.idempotencyKey;
  const refund =
    (rz?.id && (await prisma.refund.findUnique({ where: { razorpayRefundId: rz.id } }))) ||
    (key && (await prisma.refund.findUnique({ where: { idempotencyKey: key } })));
  if (!refund) {
    await logEvent(prisma, { type: "REFUND_UNKNOWN", source, razorpayEventId, data: pickRefund(rz) });
    return null;
  }
  const next = REFUND_STATUS[rz.status] || "PENDING";

  await prisma.$transaction(async (tx) => {
    await lockBooking(tx, refund.bookingId);
    const current = await tx.refund.findUnique({ where: { id: refund.id } });
    const changed = current.status !== "PROCESSED" && !(current.status === next && current.razorpayRefundId === rz.id);
    if (changed) {
      await tx.refund.update({
        where: { id: refund.id },
        data: {
          status: next,
          razorpayRefundId: rz.id,
          ...(next === "PROCESSED" ? { processedAt: new Date() } : {}),
          ...(next === "FAILED" ? { failedAt: new Date() } : {}),
        },
      });
      const booking = await tx.booking.findUnique({ where: { id: refund.bookingId }, include: bookingInclude });
      if (next === "PROCESSED") {
        await notifyBooking(tx, booking, "REFUND_PROCESSED", { key: `refund:${refund.id}`, extra: { amount: refund.amount } });
        await settleDepositAfterRefund(tx, booking, current);
      } else if (next === "FAILED") {
        await notifyBooking(tx, booking, "REFUND_FAILED", { key: `refund:${refund.id}`, extra: { amount: refund.amount } });
      }
    }
    await logEvent(tx, {
      bookingId: refund.bookingId, paymentId: refund.paymentId, refundId: refund.id, type: `REFUND_${next}`,
      source, razorpayEventId, amount: refund.amount, data: { ...pickRefund(rz), changed },
    });
  });
  return prisma.refund.findUnique({ where: { id: refund.id } });
}

// After a refund containing deposit money is processed, record the final
// deposit outcome on the booking.
async function settleDepositAfterRefund(tx, booking, refund) {
  if (refund.purpose === "DEPOSIT_RELEASE") {
    const full = dec(refund.amount).equals(dec(booking.securityDeposit));
    await tx.booking.update({ where: { id: booking.id }, data: { depositStatus: full ? "REFUNDED" : "PARTIALLY_REFUNDED" } });
  } else if (refund.purpose === "CANCELLATION" && booking.depositStatus === "RELEASE_PENDING") {
    await tx.booking.update({ where: { id: booking.id }, data: { depositStatus: "REFUNDED" } });
  }
}

// Asks Razorpay for the latest state of a refund that is still in flight.
export async function refreshRefund(refund) {
  if (!paymentsEnabled()) return refund;
  if (refund.status === "PENDING" && refund.razorpayRefundId) {
    const rz = await razorpayClient.fetchRefund(refund.razorpayPaymentId, refund.razorpayRefundId);
    return applyRefundUpdate(rz, { source: "RECONCILIATION" });
  }
  if (refund.status === "REQUESTED" || (refund.status === "FAILED" && refund.attempts < MAX_REFUND_ATTEMPTS)) {
    return sendRefund(refund.id);
  }
  return refund;
}

// The cron sweep's refund work: retry unsent/uncertain and failed refunds,
// and refresh ones Razorpay is still processing.
export async function retryRefunds(limit = 50) {
  const now = new Date();
  const refunds = await prisma.refund.findMany({
    where: {
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
      AND: {
        OR: [
          { status: "REQUESTED" },
          { status: "PENDING" },
          { status: "FAILED", attempts: { lt: MAX_REFUND_ATTEMPTS } },
        ],
      },
    },
    orderBy: { requestedAt: "asc" },
    take: limit,
  });
  for (const r of refunds) {
    try {
      await refreshRefund(r);
    } catch (err) {
      console.error(`Refund ${r.id} refresh failed:`, err.message);
    }
  }
  return refunds.length;
}

// Open orders whose checkout may have succeeded without us hearing about it.
export async function reconcileOpenPayments(limit = 50) {
  const open = await prisma.payment.findMany({
    where: { status: "CREATED", booking: { status: "ACCEPTED" } },
    take: limit,
  });
  for (const p of open) {
    try {
      await reconcilePayment(p);
    } catch (err) {
      console.error(`Payment ${p.id} reconciliation failed:`, err.message);
    }
  }
  return open.length;
}

export { ZERO };
