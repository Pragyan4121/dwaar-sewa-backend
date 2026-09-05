import type { NextFunction, Response } from "express";

import { prisma } from "../config/prisma";
import { ROLE_NAMES } from "../constants/roles";
import type { AuthenticatedRequest } from "./auth.middleware";

const APPROVED_PROVIDER_STATUS = "approved";

export const requireApprovedProvider = async (
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
) => {
  try {
    const authenticatedUser = request.user;

    if (!authenticatedUser) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    if (authenticatedUser.roleName !== ROLE_NAMES.PROVIDER) {
      return response.status(403).json({
        message: "Only provider accounts can access this resource",
      });
    }

    const providerProfile = await prisma.provider_profiles.findUnique({
      where: {
        provider_id: authenticatedUser.userId,
      },
      select: {
        provider_id: true,
        verification_status: true,
      },
    });

    if (!providerProfile) {
      return response.status(403).json({
        message:
          "Provider profile is incomplete. Please complete provider registration.",
        provider_status: "profile_missing",
      });
    }

    const providerStatus = providerProfile.verification_status
      .trim()
      .toLowerCase();

    if (providerStatus !== APPROVED_PROVIDER_STATUS) {
      let message = "Your provider account is not approved yet";

      if (providerStatus === "pending") {
        message = "Your provider registration is pending admin review";
      }

      if (providerStatus === "rejected") {
        message = "Your provider registration was rejected";
      }

      if (providerStatus === "suspended") {
        message = "Your provider account has been suspended";
      }

      return response.status(403).json({
        message,
        provider_status: providerStatus,
      });
    }

    return next();
  } catch (error: unknown) {
    console.error("Provider approval middleware error:", error);

    return response.status(500).json({
      message: "Something went wrong while checking provider approval",
    });
  }
};
