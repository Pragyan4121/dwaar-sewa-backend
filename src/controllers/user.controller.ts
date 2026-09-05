import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import { prisma } from "../config/prisma";
import { ROLE_NAMES } from "../constants/roles";
import type { AuthenticatedRequest } from "../middlewares/auth.middleware";

function normalizePhone(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedEmail = value.trim().toLowerCase();

  return normalizedEmail || null;
}

export const registerUser = async (request: Request, response: Response) => {
  try {
    const fullName =
      typeof request.body.fullName === "string"
        ? request.body.fullName.trim()
        : "";

    const phone = normalizePhone(request.body.phone);
    const email = normalizeEmail(request.body.email);

    const password =
      typeof request.body.password === "string" ? request.body.password : "";

    if (!fullName || !phone || !password) {
      return response.status(400).json({
        message: "Full name, phone and password are required",
      });
    }

    if (password.length < 8) {
      return response.status(400).json({
        message: "Password must contain at least 8 characters",
      });
    }

    const customerRole = await prisma.roles.findUnique({
      where: {
        name: ROLE_NAMES.CUSTOMER,
      },
      select: {
        id: true,
        name: true,
      },
    });

    if (!customerRole) {
      return response.status(500).json({
        message: "Customer role is not configured in the database",
      });
    }

    /*
     * Phone and email are checked only inside the customer role.
     * The same phone/email may still be used for a separate
     * provider account.
     */
    const existingCustomer = await prisma.users.findFirst({
      where: {
        role_id: customerRole.id,
        OR: [
          {
            phone,
          },
          ...(email
            ? [
                {
                  email,
                },
              ]
            : []),
        ],
      },
      select: {
        id: true,
        phone: true,
        email: true,
      },
    });

    if (existingCustomer) {
      const duplicateField =
        existingCustomer.phone === phone ? "phone" : "email";

      return response.status(409).json({
        message: `A customer account with this ${duplicateField} already exists`,
        field: duplicateField,
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const newUser = await prisma.users.create({
      data: {
        full_name: fullName,
        phone,
        email,
        password_hash: passwordHash,
        role_id: customerRole.id,
        is_active: true,
      },
      select: {
        id: true,
        full_name: true,
        phone: true,
        email: true,
        role_id: true,
        is_active: true,
        created_at: true,
        roles: {
          select: {
            name: true,
          },
        },
      },
    });

    return response.status(201).json({
      message: "Customer registered successfully",
      user: {
        id: newUser.id,
        full_name: newUser.full_name,
        phone: newUser.phone,
        email: newUser.email,
        role_id: newUser.role_id,
        role_name: newUser.roles.name,
        is_active: newUser.is_active,
        created_at: newUser.created_at,
      },
    });
  } catch (error: unknown) {
    console.error("Customer registration error:", error);

    return response.status(500).json({
      message: "Something went wrong while registering the customer",
    });
  }
};

export const loginUser = async (request: Request, response: Response) => {
  try {
    const phone = normalizePhone(request.body.phone);
    const email = normalizeEmail(request.body.email);

    const password =
      typeof request.body.password === "string" ? request.body.password : "";

    if ((!phone && !email) || !password) {
      return response.status(400).json({
        message: "Phone or email and password are required",
      });
    }

    const customerRole = await prisma.roles.findUnique({
      where: {
        name: ROLE_NAMES.CUSTOMER,
      },
      select: {
        id: true,
        name: true,
      },
    });

    if (!customerRole) {
      return response.status(500).json({
        message: "Customer role is not configured in the database",
      });
    }

    /*
     * Search only inside the customer role.
     * A provider identity with the same phone or email cannot
     * authenticate through this endpoint.
     */
    const user = await prisma.users.findFirst({
      where: {
        role_id: customerRole.id,
        OR: [
          ...(phone
            ? [
                {
                  phone,
                },
              ]
            : []),
          ...(email
            ? [
                {
                  email,
                },
              ]
            : []),
        ],
      },
      select: {
        id: true,
        full_name: true,
        phone: true,
        email: true,
        password_hash: true,
        role_id: true,
        is_active: true,
        roles: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!user) {
      return response.status(401).json({
        message: "Invalid customer credentials",
      });
    }

    if (!user.is_active) {
      return response.status(403).json({
        message: "This customer account is inactive",
      });
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatches) {
      return response.status(401).json({
        message: "Invalid customer credentials",
      });
    }

    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      console.error(
        "Authentication configuration error: JWT_SECRET is missing",
      );

      return response.status(500).json({
        message: "Authentication configuration error",
      });
    }

    const expiresIn = process.env.JWT_EXPIRES_IN || "7d";

    const token = jwt.sign(
      {
        userId: user.id,
        roleId: user.role_id,
        roleName: ROLE_NAMES.CUSTOMER,
      },
      jwtSecret,
      {
        expiresIn: expiresIn as jwt.SignOptions["expiresIn"],
      },
    );

    return response.status(200).json({
      message: "Customer login successful",
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        phone: user.phone,
        email: user.email,
        role_id: user.role_id,
        role_name: user.roles.name,
        is_active: user.is_active,
      },
    });
  } catch (error: unknown) {
    console.error("Customer login error:", error);

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
        updated_at: true,
        roles: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!user) {
      return response.status(404).json({
        message: "User not found",
      });
    }

    return response.status(200).json({
      user: {
        id: user.id,
        full_name: user.full_name,
        phone: user.phone,
        email: user.email,
        role_id: user.role_id,
        role_name: user.roles.name,
        is_active: user.is_active,
        created_at: user.created_at,
        updated_at: user.updated_at,
      },
    });
  } catch (error: unknown) {
    console.error("Get profile error:", error);

    return response.status(500).json({
      message: "Something went wrong while loading the profile",
    });
  }
};
export const updateMyProfile = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const userId = request.user?.userId;
    const roleId = request.user?.roleId;

    if (!userId || !roleId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    const fullName =
      request.body.fullName !== undefined
        ? String(request.body.fullName).trim()
        : undefined;

    const email =
      request.body.email !== undefined
        ? normalizeEmail(request.body.email)
        : undefined;

    if (fullName !== undefined && !fullName) {
      return response.status(400).json({
        message: "Full name cannot be empty",
      });
    }

    /*
     * Email uniqueness is now checked inside the current role only.
     * A customer and provider may use the same email.
     */
    if (email) {
      const existingEmail = await prisma.users.findFirst({
        where: {
          email,
          role_id: roleId,
          NOT: {
            id: userId,
          },
        },
        select: {
          id: true,
        },
      });

      if (existingEmail) {
        return response.status(409).json({
          message:
            "Another account with this email already exists in the same role",
          field: "email",
        });
      }
    }

    const updatedUser = await prisma.users.update({
      where: {
        id: userId,
      },
      data: {
        ...(fullName !== undefined
          ? {
              full_name: fullName,
            }
          : {}),
        ...(email !== undefined
          ? {
              email,
            }
          : {}),
        updated_at: new Date(),
      },
      select: {
        id: true,
        full_name: true,
        phone: true,
        email: true,
        role_id: true,
        is_active: true,
        created_at: true,
        updated_at: true,
        roles: {
          select: {
            name: true,
          },
        },
      },
    });

    return response.status(200).json({
      message: "Profile updated successfully",
      user: {
        id: updatedUser.id,
        full_name: updatedUser.full_name,
        phone: updatedUser.phone,
        email: updatedUser.email,
        role_id: updatedUser.role_id,
        role_name: updatedUser.roles.name,
        is_active: updatedUser.is_active,
        created_at: updatedUser.created_at,
        updated_at: updatedUser.updated_at,
      },
    });
  } catch (error: unknown) {
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

    if (!userId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    const currentPassword =
      typeof request.body.currentPassword === "string"
        ? request.body.currentPassword
        : "";

    const newPassword =
      typeof request.body.newPassword === "string"
        ? request.body.newPassword
        : "";

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
      select: {
        id: true,
        password_hash: true,
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

    const sameAsCurrentPassword = await bcrypt.compare(
      newPassword,
      user.password_hash,
    );

    if (sameAsCurrentPassword) {
      return response.status(400).json({
        message: "New password must be different from the current password",
      });
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 12);

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
  } catch (error: unknown) {
    console.error("Change password error:", error);

    return response.status(500).json({
      message: "Something went wrong while changing the password",
    });
  }
};

export const createProvider = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const fullName =
      typeof request.body.fullName === "string"
        ? request.body.fullName.trim()
        : "";

    const phone = normalizePhone(request.body.phone);
    const email = normalizeEmail(request.body.email);

    const password =
      typeof request.body.password === "string" ? request.body.password : "";

    const address =
      typeof request.body.address === "string"
        ? request.body.address.trim()
        : "";

    if (!fullName) {
      return response.status(400).json({
        message: "Full name is required",
        field: "fullName",
      });
    }

    if (!phone) {
      return response.status(400).json({
        message: "Phone is required",
        field: "phone",
      });
    }

    if (!password) {
      return response.status(400).json({
        message: "Password is required",
        field: "password",
      });
    }

    if (password.length < 8) {
      return response.status(400).json({
        message: "Password must contain at least 8 characters",
        field: "password",
      });
    }

    const providerRole = await prisma.roles.findUnique({
      where: {
        name: ROLE_NAMES.PROVIDER,
      },
      select: {
        id: true,
        name: true,
      },
    });

    if (!providerRole) {
      return response.status(500).json({
        message: "Provider role is not configured in the database",
      });
    }

    const existingProvider = await prisma.users.findFirst({
      where: {
        role_id: providerRole.id,
        OR: [
          {
            phone,
          },
          ...(email
            ? [
                {
                  email,
                },
              ]
            : []),
        ],
      },
      select: {
        id: true,
        phone: true,
        email: true,
      },
    });

    if (existingProvider) {
      const duplicateField =
        existingProvider.phone === phone ? "phone" : "email";

      return response.status(409).json({
        message: `A provider account with this ${duplicateField} already exists`,
        field: duplicateField,
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const provider = await prisma.$transaction(async (transaction) => {
      const createdUser = await transaction.users.create({
        data: {
          full_name: fullName,
          phone,
          email,
          password_hash: passwordHash,
          role_id: providerRole.id,
          is_active: true,
        },
        select: {
          id: true,
          full_name: true,
          phone: true,
          email: true,
          role_id: true,
          is_active: true,
          created_at: true,
          roles: {
            select: {
              name: true,
            },
          },
        },
      });

      const createdProfile = await transaction.provider_profiles.create({
        data: {
          provider_id: createdUser.id,
          address: address || null,
          verification_status: "pending",
          years_of_experience: 0,
          average_rating: 0,
          total_reviews: 0,
          total_completed_jobs: 0,
        },
        select: {
          id: true,
          provider_id: true,
          address: true,
          verification_status: true,
          created_at: true,
        },
      });
      const createdWallet = await transaction.wallets.create({
        data: {
          user_id: createdUser.id,
          balance: 0,
          currency: "NPR",
          is_active: true,
        },
        select: {
          id: true,
          user_id: true,
          balance: true,
          currency: true,
          is_active: true,
          created_at: true,
        },
      });

      return {
        user: createdUser,
        profile: createdProfile,
        wallet: createdWallet,
      };
    });

    return response.status(201).json({
      message: "Provider created successfully and submitted for verification",
      provider: {
        id: provider.user.id,
        full_name: provider.user.full_name,
        phone: provider.user.phone,
        email: provider.user.email,
        role_id: provider.user.role_id,
        role_name: provider.user.roles.name,
        is_active: provider.user.is_active,
        verification_status: provider.profile.verification_status,
        address: provider.profile.address,
        wallet: {
          balance: provider.wallet.balance,
          currency: provider.wallet.currency,
          is_active: provider.wallet.is_active,
        },
        created_at: provider.user.created_at,
      },
    });
  } catch (error: unknown) {
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
        name: ROLE_NAMES.PROVIDER,
      },
      select: {
        id: true,
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
        role_id: true,
        is_active: true,
        created_at: true,
        updated_at: true,
      },
      orderBy: {
        created_at: "desc",
      },
    });

    return response.status(200).json({
      message: "Providers fetched successfully",
      providers,
    });
  } catch (error: unknown) {
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
    const isActive = request.body.isActive;

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
        name: ROLE_NAMES.PROVIDER,
      },
      select: {
        id: true,
      },
    });

    if (!providerRole) {
      return response.status(500).json({
        message: "Provider role is not configured in the database",
      });
    }

    const existingProvider = await prisma.users.findFirst({
      where: {
        id: providerId,
        role_id: providerRole.id,
      },
      select: {
        id: true,
      },
    });

    if (!existingProvider) {
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
  } catch (error: unknown) {
    console.error("Update provider status error:", error);

    return response.status(500).json({
      message: "Something went wrong while updating provider status",
    });
  }
};
