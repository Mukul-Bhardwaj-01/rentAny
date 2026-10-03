// Reviews & ratings: only parties to a completed booking, one each,
// renter -> owner/item and owner -> renter, exact averages, notifications.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  startServer, createContext, prisma, slot, requestBooking, payForBooking, shiftBooking, notificationsFor,
} from "./helpers.js";

let api, close, ctx;
let O, R, X, item;

before(async () => {
  ({ api, close } = await startServer());
  ctx = createContext(api, "reviews");
  O = await ctx.registerUser("Owner");
  R = await ctx.registerUser("Renter");
  X = await ctx.registerUser("Outsider");
  item = await ctx.createItem(O, { price: "100" });
});

after(async () => {
  await ctx.cleanup();
  await close();
  await prisma.$disconnect();
});

let offset = 0;
// A booking taken through request -> accept -> pay -> handover -> return.
async function completedBooking(renter = R) {
  offset += 4;
  const b = (await requestBooking(api, renter, item.id, slot(48 + offset), 2)).data;
  await api("PATCH", `/bookings/${b.id}/accept`, { token: O.token });
  await payForBooking(api, renter, b.id);
  await shiftBooking(b.id, 30 * 60e3);
  await api("PATCH", `/bookings/${b.id}/start`, { token: O.token });
  const done = await api("PATCH", `/bookings/${b.id}/complete`, { token: O.token });
  assert.equal(done.data.status, "COMPLETED");
  return b;
}
const review = (user, id, body) => api("POST", `/bookings/${id}/reviews`, { token: user?.token, body });

let b1;
test("reviews are only possible once the rental is completed", async () => {
  offset += 4;
  const pending = (await requestBooking(api, R, item.id, slot(48 + offset), 2)).data;
  let r = await review(R, pending.id, { rating: 5 });
  assert.equal(r.status, 409);
  await api("PATCH", `/bookings/${pending.id}/accept`, { token: O.token });
  await payForBooking(api, R, pending.id);
  assert.equal((await review(R, pending.id, { rating: 5 })).status, 409, "confirmed, not completed");
  await api("PATCH", `/bookings/${pending.id}/cancel`, { token: R.token });
  assert.equal((await review(R, pending.id, { rating: 5 })).status, 409, "cancelled");
});

test("only the renter and owner can review; ratings are validated", async () => {
  b1 = await completedBooking();
  assert.equal((await review(null, b1.id, { rating: 5 })).status, 401);
  assert.equal((await review(X, b1.id, { rating: 5 })).status, 404, "outsider");
  for (const rating of [0, 6, 3.5, "abc", "", null, undefined]) {
    assert.equal((await review(R, b1.id, { rating })).status, 400, `rating ${rating}`);
  }
  assert.equal((await review(R, b1.id, { rating: 4, comment: "x".repeat(1001) })).status, 400, "comment too long");
  assert.equal((await review(R, 99999999, { rating: 4 })).status, 404);
  assert.equal(await prisma.review.count({ where: { bookingId: b1.id } }), 0);
});

test("renter reviews the owner and item; client can't choose who is reviewed", async () => {
  const r = await review(R, b1.id, { rating: "4", comment: "  Worked great, owner was helpful  ", subjectId: X.id, itemId: 1, direction: "OWNER_TO_RENTER" });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.rating, 4);
  assert.equal(r.data.comment, "Worked great, owner was helpful");
  assert.equal(r.data.direction, "RENTER_TO_OWNER");
  assert.deepEqual(r.data.author, { id: R.id, name: "Renter" });

  const row = await prisma.review.findFirst({ where: { bookingId: b1.id } });
  assert.equal(row.subjectId, O.id, "subject derived from the booking, not the body");
  assert.equal(row.itemId, item.id);

  const it = await prisma.item.findUnique({ where: { id: item.id } });
  assert.deepEqual([it.ratingSum, it.ratingCount], [4, 1]);
  const owner = await prisma.user.findUnique({ where: { id: O.id } });
  assert.deepEqual([owner.ownerRatingSum, owner.ownerRatingCount, owner.renterRatingCount], [4, 1, 0]);

  const n = await notificationsFor(O.id, { bookingId: b1.id, type: "REVIEW_RECEIVED" });
  assert.equal(n.length, 1);
  assert.match(n[0].message, /Renter rated you 4\/5/);
  assert.equal((await notificationsFor(R.id, { bookingId: b1.id, type: "REVIEW_RECEIVED" })).length, 0);
});

test("one review per person per booking, even when submitted twice at once", async () => {
  assert.equal((await review(R, b1.id, { rating: 1 })).status, 409);
  const b2 = await completedBooking();
  const results = await Promise.all([review(R, b2.id, { rating: 5 }), review(R, b2.id, { rating: 5 })]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal(await prisma.review.count({ where: { bookingId: b2.id, authorId: R.id } }), 1);
  const it = await prisma.item.findUnique({ where: { id: item.id } });
  assert.deepEqual([it.ratingSum, it.ratingCount], [9, 2], "the losing duplicate didn't change the totals");
});

test("owner reviews the renter; the item's rating is untouched", async () => {
  const r = await review(O, b1.id, { rating: 5 });
  assert.equal(r.status, 201);
  assert.equal(r.data.direction, "OWNER_TO_RENTER");
  assert.equal(r.data.comment, null);
  const row = await prisma.review.findUnique({ where: { id: r.data.id } });
  assert.equal(row.subjectId, R.id);
  assert.equal(row.itemId, null);
  const renter = await prisma.user.findUnique({ where: { id: R.id } });
  assert.deepEqual([renter.renterRatingSum, renter.renterRatingCount, renter.ownerRatingCount], [5, 1, 0]);
  const it = await prisma.item.findUnique({ where: { id: item.id } });
  assert.equal(it.ratingCount, 2);
  assert.equal((await notificationsFor(R.id, { bookingId: b1.id, type: "REVIEW_RECEIVED" })).length, 1);
});

test("booking reviews: both sides visible to the parties only", async () => {
  let r = await api("GET", `/bookings/${b1.id}/reviews`, { token: R.token });
  assert.equal(r.status, 200);
  assert.equal(r.data.canReview, false);
  assert.equal(r.data.mine.rating, 4);
  assert.equal(r.data.theirs.rating, 5);
  assert.equal(r.data.theirs.author.name, "Owner");
  assert.equal((await api("GET", `/bookings/${b1.id}/reviews`, { token: X.token })).status, 404);

  const b3 = await completedBooking();
  r = await api("GET", `/bookings/${b3.id}/reviews`, { token: O.token });
  assert.equal(r.data.canReview, true);
  assert.equal(r.data.mine, null);
});

test("public item and user reviews with exact averages and no private data", async () => {
  let r = await api("GET", `/items/${item.id}/reviews`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.summary, { average: 4.5, count: 2 }, "(4 + 5) / 2");
  assert.equal(r.data.reviews.length, 2);
  assert.ok(r.data.reviews.every((x) => x.direction === "RENTER_TO_OWNER"), "owner->renter reviews aren't item reviews");
  const text = JSON.stringify(r.data);
  assert.ok(!text.includes("@test.local") && !text.includes("9876500000"), "no emails or phones");

  r = await api("GET", `/users/${O.id}/reviews?as=owner`);
  assert.deepEqual(r.data.summary, { average: 4.5, count: 2 });
  r = await api("GET", `/users/${R.id}/reviews?as=renter`);
  assert.deepEqual(r.data.summary, { average: 5, count: 1 });
  assert.equal(r.data.reviews[0].author.name, "Owner");
  assert.equal((await api("GET", `/users/${R.id}/reviews?as=boss`)).status, 400);
  assert.equal((await api("GET", "/users/99999999/reviews")).status, 404);
  assert.equal((await api("GET", "/items/99999999/reviews")).status, 404);

  // Shown where it matters: item page owner rating, booking lists.
  const detail = await api("GET", `/items/${item.id}`);
  assert.equal(detail.data.ratingSum, 9);
  assert.equal(detail.data.owner.ownerRatingCount, 2);
  const list = await api("GET", "/bookings?as=owner", { token: O.token });
  const row = list.data.find((b) => b.id === b1.id);
  assert.equal(row.renter.renterRatingCount, 1);
  assert.equal(row.reviews[0].rating, 5, "owner's own review of this booking");
});

test("the database itself forbids self-reviews and out-of-range ratings", async () => {
  const base = { bookingId: b1.id, authorId: X.id, subjectId: O.id, direction: "RENTER_TO_OWNER", rating: 3 };
  await assert.rejects(prisma.review.create({ data: { ...base, subjectId: X.id } }), /Review_not_self_check|23514/);
  await assert.rejects(prisma.review.create({ data: { ...base, rating: 6 } }), /Review_rating_check|23514/);
});
