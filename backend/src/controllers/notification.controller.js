import prisma from "../config/prisma.js";
import { AppError } from "../utils/AppError.js";
import { expireStalePendingBookings } from "./booking.controller.js";

// Every query is scoped to req.userId, so users only ever see or change
// their own notifications. There is deliberately no endpoint to create one:
// notifications are only written by the booking actions themselves.

const publicFields = {
  id: true,
  type: true,
  title: true,
  message: true,
  bookingId: true,
  readAt: true,
  createdAt: true,
};

const unreadCount = (userId) => prisma.notification.count({ where: { recipientId: userId, readAt: null } });

// GET /api/notifications?limit=20  -> { notifications, unreadCount }, newest first
export async function getNotifications(req, res) {
  // Polling doubles as the trigger for lazy expiry, so renters hear about
  // expired requests even if nobody opens the bookings page.
  await expireStalePendingBookings();

  const [notifications, count] = await Promise.all([
    prisma.notification.findMany({
      where: { recipientId: req.userId },
      select: publicFields,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: req.query.limit,
    }),
    unreadCount(req.userId),
  ]);

  res.json({ notifications, unreadCount: count });
}

// GET /api/notifications/unread-count  -> { unreadCount }
export async function getUnreadCount(req, res) {
  await expireStalePendingBookings();
  res.json({ unreadCount: await unreadCount(req.userId) });
}

// PATCH /api/notifications/:id/read  (idempotent)
export async function markAsRead(req, res) {
  const where = { id: req.params.id, recipientId: req.userId };

  await prisma.notification.updateMany({ where: { ...where, readAt: null }, data: { readAt: new Date() } });

  // Someone else's notification looks exactly like a missing one.
  const notification = await prisma.notification.findFirst({ where, select: publicFields });
  if (!notification) throw new AppError(404, "Notification not found");

  res.json({ notification, unreadCount: await unreadCount(req.userId) });
}

// PATCH /api/notifications/read-all
export async function markAllAsRead(req, res) {
  const { count } = await prisma.notification.updateMany({
    where: { recipientId: req.userId, readAt: null },
    data: { readAt: new Date() },
  });
  res.json({ updated: count, unreadCount: 0 });
}
