import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth.routes.js";
import eventRoutes from "./routes/event.routes.js";
import { globalLimiter } from "./middlewares/rateLimiter.js";
import leanTicketRoutes from "./routes/leanTicket.routes.js"
import memoryTicketRoutes from "./routes/memoryTicket.routes.js"

import "./lib/bullQueue.js";
import "./lib/emailQueue.js";

const app = express();

// 1. Reverse proxy configuration for Render deployment
app.set("trust proxy", 1);

const PORT = process.env.PORT || 5000;

// 2. Global Middlewares
app.use(cors());
app.use(express.json());
// app.use(globalLimiter);

// 3. Root Health Check Route
app.get("/", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "Event booking API is running successfully!",
  });
});

// 4. Mount Route Modules
app.use("/api/auth", authRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/memoryTickets", memoryTicketRoutes );   // Optimized (Redis Lua + BullMQ)
app.use("/api/leanTickets", leanTicketRoutes);  // Naive baseline (MySQL row-lock)

// 5. Fallback 404 Handler for Unmatched Routes
app.use((req, res) => {
  return res.status(404).json({ success: false, message: "Route not found" });
});

// 6. Centralized Error Handling Middleware
app.use((err, req, res, next) => {
  console.error("Unhandled Server Error:", err);
  const status = err.statusCode || 500;
  return res.status(status).json({
    success: false,
    message: err.message || "Internal Server Error",
  });
});

// 7. Start Server Listener
app.listen(PORT, () => {
  console.log(`Server Running on http://localhost:${PORT}`);
});