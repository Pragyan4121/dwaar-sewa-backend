import type {
  ErrorRequestHandler,
  NextFunction,
  Request,
  Response,
} from "express";

export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(statusCode: number, message: string, details?: unknown) {
    super(message);

    this.name = "ApiError";
    this.statusCode = statusCode;
    this.details = details;

    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  request: Request,
  response: Response,
  _next: NextFunction,
) => {
  if (error instanceof ApiError) {
    return response.status(error.statusCode).json({
      message: error.message,
      ...(error.details !== undefined
        ? {
            details: error.details,
          }
        : {}),
    });
  }

  console.error("Unhandled API error:", {
    method: request.method,
    path: request.originalUrl,
    error,
  });

  return response.status(500).json({
    message: "Internal server error",
  });
};
