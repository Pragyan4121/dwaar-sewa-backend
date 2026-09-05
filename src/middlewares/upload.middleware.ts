import fs from "fs";
import path from "path";
import multer from "multer";

const categoryUploadDirectory = path.join(
  process.cwd(),
  "uploads",
  "categories",
);

if (!fs.existsSync(categoryUploadDirectory)) {
  fs.mkdirSync(categoryUploadDirectory, {
    recursive: true,
  });
}

const storage = multer.diskStorage({
  destination: (_request, _file, callback) => {
    callback(null, categoryUploadDirectory);
  },

  filename: (_request, file, callback) => {
    const extension = path.extname(file.originalname) || ".jpg";

    const safeExtension = extension.toLowerCase();

    const uniqueName = `category-${Date.now()}-${Math.round(
      Math.random() * 1_000_000_000,
    )}${safeExtension}`;

    callback(null, uniqueName);
  },
});

const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

const fileFilter: multer.Options["fileFilter"] = (_request, file, callback) => {
  if (!allowedMimeTypes.has(file.mimetype)) {
    callback(new Error("Only JPG, PNG and WebP images are allowed."));

    return;
  }

  callback(null, true);
};

export const upload = multer({
  storage,

  fileFilter,

  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});
