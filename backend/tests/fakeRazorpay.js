// In-memory stand-in for the Razorpay API, installed into the app's
// swappable razorpayClient. Behaves like Razorpay for what we use: orders,
// payments (captured/failed/authorized), capture, refunds (with the
// captured-amount ceiling) and lookups. Tests can inject failures.
import crypto from "node:crypto";
import { razorpayClient, RazorpayError, signForTests } from "../src/utils/razorpay.js";

const id = (prefix) => `${prefix}_T${crypto.randomBytes(7).toString("hex")}`;

export const fake = {
  orders: new Map(),
  payments: new Map(),
  refunds: new Map(),
  calls: { createOrder: 0, createRefund: 0, fetchRefunds: 0, capture: 0 },
  // Next createRefund call: "definite" (Razorpay rejects), "uncertain"
  // (network error, nothing created) or "lost-response" (Razorpay creates
  // the refund but our call times out).
  nextRefundFailure: null,
  refundStatus: "processed", // status new refunds get ("pending" to test webhooks)
  orderFailure: null,
  refundDelayMs: 0, // makes createRefund slow, to test concurrent senders

  reset() {
    this.orders.clear();
    this.payments.clear();
    this.refunds.clear();
    this.calls = { createOrder: 0, createRefund: 0, fetchRefunds: 0, capture: 0 };
    this.nextRefundFailure = null;
    this.refundStatus = "processed";
    this.orderFailure = null;
    this.refundDelayMs = 0;
  },

  // Simulates the renter paying in Checkout. Returns what Checkout's handler
  // gives the browser (with a valid signature unless told otherwise).
  pay(orderId, { amount, status = "captured", method = "upi", error } = {}) {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`fake: unknown order ${orderId}`);
    const payment = {
      id: id("pay"),
      entity: "payment",
      order_id: orderId,
      amount: amount ?? order.amount,
      currency: "INR",
      status,
      method,
      captured: status === "captured",
      error_code: status === "failed" ? "BAD_REQUEST_ERROR" : null,
      error_reason: status === "failed" ? "payment_failed" : null,
      error_description: status === "failed" ? error || "Payment was declined by the bank" : null,
      created_at: Math.floor(Date.now() / 1000),
    };
    this.payments.set(payment.id, payment);
    if (status === "captured") order.status = "paid";
    return {
      razorpay_order_id: orderId,
      razorpay_payment_id: payment.id,
      razorpay_signature: signForTests.checkout(orderId, payment.id),
      payment,
    };
  },

  // A signed webhook request body + headers for an event about an entity.
  webhook(event, entity, { eventId = id("evt") } = {}) {
    const key = event.split(".")[0];
    const body = JSON.stringify({
      entity: "event",
      event,
      payload: { [key === "order" ? "payment" : key]: { entity } },
      created_at: Math.floor(Date.now() / 1000),
    });
    return { body, eventId, signature: signForTests.webhook(body) };
  },

  refundedTotal(paymentId) {
    return [...this.refunds.values()].filter((r) => r.payment_id === paymentId && r.status !== "failed").reduce((s, r) => s + r.amount, 0);
  },
};

const notFound = (what) => new RazorpayError(`${what} not found`, { status: 400, code: "BAD_REQUEST_ERROR" });

const impl = {
  async createOrder({ amountPaise, receipt, notes }) {
    fake.calls.createOrder += 1;
    if (fake.orderFailure) throw new RazorpayError("fake order failure", { retryable: true });
    const order = { id: id("order"), entity: "order", amount: amountPaise, currency: "INR", receipt, notes, status: "created" };
    fake.orders.set(order.id, order);
    return { ...order };
  },
  async fetchPayment(paymentId) {
    const p = fake.payments.get(paymentId);
    if (!p) throw notFound("Payment");
    return { ...p };
  },
  async fetchOrderPayments(orderId) {
    return [...fake.payments.values()].filter((p) => p.order_id === orderId).map((p) => ({ ...p }));
  },
  async capturePayment(paymentId, amountPaise) {
    fake.calls.capture += 1;
    const p = fake.payments.get(paymentId);
    if (!p) throw notFound("Payment");
    if (p.status !== "authorized") throw new RazorpayError("This payment has already been captured", { status: 400 });
    if (p.amount !== amountPaise) throw new RazorpayError("Capture amount must match", { status: 400 });
    p.status = "captured";
    p.captured = true;
    return { ...p };
  },
  async createRefund(paymentId, { amountPaise, notes }) {
    fake.calls.createRefund += 1;
    if (fake.refundDelayMs) await new Promise((resolve) => setTimeout(resolve, fake.refundDelayMs));
    const failure = fake.nextRefundFailure;
    fake.nextRefundFailure = null;
    if (failure === "definite") throw new RazorpayError("The refund could not be processed", { status: 400, code: "BAD_REQUEST_ERROR" });
    if (failure === "uncertain") throw new RazorpayError("Could not reach Razorpay: timeout", { retryable: true });

    const p = fake.payments.get(paymentId);
    if (!p || p.status !== "captured") throw notFound("Captured payment");
    if (fake.refundedTotal(paymentId) + amountPaise > p.amount) {
      throw new RazorpayError("The total refund amount is greater than the captured amount", { status: 400 });
    }
    const refund = { id: id("rfnd"), entity: "refund", payment_id: paymentId, amount: amountPaise, currency: "INR", notes, status: fake.refundStatus };
    fake.refunds.set(refund.id, refund);
    if (failure === "lost-response") throw new RazorpayError("Could not reach Razorpay: timeout", { retryable: true });
    return { ...refund };
  },
  async fetchRefunds(paymentId) {
    fake.calls.fetchRefunds += 1;
    return [...fake.refunds.values()].filter((r) => r.payment_id === paymentId).map((r) => ({ ...r }));
  },
  async fetchRefund(paymentId, refundId) {
    const r = fake.refunds.get(refundId);
    if (!r || r.payment_id !== paymentId) throw notFound("Refund");
    return { ...r };
  },
};

export function installFakeRazorpay() {
  Object.assign(razorpayClient, impl);
  return fake;
}
