// Single source of truth for listing media rules (limits, formats, ids).
const MB = 1024 * 1024;

export const MEDIA_LIMITS = {
  maxImages: 8,
  maxVideos: 2,
  maxTotal: 10,
  maxImageBytes: 5 * MB,
  maxVideoBytes: 50 * MB,
};

export const MAX_BYTES = { IMAGE: MEDIA_LIMITS.maxImageBytes, VIDEO: MEDIA_LIMITS.maxVideoBytes };

// Declared MIME type -> our media type.
export const TYPE_BY_MIME = {
  "image/jpeg": "IMAGE",
  "image/png": "IMAGE",
  "image/webp": "IMAGE",
  "video/mp4": "VIDEO",
  "video/webm": "VIDEO",
};

// Formats as Cloudinary reports them after it has parsed the file.
export const ALLOWED_FORMATS = { IMAGE: ["jpg", "png", "webp"], VIDEO: ["mp4", "webm"] };
// RAW is never uploaded by us; it is only used when deleting, in case someone
// posted a signed upload to Cloudinary's raw-file endpoint instead.
export const RESOURCE_TYPE = { IMAGE: "image", VIDEO: "video", RAW: "raw" };

export const MEDIA_FOLDER = "rentany_items";
// Public ids we issue for direct uploads: rentany_items/u<userId>_<24 hex chars>.
export const ISSUED_PUBLIC_ID = /^rentany_items\/u\d+_[a-f0-9]{24}$/;
