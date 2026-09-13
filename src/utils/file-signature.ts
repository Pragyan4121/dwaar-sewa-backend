import fs from "node:fs/promises";

/*
|--------------------------------------------------------------------------
| File signature ("magic bytes") verification
|--------------------------------------------------------------------------
|
| multer's fileFilter only checks the Content-Type header the client
| chose to send, which is trivially spoofable. This reads the first few
| bytes actually written to disk and checks them against the real file
| signature for each MIME type we claim to accept, so a client can't
| upload an arbitrary file by mislabeling it as an image or PDF.
|--------------------------------------------------------------------------
*/

type AllowedUploadMimeType =
  | "image/jpeg"
  | "image/jpg"
  | "image/png"
  | "image/webp"
  | "application/pdf";

function matchesSignature(buffer: Buffer, signature: number[]): boolean {
  if (buffer.length < signature.length) {
    return false;
  }

  return signature.every((byte, index) => buffer[index] === byte);
}

function isValidWebp(buffer: Buffer): boolean {
  // RIFF....WEBP
  if (buffer.length < 12) {
    return false;
  }

  const isRiff = matchesSignature(buffer, [0x52, 0x49, 0x46, 0x46]);
  const isWebp =
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50;

  return isRiff && isWebp;
}

function matchesDeclaredType(
  buffer: Buffer,
  declaredMimeType: AllowedUploadMimeType,
): boolean {
  switch (declaredMimeType) {
    case "image/jpeg":
    case "image/jpg":
      return matchesSignature(buffer, [0xff, 0xd8, 0xff]);
    case "image/png":
      return matchesSignature(
        buffer,
        [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      );
    case "image/webp":
      return isValidWebp(buffer);
    case "application/pdf":
      return matchesSignature(buffer, [0x25, 0x50, 0x44, 0x46]); // "%PDF"
    default:
      return false;
  }
}

/**
 * Verifies that a file already written to disk by multer actually starts
 * with the byte signature expected for its declared (client-supplied)
 * MIME type. Returns false (and the caller should delete the file) if
 * the content does not match what the client claimed it was.
 */
export async function verifyUploadedFileSignature(
  filePath: string,
  declaredMimeType: string,
): Promise<boolean> {
  const allowed: AllowedUploadMimeType[] = [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "application/pdf",
  ];

  if (!allowed.includes(declaredMimeType as AllowedUploadMimeType)) {
    return false;
  }

  const fileHandle = await fs.open(filePath, "r");

  try {
    const headerBuffer = Buffer.alloc(12);
    await fileHandle.read(headerBuffer, 0, 12, 0);

    return matchesDeclaredType(
      headerBuffer,
      declaredMimeType as AllowedUploadMimeType,
    );
  } finally {
    await fileHandle.close();
  }
}
