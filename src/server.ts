import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { prisma } from "./config/prisma";
import userRoutes from "./routes/user.routes";

dotenv.config();

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use("/api/users", userRoutes);

app.get("/", (request, response) => {
  response.json({
    message: "Dwaar Sewa backend is working",
  });
});

app.get("/database-test", async (request, response) => {
  try {
    const roles = await prisma.roles.findMany();

    return response.json({
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

app.listen(PORT, () => {
  console.log(`Dwaar Sewa server is running on port ${PORT}`);
});
