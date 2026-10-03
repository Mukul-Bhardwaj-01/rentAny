import prisma from "../config/prisma.js";
import { AppError } from "../utils/AppError.js";
import { notifyBooking, notifyBookings } from "../utils/notifications.js";
import { PLATFORM_FEE, fmt } from "../utils/money.js";
import { CURRENT_POLICY, computeCancellationRefund } from "../utils/cancellationPolicy.js";
import { CLAIM_WINDOW_MS } from "../utils/deposits.js";
import {
  paymentDeadline,
  expireUnpaidBookings,
  lockBooking,
  createRefundRecord,
  sendRefund,
  logEvent,
} from "../utils/payments.js";

// Only these statuses reserve a time slot (mirrors the Booking_no_overlap
// exclusion constraint in the database). PENDING requests never block; an
// ACCEPTED booking holds its slot while waiting for payment.
const BLOCKING_STATUSES = ["ACCEPTED", "CONFIRMED", "ACTIVE"];
// Phone numbers are shared only once the booking is paid (CONFIRMED).
const CONTACT_VISIBLE_STATUSES = ["CONFIRMED", "ACTIVE", "COMPLETED"];
// The owner may hand the item over from this long before the start time.
const HANDOVER_EARLY_MS = 60 * 60 * 1000;

const listInclude = {
  item: { select: { id: true, title: true, imageUrl: true, location: true } },
  renter: { select: { id: true, name: true } },
  owner: { select: { id: true, name: true } },
};

// Bookings use half-open intervals [start, end): back-to-back slots don't overlap.
function overlaps(startTime, endTime) {
  return { startTime: { lt: endTime }, endTime: { gt: startTime } };
}

// Sets the given PENDING bookings to `data` one by one, only if each is still
// PENDING, and returns the ones this call actually changed. A booking changed
// concurrently elsewhere (e.g. cancelled by its renter) is skipped, so nobody
// gets a notification for a change that didn't happen.
async function closePendingBookings(tx, bookings, data) {
  const changed = [];
  for (const b of bookings) {
    const { count } = await tx.booking.updateMany({ where: { id: b.id, status: "PENDING" }, data });
    if (count === 1) changed.push(b);
  }
  return changed;
}

// PENDING requests the owner never answered expire once their start time
// passes. Done lazily before booking reads/actions (and notification polls)
// so no cron job is needed. The renter is notified in the same transaction.
export async function expireStalePendingBookings() {
  const now = new Date();
  const where = { status: "PENDING", startTime: { lte: now } };
  // Cheap check first: almost always there is nothing to expire.
  if (!(await prisma.booking.findFirst({ where, select: { id: true } }))) return;

  await prisma.$transaction(async (tx) => {
    const stale = await tx.booking.findMany({ where, include: listInclude });
    const expired = await closePendingBookings(tx, stale, { status: "EXPIRED" });
    await notifyBookings(tx, expired, "BOOKING_EXPIRED");
  });
}

// Everything time-based that happens lazily on reads: unanswered requests
// and unpaid accepted bookings expire. (The cron sweep does the same.)
export async function expireOverdueBookings() {
  await expireStalePendingBookings();
  await expireUnpaidBookings();
}

// Fetches a booking the caller wants to act on. Bookings the caller isn't
// part of are reported as not found, so ids can't be probed.
async function loadForAction(id, userId) {
  const booking = await prisma.booking.findUnique({ where: { id } });
  if (!booking || (booking.renterId !== userId && booking.ownerId !== userId)) {
    throw new AppError(404, "Booking not found");
  }
  return booking;
}

function assertOwner(booking, userId, action) {
  if (booking.ownerId !== userId) throw new AppError(403, `Only the item owner can ${action} this booking`);
}

function assertStatus(booking, allowed, action) {
  if (!allowed.includes(booking.status)) {
    throw new AppError(409, `Cannot ${action} a booking that is ${booking.status.toLowerCase()}`);
  }
}

// Applies a status change only if the booking is still in the state we checked.
// If a concurrent request changed it first, nothing is updated and we report 409.
async function applyTransition(client, booking, data, extraWhere = {}) {
  const { count } = await client.booking.updateMany({
    where: { id: booking.id, status: booking.status, ...extraWhere },
    data,
  });
  if (count === 0) throw new AppError(409, "This booking was just changed. Please refresh and try again.");
  return client.booking.findUnique({ where: { id: booking.id }, include: listInclude });
}

async function findSlotConflict(itemId, startTime, endTime, excludeId) {
  return prisma.booking.findFirst({
    where: {
      itemId,
      status: { in: BLOCKING_STATUSES },
      ...overlaps(startTime, endTime),
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });
}

// GET /api/items/:id/availability?from=&to=  (public)
// Returns only the booked time ranges, never who booked them.
export async function getItemAvailability(req, res) {
  const { id } = req.params;
  const { from, to } = req.query;

  const item = await prisma.item.findUnique({ where: { id }, select: { id: true, isAvailable: true } });
  if (!item) throw new AppError(404, "Item not found");

  const booked = await prisma.booking.findMany({
    where: { itemId: id, status: { in: BLOCKING_STATUSES }, ...overlaps(from, to) },
    select: { startTime: true, endTime: true },
    orderBy: { startTime: "asc" },
  });

  res.json({ itemId: item.id, isAvailable: item.isAvailable, from, to, booked });
}

// POST /api/bookings  (renter)  body: { itemId, startTime, hours, note? }
export async function createBooking(req, res) {
  const { itemId, startTime, hours, note } = req.body;
  const endTime = new Date(startTime.getTime() + hours * 60 * 60 * 1000);

  await expireOverdueBookings();

  const item = await prisma.item.findUnique({ where: { id: itemId } });
  if (!item) throw new AppError(404, "Item not found");
  if (item.ownerId === req.userId) throw new AppError(400, "You cannot book your own item");
  if (!item.isAvailable) throw new AppError(409, "This item is not accepting bookings right now");

  if (await findSlotConflict(itemId, startTime, endTime)) {
    throw new AppError(409, "This time slot is already booked. Please choose another time.");
  }

  const duplicate = await prisma.booking.findFirst({
    where: {
      itemId,
      renterId: req.userId,
      status: { in: ["PENDING", ...BLOCKING_STATUSES] },
      ...overlaps(startTime, endTime),
    },
    select: { id: true },
  });
  if (duplicate) {
    throw new AppError(409, "You already have a request or booking for this item that overlaps this time");
  }

  // Financial snapshot: what the renter sees now is exactly what they pay,
  // whatever later happens to the item's price, deposit or the platform fee.
  // Decimal arithmetic, so there are no floating point rounding errors.
  const rentalAmount = item.pricePerHour.mul(hours);
  const securityDeposit = item.securityDeposit;
  const totalPayable = rentalAmount.add(PLATFORM_FEE).add(securityDeposit);

  const booking = await prisma.$transaction(async (tx) => {
    const created = await tx.booking.create({
      data: {
        itemId,
        renterId: req.userId,
        ownerId: item.ownerId,
        startTime,
        endTime,
        hours,
        pricePerHour: item.pricePerHour,
        rentalAmount,
        platformFee: PLATFORM_FEE,
        securityDeposit,
        totalPayable,
        policyCode: CURRENT_POLICY,
        renterNote: note,
      },
      include: listInclude,
    });
    await notifyBooking(tx, created, "BOOKING_REQUESTED");
    return created;
  });

  res.status(201).json(booking);
}

// GET /api/bookings?as=renter|owner&status=
export async function getMyBookings(req, res) {
  const { as, status } = req.query;

  await expireOverdueBookings();

  const bookings = await prisma.booking.findMany({
    where: {
      [as === "owner" ? "ownerId" : "renterId"]: req.userId,
      ...(status ? { status } : {}),
    },
    include: listInclude,
    orderBy: { createdAt: "desc" },
  });

  res.json(bookings);
}

// GET /api/bookings/:id  (renter or owner of this booking)
export async function getBookingById(req, res) {
  await expireOverdueBookings();

  const booking = await prisma.booking.findUnique({
    where: { id: req.params.id },
    include: {
      item: { select: { id: true, title: true, imageUrl: true, location: true, category: true } },
      renter: { select: { id: true, name: true, phone: true } },
      owner: { select: { id: true, name: true, phone: true } },
    },
  });

  if (!booking || (booking.renterId !== req.userId && booking.ownerId !== req.userId)) {
    throw new AppError(404, "Booking not found");
  }

  if (!CONTACT_VISIBLE_STATUSES.includes(booking.status)) {
    delete booking.renter.phone;
    delete booking.owner.phone;
  }

  res.json(booking);
}

// PATCH /api/bookings/:id/accept  (owner)
export async function acceptBooking(req, res) {
  await expireOverdueBookings();

  const booking = await loadForAction(req.params.id, req.userId);
  assertOwner(booking, req.userId, "accept");
  assertStatus(booking, ["PENDING"], "accept");

  if (await findSlotConflict(booking.itemId, booking.startTime, booking.endTime, booking.id)) {
    throw new AppError(409, "This time slot is already taken by another accepted booking");
  }

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    // Lock the item row so accepts for the same item run one at a time.
    // Without this, two concurrent accepts deadlock: each waits on the other's
    // accepted row (exclusion check) while auto-rejecting it. The second accept
    // now waits, then finds its booking already auto-rejected (409).
    await tx.$queryRaw`SELECT id FROM "Item" WHERE id = ${booking.itemId} FOR UPDATE`;

    // Booking_no_overlap is still the final safety net (mapped to 409).
    // The renter now has 12 hours (never past the start) to pay.
    const accepted = await applyTransition(
      tx,
      booking,
      { status: "ACCEPTED", respondedAt: now, paymentDueAt: paymentDeadline(now, booking.startTime) },
      { startTime: { gt: now } }
    );

    await notifyBooking(tx, accepted, "BOOKING_ACCEPTED");

    // The slot is now taken, so other overlapping requests are turned down
    // and their renters told why.
    const overlapping = await tx.booking.findMany({
      where: {
        itemId: booking.itemId,
        status: "PENDING",
        id: { not: booking.id },
        ...overlaps(booking.startTime, booking.endTime),
      },
      include: listInclude,
    });
    const autoRejected = await closePendingBookings(tx, overlapping, {
      status: "REJECTED",
      respondedAt: now,
      responseNote: "Another request for this time slot was accepted",
    });
    await notifyBookings(tx, autoRejected, "BOOKING_AUTO_REJECTED");

    return accepted;
  });

  res.json(updated);
}

// PATCH /api/bookings/:id/reject  (owner)  body: { reason? }
export async function rejectBooking(req, res) {
  await expireOverdueBookings();

  const booking = await loadForAction(req.params.id, req.userId);
  assertOwner(booking, req.userId, "reject");
  assertStatus(booking, ["PENDING"], "reject");

  const updated = await prisma.$transaction(async (tx) => {
    const rejected = await applyTransition(tx, booking, {
      status: "REJECTED",
      respondedAt: new Date(),
      responseNote: req.body.reason,
    });
    await notifyBooking(tx, rejected, "BOOKING_REJECTED");
    return rejected;
  });
  res.json(updated);
}

// PATCH /api/bookings/:id/cancel  body: { reason? }
// Renter: PENDING, ACCEPTED or CONFIRMED. Owner: ACCEPTED or CONFIRMED (owners
// reject PENDING requests instead) and must give a reason. Only before the
// start time. A paid booking is refunded per its cancellation policy.
export async function cancelBooking(req, res) {
  await expireOverdueBookings();

  const booking = await loadForAction(req.params.id, req.userId);
  const isOwner = booking.ownerId === req.userId;
  const now = new Date();

  if (isOwner) {
    assertStatus(booking, ["ACCEPTED", "CONFIRMED"], "cancel");
    if (!req.body.reason) {
      throw new AppError(400, "Please give the renter a reason for cancelling", {
        reason: "A reason is required when the owner cancels",
      });
    }
  } else {
    assertStatus(booking, ["PENDING", "ACCEPTED", "CONFIRMED"], "cancel");
  }

  if (booking.startTime <= now) {
    throw new AppError(409, "This booking has already started and can no longer be cancelled");
  }

  const cancelledBy = isOwner ? "OWNER" : "RENTER";
  let refundId = null;
  const updated = await prisma.$transaction(async (tx) => {
    // Same lock order as payment capture, so a payment landing at the same
    // moment either confirms first (and is refunded here) or arrives after
    // the cancellation (and is refunded in full there).
    await lockBooking(tx, booking.id);
    const cancelled = await applyTransition(
      tx,
      booking,
      { status: "CANCELLED", cancelledBy, cancelReason: req.body.reason, cancelledAt: now },
      { startTime: { gt: now } }
    );

    const payment = await tx.payment.findUnique({ where: { bookingId: booking.id } });
    if (payment?.status === "CAPTURED") {
      const refund = computeCancellationRefund(cancelled, cancelledBy, now, true);
      if (refund.total.gt(0)) {
        const record = await createRefundRecord(tx, {
          booking: cancelled, payment, purpose: "CANCELLATION", amount: refund.total,
          breakdown: { rental: fmt(refund.rental), platformFee: fmt(refund.platformFee), deposit: fmt(refund.deposit) },
          reason: refund.explanation, initiatedBy: cancelledBy, initiatedById: req.userId,
          idempotencyKey: `cancel:${booking.id}`,
        });
        refundId = record.id;
      }
      if (refund.deposit.gt(0)) {
        await tx.booking.update({ where: { id: booking.id }, data: { depositStatus: "RELEASE_PENDING" } });
      }
    } else if (payment?.status === "CREATED") {
      await tx.payment.update({ where: { id: payment.id }, data: { status: "VOIDED" } });
      await logEvent(tx, { bookingId: booking.id, paymentId: payment.id, type: "ORDER_VOIDED", source: "USER", actorId: req.userId, data: { reason: "booking cancelled before payment" } });
    }

    // The other party is the one who needs to know.
    await notifyBooking(tx, cancelled, isOwner ? "BOOKING_CANCELLED_BY_OWNER" : "BOOKING_CANCELLED_BY_RENTER");
    return tx.booking.findUnique({ where: { id: booking.id }, include: listInclude });
  });

  // Sent after the cancellation is committed; retried by the sweep if needed.
  if (refundId) await sendRefund(refundId);
  res.json(updated);
}

// PATCH /api/bookings/:id/start  (owner confirms handover)
export async function startBooking(req, res) {
  const booking = await loadForAction(req.params.id, req.userId);
  assertOwner(booking, req.userId, "start");
  if (booking.status === "ACCEPTED") {
    throw new AppError(409, "The renter hasn't paid yet, so the item can't be handed over");
  }
  assertStatus(booking, ["CONFIRMED"], "start");

  const now = new Date();
  if (now.getTime() < booking.startTime.getTime() - HANDOVER_EARLY_MS) {
    throw new AppError(409, "The item can be handed over at most 1 hour before the booking starts");
  }
  if (now >= booking.endTime) {
    throw new AppError(409, "This booking's time has already ended, so it can't be started");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const started = await applyTransition(tx, booking, { status: "ACTIVE", startedAt: now });
    await notifyBooking(tx, started, "BOOKING_STARTED");
    return started;
  });
  res.json(updated);
}

// PATCH /api/bookings/:id/complete  (owner confirms return)
export async function completeBooking(req, res) {
  const booking = await loadForAction(req.params.id, req.userId);
  assertOwner(booking, req.userId, "complete");
  assertStatus(booking, ["ACTIVE"], "complete");

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    // A held deposit stays held for the 48-hour claim window from now.
    const completed = await applyTransition(tx, booking, {
      status: "COMPLETED",
      returnedAt: now,
      ...(booking.depositStatus === "HELD" ? { depositReleaseAt: new Date(now.getTime() + CLAIM_WINDOW_MS) } : {}),
    });
    await notifyBooking(tx, completed, "BOOKING_COMPLETED");
    return completed;
  });

  // The owner can use this to claim a late-return fee from the deposit.
  const lateByMinutes = Math.max(0, Math.ceil((now - booking.endTime) / 60000));
  res.json({ ...updated, lateByMinutes });
}
