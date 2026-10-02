// Cloudinary holds the item images. Credentials come from your .env
// (get them free at https://cloudinary.com/users/register/free), which
// server.js loads before any other module.
import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export default cloudinary;
