import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import multer from "multer";

/*
|--------------------------------------------------------------------------
| Chat image upload directory
|--------------------------------------------------------------------------
|
| Images are stored separately from other uploads:
|
| uploads/
|   chat-images/
|
| The database will store the public URL:
|
| /uploads/chat-images/filename.jpg
|--------------------------------------------------------------------------
*/

const CHAT_IMAGE_UPLOAD_DIRECTORY = path.resolve(
  process.cwd(),
  "uploads",
  "chat-images",
);

/*
|--------------------------------------------------------------------------
| Ensure upload directory exists
|--------------------------------------------------------------------------
*/

if (!fs.existsSync(CHAT_IMAGE_UPLOAD_DIRECTORY)) {
  fs.mkdirSync(CHAT_IMAGE_UPLOAD_DIRECTORY, {
    recursive: true,
  });
}

/*
|--------------------------------------------------------------------------
| Allowed image types
|--------------------------------------------------------------------------
|
| We intentionally do NOT allow arbitrary files.
|--------------------------------------------------------------------------
*/

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

const ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

/*
|--------------------------------------------------------------------------
| Storage
|--------------------------------------------------------------------------
*/

const storage = multer.diskStorage({
  destination: (_request, _file, callback) => {
    callback(null, CHAT_IMAGE_UPLOAD_DIRECTORY);
  },

  filename: (_request, file, callback) => {
    const originalExtension = path.extname(file.originalname).toLowerCase();

    /*
     * If the uploaded filename has an unexpected extension,
     * derive a safe extension from MIME type.
     */
    let extension = originalExtension;

    if (!ALLOWED_EXTENSIONS.has(extension)) {
      switch (file.mimetype) {
        case "image/png":
          extension = ".png";
          break;

        case "image/webp":
          extension = ".webp";
          break;

        case "image/jpeg":
        case "image/jpg":
        default:
          extension = ".jpg";
          break;
      }
    }

    /*
     * Do not use the original filename.
     *
     * This avoids:
     * - filename collisions
     * - unsafe characters
     * - leaking original filenames
     */
    const uniqueName = [Date.now(), crypto.randomUUID()].join("-");

    callback(null, `${uniqueName}${extension}`);
  },
});

/*
|--------------------------------------------------------------------------
| Image validation
|--------------------------------------------------------------------------
*/

const fileFilter: multer.Options["fileFilter"] = (_request, file, callback) => {
  const extension = path.extname(file.originalname).toLowerCase();

  const validMimeType = ALLOWED_MIME_TYPES.has(file.mimetype);

  const validExtension = ALLOWED_EXTENSIONS.has(extension);

  if (!validMimeType || !validExtension) {
    callback(new Error("CHAT_IMAGE_INVALID_TYPE"));

    return;
  }

  callback(null, true);
};

/*
|--------------------------------------------------------------------------
| Multer configuration
|--------------------------------------------------------------------------
|
| Limit:
| 5 MB per image
|
| One image per message.
|--------------------------------------------------------------------------
*/

export const chatImageUpload = multer({
  storage,

  fileFilter,

  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
  },
});

/*
|--------------------------------------------------------------------------
| Delete uploaded image
|--------------------------------------------------------------------------
|
| If database creation fails after Multer has already saved the image,
| the controller will use this helper to remove the orphaned file.
|--------------------------------------------------------------------------
*/

export async function deleteChatImageFile(
  filePath: string | undefined,
): Promise<void> {
  if (!filePath) {
    return;
  }

  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    /*
     * ENOENT simply means the file has already been removed.
     */
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }

    console.error("Failed to delete chat image:", error);
  }
}

/*
|--------------------------------------------------------------------------
| Build public image URL
|--------------------------------------------------------------------------
*/

export function getChatImagePublicUrl(filename: string): string {
  return `/uploads/chat-images/${filename}`;
}
