// Handles a single "image" file field on incoming requests and streams
// it straight to Cloudinary instead of saving it on our own disk.
import multer from "multer";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import cloudinary from "../config/cloudinary.js";
import { AppError } from "../utils/AppError.js";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "rentany_items",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
  },
});

// Rejects non-image files before anything is sent to Cloudinary.
function fileFilter(req, file, cb) {
  if (ALLOWED_TYPES.includes(file.mimetype)) return cb(null, true);
  const message = "Image must be a JPG, PNG or WEBP file";
  cb(new AppError(400, message, { image: message }));
}

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_IMAGE_SIZE, files: 1 },
});
