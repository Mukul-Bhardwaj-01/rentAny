import { Prisma } from "@prisma/client";
import prisma from "../config/prisma.js";
import { AppError } from "../utils/AppError.js";
import { notifyBooking } from "../utils/notifications.js";

// What anyone may see of a review: no emails, phones or booking details.
const reviewSelect = {
  id: true,
  rating: true,
  comment: true,
  direction: true,
  createdAt: true,
  author: { select: { id: true, name: true } },
};

// Exact average from stored totals, rounded to one decimal for display.
export const ratingSummary = (sum, count) => ({
  average: count > 0 ? Math.round((sum / count) * 10) / 10 : null,
  count,
});

// POST /api/bookings/:id/reviews  (renter or owner of a COMPLETED booking)
// The renter reviews the owner and the item; the owner reviews the renter.
// One review per person per booking. Who is reviewed is never taken from
// the request.
export async function createReview(req, res) {
  const booking = await prisma.booking.findUnique({
    where: { id: req.params.id },
    include: { item: { select: { id: true, title: true } }, renter: { select: { id: true, name: true } }, owner: { select: { id: true, name: true } } },
  });
  if (!booking || (booking.renterId !== req.userId && booking.ownerId !== req.userId)) {
    throw new AppError(404, "Booking not found");
  }
  if (booking.status !== "COMPLETED") {
    throw new AppError(409, "You can leave a review once the rental is completed");
  }

  const isRenter = booking.renterId === req.userId;
  const direction = isRenter ? "RENTER_TO_OWNER" : "OWNER_TO_RENTER";
  const subjectId = isRenter ? booking.ownerId : booking.renterId;
  if (subjectId === req.userId) throw new AppError(400, "You can't review yourself");
  const { rating, comment } = req.body;

  let review;
  try {
    review = await prisma.$transaction(async (tx) => {
      const created = await tx.review.create({
        data: {
          bookingId: booking.id,
          authorId: req.userId,
          subjectId,
          itemId: isRenter ? booking.itemId : null,
          direction,
          rating,
          comment,
        },
        select: reviewSelect,
      });
      // Running totals, updated atomically with the review itself.
      if (isRenter) {
        await tx.item.update({
          where: { id: booking.itemId },
          data: { ratingSum: { increment: rating }, ratingCount: { increment: 1 } },
        });
        await tx.user.update({
          where: { id: subjectId },
          data: { ownerRatingSum: { increment: rating }, ownerRatingCount: { increment: 1 } },
        });
      } else {
        await tx.user.update({
          where: { id: subjectId },
          data: { renterRatingSum: { increment: rating }, renterRatingCount: { increment: 1 } },
        });
      }
      await notifyBooking(tx, booking, "REVIEW_RECEIVED", {
        key: `review:${created.id}`,
        roles: [isRenter ? "owner" : "renter"],
        extra: { authorName: req.userId === booking.renterId ? booking.renter.name : booking.owner.name, rating },
      });
      return created;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new AppError(409, "You have already reviewed this booking");
    }
    throw err;
  }

  res.status(201).json(review);
}

// GET /api/bookings/:id/reviews  (renter or owner)
// Both parties' reviews for this booking, and whether the caller can still write one.
export async function getBookingReviews(req, res) {
  const booking = await prisma.booking.findUnique({ where: { id: req.params.id }, select: { id: true, status: true, renterId: true, ownerId: true } });
  if (!booking || (booking.renterId !== req.userId && booking.ownerId !== req.userId)) {
    throw new AppError(404, "Booking not found");
  }
  const reviews = await prisma.review.findMany({
    where: { bookingId: booking.id },
    select: { ...reviewSelect, authorId: true },
    orderBy: { createdAt: "asc" },
  });
  const mine = reviews.find((r) => r.authorId === req.userId) || null;
  const theirs = reviews.find((r) => r.authorId !== req.userId) || null;
  const strip = (r) => r && (({ authorId, ...rest }) => rest)(r);
  res.json({
    canReview: booking.status === "COMPLETED" && !mine,
    role: booking.renterId === req.userId ? "renter" : "owner",
    mine: strip(mine),
    theirs: strip(theirs),
  });
}

// GET /api/items/:id/reviews  (public) — renters' reviews of this item.
export async function getItemReviews(req, res) {
  const item = await prisma.item.findUnique({ where: { id: req.params.id }, select: { id: true, ratingSum: true, ratingCount: true } });
  if (!item) throw new AppError(404, "Item not found");
  const reviews = await prisma.review.findMany({
    where: { itemId: item.id, direction: "RENTER_TO_OWNER" },
    select: reviewSelect,
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json({ summary: ratingSummary(item.ratingSum, item.ratingCount), reviews });
}

// GET /api/users/:id/reviews?as=owner|renter  (public)
// Reviews a user received as an owner (from renters) or as a renter (from owners).
export async function getUserReviews(req, res) {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: { id: true, name: true, ownerRatingSum: true, ownerRatingCount: true, renterRatingSum: true, renterRatingCount: true },
  });
  if (!user) throw new AppError(404, "User not found");
  const asOwner = req.query.as === "owner";
  const reviews = await prisma.review.findMany({
    where: { subjectId: user.id, direction: asOwner ? "RENTER_TO_OWNER" : "OWNER_TO_RENTER" },
    select: { ...reviewSelect, item: { select: { id: true, title: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json({
    user: { id: user.id, name: user.name },
    as: req.query.as,
    summary: asOwner
      ? ratingSummary(user.ownerRatingSum, user.ownerRatingCount)
      : ratingSummary(user.renterRatingSum, user.renterRatingCount),
    reviews,
  });
}
