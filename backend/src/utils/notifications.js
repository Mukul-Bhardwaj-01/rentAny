// Builds and stores booking notifications. Always called with the same
// transaction client (`tx`) as the booking change it describes, so the two
// are saved together or not at all.

// Who hears about each event. The recipient is always derived from the
// booking itself, never taken from the request.
const RECIPIENT = {
  BOOKING_REQUESTED: "owner",
  BOOKING_CANCELLED_BY_RENTER: "owner",
  BOOKING_ACCEPTED: "renter",
  BOOKING_REJECTED: "renter",
  BOOKING_AUTO_REJECTED: "renter",
  BOOKING_CANCELLED_BY_OWNER: "renter",
  BOOKING_EXPIRED: "renter",
  BOOKING_STARTED: "renter",
  BOOKING_COMPLETED: "renter",
};

const hoursText = (h) => `${h} hour${h === 1 ? "" : "s"}`;

// Only names, item titles and durations: no phone numbers or other private data.
const TEMPLATES = {
  BOOKING_REQUESTED: (b) => ({
    title: "New booking request",
    message: `${b.renter.name} wants to rent "${b.item.title}" for ${hoursText(b.hours)}.`,
  }),
  BOOKING_ACCEPTED: (b) => ({
    title: "Booking accepted",
    message: `${b.owner.name} accepted your request for "${b.item.title}".`,
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
};

// `bookings` must include item.title, renter.name and owner.name.
export async function notifyBookings(tx, bookings, type) {
  if (bookings.length === 0) return;
  await tx.notification.createMany({
    data: bookings.map((b) => ({
      recipientId: RECIPIENT[type] === "owner" ? b.ownerId : b.renterId,
      bookingId: b.id,
      type,
      ...TEMPLATES[type](b),
    })),
    // The (bookingId, recipientId, type) unique index makes a retried
    // transition a no-op instead of a duplicate notification.
    skipDuplicates: true,
  });
}

export const notifyBooking = (tx, booking, type) => notifyBookings(tx, [booking], type);
