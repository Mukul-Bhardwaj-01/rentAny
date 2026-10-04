import express from "express";
import cors from "cors";
import { allowedOrigins } from "./config/env.js";
import authRoutes from "./routes/auth.routes.js";
import itemRoutes from "./routes/item.routes.js";
import bookingRoutes from "./routes/booking.routes.js";
import notificationRoutes from "./routes/notification.routes.js";
import mediaRoutes from "./routes/media.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import internalRoutes from "./routes/internal.routes.js";
import userRoutes from "./routes/user.routes.js";
import chatRoutes from "./routes/chat.routes.js";
import { razorpayWebhook } from "./controllers/payment.controller.js";
import { asyncHandler } from "./utils/asyncHandler.js";
import { notFound, errorHandler } from "./middleware/error.middleware.js";

const app = express();

// Razorpay webhooks are signed over the exact raw body, so this route must be
// registered before express.json() parses (and re-serialises) bodies.
// Server-to-server: no CORS, no login; the signature is the authentication.
app.post("/api/payments/webhook", express.raw({ type: "*/*", limit: "1mb" }), asyncHandler(razorpayWebhook));

// Only the configured frontend origin(s) may call the API from a browser.
// Requests without an Origin header (Postman, curl) are still allowed.
app.use(
  cors({
    origin(origin, cb) {
      cb(null, !origin || allowedOrigins.includes(origin));
    },
  })
);
app.use(express.json({ limit: "100kb" }));

app.use("/api/auth", authRoutes);
app.use("/api/items", itemRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/media", mediaRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/internal", internalRoutes);
app.use("/api/users", userRoutes);
app.use("/api/chat", chatRoutes);

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

app.use(notFound);
app.use(errorHandler);

export default app;
