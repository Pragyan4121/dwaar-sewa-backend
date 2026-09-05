import http from "node:http";
import path from "node:path";

import cors from "cors";
import dotenv from "dotenv";
import express from "express";

import { prisma } from "./config/prisma";

import adminCustomerRoutes from "./routes/admin-customer.routes";
import adminDashboardRoutes from "./routes/admin-dashboard.routes";
import adminPaymentRoutes from "./routes/admin-payment.routes";
import adminProviderRoutes from "./routes/admin-provider.routes";
import adminReportRoutes from "./routes/admin-report.routes";
import adminReviewRoutes from "./routes/admin-review.routes";
import adminSettingRoutes from "./routes/admin-setting.routes";
import adminWithdrawalRoutes from "./routes/admin-withdrawal.routes";
import authRoutes from "./routes/auth.routes";
import bookingRoutes from "./routes/booking.routes";
import categoryRoutes from "./routes/category.routes";
import customerAddressRoutes from "./routes/customer-address.routes";
import customerDashboardRoutes from "./routes/customer-dashboard.routes";
import experienceTypeRoutes from "./routes/experience-type.routes";
import notificationRoutes from "./routes/notification.routes";
import orderChatRoutes from "./routes/order-chat.routes";
import paymentRoutes from "./routes/payment.routes";
import providerDashboardRoutes from "./routes/provider-dashboard.routes";
import providerEarningsRoutes from "./routes/provider-earnings.routes";
import providerRegistrationRoutes from "./routes/provider-registration.routes";
import providerRoutes from "./routes/provider.routes";
import providerWithdrawalRoutes from "./routes/provider-withdrawal.routes";
import reviewRoutes from "./routes/review.routes";
import serviceRoutes from "./routes/service.routes";
import userRoutes from "./routes/user.routes";
import walletRoutes from "./routes/wallet.routes";

import { errorHandler } from "./middlewares/error.middleware";
import { initializeChatSocket } from "./services/chat-socket.service";
import promotionRoutes from "./routes/promotion.routes";

dotenv.config();

const app = express();

const httpServer = http.createServer(app);

const PORT = Number(process.env.PORT) || 3000;

/*
|--------------------------------------------------------------------------
| Global middleware
|--------------------------------------------------------------------------
*/

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:8081",
  "https://dwaar-sewa-admin.onrender.com",
  "https://dwaar-sewa-app.onrender.com",
];

app.use(
  cors({
    origin: allowedOrigins,

    credentials: true,
  }),
);

app.use(express.json());

app.use("/uploads", express.static(path.resolve(process.cwd(), "uploads")));

/*
|--------------------------------------------------------------------------
| Main API routes
|--------------------------------------------------------------------------
*/

app.use("/api/auth", authRoutes);

app.use("/api/users", userRoutes);

app.use("/api/services", serviceRoutes);

app.use("/api/categories", categoryRoutes);

app.use("/api/bookings", bookingRoutes);

app.use("/api/payments", paymentRoutes);

app.use("/api/reviews", reviewRoutes);

app.use("/api/wallets", walletRoutes);

app.use("/api/providers", providerRoutes);

app.use("/api/provider-registration", providerRegistrationRoutes);

app.use("/api/notifications", notificationRoutes);

app.use("/api/customer/dashboard", customerDashboardRoutes);

app.use("/api/customer/addresses", customerAddressRoutes);

app.use("/api/experience-types", experienceTypeRoutes);
app.use("/api/promotions", promotionRoutes);

/*
|--------------------------------------------------------------------------
| Admin routes
|--------------------------------------------------------------------------
*/

app.use("/api/admin/dashboard", adminDashboardRoutes);

app.use("/api/admin/payments", adminPaymentRoutes);

app.use("/api/admin/reviews", adminReviewRoutes);

app.use("/api/admin/providers", adminProviderRoutes);

app.use("/api/admin/customers", adminCustomerRoutes);

app.use("/api/settings", adminSettingRoutes);

app.use("/api/admin/reports", adminReportRoutes);

/*
|--------------------------------------------------------------------------
| Provider routes
|--------------------------------------------------------------------------
*/

app.use("/api/provider/dashboard", providerDashboardRoutes);

app.use("/api/provider/earnings", providerEarningsRoutes);

app.use("/api/provider/withdrawals", providerWithdrawalRoutes);

app.use("/api/admin/withdrawals", adminWithdrawalRoutes);

/*
|--------------------------------------------------------------------------
| Order chat
|--------------------------------------------------------------------------
*/

app.use("/api/chats", orderChatRoutes);

/*
|--------------------------------------------------------------------------
| Basic backend test
|--------------------------------------------------------------------------
*/

app.get("/", (_request, response) => {
  return response.status(200).json({
    message: "Dwaar Sewa backend is working",
  });
});

/*
|--------------------------------------------------------------------------
| Database connection test
|--------------------------------------------------------------------------
*/

app.get("/database-test", async (_request, response) => {
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

/*
|--------------------------------------------------------------------------
| Health check
|--------------------------------------------------------------------------
*/

app.get("/health", async (_request, response) => {
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

/*
|--------------------------------------------------------------------------
| 404 handler
|--------------------------------------------------------------------------
*/

app.use((request, response) => {
  return response.status(404).json({
    message: "API route not found",

    method: request.method,

    path: request.originalUrl,
  });
});

/*
|--------------------------------------------------------------------------
| Central error handler
|--------------------------------------------------------------------------
*/

app.use(errorHandler);

/*
|--------------------------------------------------------------------------
| Socket.IO
|--------------------------------------------------------------------------
|
| Socket.IO shares the exact same HTTP server and port as Express.
|--------------------------------------------------------------------------
*/

initializeChatSocket(httpServer);

/*
|--------------------------------------------------------------------------
| Start HTTP + Socket.IO server
|--------------------------------------------------------------------------
*/

httpServer.listen(PORT, () => {
  console.log(`Dwaar Sewa server is running on port ${PORT}`);

  console.log("Order chat real-time server is ready");
});
