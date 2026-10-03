// Cancellation refunds (policy STANDARD_V1), refund reliability (failures,
// lost responses, concurrent senders, webhooks), and the security-deposit
// claim workflow (window, limits, accept/dispute, admin, release, cron).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  startServer, createContext, prisma, fake, slot, requestBooking, payForBooking, shiftBooking, notificationsFor, HOUR,
} from "./helpers.js";
import { sendRefund, createRefundRecord } from "../src/utils/payments.js";

let api, close, ctx;
let O, R, X, A, item, freeItem;

before(async () => {
  ({ api, close } = await startServer());
  ctx = createContext(api, "refunds");
  O = await ctx.registerUser("Owner");
  R = await ctx.registerUser("Renter");
  X = await ctx.registerUser("Outsider");
  A = await ctx.registerUser("Admin");
  await prisma.user.update({ where: { id: A.id }, data: { role: "ADMIN" } });
  item = await ctx.createItem(O, { price: "100", deposit: "1000" }); // 3 h: 300 + 49 + 1000 = 1349
  freeItem = await ctx.createItem(O, { price: "100", title: "No deposit" });
});

after(async () => {
  fake.reset();
  await ctx.cleanup();
  await close();
  await prisma.$disconnect();
});

let offset = 0;
async function paidBooking({ hours = 3, startIn = 72, onItem = item } = {}) {
  offset += 4;
  const r = await requestBooking(api, R, onItem.id, slot(startIn + offset), hours);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal((await api("PATCH", `/bookings/${r.data.id}/accept`, { token: O.token })).status, 200);
  const { verify, payment } = await payForBooking(api, R, r.data.id);
  assert.equal(verify.data.bookingStatus, "CONFIRMED", JSON.stringify(verify.data));
  return { id: r.data.id, payment };
}
const cancel = (user, id, reason) => api("PATCH", `/bookings/${id}/cancel`, { token: user.token, body: reason ? { reason } : {} });
const preview = (user, id) => api("GET", `/bookings/${id}/cancellation-preview`, { token: user.token });
const refundsOf = (id) => prisma.refund.findMany({ where: { bookingId: id }, orderBy: { id: "asc" } });
const bookingRow = (id) => prisma.booking.findUnique({ where: { id } });
const sweep = () => api("GET", "/internal/payments/sweep", { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
async function webhook(event, entity) {
  const w = fake.webhook(event, entity);
  return api("POST", "/payments/webhook", {
    raw: w.body,
    headers: { "Content-Type": "application/json", "x-razorpay-event-id": w.eventId, "x-razorpay-signature": w.signature },
  });
}

// ---------- cancellation policy ----------
test("owner cancels after payment: everything refunded (preview = actual)", async () => {
  const b = await paidBooking();
  const p = await preview(O, b.id);
  assert.deepEqual(p.data.refund, { rental: "300.00", platformFee: "49.00", deposit: "1000.00", total: "1349.00" });
  const r = await cancel(O, b.id, "Item broke");
  assert.equal(r.status, 200);
  const [refund] = await refundsOf(b.id);
  assert.equal(refund.purpose, "CANCELLATION");
  assert.equal(refund.amount.toFixed(2), p.data.refund.total);
  assert.deepEqual(refund.breakdown, { rental: "300.00", platformFee: "49.00", deposit: "1000.00" });
  assert.equal(refund.status, "PROCESSED");
  assert.equal(fake.refundedTotal(b.payment.id), 134900);
  assert.equal((await bookingRow(b.id)).depositStatus, "REFUNDED");
  for (const type of ["REFUND_INITIATED", "REFUND_PROCESSED", "BOOKING_CANCELLED_BY_OWNER"]) {
    assert.equal((await notificationsFor(R.id, { bookingId: b.id, type })).length, 1, type);
  }
});

test("renter cancels 24 h+ before start: rental and deposit back, fee kept", async () => {
  const b = await paidBooking();
  const p = await preview(R, b.id);
  assert.deepEqual(p.data.refund, { rental: "300.00", platformFee: "0.00", deposit: "1000.00", total: "1300.00" });
  assert.match(p.data.explanation, /24 hours or more/);
  await cancel(R, b.id);
  const [refund] = await refundsOf(b.id);
  assert.equal(refund.amount.toFixed(2), "1300.00");
  assert.equal(fake.refundedTotal(b.payment.id), 130000);
});

test("renter cancels under 24 h before start: 50% rental + deposit, fee kept", async () => {
  const b = await paidBooking({ hours: 3 });
  await shiftBooking(b.id, 10 * HOUR);
  const p = await preview(R, b.id);
  assert.deepEqual(p.data.refund, { rental: "150.00", platformFee: "0.00", deposit: "1000.00", total: "1150.00" });
  await cancel(R, b.id);
  assert.equal((await refundsOf(b.id))[0].amount.toFixed(2), "1150.00");
});

test("50% of an odd paisa amount is rounded down, never over-refunded", async () => {
  const odd = await ctx.createItem(O, { price: "33.33", title: "Odd price" }); // 1 h rental 33.33
  const b = await paidBooking({ hours: 1, onItem: odd });
  await shiftBooking(b.id, 5 * HOUR);
  const p = await preview(R, b.id);
  assert.equal(p.data.refund.rental, "16.66");
  await cancel(R, b.id);
  assert.equal((await refundsOf(b.id))[0].amount.toFixed(2), "16.66");
});

test("cancelling before payment moves no money and voids the open order", async () => {
  offset += 4;
  const r = await requestBooking(api, R, item.id, slot(72 + offset), 2);
  await api("PATCH", `/bookings/${r.data.id}/accept`, { token: O.token });
  await api("POST", `/bookings/${r.data.id}/payment/order`, { token: R.token });
  const p = await preview(R, r.data.id);
  assert.equal(p.data.refund.total, "0.00");
  await cancel(R, r.data.id);
  assert.equal((await refundsOf(r.data.id)).length, 0);
  assert.equal((await prisma.payment.findUnique({ where: { bookingId: r.data.id } })).status, "VOIDED");
});

test("a payment captured just after cancellation is refunded in full", async () => {
  offset += 4;
  const r = await requestBooking(api, R, item.id, slot(72 + offset), 2);
  await api("PATCH", `/bookings/${r.data.id}/accept`, { token: O.token });
  const o = await api("POST", `/bookings/${r.data.id}/payment/order`, { token: R.token });
  await cancel(R, r.data.id);
  const { payment } = fake.pay(o.data.orderId);
  await webhook("payment.captured", payment);
  const [refund] = await refundsOf(r.data.id);
  assert.equal(refund.purpose, "BOOKING_NOT_PAYABLE");
  assert.equal(refund.amount.toFixed(2), "1249.00", "200 + 49 + 1000");
  assert.equal((await bookingRow(r.data.id)).status, "CANCELLED");
});

// ---------- refund reliability ----------
test("a rejected refund is marked failed, the renter told, and the sweep retries it", async () => {
  const b = await paidBooking();
  fake.nextRefundFailure = "definite";
  await cancel(O, b.id, "Unavailable");
  let [refund] = await refundsOf(b.id);
  assert.equal(refund.status, "FAILED");
  assert.equal((await notificationsFor(R.id, { bookingId: b.id, type: "REFUND_FAILED" })).length, 1);

  await sweep();
  [refund] = await refundsOf(b.id);
  assert.equal(refund.status, "PROCESSED");
  assert.equal(fake.refundedTotal(b.payment.id), 134900, "refunded exactly once");
});

test("a lost Razorpay response never leads to a second refund", async () => {
  const b = await paidBooking();
  fake.nextRefundFailure = "lost-response"; // Razorpay creates it, we time out
  await cancel(O, b.id, "Unavailable");
  let [refund] = await refundsOf(b.id);
  assert.equal(refund.status, "REQUESTED", "outcome unknown");
  const createsBefore = fake.calls.createRefund;
  await sweep();
  [refund] = await refundsOf(b.id);
  assert.equal(refund.status, "PROCESSED");
  assert.equal(fake.calls.createRefund, createsBefore, "found the existing refund instead of creating another");
  assert.equal(fake.refundedTotal(b.payment.id), 134900);
});

test("two processes sending the same refund at once create it only once", async () => {
  const b = await paidBooking();
  fake.nextRefundFailure = "uncertain"; // leave the refund unsent
  await cancel(O, b.id, "Unavailable");
  const [refund] = await refundsOf(b.id);
  await prisma.refund.update({ where: { id: refund.id }, data: { lockedUntil: null } });
  fake.refundDelayMs = 300;
  const before = fake.calls.createRefund;
  try {
    await Promise.all([sendRefund(refund.id), sendRefund(refund.id), sweep()]);
  } finally {
    fake.refundDelayMs = 0;
  }
  assert.ok(fake.calls.createRefund - before <= 1, `created ${fake.calls.createRefund - before} times`);
  assert.equal(fake.refundedTotal(b.payment.id), 134900);
});

test("refund status from webhooks: pending -> processed, redelivery harmless", async () => {
  const b = await paidBooking();
  fake.refundStatus = "pending";
  try {
    await cancel(O, b.id, "Unavailable");
  } finally {
    fake.refundStatus = "processed";
  }
  let [refund] = await refundsOf(b.id);
  assert.equal(refund.status, "PENDING");
  const rz = fake.refunds.get(refund.razorpayRefundId);
  rz.status = "processed";
  assert.equal((await webhook("refund.processed", rz)).status, 200);
  await webhook("refund.processed", rz);
  [refund] = await refundsOf(b.id);
  assert.equal(refund.status, "PROCESSED");
  assert.equal((await notificationsFor(R.id, { bookingId: b.id, type: "REFUND_PROCESSED" })).length, 1);
});

test("refunds can never exceed what was paid", async () => {
  const b = await paidBooking();
  const row = await prisma.booking.findUnique({ where: { id: b.id }, include: { item: true, renter: true, owner: true } });
  const payment = await prisma.payment.findUnique({ where: { bookingId: b.id } });
  await assert.rejects(
    prisma.$transaction((tx) =>
      createRefundRecord(tx, {
        booking: row, payment, purpose: "ADMIN_ADJUSTMENT", amount: "1349.01", breakdown: {}, reason: "test",
        initiatedBy: "ADMIN", idempotencyKey: `test-over:${b.id}`,
      })
    ),
    /exceed/
  );
});

// ---------- deposit claims ----------
async function completedBooking(opts) {
  const b = await paidBooking(opts);
  await shiftBooking(b.id, 30 * 60e3);
  assert.equal((await api("PATCH", `/bookings/${b.id}/start`, { token: O.token })).status, 200);
  assert.equal((await api("PATCH", `/bookings/${b.id}/complete`, { token: O.token })).status, 200);
  return b;
}
const claim = (user, id, body) => api("POST", `/bookings/${id}/deposit/claims`, { token: user.token, body });
const claimAction = (user, id, claimId, action, body) =>
  api("POST", `/bookings/${id}/deposit/claims/${claimId}/${action}`, { token: user.token, body });
const closeWindow = (id) => prisma.booking.update({ where: { id }, data: { depositReleaseAt: new Date(Date.now() - 1000) } });

test("after return the deposit is held for a 48-hour claim window", async () => {
  const b = await completedBooking();
  const row = await bookingRow(b.id);
  assert.equal(row.depositStatus, "HELD");
  const windowMs = row.depositReleaseAt - row.returnedAt;
  assert.ok(Math.abs(windowMs - 48 * HOUR) < 2000);
  const s = await api("GET", `/bookings/${b.id}/payment`, { token: O.token });
  assert.equal(s.data.deposit.canClaim, true);
  assert.equal(s.data.deposit.available, "1000.00");
});

test("claims: owner only, valid reason/description/amount, within the deposit", async () => {
  const b = await completedBooking();
  const good = { reason: "DAMAGE", description: "Scratched lens cover", amount: "300" };
  assert.equal((await claim(R, b.id, good)).status, 403, "renter can't claim");
  assert.equal((await claim(X, b.id, good)).status, 404);
  assert.equal((await claim(O, b.id, { ...good, reason: "GREED" })).status, 400);
  assert.equal((await claim(O, b.id, { ...good, description: "bad" })).status, 400);
  for (const amount of ["0", "-5", "10.555", "1000.01"]) {
    assert.equal((await claim(O, b.id, { ...good, amount })).status, 400, `amount ${amount}`);
  }
  const a = await claim(O, b.id, good);
  assert.equal(a.status, 201);
  assert.equal(a.data.deposit.status, "CLAIM_OPEN");
  assert.equal((await claim(O, b.id, { ...good, amount: "500" })).status, 201);
  const over = await claim(O, b.id, { ...good, amount: "200.01" });
  assert.equal(over.status, 400, "300 + 500 + 200.01 > 1000");
  assert.match(over.data.message, /₹200\.00/);
  assert.equal((await notificationsFor(R.id, { bookingId: b.id, type: "DEPOSIT_CLAIM_RAISED" })).length, 2);
});

test("full claim workflow: accept, dispute, admin decision, partial refund", async () => {
  const b = await completedBooking();
  const c1 = (await claim(O, b.id, { reason: "DAMAGE", description: "Cracked casing on the side", amount: "300" })).data.claimId;
  const c2 = (await claim(O, b.id, { reason: "LATE_RETURN", description: "Returned two hours late", amount: "500" })).data.claimId;

  assert.equal((await claimAction(O, b.id, c1, "accept")).status, 403, "owner can't accept own claim");
  let r = await claimAction(R, b.id, c1, "accept");
  assert.equal(r.status, 200);
  assert.equal(r.data.deposit.claims.find((c) => c.id === c1).amountApproved, "300.00");
  assert.equal(r.data.deposit.status, "CLAIM_OPEN", "c2 still open");
  assert.equal((await claimAction(R, b.id, c1, "accept")).status, 409, "already accepted");

  assert.equal((await claimAction(R, b.id, c2, "dispute", { response: "no" })).status, 400, "response too short");
  r = await claimAction(R, b.id, c2, "dispute", { response: "It was returned on time" });
  assert.equal(r.data.deposit.claims.find((c) => c.id === c2).status, "DISPUTED");
  assert.equal((await notificationsFor(O.id, { bookingId: b.id, type: "DEPOSIT_CLAIM_DISPUTED" })).length, 1);

  // Window closes, but the dispute keeps the whole deposit held.
  await closeWindow(b.id);
  await sweep();
  assert.equal((await bookingRow(b.id)).depositStatus, "CLAIM_OPEN");
  assert.equal((await refundsOf(b.id)).length, 0);

  // Only an admin resolves; never above the claim or the deposit.
  const resolve = (user, body) => api("POST", `/admin/deposit-claims/${c2}/resolve`, { token: user.token, body });
  assert.equal((await resolve(O, { approvedAmount: "200", note: "Partial approval" })).status, 403, "owner isn't admin");
  assert.equal((await resolve(R, { approvedAmount: "0", note: "Reject this one" })).status, 403);
  assert.equal((await resolve(A, { approvedAmount: "500.01", note: "Too much approved" })).status, 400);
  const list = await api("GET", "/admin/deposit-claims?status=DISPUTED", { token: A.token });
  assert.ok(list.data.some((c) => c.id === c2));
  assert.equal((await api("GET", "/admin/deposit-claims", { token: R.token })).status, 403);

  r = await resolve(A, { approvedAmount: "200", note: "Late by one hour, not two" });
  assert.equal(r.status, 200);
  assert.equal(r.data.status, "APPROVED");

  // Nothing unresolved and window closed: released right away.
  const row = await bookingRow(b.id);
  assert.equal(row.depositStatus, "PARTIALLY_REFUNDED");
  const [refund] = await refundsOf(b.id);
  assert.equal(refund.purpose, "DEPOSIT_RELEASE");
  assert.equal(refund.amount.toFixed(2), "500.00", "1000 - 300 - 200");
  assert.equal(fake.refundedTotal(b.payment.id), 50000);
  for (const user of [R, O]) assert.equal((await notificationsFor(user.id, { bookingId: b.id, type: "DEPOSIT_RELEASED" })).length, 1);
  assert.equal((await notificationsFor(R.id, { bookingId: b.id, type: "DEPOSIT_CLAIM_RESOLVED" })).length, 1);

  // Settled: nothing more can happen.
  await sweep();
  assert.equal((await refundsOf(b.id)).length, 1);
  assert.equal(fake.refundedTotal(b.payment.id), 50000);
  const audit = await prisma.paymentEvent.findMany({ where: { bookingId: b.id }, select: { type: true } });
  for (const t of ["DEPOSIT_CLAIM_RAISED", "DEPOSIT_CLAIM_ACCEPTED", "DEPOSIT_CLAIM_DISPUTED", "DEPOSIT_CLAIM_RESOLVED", "DEPOSIT_SETTLED", "REFUND_PROCESSED"]) {
    assert.ok(audit.some((e) => e.type === t), `audit has ${t}`);
  }
});

test("no claims: the full deposit is released by the cron after the window", async () => {
  const b = await completedBooking();
  await sweep();
  assert.equal((await bookingRow(b.id)).depositStatus, "HELD", "window still open");
  await closeWindow(b.id);
  const r = await sweep();
  assert.ok(r.data.depositsReleased >= 1);
  assert.equal((await bookingRow(b.id)).depositStatus, "REFUNDED");
  assert.equal((await refundsOf(b.id))[0].amount.toFixed(2), "1000.00");
});

test("the deposit page itself releases a due deposit (lazy fallback)", async () => {
  const b = await completedBooking();
  await closeWindow(b.id);
  const s = await api("GET", `/bookings/${b.id}/payment`, { token: R.token });
  assert.equal(s.data.deposit.status, "REFUNDED");
});

test("a fully deducted deposit is forfeited, with no refund", async () => {
  const b = await completedBooking();
  const c = (await claim(O, b.id, { reason: "MISSING_PARTS", description: "Charger and case missing", amount: "1000" })).data.claimId;
  await claimAction(R, b.id, c, "accept");
  await closeWindow(b.id);
  await sweep();
  assert.equal((await bookingRow(b.id)).depositStatus, "FORFEITED");
  assert.equal((await refundsOf(b.id)).length, 0);
});

test("withdrawn claims deduct nothing; claims after the window are refused", async () => {
  const b = await completedBooking();
  const c = (await claim(O, b.id, { reason: "OTHER", description: "Thought it was dirty", amount: "100" })).data.claimId;
  assert.equal((await claimAction(R, b.id, c, "withdraw")).status, 403, "only the owner withdraws");
  assert.equal((await claimAction(O, b.id, c, "withdraw")).status, 200);
  assert.equal((await bookingRow(b.id)).depositStatus, "HELD");
  await closeWindow(b.id);
  const late = await claim(O, b.id, { reason: "DAMAGE", description: "Found a dent much later", amount: "50" });
  assert.equal(late.status, 409);
  assert.match(late.data.message, /window/);
});

test("late returns get a suggested (never automatic) claim amount", async () => {
  const b = await paidBooking({ hours: 2 });
  await shiftBooking(b.id, -(2 * HOUR + 90 * 60e3), { status: "ACTIVE", startedAt: new Date() }); // ended 90 min ago
  await api("PATCH", `/bookings/${b.id}/complete`, { token: O.token });
  const s = await api("GET", `/bookings/${b.id}/payment`, { token: O.token });
  assert.equal(s.data.deposit.suggestedLateFee, "200.00", "2 late hours (rounded up) x ₹100");
  assert.equal(s.data.deposit.claims.length, 0, "nothing deducted automatically");
  const renterView = await api("GET", `/bookings/${b.id}/payment`, { token: R.token });
  assert.equal(renterView.data.deposit.suggestedLateFee, null);
});

test("no deposit, no claims", async () => {
  const b = await completedBooking({ onItem: freeItem });
  assert.equal((await bookingRow(b.id)).depositStatus, "NOT_COLLECTED");
  const r = await claim(O, b.id, { reason: "DAMAGE", description: "Scratched surface badly", amount: "10" });
  assert.equal(r.status, 409);
});
