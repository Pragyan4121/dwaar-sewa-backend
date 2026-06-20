import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

interface AuthTokenPayload {
  userId: number;
  roleId: number;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthTokenPayload;
}

export const authenticateUser = (
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
) => {
  try {
    const authorizationHeader = request.headers.authorization;

    if (!authorizationHeader?.startsWith("Bearer ")) {
      return response.status(401).json({
        message: "Authentication token is required",
      });
    }

    const token = authorizationHeader.split(" ")[1];
    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      throw new Error("JWT_SECRET is missing from the .env file");
    }

    const decodedToken = jwt.verify(token, jwtSecret) as AuthTokenPayload;

    request.user = decodedToken;

    return next();
  } catch (error) {
    return response.status(401).json({
      message: "Invalid or expired authentication token",
    });
  }
};
