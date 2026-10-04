// Profile and listing management: the owner edits, pauses and deletes
// listings; deleted listings disappear everywhere but booking history stays.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, createContext, prisma, slot, requestBooking, payForBooking, notificationsFor } from "./helpers.js";

let api, close, ctx;
let O, R, X;

before(async () => {
  ({ api, close } = await startServer());
  ctx = createContext(api, "listings");
  O = await ctx.registerUser("Owner");
  R = await ctx.registerUser("Renter");
  X = await ctx.registerUser("Outsider");
});

after(async () => {
  await ctx.cleanup();
  await close();
  await prisma.$disconnect();
});

const edit = (user, id, body) => api("PATCH", `/items/${id}`, { token: user?.token, body });
const remove = (user, id) => api("DELETE", `/items/${id}`, { token: user?.token });

test("profile: account details, ratings and totals; name and phone can be edited", async () => {
  const me = await api("GET", "/auth/me", { token: O.token });
  assert.equal(me.status, 200);
  assert.equal(me.data.email, O.email);
  assert.equal(me.data.passwordHash, undefined);
  assert.deepEqual(me.data.ownerRating, { average: null, count: 0 });
  assert.equal(typeof me.data.stats.listings, "number");

  const bad = await api("PATCH", "/auth/me", { token: O.token, body: { phone: "12", email: "x@y.z" } });
  assert.equal(bad.status, 400);
  assert.ok(bad.data.errors.phone || bad.data.errors.email);
  assert.equal((await api("PATCH", "/auth/me", { token: O.token, body: {} })).status, 400);
  assert.equal((await api("PATCH", "/auth/me", { body: { name: "Nobody" } })).status, 401);

  const ok = await api("PATCH", "/auth/me", { token: O.token, body: { name: "  Owner Renamed ", phone: "98765-43210" } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.name, "Owner Renamed");
  assert.equal(ok.data.phone, "9876543210");
  const row = await prisma.user.findUnique({ where: { id: O.id } });
  assert.equal(row.name, "Owner Renamed");
  assert.equal(row.email, O.email);
});

test("owner edits a listing; only the owner, only valid fields; existing bookings keep their price", async () => {
  const item = await ctx.createItem(O, { price: "100", deposit: "500" });
  const pending = (await requestBooking(api, R, item.id, slot(30), 2)).data;

  assert.equal((await edit(X, item.id, { title: "Hijacked" })).status, 403);
  assert.equal((await edit(null, item.id, { title: "Hijacked" })).status, 401);
  assert.equal((await edit(O, 99999999, { title: "Nothing" })).status, 404);

  const invalid = await edit(O, item.id, { pricePerHour: -5, title: "x", ownerId: X.id });
  assert.equal(invalid.status, 400);
  assert.ok(invalid.data.errors.pricePerHour && invalid.data.errors.title && invalid.data.errors.ownerId);
  assert.equal((await edit(O, item.id, {})).status, 400);

  const ok = await edit(O, item.id, {
    title: "Edited Projector",
    description: "Now with an HDMI cable included",
    category: "Electronics",
    location: "Mohali",
    pricePerHour: "250",
    securityDeposit: "1000",
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.title, "Edited Projector");
  assert.equal(String(ok.data.pricePerHour), "250");
  assert.ok(Array.isArray(ok.data.media));

  const row = await prisma.item.findUnique({ where: { id: item.id } });
  assert.equal(row.location, "Mohali");
  assert.equal(row.pricePerHour.toFixed(2), "250.00");
  assert.equal(row.securityDeposit.toFixed(2), "1000.00");
  assert.equal(row.ownerId, O.id);

  // The earlier request keeps the price and deposit it was made with.
  const b = await prisma.booking.findUnique({ where: { id: pending.id } });
  assert.equal(b.pricePerHour.toFixed(2), "100.00");
  assert.equal(b.securityDeposit.toFixed(2), "500.00");
});

test("pausing hides the listing and blocks new requests; resuming restores it", async () => {
  const item = await ctx.createItem(O, { title: "Pausable Tent" });

  assert.equal((await edit(O, item.id, { isAvailable: "no" })).status, 400);
  assert.equal((await edit(O, item.id, { isAvailable: false })).status, 200);

  const list = await api("GET", "/items");
  assert.ok(!list.data.some((i) => i.id === item.id));
  assert.equal((await api("GET", `/items/${item.id}`)).status, 200);
  assert.equal((await requestBooking(api, R, item.id, slot(30), 1)).status, 409);

  const mine = await api("GET", "/items/mine", { token: O.token });
  assert.equal(mine.data.find((i) => i.id === item.id).isAvailable, false);

  assert.equal((await edit(O, item.id, { isAvailable: true })).status, 200);
  assert.ok((await api("GET", "/items")).data.some((i) => i.id === item.id));
  assert.equal((await requestBooking(api, R, item.id, slot(30), 1)).status, 201);
});

test("my listings: own live listings only, with booking counts", async () => {
  const item = await ctx.createItem(O, { title: "Counted Speaker" });
  await ctx.createItem(X, { title: "Someone else's" });
  const b1 = (await requestBooking(api, R, item.id, slot(40), 1)).data;
  await requestBooking(api, R, item.id, slot(44), 1);
  await api("PATCH", `/bookings/${b1.id}/accept`, { token: O.token });

  const mine = await api("GET", "/items/mine", { token: O.token });
  assert.equal(mine.status, 200);
  assert.ok(mine.data.every((i) => i.ownerId === O.id && i.deletedAt === null));
  const entry = mine.data.find((i) => i.id === item.id);
  assert.deepEqual(
    { pending: entry.stats.pendingRequests, upcoming: entry.stats.upcomingOrActive, total: entry.stats.totalBookings },
    { pending: 1, upcoming: 1, total: 2 }
  );
  assert.equal((await api("GET", "/items/mine")).status, 401);
});

test("delete is refused while a booking is accepted or paid", async () => {
  const item = await ctx.createItem(O, { title: "Busy Camera" });
  const b = (await requestBooking(api, R, item.id, slot(50), 2)).data;
  await api("PATCH", `/bookings/${b.id}/accept`, { token: O.token });

  const blocked = await remove(O, item.id);
  assert.equal(blocked.status, 409);
  assert.match(blocked.data.message, /upcoming or ongoing booking/);

  await payForBooking(api, R, b.id);
  assert.equal((await remove(O, item.id)).status, 409);
  const row = await prisma.item.findUnique({ where: { id: item.id } });
  assert.equal(row.deletedAt, null);

  // Once the owner cancels (with a refund), deleting is allowed.
  const cancel = await api("PATCH", `/bookings/${b.id}/cancel`, { token: O.token, body: { reason: "Selling it" } });
  assert.equal(cancel.status, 200);
  assert.equal((await remove(O, item.id)).status, 200);
});

test("delete: soft delete, open requests declined with notification, hidden everywhere, history kept", async () => {
  const item = await ctx.createItem(O, { title: "Old Drill" });
  const p1 = (await requestBooking(api, R, item.id, slot(60), 1)).data;
  const p2 = (await requestBooking(api, X, item.id, slot(60), 2)).data;

  assert.equal((await remove(X, item.id)).status, 403);
  assert.equal((await remove(null, item.id)).status, 401);

  const del = await remove(O, item.id);
  assert.equal(del.status, 200);
  assert.equal(del.data.declinedRequests, 2);

  // The row is kept, marked deleted and unavailable.
  const row = await prisma.item.findUnique({ where: { id: item.id } });
  assert.ok(row.deletedAt);
  assert.equal(row.isAvailable, false);

  for (const id of [p1.id, p2.id]) {
    const b = await prisma.booking.findUnique({ where: { id } });
    assert.equal(b.status, "REJECTED");
    assert.equal(b.itemId, item.id);
  }
  const [n] = await notificationsFor(R.id, { bookingId: p1.id, type: "BOOKING_REJECTED" });
  assert.match(n.message, /removed the listing/);

  // Gone from every public and owner view, and nothing more can be done with it.
  assert.ok(!(await api("GET", "/items")).data.some((i) => i.id === item.id));
  assert.equal((await api("GET", `/items/${item.id}`)).status, 404);
  assert.equal((await api("GET", `/items/${item.id}/availability?from=${slot(1).toISOString()}&to=${slot(100).toISOString()}`)).status, 404);
  assert.ok(!(await api("GET", "/items/mine", { token: O.token })).data.some((i) => i.id === item.id));
  assert.equal((await requestBooking(api, R, item.id, slot(70), 1)).status, 404);
  assert.equal((await edit(O, item.id, { title: "Back again" })).status, 404);
  assert.equal((await remove(O, item.id)).status, 404);
  const sig = await api("POST", "/media/signatures", {
    token: O.token, body: { itemId: item.id, files: [{ mimeType: "image/png", size: 1000 }] },
  });
  assert.equal(sig.status, 404);

  // The renter's history still shows the booking with the item's title.
  const history = await api("GET", "/bookings?as=renter", { token: R.token });
  assert.equal(history.data.find((b) => b.id === p1.id).item.title, "Old Drill");
});

test("the database refuses a deleted listing that is still available", async () => {
  const item = await ctx.createItem(O, { title: "Constraint Check" });
  await assert.rejects(
    prisma.item.update({ where: { id: item.id }, data: { deletedAt: new Date(), isAvailable: true } }),
    /Item_deleted_not_available/
  );
});

test("concurrent delete and booking request never leave a pending request on a deleted listing", async () => {
  const item = await ctx.createItem(O, { title: "Race Bike" });
  const [, del] = await Promise.all([requestBooking(api, R, item.id, slot(80), 1), remove(O, item.id)]);
  assert.equal(del.status, 200);
  const open = await prisma.booking.count({ where: { itemId: item.id, status: "PENDING" } });
  assert.equal(open, 0);
});
