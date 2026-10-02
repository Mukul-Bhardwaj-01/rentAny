// Booking lifecycle, validation, access control and overlap prevention.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, createContext, prisma, slot, requestBooking, shiftBooking, HOUR } from "./helpers.js";

let api, close, ctx;
let O, R1, R2, item, paused;

before(async () => {
  ({ api, close } = await startServer());
  ctx = createContext(api, "bookings");
  O = await ctx.registerUser("Owner");
  R1 = await ctx.registerUser("RenterOne");
  R2 = await ctx.registerUser("RenterTwo");
  item = await ctx.createItem(O, { price: "150.50" });
  paused = await ctx.createItem(O, { price: "99" });
  await prisma.item.update({ where: { id: paused.id }, data: { isAvailable: false } });
});

after(async () => {
  await ctx.cleanup();
  await close();
  await prisma.$disconnect();
});

const book = (renter, itemId, start, hours, note) => requestBooking(api, renter, itemId, start, hours, note);
const patch = (user, id, action, body) => api("PATCH", `/bookings/${id}/${action}`, { token: user.token, body });

test("request validation", async () => {
  let r = await api("POST", "/bookings", { body: {} });
  assert.equal(r.status, 401, "no token");

  r = await api("POST", "/bookings", { token: R1.token, body: {} });
  assert.equal(r.status, 400);
  assert.ok(r.data.errors.itemId && r.data.errors.startTime && r.data.errors.hours);

  for (const h of [0, 73, 2.5, "abc"]) {
    r = await book(R1, item.id, slot(30), h);
    assert.equal(r.status, 400, `hours=${h}`);
    assert.ok(r.data.errors.hours);
  }

  r = await api("POST", "/bookings", { token: R1.token, body: { itemId: item.id, startTime: "2026-10-20T10:00", hours: 2 } });
  assert.equal(r.status, 400, "no timezone");

  r = await api("POST", "/bookings", {
    token: R1.token,
    body: { itemId: item.id, startTime: new Date(slot(30).getTime() + 15e3).toISOString(), hours: 2 },
  });
  assert.equal(r.status, 400, "seconds not zero");

  const tooSoon = new Date(Date.now() + 10 * 60e3);
  tooSoon.setUTCSeconds(0, 0);
  r = await book(R1, item.id, tooSoon, 2);
  assert.equal(r.status, 400);
  assert.match(r.data.errors.startTime, /30 minutes/);

  r = await book(R1, item.id, slot(31 * 24), 2);
  assert.equal(r.status, 400);
  assert.match(r.data.errors.startTime, /30 days/);

  r = await book(R1, item.id, slot(30), 2, "x".repeat(501));
  assert.equal(r.status, 400, "note too long");

  assert.equal((await book(R1, 99999999, slot(30), 2)).status, 404, "unknown item");
  r = await book(O, item.id, slot(30), 2);
  assert.equal(r.status, 400);
  assert.match(r.data.message, /own item/);
  assert.equal((await book(R1, paused.id, slot(30), 2)).status, 409, "paused item");
});

// Shared across the lifecycle tests below (they run in order).
const T = slot(48);
let b1, b2, b3;

test("create request: amount, snapshot, pending requests don't block", async () => {
  let r = await book(R1, item.id, T, 3, "College fest");
  b1 = r.data;
  assert.equal(r.status, 201);
  assert.equal(b1.status, "PENDING");
  assert.equal(new Date(b1.endTime) - new Date(b1.startTime), 3 * HOUR);
  assert.equal(b1.rentalAmount, "451.5");
  assert.equal(b1.pricePerHour, "150.5");

  assert.equal((await book(R1, item.id, new Date(T.getTime() + HOUR), 2)).status, 409, "own duplicate");

  r = await book(R2, item.id, new Date(T.getTime() + HOUR), 3);
  b2 = r.data;
  assert.equal(r.status, 201, "overlapping pending from another renter is allowed");

  r = await book(R2, item.id, new Date(T.getTime() + 10 * HOUR), 2);
  b3 = r.data;
  assert.equal(r.status, 201);

  await prisma.item.update({ where: { id: item.id }, data: { pricePerHour: "500" } });
  r = await api("GET", `/bookings/${b1.id}`, { token: R1.token });
  assert.equal(r.data.rentalAmount, "451.5", "price snapshot unaffected");
  await prisma.item.update({ where: { id: item.id }, data: { pricePerHour: "150.50" } });
});

test("history and access control", async () => {
  let r = await api("GET", "/bookings?as=renter", { token: R1.token });
  assert.equal(r.data.length, 1);
  r = await api("GET", "/bookings?as=owner", { token: O.token });
  assert.equal(r.data.length, 3);
  r = await api("GET", "/bookings", { token: O.token });
  assert.equal(r.data.length, 0, "default is as=renter");
  assert.equal((await api("GET", "/bookings?as=admin", { token: O.token })).status, 400);
  r = await api("GET", "/bookings?as=owner&status=pending", { token: O.token });
  assert.equal(r.data.length, 3);
  assert.equal((await api("GET", "/bookings?status=BOGUS", { token: O.token })).status, 400);
  assert.equal((await api("GET", "/bookings")).status, 401);
  assert.equal((await api("GET", `/bookings/${b1.id}`, { token: R2.token })).status, 404, "non-party");
  r = await api("GET", `/bookings/${b1.id}`, { token: O.token });
  assert.equal(r.data.renter.phone, undefined, "phones hidden while pending");
  assert.equal(r.data.owner.phone, undefined);
  assert.equal((await api("GET", "/bookings/abc", { token: O.token })).status, 400);
  assert.equal((await api("GET", "/bookings/99999999", { token: O.token })).status, 404);
  r = await api("GET", `/items/${item.id}`);
  assert.equal(r.data.owner.phone, undefined, "public item has no owner phone");
});

test("accept: permissions, auto-reject overlapping, contact shared", async () => {
  assert.equal((await patch(R1, b1.id, "accept")).status, 403);
  assert.equal((await patch(R2, b1.id, "accept")).status, 404);
  let r = await patch(O, b1.id, "accept");
  assert.equal(r.status, 200);
  assert.equal(r.data.status, "ACCEPTED");

  const x2 = await prisma.booking.findUnique({ where: { id: b2.id } });
  assert.equal(x2.status, "REJECTED");
  assert.match(x2.responseNote, /accepted/);
  assert.equal((await prisma.booking.findUnique({ where: { id: b3.id } })).status, "PENDING");

  assert.equal((await patch(O, b1.id, "accept")).status, 409, "accept twice");
  assert.equal((await patch(O, b2.id, "accept")).status, 409, "accept auto-rejected");

  r = await api("GET", `/bookings/${b1.id}`, { token: R1.token });
  assert.equal(r.data.owner.phone, "9876500000");
  assert.equal(r.data.renter.phone, "9876500000");
});

test("availability endpoint", async () => {
  let r = await api("GET", `/items/${item.id}/availability`);
  assert.equal(r.status, 200);
  assert.equal(r.data.booked.length, 1);
  assert.equal(r.data.booked[0].startTime, b1.startTime);
  assert.deepEqual(Object.keys(r.data.booked[0]).sort(), ["endTime", "startTime"]);
  assert.equal((await api("GET", `/items/${item.id}/availability?from=nope`)).status, 400);
  const from = encodeURIComponent(new Date().toISOString());
  const to = encodeURIComponent(new Date(Date.now() + 40 * 24 * HOUR).toISOString());
  assert.equal((await api("GET", `/items/${item.id}/availability?from=${from}&to=${to}`)).status, 400);
  assert.equal((await api("GET", "/items/99999999/availability")).status, 404);
});

let b4, b5;
test("overlap rules after acceptance (half-open intervals)", async () => {
  assert.equal((await book(R2, item.id, new Date(T.getTime() + 2 * HOUR), 2)).status, 409);
  let r = await book(R2, item.id, new Date(T.getTime() - 2 * HOUR), 2);
  b4 = r.data;
  assert.equal(r.status, 201, "ends exactly at accepted start");
  r = await book(R2, item.id, new Date(T.getTime() + 3 * HOUR), 1);
  b5 = r.data;
  assert.equal(r.status, 201, "starts exactly at accepted end");
  assert.equal((await patch(O, b4.id, "accept")).status, 200);
  assert.equal((await patch(O, b5.id, "accept")).status, 200);
});

test("reject and cancel rules", async () => {
  let r = await patch(O, b3.id, "reject", { reason: "Item is being serviced" });
  assert.equal(r.status, 200);
  assert.equal(r.data.status, "REJECTED");
  assert.equal(r.data.responseNote, "Item is being serviced");
  assert.equal((await patch(O, b3.id, "reject")).status, 409);

  r = await patch(O, b1.id, "cancel", {});
  assert.equal(r.status, 400);
  assert.ok(r.data.errors.reason);
  r = await patch(O, b1.id, "cancel", { reason: "Projector broke" });
  assert.equal(r.data.status, "CANCELLED");
  assert.equal(r.data.cancelledBy, "OWNER");

  r = await api("GET", `/items/${item.id}/availability`);
  assert.ok(!r.data.booked.some((s) => s.startTime === b1.startTime), "slot freed");

  r = await book(R2, item.id, T, 3);
  const b6 = r.data;
  assert.equal(r.status, 201, "freed slot can be requested");
  assert.equal((await patch(O, b6.id, "cancel", { reason: "x" })).status, 409, "owner can't cancel PENDING");
  r = await patch(R2, b6.id, "cancel");
  assert.equal(r.data.status, "CANCELLED");
  assert.equal(r.data.cancelledBy, "RENTER");
  assert.equal((await patch(R2, b6.id, "cancel")).status, 409);

  r = await patch(R2, b4.id, "cancel", { reason: "Plans changed" });
  assert.equal(r.data.status, "CANCELLED", "renter cancels ACCEPTED");
});

test("handover and return", async () => {
  let r = await patch(O, b5.id, "start");
  assert.equal(r.status, 409);
  assert.match(r.data.message, /1 hour/);

  await shiftBooking(b5.id, 30 * 60e3);
  assert.equal((await patch(R2, b5.id, "start")).status, 403);
  r = await patch(O, b5.id, "start");
  assert.equal(r.data.status, "ACTIVE");
  assert.ok(r.data.startedAt);
  assert.equal((await patch(R2, b5.id, "cancel")).status, 409, "cancel ACTIVE");
  assert.equal((await patch(O, b5.id, "start")).status, 409, "start twice");
  assert.equal((await patch(R2, b5.id, "complete")).status, 403);
  r = await patch(O, b5.id, "complete");
  assert.equal(r.data.status, "COMPLETED");
  assert.equal(r.data.lateByMinutes, 0);
  assert.equal((await patch(O, b5.id, "complete")).status, 409);
  assert.equal((await patch(R2, b5.id, "cancel")).status, 409);
});

test("late return, cancel after start, start after end", async () => {
  const b7 = (await book(R1, item.id, slot(24 * 5), 2)).data;
  await patch(O, b7.id, "accept");
  await shiftBooking(b7.id, -(2 * HOUR + 90 * 60e3), { status: "ACTIVE", startedAt: new Date() });
  let r = await patch(O, b7.id, "complete");
  assert.equal(r.status, 200);
  assert.ok(r.data.lateByMinutes >= 90 && r.data.lateByMinutes <= 91, `late ${r.data.lateByMinutes}`);

  const b8 = (await book(R1, item.id, slot(24 * 6), 2)).data;
  await patch(O, b8.id, "accept");
  await shiftBooking(b8.id, -30 * 60e3);
  r = await patch(R1, b8.id, "cancel");
  assert.equal(r.status, 409);
  assert.match(r.data.message, /already started/);
  await shiftBooking(b8.id, -3 * HOUR);
  r = await patch(O, b8.id, "start");
  assert.equal(r.status, 409);
  assert.match(r.data.message, /ended/);
});

test("unanswered requests expire lazily", async () => {
  const b9 = (await book(R1, item.id, slot(24 * 7), 2)).data;
  await shiftBooking(b9.id, -5 * 60e3);
  const r = await api("GET", "/bookings?as=renter&status=EXPIRED", { token: R1.token });
  assert.ok(r.data.some((b) => b.id === b9.id));
  const a = await patch(O, b9.id, "accept");
  assert.equal(a.status, 409);
  assert.match(a.data.message, /expired/);
});

test("concurrent accepts of overlapping requests: exactly one wins, loser gets 409", async () => {
  for (let round = 0; round < 10; round++) {
    const s = slot(24 * 8 + round * 5);
    const a = (await book(R1, item.id, s, 3)).data;
    const b = (await book(R2, item.id, new Date(s.getTime() + HOUR), 3)).data;
    const results = await Promise.all([patch(O, a.id, "accept"), patch(O, b.id, "accept")]);
    const statuses = results.map((x) => x.status).sort();
    assert.deepEqual(statuses, [200, 409], `round ${round}: ${statuses}`);
  }
  const [{ n }] = await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS n FROM "Booking" a JOIN "Booking" b
      ON a."itemId" = b."itemId" AND a.id < b.id
     AND a.status IN ('ACCEPTED','ACTIVE') AND b.status IN ('ACCEPTED','ACTIVE')
     AND tstzrange(a."startTime", a."endTime", '[)') && tstzrange(b."startTime", b."endTime", '[)')`);
  assert.equal(n, 0, "no overlapping ACCEPTED/ACTIVE bookings in the database");
});

test("database constraints hold even when the API is bypassed", async () => {
  const victim = (await book(R2, item.id, slot(24 * 20), 2)).data;
  await patch(O, victim.id, "accept");
  const sneaky = await prisma.booking.create({
    data: {
      itemId: item.id, renterId: R1.id, ownerId: O.id, hours: 2, pricePerHour: "1", rentalAmount: "2",
      startTime: new Date(victim.startTime), endTime: new Date(victim.endTime),
    },
  });
  await assert.rejects(
    prisma.booking.update({ where: { id: sneaky.id }, data: { status: "ACCEPTED" } }),
    /23P01/,
    "exclusion constraint"
  );
  await assert.rejects(
    prisma.booking.create({
      data: {
        itemId: item.id, renterId: R1.id, ownerId: O.id, hours: 0, pricePerHour: "1", rentalAmount: "0",
        startTime: new Date(), endTime: new Date(),
      },
    }),
    /23514/,
    "CHECK constraints"
  );
});
