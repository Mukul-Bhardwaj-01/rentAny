// Security-deposit claims and release.
//
// After the owner confirms the return, the deposit stays held for a 48-hour
// claim window. The owner may raise claims (damage, late return, ...); the
// renter accepts or disputes each one; disputes are resolved by an admin.
// While any claim is unresolved the whole deposit stays held. When the window
// has closed and nothing is unresolved, the deposit minus approved deductions
// is refunded. Approved deductions can never exceed the deposit.
import prisma from "../config/prisma.js";
import { AppError } from "./AppError.js";
import { dec, sum, fmt, ZERO } from "./money.js";
import { notifyBooking } from "./notifications.js";
import { bookingInclude, lockBooking, logEvent, createRefundRecord, sendRefund } from "./payments.js";

export const CLAIM_WINDOW_MS = 48 * 60 * 60 * 1000;

const UNRESOLVED = ["OPEN", "DISPUTED"];
const DEDUCTED = ["ACCEPTED", "APPROVED"];
const REASON_TEXT = { DAMAGE: "damage", LATE_RETURN: "late return", MISSING_PARTS: "missing parts", OTHER: "other" };

const approvedTotal = (claims) => sum(claims.filter((c) => DEDUCTED.includes(c.status)).map((c) => c.amountApproved));
const reservedTotal = (claims) =>
  approvedTotal(claims).add(sum(claims.filter((c) => UNRESOLVED.includes(c.status)).map((c) => c.amountClaimed)));

// Suggested amount for a late-return claim: late hours (rounded up) at the
// booking's hourly price, capped at the deposit. Only a suggestion.
export function suggestedLateFee(booking) {
  if (!booking.returnedAt) return ZERO;
  const lateMs = new Date(booking.returnedAt) - new Date(booking.endTime);
  if (lateMs <= 0) return ZERO;
  const fee = dec(booking.pricePerHour).mul(Math.ceil(lateMs / 3600000));
  return fee.gt(booking.securityDeposit) ? dec(booking.securityDeposit) : fee;
}

async function loadLocked(tx, bookingId) {
  await lockBooking(tx, bookingId);
  return tx.booking.findUnique({ where: { id: bookingId }, include: { ...bookingInclude, depositClaims: true } });
}

// After a claim stops being unresolved, go back to HELD if nothing else is open.
async function reopenHoldIfSettled(tx, booking) {
  const open = await tx.depositClaim.count({ where: { bookingId: booking.id, status: { in: UNRESOLVED } } });
  if (open === 0 && booking.depositStatus === "CLAIM_OPEN") {
    await tx.booking.update({ where: { id: booking.id }, data: { depositStatus: "HELD" } });
  }
}

// POST /bookings/:id/deposit/claims  (owner, during the claim window)
export async function raiseClaim(bookingId, ownerId, { reason, description, amount }) {
  const claim = await prisma.$transaction(async (tx) => {
    const booking = await loadLocked(tx, bookingId);
    if (!booking || (booking.ownerId !== ownerId && booking.renterId !== ownerId)) throw new AppError(404, "Booking not found");
    if (booking.ownerId !== ownerId) throw new AppError(403, "Only the owner can claim from the deposit");
    if (booking.status !== "COMPLETED") throw new AppError(409, "Claims can only be raised after the item is returned");
    if (!["HELD", "CLAIM_OPEN"].includes(booking.depositStatus)) {
      throw new AppError(409, "There is no security deposit held for this booking");
    }
    if (!booking.depositReleaseAt || booking.depositReleaseAt <= new Date()) {
      throw new AppError(409, "The 48-hour claim window for this booking has closed");
    }
    const available = dec(booking.securityDeposit).sub(reservedTotal(booking.depositClaims));
    if (dec(amount).gt(available)) {
      throw new AppError(400, `Claims can't exceed the deposit: at most ₹${fmt(available)} is still available`, {
        amount: `At most ₹${fmt(available)} can be claimed`,
      });
    }
    const created = await tx.depositClaim.create({
      data: { bookingId, raisedById: ownerId, reason, description, amountClaimed: amount },
    });
    await tx.booking.update({ where: { id: bookingId }, data: { depositStatus: "CLAIM_OPEN" } });
    await logEvent(tx, {
      bookingId, claimId: created.id, type: "DEPOSIT_CLAIM_RAISED", source: "USER", actorId: ownerId,
      amount: created.amountClaimed, data: { reason, description },
    });
    await notifyBooking(tx, booking, "DEPOSIT_CLAIM_RAISED", {
      key: `claim:${created.id}`, extra: { amount: created.amountClaimed, reasonText: REASON_TEXT[reason] },
    });
    return created;
  });
  return claim;
}

async function changeClaim(bookingId, claimId, actorId, { allowedFrom, check, data, event, notify, source = "USER" }) {
  const updated = await prisma.$transaction(async (tx) => {
    const booking = await loadLocked(tx, bookingId);
    if (!booking) throw new AppError(404, "Booking not found");
    const claim = booking.depositClaims.find((c) => c.id === claimId);
    if (!claim) throw new AppError(404, "Claim not found");
    check(booking, claim);
    if (!allowedFrom.includes(claim.status)) throw new AppError(409, `This claim is already ${claim.status.toLowerCase()}`);

    const changes = data(booking, claim);
    // Approved deductions may never exceed the deposit, whatever happens.
    if (changes.amountApproved !== undefined) {
      const others = booking.depositClaims.filter((c) => c.id !== claim.id);
      if (approvedTotal(others).add(dec(changes.amountApproved)).gt(dec(booking.securityDeposit))) {
        throw new AppError(400, "Approved deductions can't exceed the security deposit");
      }
    }
    const result = await tx.depositClaim.update({ where: { id: claim.id }, data: changes });
    await reopenHoldIfSettled(tx, booking);
    await logEvent(tx, {
      bookingId, claimId, type: event, source, actorId,
      amount: result.amountApproved ?? result.amountClaimed, data: { from: claim.status, to: result.status, ...changes },
    });
    if (notify) {
      await notifyBooking(tx, booking, notify, {
        key: `claim:${claim.id}`,
        extra: { amount: result.amountClaimed, approved: result.amountApproved ?? ZERO },
      });
    }
    return result;
  });
  // Settling the last claim after the window closed releases the deposit now.
  await releaseDepositIfDue(bookingId);
  return updated;
}

// POST /bookings/:id/deposit/claims/:claimId/accept  (renter)
export const acceptClaim = (bookingId, claimId, renterId) =>
  changeClaim(bookingId, claimId, renterId, {
    allowedFrom: ["OPEN"],
    check: (b) => {
      if (b.renterId !== renterId && b.ownerId !== renterId) throw new AppError(404, "Booking not found");
      if (b.renterId !== renterId) throw new AppError(403, "Only the renter can accept a claim");
    },
    data: (_b, c) => ({ status: "ACCEPTED", amountApproved: c.amountClaimed, resolvedById: renterId, respondedAt: new Date(), resolvedAt: new Date() }),
    event: "DEPOSIT_CLAIM_ACCEPTED",
    notify: "DEPOSIT_CLAIM_ACCEPTED",
  });

// POST /bookings/:id/deposit/claims/:claimId/dispute  (renter)
export const disputeClaim = (bookingId, claimId, renterId, response) =>
  changeClaim(bookingId, claimId, renterId, {
    allowedFrom: ["OPEN"],
    check: (b) => {
      if (b.renterId !== renterId && b.ownerId !== renterId) throw new AppError(404, "Booking not found");
      if (b.renterId !== renterId) throw new AppError(403, "Only the renter can dispute a claim");
    },
    data: () => ({ status: "DISPUTED", renterResponse: response, respondedAt: new Date() }),
    event: "DEPOSIT_CLAIM_DISPUTED",
    notify: "DEPOSIT_CLAIM_DISPUTED",
  });

// POST /bookings/:id/deposit/claims/:claimId/withdraw  (owner)
export const withdrawClaim = (bookingId, claimId, ownerId) =>
  changeClaim(bookingId, claimId, ownerId, {
    allowedFrom: ["OPEN", "DISPUTED"],
    check: (b) => {
      if (b.renterId !== ownerId && b.ownerId !== ownerId) throw new AppError(404, "Booking not found");
      if (b.ownerId !== ownerId) throw new AppError(403, "Only the owner can withdraw a claim");
    },
    data: () => ({ status: "WITHDRAWN", resolvedAt: new Date() }),
    event: "DEPOSIT_CLAIM_WITHDRAWN",
    notify: "DEPOSIT_CLAIM_WITHDRAWN",
  });

// POST /admin/deposit-claims/:id/resolve  (admin only; role checked by the route)
export async function resolveClaim(claimId, adminId, { approvedAmount, note }) {
  const claim = await prisma.depositClaim.findUnique({ where: { id: claimId } });
  if (!claim) throw new AppError(404, "Claim not found");
  return changeClaim(claim.bookingId, claimId, adminId, {
    allowedFrom: ["OPEN", "DISPUTED"],
    check: (_b, c) => {
      if (dec(approvedAmount).gt(dec(c.amountClaimed))) {
        throw new AppError(400, "The approved amount can't be more than was claimed", { approvedAmount: "Can't exceed the claimed amount" });
      }
    },
    data: () => ({
      status: dec(approvedAmount).gt(0) ? "APPROVED" : "REJECTED",
      amountApproved: approvedAmount,
      resolvedById: adminId,
      resolutionNote: note,
      resolvedAt: new Date(),
    }),
    event: "DEPOSIT_CLAIM_RESOLVED",
    notify: "DEPOSIT_CLAIM_RESOLVED",
    source: "ADMIN",
  });
}

// Releases the deposit (minus approved deductions) once the claim window has
// closed and no claim is unresolved. Idempotent; does nothing otherwise.
export async function releaseDepositIfDue(bookingId) {
  let refundId = null;
  await prisma.$transaction(async (tx) => {
    const booking = await loadLocked(tx, bookingId);
    if (!booking || booking.depositStatus !== "HELD") return; // CLAIM_OPEN keeps it held
    if (!booking.depositReleaseAt || booking.depositReleaseAt > new Date()) return;
    const payment = await tx.payment.findUnique({ where: { bookingId } });
    if (payment?.status !== "CAPTURED") return;

    const deducted = approvedTotal(booking.depositClaims);
    const refundAmount = dec(booking.securityDeposit).sub(deducted);
    if (refundAmount.gt(0)) {
      const refund = await createRefundRecord(tx, {
        booking, payment, purpose: "DEPOSIT_RELEASE", amount: refundAmount,
        breakdown: { deposit: fmt(booking.securityDeposit), deducted: fmt(deducted), refunded: fmt(refundAmount) },
        reason: deducted.gt(0) ? "Security deposit returned minus approved deductions" : "Security deposit returned in full",
        initiatedBy: "SYSTEM", idempotencyKey: `deposit:${bookingId}`,
      });
      refundId = refund.id;
      await tx.booking.update({ where: { id: bookingId }, data: { depositStatus: "RELEASE_PENDING" } });
    } else {
      await tx.booking.update({ where: { id: bookingId }, data: { depositStatus: "FORFEITED" } });
    }
    await notifyBooking(tx, booking, "DEPOSIT_RELEASED", { extra: { deducted, refunded: refundAmount } });
    await logEvent(tx, {
      bookingId, paymentId: payment.id, refundId, type: "DEPOSIT_SETTLED", source: "SYSTEM",
      amount: refundAmount, data: { deposit: fmt(booking.securityDeposit), deducted: fmt(deducted), refunded: fmt(refundAmount) },
    });
  });
  if (refundId) await sendRefund(refundId);
}

// Cron/lazy: every held deposit whose claim window has closed.
export async function releaseDueDeposits(limit = 50) {
  const due = await prisma.booking.findMany({
    where: { depositStatus: "HELD", depositReleaseAt: { lte: new Date() } },
    select: { id: true },
    take: limit,
  });
  for (const b of due) await releaseDepositIfDue(b.id);
  return due.length;
}
