// Builds and stores booking notifications. Always called with the same
// transaction client (`tx`) as the change it describes, so the two are saved
// together or not at all.
import { fmt } from "./money.js";

// Who hears about each event. Recipients are always derived from the booking
// itself, never taken from the request.
const RECIPIENTS = {
  BOOKING_REQUESTED: ["owner"],
  BOOKING_CANCELLED_BY_RENTER: ["owner"],
  BOOKING_ACCEPTED: ["renter"],
  BOOKING_REJECTED: ["renter"],
  BOOKING_AUTO_REJECTED: ["renter"],
  BOOKING_CANCELLED_BY_OWNER: ["renter"],
  BOOKING_EXPIRED: ["renter"],
  BOOKING_STARTED: ["renter"],
  BOOKING_COMPLETED: ["renter"],
  PAYMENT_RECEIVED: ["renter", "owner"],
  PAYMENT_FAILED: ["renter"],
  BOOKING_PAYMENT_EXPIRED: ["renter", "owner"],
  REFUND_INITIATED: ["renter"],
  REFUND_PROCESSED: ["renter"],
  REFUND_FAILED: ["renter"],
  DEPOSIT_CLAIM_RAISED: ["renter"],
  DEPOSIT_CLAIM_ACCEPTED: ["owner"],
  DEPOSIT_CLAIM_DISPUTED: ["owner"],
  DEPOSIT_CLAIM_WITHDRAWN: ["renter"],
  DEPOSIT_CLAIM_RESOLVED: ["renter", "owner"],
  DEPOSIT_RELEASED: ["renter", "owner"],
};

const hoursText = (h) => `${h} hour${h === 1 ? "" : "s"}`;
const when = (date) =>
  new Date(date).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
const rs = (amount) => `₹${fmt(amount)}`;

// Only names, item titles, amounts and times: no phone numbers or other
// private data. `role` is the recipient's side; `x` holds event details.
const TEMPLATES = {
  BOOKING_REQUESTED: (b) => ({
    title: "New booking request",
    message: `${b.renter.name} wants to rent "${b.item.title}" for ${hoursText(b.hours)}.`,
  }),
  BOOKING_ACCEPTED: (b) => ({
    title: "Booking accepted — payment needed",
    message: b.paymentDueAt
      ? `${b.owner.name} accepted your request for "${b.item.title}". Pay ${rs(b.totalPayable)} by ${when(b.paymentDueAt)} to confirm it.`
      : `${b.owner.name} accepted your request for "${b.item.title}".`,
  }),
  BOOKING_REJECTED: (b) => ({
    title: "Booking request declined",
    message: `${b.owner.name} declined your request for "${b.item.title}".`,
  }),
  BOOKING_AUTO_REJECTED: (b) => ({
    title: "Time slot no longer available",
    message: `Your request for "${b.item.title}" was declined because the owner accepted another request for that time.`,
  }),
  BOOKING_CANCELLED_BY_RENTER: (b) => ({
    title: "Booking cancelled by renter",
    message: `${b.renter.name} cancelled their booking for "${b.item.title}".`,
  }),
  BOOKING_CANCELLED_BY_OWNER: (b) => ({
    title: "Booking cancelled by owner",
    message: `${b.owner.name} cancelled your booking for "${b.item.title}".`,
  }),
  BOOKING_EXPIRED: (b) => ({
    title: "Booking request expired",
    message: `Your request for "${b.item.title}" expired because the owner didn't respond before the start time.`,
  }),
  BOOKING_STARTED: (b) => ({
    title: "Rental started",
    message: `${b.owner.name} confirmed the handover of "${b.item.title}". Enjoy!`,
  }),
  BOOKING_COMPLETED: (b) => ({
    title: "Rental completed",
    message: `${b.owner.name} confirmed "${b.item.title}" was returned. Thanks for using RentAny!`,
  }),
  PAYMENT_RECEIVED: (b, role) =>
    role === "owner"
      ? { title: "Booking paid and confirmed", message: `${b.renter.name} paid for "${b.item.title}". The booking is confirmed.` }
      : { title: "Payment received — booking confirmed", message: `We received ${rs(b.totalPayable)} for "${b.item.title}". Your booking is confirmed.` },
  PAYMENT_FAILED: (b, _role, x) => ({
    title: "Payment failed",
    message: `Your payment for "${b.item.title}" didn't go through${x?.reason ? ` (${x.reason})` : ""}. You can try again before the payment deadline.`,
  }),
  BOOKING_PAYMENT_EXPIRED: (b, role) =>
    role === "owner"
      ? { title: "Booking expired — not paid", message: `${b.renter.name} didn't pay for "${b.item.title}" in time, so the booking expired and the slot is free again.` }
      : { title: "Booking expired — not paid", message: `Your booking for "${b.item.title}" expired because payment wasn't completed in time.` },
  REFUND_INITIATED: (b, _role, x) => ({
    title: "Refund initiated",
    message: `A refund of ${rs(x.amount)} for "${b.item.title}" has been initiated (${x.purposeText}).`,
  }),
  REFUND_PROCESSED: (b, _role, x) => ({
    title: "Refund completed",
    message: `Your refund of ${rs(x.amount)} for "${b.item.title}" has been processed.`,
  }),
  REFUND_FAILED: (b, _role, x) => ({
    title: "Refund delayed",
    message: `Your refund of ${rs(x.amount)} for "${b.item.title}" could not be processed yet. We'll retry automatically.`,
  }),
  DEPOSIT_CLAIM_RAISED: (b, _role, x) => ({
    title: "Deposit claim raised",
    message: `${b.owner.name} claimed ${rs(x.amount)} from your deposit for "${b.item.title}" (${x.reasonText}). Please accept or dispute it.`,
  }),
  DEPOSIT_CLAIM_ACCEPTED: (b, _role, x) => ({
    title: "Deposit claim accepted",
    message: `${b.renter.name} accepted your ${rs(x.amount)} claim for "${b.item.title}".`,
  }),
  DEPOSIT_CLAIM_DISPUTED: (b, _role, x) => ({
    title: "Deposit claim disputed",
    message: `${b.renter.name} disputed your ${rs(x.amount)} claim for "${b.item.title}". An admin will review it.`,
  }),
  DEPOSIT_CLAIM_WITHDRAWN: (b, _role, x) => ({
    title: "Deposit claim withdrawn",
    message: `${b.owner.name} withdrew the ${rs(x.amount)} claim on your deposit for "${b.item.title}".`,
  }),
  DEPOSIT_CLAIM_RESOLVED: (b, _role, x) => ({
    title: "Deposit claim resolved",
    message: `An admin reviewed the claim for "${b.item.title}": ${rs(x.approved)} of ${rs(x.amount)} will be deducted from the deposit.`,
  }),
  DEPOSIT_RELEASED: (b, role, x) => ({
    title: "Security deposit settled",
    message:
      role === "owner"
        ? `The deposit for "${b.item.title}" is settled: ${rs(x.deducted)} deducted, ${rs(x.refunded)} returned to ${b.renter.name}.`
        : Number(x.deducted) > 0
          ? `Your deposit for "${b.item.title}" is settled: ${rs(x.deducted)} deducted, ${rs(x.refunded)} will be refunded.`
          : `Your full deposit of ${rs(x.refunded)} for "${b.item.title}" will be refunded.`,
  }),
};

// Notifies everyone who should hear about `type` for each booking.
// `bookings` must include item.title, renter.name and owner.name.
// `key` identifies the event when it can happen more than once per booking
// (e.g. "refund:7", "claim:3"); by default it is the booking itself.
// The (recipientId, dedupeKey) unique index makes a repeated event a no-op.
export async function notifyBookings(tx, bookings, type, { key, extra } = {}) {
  const data = [];
  for (const b of bookings) {
    for (const role of RECIPIENTS[type]) {
      data.push({
        recipientId: role === "owner" ? b.ownerId : b.renterId,
        bookingId: b.id,
        type,
        dedupeKey: `${type}:${key ?? `booking:${b.id}`}`,
        ...TEMPLATES[type](b, role, extra),
      });
    }
  }
  if (data.length > 0) await tx.notification.createMany({ data, skipDuplicates: true });
}

export const notifyBooking = (tx, booking, type, options) => notifyBookings(tx, [booking], type, options);
