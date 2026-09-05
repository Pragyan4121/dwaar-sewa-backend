import fs from "node:fs";
import path from "node:path";

import multer, { type FileFilterCallback } from "multer";
import type { Request } from "express";

const uploadRootDirectory = path.resolve(process.cwd(), "uploads", "providers");

const profilePhotoDirectory = path.join(uploadRootDirectory, "profile-photos");

const documentDirectory = path.join(uploadRootDirectory, "documents");

for (const directory of [profilePhotoDirectory, documentDirectory]) {
  fs.mkdirSync(directory, {
    recursive: true,
  });
}

const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

function sanitizeFileName(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();

  const baseName = path
    .basename(fileName, extension)
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

  return `${baseName || "file"}${extension}`;
}

function createStorage(destinationDirectory: string) {
  return multer.diskStorage({
    destination: (_request, _file, callback) => {
      callback(null, destinationDirectory);
    },

    filename: (_request, file, callback) => {
      const safeOriginalName = sanitizeFileName(file.originalname);

      const uniqueFileName = [
        Date.now(),
        Math.round(Math.random() * 1_000_000_000),
        safeOriginalName,
      ].join("-");

      callback(null, uniqueFileName);
    },
  });
}

function fileFilter(
  _request: Request,
  file: Express.Multer.File,
  callback: FileFilterCallback,
) {
  if (!allowedMimeTypes.has(file.mimetype)) {
    callback(new Error("Only JPG, JPEG, PNG, WEBP and PDF files are allowed"));

    return;
  }

  callback(null, true);
}

const commonUploadOptions = {
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
  },
  fileFilter,
};

export const uploadProviderProfilePhoto = multer({
  ...commonUploadOptions,
  storage: createStorage(profilePhotoDirectory),
}).single("file");

export const uploadProviderDocument = multer({
  ...commonUploadOptions,
  storage: createStorage(documentDirectory),
}).single("file");
