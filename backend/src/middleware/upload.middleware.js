// Accepts listing photos/videos into a temporary folder on our own disk, so
// they can be checked (real content type, per-type size and count limits)
// and the text fields validated BEFORE anything is sent to Cloudinary.
// Temporary files are always deleted once the response is finished.
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import multer from "multer";
import { AppError } from "../utils/AppError.js";
import { detectMediaType } from "../utils/fileType.js";

const MB = 1024 * 1024;

export const MEDIA_LIMITS = {
  maxImages: 8,
  maxVideos: 2,
  maxTotal: 10,
  maxImageBytes: 5 * MB,
  maxVideoBytes: 50 * MB,
};

const TYPE_BY_MIME = {
  "image/jpeg": "IMAGE",
  "image/png": "IMAGE",
  "image/webp": "IMAGE",
  "video/mp4": "VIDEO",
  "video/webm": "VIDEO",
};

const TYPE_ERROR = "Only JPG, PNG and WEBP images and MP4 and WebM videos are allowed";

export const TEMP_DIR = path.join(os.tmpdir(), "rentany-uploads");
fs.mkdirSync(TEMP_DIR, { recursive: true });

function mediaError(status, message) {
  return new AppError(status, message, { media: message });
}

// Cheap first pass on the declared type and per-request counts, so an
// oversized batch is rejected while it is still being received.
function fileFilter(req, file, cb) {
  const type = TYPE_BY_MIME[file.mimetype];
  if (!type) return cb(mediaError(400, TYPE_ERROR));

  req.mediaCounts ??= { IMAGE: 0, VIDEO: 0 };
  req.mediaCounts[type] += 1;
  if (req.mediaCounts.IMAGE > MEDIA_LIMITS.maxImages) {
    return cb(mediaError(400, `You can upload at most ${MEDIA_LIMITS.maxImages} images`));
  }
  if (req.mediaCounts.VIDEO > MEDIA_LIMITS.maxVideos) {
    return cb(mediaError(400, `You can upload at most ${MEDIA_LIMITS.maxVideos} videos`));
  }
  cb(null, true);
}

const multerUpload = multer({
  storage: multer.diskStorage({ destination: TEMP_DIR }),
  fileFilter,
  limits: {
    fileSize: MEDIA_LIMITS.maxVideoBytes, // the larger limit; images are re-checked below
    files: MEDIA_LIMITS.maxTotal,
    fields: 20,
  },
}).fields([
  { name: "media", maxCount: MEDIA_LIMITS.maxTotal },
  // Older clients send a single photo as "image"; still accepted.
  { name: "image", maxCount: 1 },
]);

function allFiles(req) {
  return [...(req.files?.media || []), ...(req.files?.image || [])];
}

function removeTempFiles(req) {
  for (const f of allFiles(req)) fs.promises.unlink(f.path).catch(() => {});
}

// Second pass on the files actually received: real content type from the
// file's bytes, must match the declared kind, and per-type size limits.
async function inspectFiles(files) {
  const media = [];
  for (const f of files) {
    const detected = await detectMediaType(f.path);
    const declaredType = TYPE_BY_MIME[f.mimetype];
    if (!detected || TYPE_BY_MIME[detected] !== declaredType) {
      throw mediaError(400, `"${f.originalname}" is not a valid JPG, PNG, WEBP, MP4 or WebM file`);
    }
    if (declaredType === "IMAGE" && f.size > MEDIA_LIMITS.maxImageBytes) {
      throw mediaError(413, `Each image must be ${MEDIA_LIMITS.maxImageBytes / MB} MB or smaller`);
    }
    media.push({ path: f.path, type: declaredType, size: f.size, name: f.originalname });
  }
  return media;
}

// Puts the checked files, in the order sent, on req.media.
export function uploadMedia(req, res, next) {
  res.on("close", () => removeTempFiles(req));
  multerUpload(req, res, async (err) => {
    if (err) return next(err);
    try {
      req.media = await inspectFiles(allFiles(req));
      next();
    } catch (inspectErr) {
      next(inspectErr);
    }
  });
}
