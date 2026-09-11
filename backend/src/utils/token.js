// Small helper so token creation logic lives in exactly one place.
import jwt from "jsonwebtoken";

export function generateToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: "7d" });
}
