import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../config/prisma";
import jwt from "jsonwebtoken";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";

export const registerUser = async (request: Request, response: Response) => {
  try {
    const { fullName, phone, email, password } = request.body;

    if (!fullName || !phone || !password) {
      return response.status(400).json({
        message: "Full name, phone and password are required",
      });
    }

    const existingUser = await prisma.users.findFirst({
      where: {
        OR: [{ phone }, ...(email ? [{ email }] : [])],
      },
    });

    if (existingUser) {
      return response.status(409).json({
        message: "A user with this phone or email already exists",
      });
    }

    const selectedRole = await prisma.roles.findUnique({
      where: {
        name: "customer",
      },
    });

    if (!selectedRole) {
      return response.status(500).json({
        message: "Customer role is not configured in the database",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const newUser = await prisma.users.create({
      data: {
        full_name: fullName,
        phone,
        email: email || null,
        password_hash: passwordHash,
        role_id: selectedRole.id,
      },
      select: {
        id: true,
        full_name: true,
        phone: true,
        email: true,
        role_id: true,
        is_active: true,
        created_at: true,
      },
    });

    return response.status(201).json({
      message: "User registered successfully",
      user: newUser,
    });
  } catch (error) {
    console.error("Registration error:", error);

    return response.status(500).json({
      message: "Something went wrong while registering the user",
    });
  }
};

export const loginUser = async (request: Request, response: Response) => {
  try {
    const { phone, password } = request.body;

    if (!phone || !password) {
      return response.status(400).json({
        message: "Phone and password are required",
      });
    }

    const user = await prisma.users.findUnique({
      where: {
        phone,
      },
    });

    if (!user) {
      return response.status(401).json({
        message: "Invalid phone or password",
      });
    }

    if (!user.is_active) {
      return response.status(403).json({
        message: "This account is inactive",
      });
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatches) {
      return response.status(401).json({
        message: "Invalid phone or password",
      });
    }
    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      throw new Error("JWT_SECRET is missing from the .env file");
    }

    const token = jwt.sign(
      {
        userId: user.id,
        roleId: user.role_id,
      },
      jwtSecret,
      {
        expiresIn: "7d",
      },
    );

    return response.status(200).json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        phone: user.phone,
        email: user.email,
        role_id: user.role_id,
        is_active: user.is_active,
      },
    });
  } catch (error) {
    console.error("Login error:", error);

    return response.status(500).json({
      message: "Something went wrong while logging in",
    });
  }
};
export const getMyProfile = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const userId = request.user?.userId;

    if (!userId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    const user = await prisma.users.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        full_name: true,
        phone: true,
        email: true,
        role_id: true,
        is_active: true,
        created_at: true,
      },
    });

    if (!user) {
      return response.status(404).json({
        message: "User not found",
      });
    }

    return response.status(200).json({
      message: "Profile fetched successfully",
      user,
    });
  } catch (error) {
    console.error("Profile error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching the profile",
    });
  }
};
export const createProvider = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const { fullName, phone, email, password } = request.body;

    if (!fullName || !phone || !password) {
      return response.status(400).json({
        message: "Full name, phone and password are required",
      });
    }

    const existingUser = await prisma.users.findFirst({
      where: {
        OR: [{ phone }, ...(email ? [{ email }] : [])],
      },
    });

    if (existingUser) {
      return response.status(409).json({
        message: "A user with this phone or email already exists",
      });
    }

    const providerRole = await prisma.roles.findUnique({
      where: {
        name: "provider",
      },
    });

    if (!providerRole) {
      return response.status(500).json({
        message: "Provider role is not configured in the database",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const provider = await prisma.users.create({
      data: {
        full_name: fullName,
        phone,
        email: email || null,
        password_hash: passwordHash,
        role_id: providerRole.id,
      },
      select: {
        id: true,
        full_name: true,
        phone: true,
        email: true,
        role_id: true,
        is_active: true,
        created_at: true,
      },
    });

    return response.status(201).json({
      message: "Provider created successfully",
      provider,
    });
  } catch (error) {
    console.error("Create provider error:", error);

    return response.status(500).json({
      message: "Something went wrong while creating the provider",
    });
  }
};
