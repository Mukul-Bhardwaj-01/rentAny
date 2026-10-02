// Reads the "Authorization: Bearer <token>" header, verifies it, and
// attaches the logged-in user's id to req.userId for the next handler.
import jwt from "jsonwebtoken";
import { AppError } from "../utils/AppError.js";

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return next(new AppError(401, "No token provided"));
  }

  const token = header.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!Number.isInteger(decoded.userId)) throw new Error("Malformed token payload");
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return next(new AppError(401, "Invalid or expired token"));
  }
}
