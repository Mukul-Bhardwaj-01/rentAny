// Notifications: one per booking event, to the right person, created in the
// same transaction as the booking change, private to their recipient.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  startServer, createContext, prisma, slot, requestBooking, shiftBooking, payForBooking, notificationsFor, HOUR,
} from "./helpers.js";
import { notifyBooking } from "../src/utils/notifications.js";

let api, close, ctx;
let O, R1, R2, X, item;

before(async () => {
  ({ api, close } = await startServer());
  ctx = createContext(api, "notifs");
  O = await ctx.registerUser("Olivia");
  R1 = await ctx.registerUser("Ravi");
  R2 = await ctx.registerUser("Rhea");
  X = await ctx.registerUser("Xavier"); // not involved in any booking
  item = await ctx.createItem(O, { title: "Party Speaker" });
});

after(async () => {
  await ctx.cleanup();
  await close();
  await prisma.$disconnect();
});

const book = (renter, start, hours) => requestBooking(api, renter, item.id, start, hours);
const patch = (user, id, action, body) => api("PATCH", `/bookings/${id}/${action}`, { token: user.token, body });
const typesOf = async (user) => (await notificationsFor(user.id)).map((n) => `${n.type}#${n.bookingId}`);

// Asserts `user` has exactly one notification of `type` for `bookingId`.
async function expectOne(user, type, bookingId) {
  const rows = await notificationsFor(user.id, { type, bookingId });
  assert.equal(rows.length, 1, `${user.name} should have exactly one ${type} for booking ${bookingId}`);
  return rows[0];
}

let b1, b2, b3;

test("request -> owner notified (only the owner)", async () => {
  b1 = (await book(R1, slot(48), 3)).data;
  const n = await expectOne(O, "BOOKING_REQUESTED", b1.id);
  assert.equal(n.title, "New booking request");
  assert.match(n.message, /Ravi wants to rent "Party Speaker" for 3 hours/);
  assert.equal(n.readAt, null);
  assert.deepEqual(await typesOf(R1), [], "renter gets nothing for their own request");
});

test("accept -> renter notified; overlapping requests auto-rejected and notified", async () => {
  b2 = (await book(R2, new Date(new Date(b1.startTime).getTime() + HOUR), 2)).data; // overlaps b1
  b3 = (await book(R2, slot(24 * 6), 2)).data; // does not overlap
  const ownerBefore = (await notificationsFor(O.id)).length;

  assert.equal((await patch(O, b1.id, "accept")).status, 200);

  const accepted = await expectOne(R1, "BOOKING_ACCEPTED", b1.id);
  assert.match(accepted.message, /Olivia accepted your request for "Party Speaker"/);
  await expectOne(R2, "BOOKING_AUTO_REJECTED", b2.id);
  assert.equal((await notificationsFor(R2.id, { bookingId: b3.id })).length, 0, "non-overlapping request untouched");
  assert.equal((await notificationsFor(O.id)).length, ownerBefore, "owner is not notified of their own action");
});

test("reject -> renter notified", async () => {
  assert.equal((await patch(O, b3.id, "reject", { reason: "Being repaired" })).status, 200);
  const n = await expectOne(R2, "BOOKING_REJECTED", b3.id);
  assert.match(n.message, /Olivia declined your request/);
});

test("owner cancels -> renter notified; renter cancels -> owner notified", async () => {
  assert.equal((await patch(O, b1.id, "cancel", { reason: "Speaker broke" })).status, 200);
  await expectOne(R1, "BOOKING_CANCELLED_BY_OWNER", b1.id);

  const b4 = (await book(R1, slot(24 * 7), 2)).data;
  await patch(O, b4.id, "accept");
  assert.equal((await patch(R1, b4.id, "cancel")).status, 200);
  const n = await expectOne(O, "BOOKING_CANCELLED_BY_RENTER", b4.id);
  assert.match(n.message, /Ravi cancelled their booking/);

  // Cancelling a PENDING request also tells the owner.
  const b5 = (await book(R1, slot(24 * 8), 2)).data;
  assert.equal((await patch(R1, b5.id, "cancel")).status, 200);
  await expectOne(O, "BOOKING_CANCELLED_BY_RENTER", b5.id);
});

test("handover and return -> renter notified", async () => {
  const b6 = (await book(R2, slot(24 * 9), 2)).data;
  await patch(O, b6.id, "accept");
  await payForBooking(api, R2, b6.id);
  await shiftBooking(b6.id, 30 * 60e3);
  assert.equal((await patch(O, b6.id, "start")).status, 200);
  await expectOne(R2, "BOOKING_STARTED", b6.id);
  assert.equal((await patch(O, b6.id, "complete")).status, 200);
  const n = await expectOne(R2, "BOOKING_COMPLETED", b6.id);
  assert.match(n.message, /returned/);
});

test("expiry -> renter notified once, triggered by polling", async () => {
  const b7 = (await book(R1, slot(24 * 10), 2)).data;
  await shiftBooking(b7.id, -5 * 60e3);
  // The renter's own poll is enough to expire it and deliver the notification.
  const r = await api("GET", "/notifications", { token: R1.token });
  assert.ok(r.data.notifications.some((n) => n.type === "BOOKING_EXPIRED" && n.bookingId === b7.id));
  assert.equal((await prisma.booking.findUnique({ where: { id: b7.id } })).status, "EXPIRED");
  // Concurrent polls must not duplicate it.
  await Promise.all([1, 2, 3].map(() => api("GET", "/notifications", { token: R1.token })));
  await expectOne(R1, "BOOKING_EXPIRED", b7.id);
});

test("failed or repeated transitions create no extra notifications", async () => {
  const b8 = (await book(R2, slot(24 * 11), 2)).data;
  const before = (await notificationsFor(R2.id)).length;
  assert.equal((await patch(R2, b8.id, "accept")).status, 403, "renter can't accept");
  assert.equal((await patch(X, b8.id, "reject")).status, 404, "outsider can't reject");
  assert.equal((await notificationsFor(R2.id)).length, before);

  // The same accept sent twice at once: one succeeds, one gets 409, one notification.
  const results = await Promise.all([patch(O, b8.id, "accept"), patch(O, b8.id, "accept")]);
  assert.deepEqual(results.map((x) => x.status).sort(), [200, 409]);
  await expectOne(R2, "BOOKING_ACCEPTED", b8.id);

  // Even if notification code ran twice for the same event, the unique index
  // (bookingId, recipientId, type) keeps a single row.
  const full = await prisma.booking.findUnique({
    where: { id: b8.id },
    include: { item: true, renter: true, owner: true },
  });
  await notifyBooking(prisma, full, "BOOKING_ACCEPTED");
  await notifyBooking(prisma, full, "BOOKING_ACCEPTED");
  await expectOne(R2, "BOOKING_ACCEPTED", b8.id);
});

test("booking change is rolled back if its notification can't be saved", async () => {
  const b9 = (await book(R2, slot(24 * 12), 2)).data;
  // Temporarily make every new BOOKING_REJECTED insert fail at the database
  // (NOT VALID: existing rows from earlier tests are not checked).
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "Notification" ADD CONSTRAINT "test_tmp_block_rejected" CHECK ("type" <> 'BOOKING_REJECTED') NOT VALID`
  );
  try {
    const r = await patch(O, b9.id, "reject");
    assert.equal(r.status, 500);
  } finally {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Notification" DROP CONSTRAINT IF EXISTS "test_tmp_block_rejected"`);
  }
  const row = await prisma.booking.findUnique({ where: { id: b9.id } });
  assert.equal(row.status, "PENDING", "booking must not be rejected without its notification");
  assert.equal((await notificationsFor(R2.id, { bookingId: b9.id, type: "BOOKING_REJECTED" })).length, 0);

  // Once the database accepts it again, the same action works normally.
  assert.equal((await patch(O, b9.id, "reject")).status, 200);
  await expectOne(R2, "BOOKING_REJECTED", b9.id);
});

test("every event type was produced, with no private contact data", async () => {
  const all = await prisma.notification.findMany({ where: { recipientId: { in: [O.id, R1.id, R2.id] } } });
  const types = new Set(all.map((n) => n.type));
  for (const t of [
    "BOOKING_REQUESTED", "BOOKING_ACCEPTED", "BOOKING_REJECTED", "BOOKING_AUTO_REJECTED",
    "BOOKING_CANCELLED_BY_RENTER", "BOOKING_CANCELLED_BY_OWNER", "BOOKING_EXPIRED",
    "BOOKING_STARTED", "BOOKING_COMPLETED",
  ]) assert.ok(types.has(t), `missing ${t}`);
  for (const n of all) assert.doesNotMatch(n.message + n.title, /9876500000/, "no phone numbers in notifications");
  assert.deepEqual(await typesOf(X), [], "uninvolved user received nothing");
});

test("GET /notifications: own only, newest first, unread count, safe fields", async () => {
  const r = await api("GET", "/notifications", { token: O.token });
  assert.equal(r.status, 200);
  const own = await notificationsFor(O.id);
  assert.equal(r.data.notifications.length, own.length);
  const ids = r.data.notifications.map((n) => n.id);
  assert.deepEqual(ids, [...ids].sort((a, b) => b - a), "newest first");
  assert.equal(r.data.unreadCount, own.filter((n) => !n.readAt).length);
  assert.deepEqual(
    Object.keys(r.data.notifications[0]).sort(),
    ["bookingId", "bookingRole", "createdAt", "id", "message", "readAt", "title", "type"],
    "no recipientId or booking internals exposed"
  );

  const x = await api("GET", "/notifications", { token: X.token });
  assert.deepEqual(x.data, { notifications: [], unreadCount: 0 });

  const c = await api("GET", "/notifications/unread-count", { token: O.token });
  assert.equal(c.data.unreadCount, r.data.unreadCount);

  const limited = await api("GET", "/notifications?limit=1", { token: O.token });
  assert.equal(limited.data.notifications.length, 1);
  assert.equal(limited.data.notifications[0].id, ids[0]);
  assert.equal((await api("GET", "/notifications?limit=0", { token: O.token })).status, 400);
  assert.equal((await api("GET", "/notifications?limit=51", { token: O.token })).status, 400);
});

test("mark as read: only your own, idempotent", async () => {
  const [mine] = await notificationsFor(R1.id, { readAt: null });
  const [others] = await notificationsFor(O.id, { readAt: null });

  // Another user's notification: 404, and it stays unread.
  let r = await api("PATCH", `/notifications/${others.id}/read`, { token: R1.token });
  assert.equal(r.status, 404);
  assert.equal((await prisma.notification.findUnique({ where: { id: others.id } })).readAt, null);

  const before = (await api("GET", "/notifications/unread-count", { token: R1.token })).data.unreadCount;
  r = await api("PATCH", `/notifications/${mine.id}/read`, { token: R1.token });
  assert.equal(r.status, 200);
  assert.ok(r.data.notification.readAt);
  assert.equal(r.data.unreadCount, before - 1);
  const firstReadAt = r.data.notification.readAt;

  r = await api("PATCH", `/notifications/${mine.id}/read`, { token: R1.token });
  assert.equal(r.status, 200, "marking again is fine");
  assert.equal(r.data.notification.readAt, firstReadAt, "readAt not overwritten");

  assert.equal((await api("PATCH", "/notifications/abc/read", { token: R1.token })).status, 400);
  assert.equal((await api("PATCH", "/notifications/99999999/read", { token: R1.token })).status, 404);
});

test("mark all as read only affects the current user", async () => {
  const ownerUnreadBefore = (await notificationsFor(O.id, { readAt: null })).length;
  assert.ok(ownerUnreadBefore > 0);

  const r = await api("PATCH", "/notifications/read-all", { token: R2.token });
  assert.equal(r.status, 200);
  assert.ok(r.data.updated > 0);
  assert.equal((await notificationsFor(R2.id, { readAt: null })).length, 0);
  assert.equal((await notificationsFor(O.id, { readAt: null })).length, ownerUnreadBefore, "owner untouched");

  const again = await api("PATCH", "/notifications/read-all", { token: R2.token });
  assert.equal(again.data.updated, 0);
});

test("notification endpoints require auth and can't be used to create notifications", async () => {
  assert.equal((await api("GET", "/notifications")).status, 401);
  assert.equal((await api("GET", "/notifications/unread-count")).status, 401);
  assert.equal((await api("PATCH", "/notifications/read-all")).status, 401);
  const forged = await api("POST", "/notifications", {
    token: X.token,
    body: { recipientId: O.id, type: "BOOKING_ACCEPTED", title: "Fake", message: "Fake" },
  });
  assert.equal(forged.status, 404, "no create endpoint exists");
  assert.equal(await prisma.notification.count({ where: { title: "Fake" } }), 0);
});
