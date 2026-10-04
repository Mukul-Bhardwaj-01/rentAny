import bcrypt from "bcryptjs";
import prisma from "../config/prisma.js";
import { generateToken } from "../utils/token.js";
import { AppError } from "../utils/AppError.js";

// POST /api/auth/register  (body validated + email normalized by registerValidator)
export async function register(req, res) {
  const { name, email, password, phone } = req.body;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new AppError(409, "An account with this email already exists", {
      email: "An account with this email already exists",
    });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: { name, email, passwordHash, phone },
  });

  const token = generateToken(user.id);

  res.status(201).json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
}

// POST /api/auth/login  (body validated + email normalized by loginValidator)
export async function login(req, res) {
  const { email, password } = req.body;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new AppError(401, "Invalid email or password");
  }

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) {
    throw new AppError(401, "Invalid email or password");
  }

  const token = generateToken(user.id);

  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
}

const profileSelect = {
  id: true, name: true, email: true, phone: true, role: true, createdAt: true,
  ownerRatingSum: true, ownerRatingCount: true, renterRatingSum: true, renterRatingCount: true,
};

const average = (sum, count) => (count ? Math.round((sum / count) * 10) / 10 : null);

function profileResponse(user, counts) {
  const { ownerRatingSum, ownerRatingCount, renterRatingSum, renterRatingCount, ...rest } = user;
  return {
    ...rest,
    ownerRating: { average: average(ownerRatingSum, ownerRatingCount), count: ownerRatingCount },
    renterRating: { average: average(renterRatingSum, renterRatingCount), count: renterRatingCount },
    ...(counts ? { stats: counts } : {}),
  };
}

// GET /api/auth/me  (requires requireAuth middleware)
// Account details for the profile page, with ratings and simple totals.
export async function getProfile(req, res) {
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: profileSelect });
  // Token is valid but the account no longer exists.
  if (!user) throw new AppError(401, "Account not found");

  const [listings, rentals, completedRentals, completedAsOwner] = await Promise.all([
    prisma.item.count({ where: { ownerId: req.userId, deletedAt: null } }),
    prisma.booking.count({ where: { renterId: req.userId } }),
    prisma.booking.count({ where: { renterId: req.userId, status: "COMPLETED" } }),
    prisma.booking.count({ where: { ownerId: req.userId, status: "COMPLETED" } }),
  ]);
  res.json(profileResponse(user, { listings, rentals, completedRentals, completedAsOwner }));
}

// PATCH /api/auth/me  (requireAuth + updateProfileValidator)  body: { name?, phone? }
export async function updateProfile(req, res) {
  const user = await prisma.user.update({ where: { id: req.userId }, data: req.body, select: profileSelect });
  res.json(profileResponse(user));
}
