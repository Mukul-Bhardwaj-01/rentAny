// Versioned cancellation/refund rules. Each booking stores the policyCode it
// was made under, so changing the rules later never affects existing bookings.
// The same function produces the preview shown to users and the actual
// refund, so the two can never differ.
import { dec, ZERO } from "./money.js";

export const CURRENT_POLICY = "STANDARD_V1";
// Bookings created before payments existed: nothing was paid, nothing to refund.
export const LEGACY_POLICY = "LEGACY";

const HOUR_MS = 60 * 60 * 1000;

const POLICIES = {
  STANDARD_V1: {
    summary: [
      "Before payment: nothing is charged, so nothing is refunded.",
      "Owner cancels after payment: full refund of rental, platform fee and deposit.",
      "Renter cancels 24 hours or more before the start: full rental and deposit refund; the platform fee is not refunded.",
      "Renter cancels less than 24 hours before the start: 50% of the rental and the full deposit are refunded; the platform fee is not refunded.",
      "The security deposit is always refunded in full on cancellation.",
    ],
    // -> { rental, platformFee, deposit } refunded for a paid booking
    refund(booking, cancelledBy, now) {
      if (cancelledBy === "OWNER") {
        return { rental: booking.rentalAmount, platformFee: booking.platformFee, deposit: booking.securityDeposit };
      }
      const hoursBeforeStart = (new Date(booking.startTime) - now) / HOUR_MS;
      const rentalShare = hoursBeforeStart >= 24 ? dec(1) : dec("0.5");
      return {
        // Rounded down to the paisa so we never refund more than was paid.
        rental: dec(booking.rentalAmount).mul(rentalShare).toDecimalPlaces(2, 1),
        platformFee: ZERO,
        deposit: booking.securityDeposit,
      };
    },
  },
};

export function policySummary(policyCode) {
  if (policyCode === LEGACY_POLICY) return ["This booking was made before online payments; nothing was charged."];
  return POLICIES[policyCode]?.summary ?? [];
}

// What a cancellation by `cancelledBy` ("RENTER" | "OWNER") at `now` would
// refund. `paid` = whether the booking's payment has been captured.
// Returns { rental, platformFee, deposit, total, explanation } (Decimals).
export function computeCancellationRefund(booking, cancelledBy, now, paid) {
  const none = { rental: ZERO, platformFee: ZERO, deposit: ZERO, total: ZERO };
  if (!paid || booking.policyCode === LEGACY_POLICY) {
    return { ...none, explanation: "Nothing has been paid, so there is nothing to refund." };
  }
  const policy = POLICIES[booking.policyCode];
  if (!policy) throw new Error(`Unknown cancellation policy ${booking.policyCode}`);

  const parts = policy.refund(booking, cancelledBy, now);
  const rental = dec(parts.rental);
  const platformFee = dec(parts.platformFee);
  const deposit = dec(parts.deposit);
  const total = rental.add(platformFee).add(deposit);

  let explanation;
  if (cancelledBy === "OWNER") explanation = "The owner cancelled, so everything is refunded.";
  else if (rental.equals(dec(booking.rentalAmount))) {
    explanation = "Cancelled 24 hours or more before the start: rental and deposit refunded; the platform fee is not refundable.";
  } else {
    explanation = "Cancelled less than 24 hours before the start: 50% of the rental and the full deposit are refunded; the platform fee is not refundable.";
  }
  return { rental, platformFee, deposit, total, explanation };
}
