import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import { prisma } from "./config/prisma";

import userRoutes from "./routes/user.routes";
import serviceRoutes from "./routes/service.routes";
import bookingRoutes from "./routes/booking.routes";
import paymentRoutes from "./routes/payment.routes";
import reviewRoutes from "./routes/review.routes";
import walletRoutes from "./routes/wallet.routes";
import providerRoutes from "./routes/provider.routes";
import adminDashboardRoutes from "./routes/admin-dashboard.routes";

dotenv.config();

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Main API routes
app.use("/api/users", userRoutes);
app.use("/api/services", serviceRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/wallets", walletRoutes);
app.use("/api/providers", providerRoutes);
app.use("/api/admin/dashboard", adminDashboardRoutes);

// Basic backend test
app.get("/", (request, response) => {
  return response.status(200).json({
    message: "Dwaar Sewa backend is working",
  });
});

// Database connection test
app.get("/database-test", async (request, response) => {
  try {
    const roles = await prisma.roles.findMany();

    return response.status(200).json({
      message: "Database connection is working",
      roles,
    });
  } catch (error) {
    console.error("Database test error:", error);

    return response.status(500).json({
      message: "Database connection failed",
    });
  }
});

// Server and database health check
app.get("/health", async (request, response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    return response.status(200).json({
      status: "ok",
      server: "running",
      database: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Health check error:", error);

    return response.status(503).json({
      status: "error",
      server: "running",
      database: "disconnected",
      timestamp: new Date().toISOString(),
    });
  }
});

// 404 handler — must stay after all routes
app.use((request, response) => {
  return response.status(404).json({
    message: "API route not found",
    method: request.method,
    path: request.originalUrl,
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Dwaar Sewa server is running on port ${PORT}`);
});
