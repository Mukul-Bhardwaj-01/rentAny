// Fails fast at startup if required configuration is missing, instead of
// surfacing as a confusing 500 on the first request that needs it.
const required = [
  "DATABASE_URL",
  "JWT_SECRET",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
];

const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(", ")}`);
  console.error("Copy backend/.env.example to backend/.env and fill them in.");
  process.exit(1);
}

// Comma-separated list of frontend origins allowed to call the API.
export const allowedOrigins = (process.env.CLIENT_URL || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
