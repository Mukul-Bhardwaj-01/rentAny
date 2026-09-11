import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth.routes.js";
import itemRoutes from "./routes/item.routes.js";

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/items", itemRoutes);

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

export default app;
