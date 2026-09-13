import type { NextFunction, Request, Response } from "express";
import jwt, {
  type JwtPayload,
  JsonWebTokenError,
  TokenExpiredError,
} from "jsonwebtoken";

import { prisma } from "../config/prisma";
import { isRoleName, type RoleName } from "../constants/roles";

interface AuthenticationTokenPayload extends JwtPayload {
  userId?: number;
  roleId?: number;
  roleName?: RoleName;
}

export interface AuthenticatedUser {
  userId: number;
  roleId: number;
  roleName: RoleName;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

function extractBearerToken(
  authorizationHeader: string | undefined,
): string | null {
  if (!authorizationHeader) {
    return null;
  }

  const [scheme, token, ...remainingParts] = authorizationHeader
    .trim()
    .split(/\s+/);

  if (
    scheme?.toLowerCase() !== "bearer" ||
    !token ||
    remainingParts.length > 0
  ) {
    return null;
  }

  return token;
}

/*
 * The customer/provider apps send the JWT as a Bearer header (it's stored
 * in expo-secure-store, not accessible to a browser XSS payload). The
 * admin panel now receives its token as an httpOnly cookie instead, since
 * it's a browser SPA where an XSS bug could otherwise read a
 * header-only/localStorage token directly. Supporting both here lets one
 * middleware serve every client without weakening either.
 */
function extractToken(request: Request): string | null {
  const bearerToken = extractBearerToken(request.headers.authorization);

  if (bearerToken) {
    return bearerToken;
  }

  const cookieToken = (
    request as Request & { cookies?: Record<string, string> }
  ).cookies?.adminToken;

  return typeof cookieToken === "string" && cookieToken.length > 0
    ? cookieToken
    : null;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export const authenticateUser = async (
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
) => {
  try {
    const token = extractToken(request);

    if (!token) {
      return response.status(401).json({
        message: "Authentication token is required",
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

    const decodedToken = jwt.verify(
      token,
      jwtSecret,
    ) as AuthenticationTokenPayload;

    if (
      !isPositiveInteger(decodedToken.userId) ||
      !isPositiveInteger(decodedToken.roleId)
    ) {
      return response.status(401).json({
        message: "Invalid authentication token",
      });
    }

    const user = await prisma.users.findUnique({
      where: {
        id: decodedToken.userId,
      },
      select: {
        id: true,
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
        message: "User account no longer exists",
      });
    }

    if (!user.is_active) {
      return response.status(403).json({
        message: "This account is inactive",
      });
    }

    if (user.role_id !== decodedToken.roleId) {
      return response.status(401).json({
        message: "Your account permissions have changed. Please log in again.",
      });
    }

    const databaseRoleName = user.roles.name.trim().toLowerCase();

    if (!isRoleName(databaseRoleName)) {
      console.error(
        `Authentication error: unsupported role "${user.roles.name}" for user ${user.id}`,
      );

      return response.status(403).json({
        message: "This account has an unsupported role",
      });
    }

    /*
     * New tokens contain roleName.
     * Existing tokens may not contain it, so roleName is checked only
     * when it exists. This preserves compatibility during migration.
     */
    if (
      decodedToken.roleName !== undefined &&
      decodedToken.roleName !== databaseRoleName
    ) {
      return response.status(401).json({
        message: "Your account permissions have changed. Please log in again.",
      });
    }

    request.user = {
      userId: user.id,
      roleId: user.role_id,
      roleName: databaseRoleName,
    };

    return next();
  } catch (error: unknown) {
    if (error instanceof TokenExpiredError) {
      return response.status(401).json({
        message: "Authentication token has expired. Please log in again.",
      });
    }

    if (error instanceof JsonWebTokenError) {
      return response.status(401).json({
        message: "Invalid authentication token",
      });
    }

    console.error("Authentication middleware error:", error);

    return response.status(500).json({
      message: "Something went wrong while authenticating the user",
    });
  }
};
