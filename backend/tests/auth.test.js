// Registration/login validation, including the required phone number.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { startServer, createContext, prisma, slot, requestBooking } from "./helpers.js";

let api, close, ctx;
let n = 0;

before(async () => {
  ({ api, close } = await startServer());
  ctx = createContext(api, "auth");
});

after(async () => {
  await ctx.cleanup();
  await close();
  await prisma.$disconnect();
});

const email = () => `${ctx.prefix}u${n++}@test.local`;
const register = (fields) =>
  api("POST", "/auth/register", { body: { name: "Phone Test", email: email(), password: "password123", ...fields } });

test("register: empty body lists every required field", async () => {
  const r = await api("POST", "/auth/register", { body: {} });
  assert.equal(r.status, 400);
  for (const f of ["name", "email", "password", "phone"]) assert.ok(r.data.errors[f], f);
});

test("register: invalid or missing phone is rejected and no account is created", async () => {
  const cases = [
    [undefined, /required/],
    ["", /required/],
    ["   ", /required/],
    [null, /required/],
    ["98765abcde", /10–15 digits/],
    ["987654321", /10–15 digits/],
    ["1234567890123456", /10–15 digits/],
    ["----------", /10–15 digits/],
    ["98765+43210", /10–15 digits/],
    [9876543210, /must be text/],
    ["+91 98765 43210 00000", /at most 20/],
  ];
  for (const [phone, re] of cases) {
    const r = await register(phone === undefined ? {} : { phone });
    assert.equal(r.status, 400, `phone=${JSON.stringify(phone)}`);
    assert.match(r.data.errors.phone, re, `phone=${JSON.stringify(phone)}`);
  }
  const created = await prisma.user.count({ where: { email: { startsWith: ctx.prefix.toLowerCase() } } });
  assert.equal(created, 0);
});

test("register: valid phones are accepted and normalized", async () => {
  const cases = [
    ["9876543210", "9876543210"],
    ["98765 43210", "9876543210"],
    ["98765-43210", "9876543210"],
    ["+91 98765 43210", "+919876543210"],
    ["  9876543210  ", "9876543210"],
    ["123456789012345", "123456789012345"],
  ];
  for (const [phone, stored] of cases) {
    const r = await register({ phone });
    assert.equal(r.status, 201, phone);
    const row = await prisma.user.findUnique({ where: { id: r.data.user.id } });
    assert.equal(row.phone, stored);
  }
});

test("register/login: email normalization and duplicate detection", async () => {
  const mixed = `  ${ctx.prefix}MiXed@Test.Local `;
  let r = await api("POST", "/auth/register", {
    body: { name: "Mixed", email: mixed, password: "password123", phone: "9876543210" },
  });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.email, mixed.trim().toLowerCase());
  r = await api("POST", "/auth/register", {
    body: { name: "Dup", email: mixed.trim().toUpperCase(), password: "password123", phone: "9876543210" },
  });
  assert.equal(r.status, 409);
  r = await api("POST", "/auth/login", { body: { email: mixed.trim().toUpperCase(), password: "password123" } });
  assert.equal(r.status, 200);
  assert.ok(r.data.token);
  r = await api("POST", "/auth/login", { body: { email: mixed.trim(), password: "wrongpass1" } });
  assert.equal(r.status, 401);
  assert.equal((await api("POST", "/auth/login", { body: {} })).status, 400);
});

test("existing users without a phone keep working", async () => {
  const legacyEmail = email();
  await prisma.user.create({
    data: { name: "Legacy", email: legacyEmail, passwordHash: await bcrypt.hash("password123", 10), phone: null },
  });
  const login = await api("POST", "/auth/login", { body: { email: legacyEmail, password: "password123" } });
  assert.equal(login.status, 200);
  const legacy = { token: login.data.token };

  const me = await api("GET", "/auth/me", { token: legacy.token });
  assert.equal(me.status, 200);
  assert.equal(me.data.phone, null);

  const item = await ctx.createItem(legacy);
  const renter = await ctx.registerUser("Renter");
  const b = await requestBooking(api, renter, item.id, slot(48), 2);
  assert.equal(b.status, 201);
  assert.equal((await api("PATCH", `/bookings/${b.data.id}/accept`, { token: legacy.token })).status, 200);
  const detail = await api("GET", `/bookings/${b.data.id}`, { token: renter.token });
  assert.equal(detail.data.owner.phone, null);
  assert.equal(detail.data.renter.phone, "9876500000");
});

test("auth/me rejects missing and invalid tokens", async () => {
  assert.equal((await api("GET", "/auth/me")).status, 401);
  assert.equal((await api("GET", "/auth/me", { token: "abc.def.ghi" })).status, 401);
});
