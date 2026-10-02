import express from "express";
import cors from "cors";
import { allowedOrigins } from "./config/env.js";
import authRoutes from "./routes/auth.routes.js";
import itemRoutes from "./routes/item.routes.js";
import bookingRoutes from "./routes/booking.routes.js";
import { notFound, errorHandler } from "./middleware/error.middleware.js";

const app = express();

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

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

app.use(notFound);
app.use(errorHandler);

export default app;
