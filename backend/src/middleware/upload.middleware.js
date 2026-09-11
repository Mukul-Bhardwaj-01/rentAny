// Handles a single "image" file field on incoming requests and streams
// it straight to Cloudinary instead of saving it on our own disk.
import multer from "multer";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import cloudinary from "../config/cloudinary.js";

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "rentany_items",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
  },
});

export const upload = multer({ storage });
