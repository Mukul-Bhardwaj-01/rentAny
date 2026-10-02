// Turns every error into the same JSON shape: { message, errors? }.
// Internal details are logged on the server and never sent to the client.
import multer from "multer";
import { Prisma } from "@prisma/client";
import { AppError } from "../utils/AppError.js";
import cloudinary from "../config/cloudinary.js";

const MULTER_MESSAGES = {
  LIMIT_FILE_SIZE: "Image must be 5 MB or smaller",
  LIMIT_FILE_COUNT: "Only one image can be uploaded",
  LIMIT_UNEXPECTED_FILE: "Unexpected file field; upload the image as \"image\"",
};

// 404 for any /api route that doesn't exist.
export function notFound(req, res, next) {
  next(new AppError(404, `Route not found: ${req.method} ${req.originalUrl}`));
}

function toAppError(err) {
  if (err instanceof AppError) return err;

  // Malformed JSON body from express.json()
  if (err.type === "entity.parse.failed") return new AppError(400, "Request body is not valid JSON");
  if (err.type === "entity.too.large") return new AppError(413, "Request body is too large");

  if (err instanceof multer.MulterError) {
    const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return new AppError(status, MULTER_MESSAGES[err.code] || "Invalid file upload");
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") return new AppError(409, "A record with this value already exists");
    if (err.code === "P2025") return new AppError(404, "Record not found");
    if (err.code === "P2003") return new AppError(400, "Referenced record does not exist");
  }

  // Other client errors from Express's own middleware (e.g. bad encoding)
  // mark themselves safe to show with `expose`.
  if (err.expose && err.status >= 400 && err.status < 500) return new AppError(err.status, err.message);

  return null;
}

// Express recognises error handlers by their four arguments, so `next` stays.
export function errorHandler(err, req, res, next) {
  // If an image already reached Cloudinary but the request failed, remove it
  // so failed submissions don't leave orphaned uploads behind.
  if (req.file?.filename) {
    cloudinary.uploader.destroy(req.file.filename).catch((cleanupErr) => {
      console.error("Failed to delete orphaned image:", cleanupErr.message);
    });
  }

  // A response already started streaming; let Express close the connection.
  if (res.headersSent) return next(err);

  const appError = toAppError(err);
  if (!appError) {
    console.error(err);
    return res.status(500).json({ message: "Something went wrong. Please try again." });
  }

  const body = { message: appError.message };
  if (appError.errors) body.errors = appError.errors;
  res.status(appError.status).json(body);
}
