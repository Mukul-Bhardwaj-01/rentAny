// Turns every error into the same JSON shape: { message, errors? }.
// Internal details are logged on the server and never sent to the client.
import multer from "multer";
import { Prisma } from "@prisma/client";
import { AppError } from "../utils/AppError.js";
import { RazorpayError } from "../utils/razorpay.js";

// Only the legacy single-"image" multipart path uses multer now; photos and
// videos are otherwise uploaded straight to Cloudinary.
const MULTER_MESSAGES = {
  LIMIT_FILE_SIZE: "The image must be 5 MB or smaller",
  LIMIT_FILE_COUNT: "Only one image can be sent this way",
  LIMIT_UNEXPECTED_FILE:
    "Only a single \"image\" file can be sent with the form. Upload photos and videos directly (POST /api/media/signatures).",
  LIMIT_FIELD_COUNT: "Too many form fields",
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
    const message = MULTER_MESSAGES[err.code] || "Invalid file upload";
    return new AppError(status, message, { image: message });
  }

  // Razorpay was unreachable or rejected a request we made.
  if (err instanceof RazorpayError) {
    console.error("Razorpay error:", err.status, err.code, err.message);
    return new AppError(502, "The payment provider couldn't complete the request. Please try again in a moment.");
  }

  // Cloudinary rejected or failed an upload (already cleaned up by uploadAll).
  if (err.isUploadFailure) {
    return new AppError(502, "Could not upload your media. Please check the files and try again.", {
      media: "Upload failed",
    });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") return new AppError(409, "A record with this value already exists");
    if (err.code === "P2025") return new AppError(404, "Record not found");
    if (err.code === "P2003") return new AppError(400, "Referenced record does not exist");
  }

  // Postgres exclusion-constraint violation (Booking_no_overlap). Prisma has
  // no error code for it, so the Postgres code only appears in the message.
  if (err instanceof Prisma.PrismaClientUnknownRequestError && err.message.includes('code: "23P01"')) {
    return new AppError(409, "This time slot is already booked. Please choose another time.");
  }
  // Deadlock / serialization failure: two requests collided; safe to retry.
  if (err instanceof Prisma.PrismaClientUnknownRequestError && /code: "(40P01|40001)"/.test(err.message)) {
    return new AppError(409, "Another change happened at the same time. Please try again.");
  }

  // Other client errors from Express's own middleware (e.g. bad encoding)
  // mark themselves safe to show with `expose`.
  if (err.expose && err.status >= 400 && err.status < 500) return new AppError(err.status, err.message);

  return null;
}

// Express recognises error handlers by their four arguments, so `next` stays.
export function errorHandler(err, req, res, next) {
  // (Uploaded media is cleaned up where it is uploaded: see utils/mediaStorage.js
  // and the item controller. Temporary files are removed by uploadMedia.)

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
