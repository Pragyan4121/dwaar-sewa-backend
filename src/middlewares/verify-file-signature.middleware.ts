import fs from "node:fs/promises";

import type { NextFunction, Request, Response } from "express";

import { verifyUploadedFileSignature } from "../utils/file-signature";

/*
|--------------------------------------------------------------------------
| verifyFileSignature
|--------------------------------------------------------------------------
|
| Place this AFTER a multer single-file middleware (upload.single(...)).
| If the uploaded file's real bytes don't match the MIME type multer's
| fileFilter accepted (which only trusted the client-supplied
| Content-Type), the file is deleted from disk and the request is
| rejected with 400 before it reaches the controller.
|--------------------------------------------------------------------------
*/
export async function verifyFileSignature(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  const file = request.file;

  if (!file) {
    return next();
  }

  try {
    const isGenuine = await verifyUploadedFileSignature(
      file.path,
      file.mimetype,
    );

    if (!isGenuine) {
      await fs.unlink(file.path).catch(() => undefined);

      return response.status(400).json({
        message:
          "The uploaded file's content does not match its declared type.",
      });
    }

    return next();
  } catch (error) {
    console.error("File signature verification error:", error);

    await fs.unlink(file.path).catch(() => undefined);

    return response.status(400).json({
      message: "Unable to verify the uploaded file.",
    });
  }
}
