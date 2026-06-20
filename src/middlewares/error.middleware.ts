import { NextFunction, Request, Response } from "express";

export const errorHandler = (
  error: unknown,
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  console.error("Unhandled error:", error);

  return response.status(500).json({
    message: "Internal server error",
  });
};
