// Payments: booking snapshot, item deposits, Razorpay orders, verification,
// webhooks, reconciliation, expiry, duplicates, concurrency, audit log.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  startServer, createContext, prisma, fake, slot, requestBooking, payForBooking, shiftBooking, notificationsFor, HOUR,
} from "./helpers.js";
import { toPaise, fromPaise } from "../src/utils/money.js";

let api, close, ctx;
let O, R, R2, X, item, freeItem;

before(async () => {
  ({ api, close } = await startServer());
  ctx = createContext(api, "payments");
  O = await ctx.registerUser("Owner");
  R = await ctx.registerUser("Renter");
  R2 = await ctx.registerUser("RenterTwo");
  X = await ctx.registerUser("Outsider");
  item = await ctx.createItem(O, { price: "150.50", deposit: "1000" });
  freeItem = await ctx.createItem(O, { price: "99", title: "No deposit item" });
});

after(async () => {
  await ctx.cleanup();
  await close();
  await prisma.$disconnect();
});

let offset = 0; // keeps every booking in its own time slot
async function acceptedBooking(renter = R, { hours = 3, startIn = 48, onItem = item } = {}) {
  offset += 4;
  const r = await requestBooking(api, renter, onItem.id, slot(startIn + offset), hours);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const a = await api("PATCH", `/bookings/${r.data.id}/accept`, { token: O.token });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  return a.data;
}
const order = (user, id) => api("POST", `/bookings/${id}/payment/order`, { token: user?.token });
const verify = (user, id, body) => api("POST", `/bookings/${id}/payment/verify`, { token: user?.token, body });
const status = (user, id) => api("GET", `/bookings/${id}/payment`, { token: user.token });
const booking = (id) => prisma.booking.findUnique({ where: { id }, include: { payment: true, refunds: true } });
async function webhook(event, entity, opts = {}) {
  const w = fake.webhook(event, entity, opts);
  const headers = { "Content-Type": "application/json", "x-razorpay-event-id": w.eventId, "x-razorpay-signature": opts.signature ?? w.signature };
  const r = await api("POST", "/payments/webhook", { raw: w.body, headers });
  return { ...r, eventId: w.eventId };
}

// ---------- money ----------
test("money: exact rupee <-> paise conversion, no float errors, no silent rounding", () => {
  assert.equal(toPaise("1500.50"), 150050);
  assert.equal(toPaise(0.29), 29);
  assert.equal(toPaise("0.1"), 10);
  assert.equal(toPaise("49.00"), 4900);
  assert.throws(() => toPaise("1.005"), /fractions of a paisa/);
  assert.equal(fromPaise(150050).toFixed(2), "1500.50");
  assert.throws(() => fromPaise(1.5));
});

// ---------- snapshot + item deposit ----------
test("a booking request snapshots rental, ₹49 fee, deposit, total and policy", async () => {
  const r = await requestBooking(api, R, item.id, slot(300), 3);
  assert.equal(r.status, 201);
  assert.equal(r.data.rentalAmount, "451.5");
  assert.equal(r.data.platformFee, "49");
  assert.equal(r.data.securityDeposit, "1000");
  assert.equal(r.data.totalPayable, "1500.5");
  assert.equal(r.data.policyCode, "STANDARD_V1");

  // Later item changes don't touch it.
  await prisma.item.update({ where: { id: item.id }, data: { pricePerHour: "999", securityDeposit: "5000" } });
  const b = await booking(r.data.id);
  assert.equal(b.totalPayable.toFixed(2), "1500.50");
  await prisma.item.update({ where: { id: item.id }, data: { pricePerHour: "150.50", securityDeposit: "1000" } });

  const f = await requestBooking(api, R, freeItem.id, slot(300), 2);
  assert.equal(f.data.securityDeposit, "0");
  assert.equal(f.data.totalPayable, "247", "99 x 2 + 49");
});

test("item security deposit: owner only, ₹0 to ₹50,000, at most 2 decimals", async () => {
  const patch = (user, value) => api("PATCH", `/items/${item.id}/security-deposit`, { token: user?.token, body: { securityDeposit: value } });
  assert.equal((await patch(R, "10")).status, 403);
  assert.equal((await patch(null, "10")).status, 401);
  for (const bad of ["50000.01", "-1", "10.123", "abc", "", null]) {
    assert.equal((await patch(O, bad)).status, 400, `deposit ${bad}`);
  }
  assert.equal((await patch(O, 50000)).data.securityDeposit, "50000");
  assert.equal((await patch(O, "0")).data.securityDeposit, "0");
  assert.equal((await patch(O, "1000.00")).status, 200);

  const form = new FormData();
  for (const [k, v] of Object.entries({ title: "Too much deposit", description: "Deposit over the limit test", category: "Tools", pricePerHour: "10", location: "Here", securityDeposit: "50001" })) form.append(k, v);
  assert.equal((await api("POST", "/items", { token: O.token, form })).status, 400);
  const json = await api("POST", "/items", { token: O.token, body: { title: "Json item", description: "JSON create with deposit", category: "Tools", pricePerHour: "10", location: "Here", securityDeposit: 250.5 } });
  assert.equal(json.status, 201);
  assert.equal(json.data.securityDeposit, "250.5");
});

// ---------- acceptance + deadline ----------
test("accepting sets a 12-hour payment deadline that never passes the start time", async () => {
  const a = await acceptedBooking(R, { startIn: 600 }); // far from the other tests' slots
  assert.equal(a.status, "ACCEPTED");
  const dueIn = new Date(a.paymentDueAt) - new Date(a.respondedAt);
  assert.equal(dueIn, 12 * HOUR);

  const soon = await requestBooking(api, R, item.id, slot(5), 1);
  const s = await api("PATCH", `/bookings/${soon.data.id}/accept`, { token: O.token });
  assert.equal(new Date(s.data.paymentDueAt).getTime(), new Date(soon.data.startTime).getTime(), "capped at the start");
  await api("PATCH", `/bookings/${soon.data.id}/cancel`, { token: R.token });

  const n = (await notificationsFor(R.id, { bookingId: a.id, type: "BOOKING_ACCEPTED" }))[0];
  assert.match(n.message, /Pay ₹1500\.50 by/);
});

// ---------- orders ----------
test("orders: renter only, accepted bookings only, amount from the server's snapshot", async () => {
  const pending = (await requestBooking(api, R, item.id, slot(400), 3)).data;
  assert.equal((await order(R, pending.id)).status, 409, "not accepted yet");

  const a = await acceptedBooking();
  assert.equal((await order(null, a.id)).status, 401);
  assert.equal((await order(O, a.id)).status, 403, "owner can't pay");
  assert.equal((await order(X, a.id)).status, 404, "outsider");

  const before = fake.calls.createOrder;
  const r = await order(R, a.id);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.amount, 150050, "paise of the snapshot total");
  assert.equal(r.data.currency, "INR");
  assert.match(r.data.keyId, /^rzp_test_/);
  assert.deepEqual(r.data.breakdown, { rentalAmount: "451.50", platformFee: "49.00", securityDeposit: "1000.00", totalPayable: "1500.50" });
  const text = JSON.stringify(r.data);
  assert.ok(!text.includes(process.env.RAZORPAY_KEY_SECRET) && !text.includes(process.env.RAZORPAY_WEBHOOK_SECRET), "no secrets");
  assert.equal(fake.orders.get(r.data.orderId).amount, 150050);

  const again = await order(R, a.id);
  assert.equal(again.data.orderId, r.data.orderId, "order reused");
  assert.equal(fake.calls.createOrder, before + 1);
});

test("concurrent order requests end up with a single order", async () => {
  const a = await acceptedBooking();
  const results = await Promise.all([order(R, a.id), order(R, a.id), order(R, a.id)]);
  assert.ok(results.every((r) => r.status === 200));
  assert.equal(new Set(results.map((r) => r.data.orderId)).size, 1);
  assert.equal(await prisma.payment.count({ where: { bookingId: a.id } }), 1);
});

// ---------- verification ----------
test("verify: forged or mismatched payments never confirm a booking", async () => {
  const a = await acceptedBooking();
  const o = await order(R, a.id);
  const { payment, ...good } = fake.pay(o.data.orderId);

  let r = await verify(R, a.id, { ...good, razorpay_signature: "0".repeat(64) });
  assert.equal(r.status, 400, "bad signature");
  r = await verify(R, a.id, { ...good, razorpay_signature: "zz" });
  assert.equal(r.status, 400, "malformed signature");
  assert.equal((await verify(O, a.id, good)).status, 403);
  assert.equal((await verify(X, a.id, good)).status, 404);

  // A payment from another booking's order, presented for this booking.
  const b = await acceptedBooking();
  const ob = await order(R, b.id);
  const { payment: other } = fake.pay(ob.data.orderId);
  const { signForTests } = await import("../src/utils/razorpay.js");
  r = await verify(R, a.id, { razorpay_order_id: o.data.orderId, razorpay_payment_id: other.id, razorpay_signature: signForTests.checkout(o.data.orderId, other.id) });
  assert.equal(r.status, 400, "payment belongs to a different order");
  r = await verify(R, a.id, { ...good, razorpay_order_id: ob.data.orderId });
  assert.equal(r.status, 400, "order belongs to a different booking");

  assert.equal((await booking(a.id)).status, "ACCEPTED");
  assert.equal((await booking(b.id)).status, "ACCEPTED");
  const logged = await prisma.paymentEvent.count({ where: { bookingId: a.id, type: "CHECKOUT_SIGNATURE_INVALID" } });
  assert.ok(logged >= 1, "forged attempts are audited");
});

test("a failed payment is recorded and can be retried on the same order", async () => {
  const a = await acceptedBooking();
  const o = await order(R, a.id);
  const { payment, ...failed } = fake.pay(o.data.orderId, { status: "failed", error: "Card declined" });
  let r = await verify(R, a.id, failed);
  assert.equal(r.status, 200);
  assert.equal(r.data.bookingStatus, "ACCEPTED");
  assert.equal(r.data.payment.failedAttempts, 1);
  assert.equal(r.data.payment.lastError, "Card declined");
  assert.equal(r.data.canPay, true);

  const retry = await payForBooking(api, R, a.id);
  assert.equal(retry.verify.data.bookingStatus, "CONFIRMED");
  assert.equal(retry.order.data.orderId, o.data.orderId, "same order reused");
});

let paid; // a confirmed booking
test("a verified payment confirms the booking, holds the deposit and shares contacts", async () => {
  const a = await acceptedBooking();
  let detail = await api("GET", `/bookings/${a.id}`, { token: R.token });
  assert.equal(detail.data.owner.phone, undefined, "no phone while unpaid");

  const { verify: r, payment } = await payForBooking(api, R, a.id);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.bookingStatus, "CONFIRMED");
  assert.equal(r.data.payment.status, "CAPTURED");
  assert.equal(r.data.payment.razorpayPaymentId, payment.id);
  assert.equal(r.data.deposit.status, "HELD");

  const b = await booking(a.id);
  assert.ok(b.paidAt);
  assert.equal(b.payment.method, "upi");
  detail = await api("GET", `/bookings/${a.id}`, { token: R.token });
  assert.equal(detail.data.owner.phone, "9876500000", "contacts shared once paid");

  for (const user of [R, O]) assert.equal((await notificationsFor(user.id, { bookingId: a.id, type: "PAYMENT_RECEIVED" })).length, 1);
  const owners = await status(O, a.id);
  assert.equal(owners.data.payment.razorpayPaymentId, undefined, "owner doesn't see payment references");
  const events = await prisma.paymentEvent.findMany({ where: { bookingId: a.id }, orderBy: { id: "asc" } });
  assert.deepEqual(events.map((e) => e.type), ["ORDER_CREATED", "PAYMENT_CAPTURED"]);
  paid = { ...a, payment };
});

test("repeating the verify request changes nothing", async () => {
  const b = await booking(paid.id);
  const checkout = { razorpay_order_id: b.payment.razorpayOrderId, razorpay_payment_id: paid.payment.id, razorpay_signature: (await import("../src/utils/razorpay.js")).signForTests.checkout(b.payment.razorpayOrderId, paid.payment.id) };
  const results = await Promise.all([verify(R, paid.id, checkout), verify(R, paid.id, checkout)]);
  assert.ok(results.every((r) => r.status === 200 && r.data.bookingStatus === "CONFIRMED"));
  assert.equal((await notificationsFor(R.id, { bookingId: paid.id, type: "PAYMENT_RECEIVED" })).length, 1);
  assert.equal((await booking(paid.id)).refunds.length, 0);
  assert.equal((await order(R, paid.id)).status, 409, "can't pay twice");
});

test("unpaid bookings can't be handed over", async () => {
  const a = await acceptedBooking();
  await shiftBooking(a.id, 30 * 60e3);
  const r = await api("PATCH", `/bookings/${a.id}/start`, { token: O.token });
  assert.equal(r.status, 409);
  assert.match(r.data.message, /hasn't paid/);
});

// ---------- webhooks ----------
test("webhook confirms a payment whose browser callback never arrived", async () => {
  const a = await acceptedBooking();
  const o = await order(R, a.id);
  const { payment } = fake.pay(o.data.orderId);
  const r = await webhook("payment.captured", payment);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await booking(a.id)).status, "CONFIRMED");
});

test("webhooks must be signed with the webhook secret", async () => {
  const a = await acceptedBooking();
  const o = await order(R, a.id);
  const { payment } = fake.pay(o.data.orderId);
  assert.equal((await webhook("payment.captured", payment, { signature: "f".repeat(64) })).status, 400);
  assert.equal((await api("POST", "/payments/webhook", { raw: "{}", headers: { "Content-Type": "application/json" } })).status, 400);
  assert.equal((await booking(a.id)).status, "ACCEPTED");
});

test("a correctly signed but forged webhook can't confirm a booking (Razorpay is re-checked)", async () => {
  const a = await acceptedBooking();
  const o = await order(R, a.id);
  // Claims "captured" for a payment Razorpay never saw.
  const forged = { id: "pay_Forged0000001", order_id: o.data.orderId, amount: 150050, currency: "INR", status: "captured", method: "upi" };
  let r = await webhook("payment.captured", forged);
  assert.equal(r.status, 200);
  assert.equal(r.data.status, "ignored");
  // Claims "captured" for a payment that actually failed at Razorpay.
  const { payment: failed } = fake.pay(o.data.orderId, { status: "failed" });
  r = await webhook("payment.captured", { ...failed, status: "captured" });
  assert.equal(r.data.status, "ok");
  const b = await booking(a.id);
  assert.equal(b.status, "ACCEPTED", "still unpaid");
  assert.equal(b.payment.status, "CREATED");
});

test("a redelivered webhook, and order.paid after payment.captured, are processed once", async () => {
  const a = await acceptedBooking();
  const o = await order(R, a.id);
  const { payment } = fake.pay(o.data.orderId);
  const first = await webhook("payment.captured", payment, { eventId: `evt_dup_${a.id}` });
  assert.equal(first.data.status, "ok");
  const again = await webhook("payment.captured", payment, { eventId: `evt_dup_${a.id}` });
  assert.equal(again.status, 200);
  assert.equal(again.data.status, "duplicate");
  const orderPaid = await webhook("order.paid", payment);
  assert.equal(orderPaid.data.status, "ok");

  assert.equal((await booking(a.id)).status, "CONFIRMED");
  assert.equal((await notificationsFor(R.id, { bookingId: a.id, type: "PAYMENT_RECEIVED" })).length, 1);
  assert.equal(await prisma.paymentEvent.count({ where: { razorpayEventId: `evt_dup_${a.id}` } }), 1);
});

test("webhook before the browser callback, and both at the same time", async () => {
  const a = await acceptedBooking();
  const o = await order(R, a.id);
  const { payment, ...checkout } = fake.pay(o.data.orderId);
  await webhook("payment.captured", payment);
  const r = await verify(R, a.id, checkout);
  assert.equal(r.data.bookingStatus, "CONFIRMED");

  const b = await acceptedBooking();
  const ob = await order(R, b.id);
  const p2 = fake.pay(ob.data.orderId);
  const { payment: pay2, ...checkout2 } = p2;
  const both = await Promise.all([verify(R, b.id, checkout2), webhook("payment.captured", pay2), webhook("order.paid", pay2)]);
  assert.ok(both.every((x) => x.status === 200), JSON.stringify(both.map((x) => x.status)));
  assert.equal((await booking(b.id)).status, "CONFIRMED");
  assert.equal((await notificationsFor(R.id, { bookingId: b.id, type: "PAYMENT_RECEIVED" })).length, 1);
  assert.equal((await booking(b.id)).refunds.length, 0, "no spurious refunds");
});

test("a failed-payment webhook notifies the renter once", async () => {
  const a = await acceptedBooking();
  const o = await order(R, a.id);
  const { payment } = fake.pay(o.data.orderId, { status: "failed" });
  await webhook("payment.failed", payment);
  await webhook("payment.failed", payment);
  assert.equal((await notificationsFor(R.id, { bookingId: a.id, type: "PAYMENT_FAILED" })).length, 1);
  assert.equal((await booking(a.id)).payment.failedAttempts, 1, "the same failed attempt is counted once");
});

// ---------- reconciliation + expiry ----------
test("without callback or webhook, checking the status reconciles with Razorpay", async () => {
  const a = await acceptedBooking();
  const o = await order(R, a.id);
  fake.pay(o.data.orderId); // paid at Razorpay; we hear nothing
  const r = await status(R, a.id);
  assert.equal(r.data.bookingStatus, "CONFIRMED");
  assert.equal(await prisma.paymentEvent.count({ where: { bookingId: a.id, type: "PAYMENT_CAPTURED", source: "RECONCILIATION" } }), 1);
});

test("an authorized (not yet captured) payment is captured exactly once", async () => {
  const a = await acceptedBooking();
  const o = await order(R, a.id);
  const { payment, ...checkout } = fake.pay(o.data.orderId, { status: "authorized" });
  const before = fake.calls.capture;
  const r = await verify(R, a.id, checkout);
  assert.equal(r.data.bookingStatus, "CONFIRMED");
  assert.equal(fake.calls.capture, before + 1);
  assert.equal(fake.payments.get(payment.id).status, "captured");
});

test("unpaid bookings expire at the deadline, freeing the slot (lazy check)", async () => {
  const a = await acceptedBooking();
  await order(R, a.id);
  await prisma.booking.update({ where: { id: a.id }, data: { paymentDueAt: new Date(Date.now() - 1000) } });
  await api("GET", "/bookings?as=renter", { token: R.token });
  const b = await booking(a.id);
  assert.equal(b.status, "EXPIRED");
  assert.equal(b.payment.status, "VOIDED");
  for (const user of [R, O]) assert.equal((await notificationsFor(user.id, { bookingId: a.id, type: "BOOKING_PAYMENT_EXPIRED" })).length, 1);
  const avail = await api("GET", `/items/${item.id}/availability`);
  assert.ok(!avail.data.booked.some((s) => s.startTime === a.startTime), "slot freed");
  assert.equal((await order(R, a.id)).status, 409);
});

test("expiry checks Razorpay first: a payment that went through is kept", async () => {
  const a = await acceptedBooking();
  const o = await order(R, a.id);
  fake.pay(o.data.orderId);
  await prisma.booking.update({ where: { id: a.id }, data: { paymentDueAt: new Date(Date.now() - 1000) } });
  await api("GET", "/bookings?as=owner", { token: O.token });
  assert.equal((await booking(a.id)).status, "CONFIRMED");
});

test("a payment that lands after expiry is refunded in full", async () => {
  const a = await acceptedBooking();
  const o = await order(R, a.id);
  await prisma.booking.update({ where: { id: a.id }, data: { paymentDueAt: new Date(Date.now() - 1000) } });
  await api("GET", "/bookings?as=renter", { token: R.token }); // expires (nothing paid yet)
  const { payment } = fake.pay(o.data.orderId);
  await webhook("payment.captured", payment);
  const b = await booking(a.id);
  assert.equal(b.status, "EXPIRED", "not resurrected");
  assert.equal(b.refunds.length, 1);
  assert.equal(b.refunds[0].purpose, "BOOKING_NOT_PAYABLE");
  assert.equal(b.refunds[0].amount.toFixed(2), "1500.50");
  assert.equal(b.refunds[0].status, "PROCESSED");
  assert.equal(fake.refundedTotal(payment.id), 150050);
});

test("a second successful payment on the same order is refunded in full", async () => {
  const b = await booking(paid.id);
  const { payment: second } = fake.pay(b.payment.razorpayOrderId);
  await webhook("payment.captured", second);
  const after = await booking(paid.id);
  assert.equal(after.status, "CONFIRMED");
  const dup = after.refunds.find((r) => r.purpose === "DUPLICATE_PAYMENT");
  assert.equal(dup.razorpayPaymentId, second.id);
  assert.equal(dup.amount.toFixed(2), "1500.50");
  assert.equal(dup.status, "PROCESSED");
  assert.equal(fake.refundedTotal(paid.payment.id), 0, "the real payment is untouched");
});

test("a payment for the wrong amount is refunded and doesn't confirm", async () => {
  const a = await acceptedBooking();
  const o = await order(R, a.id);
  const { payment } = fake.pay(o.data.orderId, { amount: 100 });
  await webhook("payment.captured", payment);
  const b = await booking(a.id);
  assert.notEqual(b.status, "CONFIRMED");
  assert.equal(b.refunds[0].purpose, "BOOKING_NOT_PAYABLE");
  assert.equal(b.refunds[0].amount.toFixed(2), "1.00");
});

// ---------- legacy + config + cron + audit ----------
test("grandfathered pre-payment bookings: nothing to pay, start works, cancel refunds nothing", async () => {
  offset += 4;
  const start = slot(48 + offset);
  const legacy = await prisma.booking.create({
    data: {
      itemId: freeItem.id, renterId: R2.id, ownerId: O.id, startTime: start, endTime: new Date(start.getTime() + 2 * HOUR), hours: 2,
      pricePerHour: "99", rentalAmount: "198", platformFee: "0", securityDeposit: "0", totalPayable: "198", policyCode: "LEGACY", status: "CONFIRMED",
    },
  });
  assert.equal((await order(R2, legacy.id)).status, 409);
  const preview = await api("GET", `/bookings/${legacy.id}/cancellation-preview`, { token: R2.token });
  assert.equal(preview.data.refund.total, "0.00");
  await shiftBooking(legacy.id, 30 * 60e3);
  assert.equal((await api("PATCH", `/bookings/${legacy.id}/start`, { token: O.token })).status, 200);
});

test("payments are disabled (503) when Razorpay keys are missing", async () => {
  const a = await acceptedBooking();
  const saved = process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_ID;
  try {
    assert.equal((await order(R, a.id)).status, 503);
    assert.equal((await status(R, a.id)).data.canPay, false);
  } finally {
    process.env.RAZORPAY_KEY_ID = saved;
  }
});

test("the cron sweep needs its secret", async () => {
  assert.equal((await api("GET", "/internal/payments/sweep")).status, 401);
  assert.equal((await api("GET", "/internal/payments/sweep", { headers: { Authorization: "Bearer wrong" } })).status, 401);
  const r = await api("GET", "/internal/payments/sweep", { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
  assert.equal(r.status, 200);
  assert.equal(r.data.status, "ok");
});

test("the payment audit log is append-only", async () => {
  const ev = await prisma.paymentEvent.findFirst({ where: { bookingId: paid.id } });
  await assert.rejects(prisma.paymentEvent.update({ where: { id: ev.id }, data: { type: "TAMPERED" } }), /append-only/);
  await assert.rejects(prisma.paymentEvent.delete({ where: { id: ev.id } }), /append-only/);
});
