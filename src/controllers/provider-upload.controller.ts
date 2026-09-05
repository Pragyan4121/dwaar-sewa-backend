import fs from "node:fs/promises";
import path from "node:path";

import type { Response } from "express";

import { prisma } from "../config/prisma";
import { ROLE_NAMES } from "../constants/roles";
import type { AuthenticatedRequest } from "../middlewares/auth.middleware";

function buildPublicFileUrl(
  request: AuthenticatedRequest,
  relativePath: string,
): string {
  const normalizedPath = relativePath.replace(/\\/g, "/");

  return `${request.protocol}://${request.get("host")}/${normalizedPath}`;
}

async function deleteUploadedFile(filePath: string | undefined) {
  if (!filePath) {
    return;
  }

  try {
    await fs.unlink(filePath);
  } catch {
    // Ignore cleanup errors because the API response
    // should still report the original validation issue.
  }
}

function ensureProvider(
  request: AuthenticatedRequest,
  response: Response,
): number | null {
  const authenticatedUser = request.user;

  if (!authenticatedUser) {
    response.status(401).json({
      message: "User is not authenticated",
    });

    return null;
  }

  if (authenticatedUser.roleName !== ROLE_NAMES.PROVIDER) {
    response.status(403).json({
      message: "Only provider accounts can upload files",
    });

    return null;
  }

  return authenticatedUser.userId;
}

export const uploadProfilePhoto = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  const providerId = ensureProvider(request, response);

  if (!providerId) {
    await deleteUploadedFile(request.file?.path);

    return;
  }

  if (!request.file) {
    return response.status(400).json({
      message: 'Profile photo is required in the "file" field',
      field: "file",
    });
  }

  try {
    if (!request.file.mimetype.startsWith("image/")) {
      await deleteUploadedFile(request.file.path);

      return response.status(400).json({
        message: "Profile photo must be an image",
        field: "file",
      });
    }

    const providerProfile = await prisma.provider_profiles.findUnique({
      where: {
        provider_id: providerId,
      },
      select: {
        id: true,
      },
    });

    if (!providerProfile) {
      await deleteUploadedFile(request.file.path);

      return response.status(404).json({
        message: "Provider profile not found",
      });
    }

    const relativePath = path
      .relative(process.cwd(), request.file.path)
      .replace(/\\/g, "/");

    const fileUrl = buildPublicFileUrl(request, relativePath);

    await prisma.provider_profiles.update({
      where: {
        provider_id: providerId,
      },
      data: {
        profile_photo_url: fileUrl,
        updated_at: new Date(),
      },
    });

    return response.status(200).json({
      message: "Profile photo uploaded successfully",
      file: {
        file_url: fileUrl,
        original_name: request.file.originalname,
        mime_type: request.file.mimetype,
        size_bytes: request.file.size,
      },
    });
  } catch (error: unknown) {
    await deleteUploadedFile(request.file.path);

    console.error("Upload provider profile photo error:", error);

    return response.status(500).json({
      message: "Something went wrong while uploading the profile photo",
    });
  }
};

export const uploadDocumentFile = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  const providerId = ensureProvider(request, response);

  if (!providerId) {
    await deleteUploadedFile(request.file?.path);

    return;
  }

  if (!request.file) {
    return response.status(400).json({
      message: 'Document file is required in the "file" field',
      field: "file",
    });
  }

  try {
    const providerProfile = await prisma.provider_profiles.findUnique({
      where: {
        provider_id: providerId,
      },
      select: {
        id: true,
      },
    });

    if (!providerProfile) {
      await deleteUploadedFile(request.file.path);

      return response.status(404).json({
        message: "Provider profile not found",
      });
    }

    const relativePath = path
      .relative(process.cwd(), request.file.path)
      .replace(/\\/g, "/");

    const fileUrl = buildPublicFileUrl(request, relativePath);

    return response.status(201).json({
      message: "Provider document file uploaded successfully",
      file: {
        file_url: fileUrl,
        original_name: request.file.originalname,
        mime_type: request.file.mimetype,
        size_bytes: request.file.size,
      },
      next_step: {
        method: "POST",
        endpoint: "/api/provider-registration/documents",
        required_body: {
          documentType: "government_id_front",
          documentNumber: "optional document number",
          fileUrl,
        },
      },
    });
  } catch (error: unknown) {
    await deleteUploadedFile(request.file.path);

    console.error("Upload provider document error:", error);

    return response.status(500).json({
      message: "Something went wrong while uploading the provider document",
    });
  }
};
