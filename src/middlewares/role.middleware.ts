import { NextFunction, Response } from "express";
import { AuthenticatedRequest } from "./auth.middleware";

export const allowRoles = (...allowedRoleIds: number[]) => {
  return (
    request: AuthenticatedRequest,
    response: Response,
    next: NextFunction,
  ) => {
    const roleId = request.user?.roleId;

    if (!roleId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    if (!allowedRoleIds.includes(roleId)) {
      return response.status(403).json({
        message: "You do not have permission to access this resource",
      });
    }

    return next();
  };
};
