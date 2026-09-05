import type { NextFunction, Response } from "express";

import type { RoleName } from "../constants/roles";
import type { AuthenticatedRequest } from "./auth.middleware";

/*
 * Numeric role IDs are temporarily supported so existing routes such as
 * allowRoles(3) continue working.
 *
 * New and updated routes must use role names:
 * allowRoles("admin")
 * allowRoles("provider")
 * allowRoles("customer")
 */
type AllowedRole = RoleName | number;

export const allowRoles = (...allowedRoles: AllowedRole[]) => {
  return (
    request: AuthenticatedRequest,
    response: Response,
    next: NextFunction,
  ) => {
    const authenticatedUser = request.user;

    if (!authenticatedUser) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    if (allowedRoles.length === 0) {
      console.error(
        "Authorization configuration error: no roles were provided",
      );

      return response.status(500).json({
        message: "Authorization configuration error",
      });
    }

    const hasPermission = allowedRoles.some((allowedRole) => {
      if (typeof allowedRole === "number") {
        return authenticatedUser.roleId === allowedRole;
      }

      return authenticatedUser.roleName === allowedRole;
    });

    if (!hasPermission) {
      return response.status(403).json({
        message: "You do not have permission to access this resource",
      });
    }

    return next();
  };
};
