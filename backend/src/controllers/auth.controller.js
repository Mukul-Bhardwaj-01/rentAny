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
    user: { id: user.id, name: user.name, email: user.email },
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
    user: { id: user.id, name: user.name, email: user.email },
  });
}

// GET /api/auth/me  (requires requireAuth middleware)
export async function getProfile(req, res) {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { id: true, name: true, email: true, phone: true, createdAt: true },
  });
  // Token is valid but the account no longer exists.
  if (!user) throw new AppError(401, "Account not found");
  res.json(user);
}
