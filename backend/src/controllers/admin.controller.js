// Admin API for the admin panel (admins are set manually in the database).
// Every money action is recorded in the PaymentEvent audit log.
import prisma from "../config/prisma.js";
import { AppError } from "../utils/AppError.js";
import { fmt } from "../utils/money.js";
import { resolveClaim } from "../utils/deposits.js";
import { sendRefund, logEvent } from "../utils/payments.js";

// GET /api/admin/overview  (read-only)
// Counts, recent users/items, and refunds that need attention.
export async function getOverview(req, res) {
  const [users, admins, items, availableItems, bookingsByStatus, openClaims, disputedClaims, refundsNeedingAttention, recentUsers, recentItems] =
    await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { role: "ADMIN" } }),
      prisma.item.count({ where: { deletedAt: null } }),
      prisma.item.count({ where: { isAvailable: true, deletedAt: null } }),
      prisma.booking.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.depositClaim.count({ where: { status: "OPEN" } }),
      prisma.depositClaim.count({ where: { status: "DISPUTED" } }),
      prisma.refund.findMany({
        where: { status: { in: ["FAILED", "REQUESTED"] } },
        select: {
          id: true, bookingId: true, purpose: true, amount: true, status: true, attempts: true,
          lastErrorDescription: true, requestedAt: true,
        },
        orderBy: { requestedAt: "asc" },
        take: 20,
      }),
      prisma.user.findMany({
        select: { id: true, name: true, email: true, role: true, createdAt: true, _count: { select: { items: true, rentals: true } } },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      prisma.item.findMany({
        where: { deletedAt: null },
        select: {
          id: true, title: true, category: true, pricePerHour: true, isAvailable: true, createdAt: true,
          owner: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
    ]);

  res.json({
    counts: {
      users,
      admins,
      items,
      availableItems,
      bookings: Object.fromEntries(bookingsByStatus.map((b) => [b.status, b._count._all])),
      openClaims,
      disputedClaims,
    },
    refundsNeedingAttention: refundsNeedingAttention.map((r) => ({ ...r, amount: fmt(r.amount) })),
    recentUsers: recentUsers.map(({ _count, ...u }) => ({ ...u, listings: _count.items, rentals: _count.rentals })),
    recentItems: recentItems.map((i) => ({ ...i, pricePerHour: fmt(i.pricePerHour) })),
  });
}

// GET /api/admin/deposit-claims?status=DISPUTED
export async function listDepositClaims(req, res) {
  const claims = await prisma.depositClaim.findMany({
    where: req.query.status ? { status: req.query.status } : { status: { in: ["OPEN", "DISPUTED"] } },
    include: {
      booking: {
        select: {
          id: true, status: true, securityDeposit: true, depositStatus: true, depositReleaseAt: true,
          startTime: true, endTime: true, returnedAt: true,
          item: { select: { id: true, title: true } },
          renter: { select: { id: true, name: true } },
          owner: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  res.json(
    claims.map((c) => ({
      ...c,
      amountClaimed: fmt(c.amountClaimed),
      amountApproved: c.amountApproved === null ? null : fmt(c.amountApproved),
      booking: { ...c.booking, securityDeposit: fmt(c.booking.securityDeposit) },
    }))
  );
}

// POST /api/admin/deposit-claims/:id/resolve  body: { approvedAmount, note }
export async function resolveDepositClaim(req, res) {
  const claim = await resolveClaim(req.params.id, req.userId, req.body);
  res.json({ ...claim, amountClaimed: fmt(claim.amountClaimed), amountApproved: fmt(claim.amountApproved) });
}

// POST /api/admin/refunds/:id/retry  — retry a failed refund now
export async function retryRefund(req, res) {
  const refund = await prisma.refund.findUnique({ where: { id: req.params.id } });
  if (!refund) throw new AppError(404, "Refund not found");
  if (!["FAILED", "REQUESTED"].includes(refund.status)) throw new AppError(409, `This refund is ${refund.status.toLowerCase()}`);
  await logEvent(prisma, {
    bookingId: refund.bookingId, paymentId: refund.paymentId, refundId: refund.id, type: "REFUND_RETRY_REQUESTED",
    source: "ADMIN", actorId: req.userId, data: {},
  });
  const result = await sendRefund(refund.id);
  res.json({ id: result.id, status: result.status, amount: fmt(result.amount), attempts: result.attempts, lastError: result.lastErrorDescription });
}
