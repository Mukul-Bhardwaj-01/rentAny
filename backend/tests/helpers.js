// Shared helpers for the API tests (run with `npm test` from backend/).
//
// The tests start the real Express app on a random port and talk to the
// database in DATABASE_URL. Every user they create has an email ending in
// "@test.local" with a unique per-run prefix, and cleanup() removes those
// users together with their items, bookings, payments and notifications.
// Razorpay is replaced by an in-memory fake (tests/fakeRazorpay.js).
import "./testEnv.js";
import "../src/config/env.js";
import app from "../src/app.js";
import prisma from "../src/config/prisma.js";
import { installFakeRazorpay } from "./fakeRazorpay.js";

export { prisma };
export const fake = installFakeRazorpay();

export const HOUR = 60 * 60 * 1000;

export async function startServer() {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;

  async function api(method, path, { token, body, form, headers: extraHeaders = {}, raw } = {}) {
    const headers = { ...extraHeaders };
    if (token) headers.Authorization = `Bearer ${token}`;
    let payload;
    if (raw !== undefined) payload = raw;
    else if (form) payload = form;
    else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetch(base + path, { method, headers, body: payload });
    let data = null;
    try {
      data = await res.json();
    } catch {
      // empty or non-JSON body
    }
    return { status: res.status, data };
  }

  // fetch keeps connections alive, which would make server.close() wait forever.
  function close() {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  }

  return { api, close };
}

// Per-file test context: creates users/items and cleans them all up.
export function createContext(api, label) {
  const prefix = `t${Date.now()}${Math.floor(Math.random() * 1000)}.${label}.`;

  async function registerUser(name, { phone = "9876500000" } = {}) {
    const email = `${prefix}${name}@test.local`.toLowerCase();
    const r = await api("POST", "/auth/register", {
      body: { name, email, password: "password123", phone },
    });
    if (r.status !== 201) throw new Error(`register ${name} failed: ${r.status} ${JSON.stringify(r.data)}`);
    return { token: r.data.token, id: r.data.user.id, name, email };
  }

  async function createItem(owner, { price = "150.50", title = "Test Projector", deposit } = {}) {
    const form = new FormData();
    form.append("title", title);
    form.append("description", "Automated test item, please ignore");
    form.append("category", "Electronics");
    form.append("pricePerHour", String(price));
    form.append("location", "Chandigarh");
    if (deposit !== undefined) form.append("securityDeposit", String(deposit));
    const r = await api("POST", "/items", { token: owner.token, form });
    if (r.status !== 201) throw new Error(`create item failed: ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  }

  async function cleanup() {
    const users = await prisma.user.findMany({
      where: { email: { startsWith: prefix.toLowerCase() } },
      select: { id: true },
    });
    const ids = users.map((u) => u.id);
    if (ids.length === 0) return;
    const bookingIds = (
      await prisma.booking.findMany({ where: { OR: [{ renterId: { in: ids } }, { ownerId: { in: ids } }] }, select: { id: true } })
    ).map((b) => b.id);
    // The audit log is append-only; test cleanup explicitly opts out.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL rentany.allow_audit_delete = 'on'");
      await tx.paymentEvent.deleteMany({ where: { OR: [{ bookingId: { in: bookingIds } }, { actorId: { in: ids } }] } });
    });
    await prisma.refund.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.depositClaim.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.review.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.payment.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.notification.deleteMany({ where: { recipientId: { in: ids } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.item.deleteMany({ where: { ownerId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }

  return { prefix, registerUser, createItem, cleanup };
}

// A whole hour (UTC) at least `hoursAhead` from now.
export function slot(hoursAhead) {
  const d = new Date(Date.now() + hoursAhead * HOUR);
  d.setUTCMinutes(0, 0, 0);
  return d;
}

export const requestBooking = (api, renter, itemId, start, hours, note) =>
  api("POST", "/bookings", {
    token: renter.token,
    body: { itemId, startTime: start.toISOString(), hours, ...(note ? { note } : {}) },
  });

// The renter pays for an accepted booking through (fake) Razorpay Checkout
// and the frontend's verify call. Returns the verify response.
export async function payForBooking(api, renter, bookingId, payOptions) {
  const order = await api("POST", `/bookings/${bookingId}/payment/order`, { token: renter.token });
  if (order.status !== 200) throw new Error(`order failed: ${order.status} ${JSON.stringify(order.data)}`);
  const { payment, ...checkout } = fake.pay(order.data.orderId, payOptions);
  const verify = await api("POST", `/bookings/${bookingId}/payment/verify`, { token: renter.token, body: checkout });
  return { order, verify, payment, checkout };
}

// Moves a booking's times relative to now (keeping its length), so
// time-dependent rules can be tested without waiting.
export async function shiftBooking(id, startOffsetMs, extra = {}) {
  const b = await prisma.booking.findUnique({ where: { id } });
  const length = b.endTime - b.startTime;
  const startTime = new Date(Date.now() + startOffsetMs);
  startTime.setUTCSeconds(0, 0);
  await prisma.booking.update({
    where: { id },
    data: { startTime, endTime: new Date(startTime.getTime() + length), ...extra },
  });
}

export const notificationsFor = (userId, where = {}) =>
  prisma.notification.findMany({ where: { recipientId: userId, ...where }, orderBy: { id: "asc" } });
