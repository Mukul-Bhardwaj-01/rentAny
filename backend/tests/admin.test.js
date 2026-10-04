// Admin panel support: the user's role reaches the client, and the read-only
// admin overview is admin-only and exposes no private data.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, createContext, prisma } from "./helpers.js";

let api, close, ctx;
let U, A;

before(async () => {
  ({ api, close } = await startServer());
  ctx = createContext(api, "admin");
  U = await ctx.registerUser("Plain");
  A = await ctx.registerUser("Boss");
  await prisma.user.update({ where: { id: A.id }, data: { role: "ADMIN" } });
  await ctx.createItem(U, { title: "Admin overview item" });
});

after(async () => {
  await ctx.cleanup();
  await close();
  await prisma.$disconnect();
});

test("the user's role is returned by register, login and /auth/me", async () => {
  const reg = await api("POST", "/auth/register", {
    body: { name: "Fresh", email: `${ctx.prefix}fresh@test.local`, password: "password123", phone: "9876500000" },
  });
  assert.equal(reg.data.user.role, "USER");
  const login = await api("POST", "/auth/login", { body: { email: A.email, password: "password123" } });
  assert.equal(login.data.user.role, "ADMIN");
  assert.equal((await api("GET", "/auth/me", { token: U.token })).data.role, "USER");
  assert.equal((await api("GET", "/auth/me", { token: A.token })).data.role, "ADMIN");
});

test("admin overview: admins only", async () => {
  assert.equal((await api("GET", "/admin/overview")).status, 401);
  assert.equal((await api("GET", "/admin/overview", { token: U.token })).status, 403);
  const r = await api("GET", "/admin/overview", { token: A.token });
  assert.equal(r.status, 200);
  for (const key of ["users", "admins", "items", "availableItems", "bookings", "openClaims", "disputedClaims"]) {
    assert.ok(key in r.data.counts, key);
  }
  assert.ok(r.data.counts.admins >= 1);
  assert.ok(Array.isArray(r.data.refundsNeedingAttention));
  assert.ok(r.data.recentItems.some((i) => i.title === "Admin overview item"));
  const plain = r.data.recentUsers.find((u) => u.id === U.id);
  assert.equal(plain.listings, 1);
  assert.ok(!JSON.stringify(r.data).includes("passwordHash"), "no password hashes");
  assert.ok(!r.data.recentUsers.some((u) => "passwordHash" in u || "phone" in u));
});
