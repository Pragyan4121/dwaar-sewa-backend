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
export const getProviders = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
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

    const providers = await prisma.users.findMany({
      where: {
        role_id: providerRole.id,
      },
      select: {
        id: true,
        full_name: true,
        phone: true,
        email: true,
        is_active: true,
        created_at: true,
      },
      orderBy: {
        created_at: "desc",
      },
    });

    return response.status(200).json({
      message: "Providers fetched successfully",
      providers,
    });
  } catch (error) {
    console.error("Get providers error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching providers",
    });
  }
};
export const updateProviderStatus = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const providerId = Number(request.params.id);
    const { isActive } = request.body;

    if (!Number.isInteger(providerId) || providerId <= 0) {
      return response.status(400).json({
        message: "Invalid provider ID",
      });
    }

    if (typeof isActive !== "boolean") {
      return response.status(400).json({
        message: "isActive must be true or false",
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

    const provider = await prisma.users.findFirst({
      where: {
        id: providerId,
        role_id: providerRole.id,
      },
    });

    if (!provider) {
      return response.status(404).json({
        message: "Provider not found",
      });
    }

    const updatedProvider = await prisma.users.update({
      where: {
        id: providerId,
      },
      data: {
        is_active: isActive,
        updated_at: new Date(),
      },
      select: {
        id: true,
        full_name: true,
        phone: true,
        email: true,
        role_id: true,
        is_active: true,
        updated_at: true,
      },
    });

    return response.status(200).json({
      message: isActive
        ? "Provider activated successfully"
        : "Provider deactivated successfully",
      provider: updatedProvider,
    });
  } catch (error) {
    console.error("Update provider status error:", error);

    return response.status(500).json({
      message: "Something went wrong while updating provider status",
    });
  }
};
export const updateMyProfile = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const userId = request.user?.userId;
    const { fullName, email } = request.body;

    if (!userId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    if (fullName !== undefined && !fullName.trim()) {
      return response.status(400).json({
        message: "Full name cannot be empty",
      });
    }

    if (email !== undefined && email) {
      const existingEmail = await prisma.users.findFirst({
        where: {
          email,
          NOT: {
            id: userId,
          },
        },
      });

      if (existingEmail) {
        return response.status(409).json({
          message: "This email is already being used",
        });
      }
    }

    const updatedUser = await prisma.users.update({
      where: {
        id: userId,
      },
      data: {
        ...(fullName !== undefined && {
          full_name: fullName.trim(),
        }),
        ...(email !== undefined && {
          email: email || null,
        }),
        updated_at: new Date(),
      },
      select: {
        id: true,
        full_name: true,
        phone: true,
        email: true,
        role_id: true,
        is_active: true,
        updated_at: true,
      },
    });

    return response.status(200).json({
      message: "Profile updated successfully",
      user: updatedUser,
    });
  } catch (error) {
    console.error("Update profile error:", error);

    return response.status(500).json({
      message: "Something went wrong while updating the profile",
    });
  }
};
export const changeMyPassword = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const userId = request.user?.userId;
    const { currentPassword, newPassword } = request.body;

    if (!userId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    if (!currentPassword || !newPassword) {
      return response.status(400).json({
        message: "Current password and new password are required",
      });
    }

    if (newPassword.length < 8) {
      return response.status(400).json({
        message: "New password must be at least 8 characters long",
      });
    }

    const user = await prisma.users.findUnique({
      where: {
        id: userId,
      },
    });

    if (!user) {
      return response.status(404).json({
        message: "User not found",
      });
    }

    const currentPasswordMatches = await bcrypt.compare(
      currentPassword,
      user.password_hash,
    );

    if (!currentPasswordMatches) {
      return response.status(400).json({
        message: "Current password is incorrect",
      });
    }

    const sameAsOldPassword = await bcrypt.compare(
      newPassword,
      user.password_hash,
    );

    if (sameAsOldPassword) {
      return response.status(400).json({
        message: "New password must be different from the current password",
      });
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    await prisma.users.update({
      where: {
        id: userId,
      },
      data: {
        password_hash: newPasswordHash,
        updated_at: new Date(),
      },
    });

    return response.status(200).json({
      message: "Password changed successfully",
    });
  } catch (error) {
    console.error("Change password error:", error);

    return response.status(500).json({
      message: "Something went wrong while changing the password",
    });
  }
};
