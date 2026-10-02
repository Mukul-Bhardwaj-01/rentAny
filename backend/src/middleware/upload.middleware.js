// LEGACY upload path: older clients may still send one photo as a multipart
// "image" field to POST /api/items. New clients upload photos and videos
// straight to Cloudinary (see utils/directUploads.js) and send JSON.
//
// The file lands in a temporary folder, is checked (real content type, size)
// before anything is sent to Cloudinary, and is always deleted afterwards.
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import multer from "multer";
import { AppError } from "../utils/AppError.js";
import { detectMediaType } from "../utils/fileType.js";
import { MEDIA_LIMITS, TYPE_BY_MIME } from "../utils/mediaRules.js";

export const TEMP_DIR = path.join(os.tmpdir(), "rentany-uploads");
fs.mkdirSync(TEMP_DIR, { recursive: true });

const IMAGE_ERROR = "The image must be a JPG, PNG or WEBP file";
const imageError = (status, message) => new AppError(status, message, { image: message });

const multerUpload = multer({
  storage: multer.diskStorage({ destination: TEMP_DIR }),
  fileFilter(req, file, cb) {
    if (TYPE_BY_MIME[file.mimetype] === "IMAGE") return cb(null, true);
    cb(imageError(400, IMAGE_ERROR));
  },
  limits: { fileSize: MEDIA_LIMITS.maxImageBytes, files: 1, fields: 20 },
}).single("image");

// For multipart requests only: accepts at most one "image" file and puts it,
// checked, on req.legacyMedia. JSON requests pass straight through.
export function legacyImageUpload(req, res, next) {
  if (!req.is("multipart/form-data")) return next();
  res.on("close", () => {
    if (req.file) fs.promises.unlink(req.file.path).catch(() => {});
  });
  multerUpload(req, res, async (err) => {
    if (err) return next(err);
    if (!req.file) return next();
    try {
      const detected = await detectMediaType(req.file.path);
      if (TYPE_BY_MIME[detected] !== "IMAGE") throw imageError(400, IMAGE_ERROR);
      req.legacyMedia = [{ path: req.file.path, type: "IMAGE" }];
      next();
    } catch (inspectErr) {
      next(inspectErr);
    }
  });
}
