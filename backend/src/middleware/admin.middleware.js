// Admin-only routes (use after requireAuth). The role is read from the
// database on every request, so revoking it takes effect immediately.
import prisma from "../config/prisma.js";
import { AppError } from "../utils/AppError.js";

export async function requireAdmin(req, res, next) {
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { role: true } });
  if (user?.role !== "ADMIN") throw new AppError(403, "Admins only");
  next();
}
