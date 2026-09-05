import type { Response } from "express";

import { prisma } from "../config/prisma";
import { ROLE_NAMES } from "../constants/roles";
import type { AuthenticatedRequest } from "../middlewares/auth.middleware";

const ALLOWED_DOCUMENT_TYPES = [
  "government_id_front",
  "government_id_back",
  "citizenship",
  "driving_license",
  "passport",
  "police_clearance",
  "training_certificate",
  "experience_certificate",
  "other",
] as const;

type ProviderDocumentType = (typeof ALLOWED_DOCUMENT_TYPES)[number];

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isProviderDocumentType(value: string): value is ProviderDocumentType {
  return ALLOWED_DOCUMENT_TYPES.includes(value as ProviderDocumentType);
}

function parsePositiveInteger(value: unknown): number | null {
  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    return null;
  }

  return parsedValue;
}

async function getProviderProfile(providerId: number) {
  return prisma.provider_profiles.findUnique({
    where: {
      provider_id: providerId,
    },
    select: {
      id: true,
      provider_id: true,
      address: true,
      profile_photo_url: true,
      bio: true,
      verification_status: true,
    },
  });
}

export const createProviderDocument = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const authenticatedUser = request.user;

    if (!authenticatedUser) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    if (authenticatedUser.roleName !== ROLE_NAMES.PROVIDER) {
      return response.status(403).json({
        message: "Only provider accounts can upload provider documents",
      });
    }

    const documentType = normalizeText(request.body.documentType).toLowerCase();

    const documentNumber = normalizeText(request.body.documentNumber) || null;

    const fileUrl = normalizeText(request.body.fileUrl);

    if (!documentType) {
      return response.status(400).json({
        message: "Document type is required",
        field: "documentType",
      });
    }

    if (!isProviderDocumentType(documentType)) {
      return response.status(400).json({
        message: "Invalid document type",
        field: "documentType",
        allowed_document_types: ALLOWED_DOCUMENT_TYPES,
      });
    }

    if (!fileUrl) {
      return response.status(400).json({
        message: "Document file URL is required",
        field: "fileUrl",
      });
    }

    const profile = await getProviderProfile(authenticatedUser.userId);

    if (!profile) {
      return response.status(403).json({
        message: "Provider profile is incomplete",
        provider_status: "profile_missing",
      });
    }

    const existingDocument = await prisma.provider_documents.findFirst({
      where: {
        provider_id: authenticatedUser.userId,
        document_type: documentType,
      },
      select: {
        id: true,
        verification_status: true,
      },
    });

    if (existingDocument?.verification_status === "approved") {
      return response.status(409).json({
        message: "An approved document of this type already exists",
        document_id: existingDocument.id,
      });
    }

    let document;

    if (existingDocument) {
      document = await prisma.provider_documents.update({
        where: {
          id: existingDocument.id,
        },
        data: {
          document_number: documentNumber,
          file_url: fileUrl,
          verification_status: "pending",
          rejection_reason: null,
          reviewed_at: null,
          reviewed_by: null,
          updated_at: new Date(),
        },
        select: {
          id: true,
          document_type: true,
          document_number: true,
          file_url: true,
          verification_status: true,
          rejection_reason: true,
          created_at: true,
          updated_at: true,
        },
      });
    } else {
      document = await prisma.provider_documents.create({
        data: {
          provider_id: authenticatedUser.userId,
          document_type: documentType,
          document_number: documentNumber,
          file_url: fileUrl,
          verification_status: "pending",
        },
        select: {
          id: true,
          document_type: true,
          document_number: true,
          file_url: true,
          verification_status: true,
          rejection_reason: true,
          created_at: true,
          updated_at: true,
        },
      });
    }

    /*
     * Re-submitting a rejected provider document returns the
     * provider application to pending review.
     */
    if (profile.verification_status === "rejected") {
      await prisma.provider_profiles.update({
        where: {
          provider_id: authenticatedUser.userId,
        },
        data: {
          verification_status: "pending",
          rejection_reason: null,
          verification_note: null,
          verified_at: null,
          verified_by: null,
          updated_at: new Date(),
        },
      });
    }

    return response.status(existingDocument ? 200 : 201).json({
      message: existingDocument
        ? "Provider document resubmitted successfully"
        : "Provider document uploaded successfully",
      document,
    });
  } catch (error: unknown) {
    console.error("Create provider document error:", error);

    return response.status(500).json({
      message: "Something went wrong while saving the provider document",
    });
  }
};

export const getMyProviderDocuments = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const authenticatedUser = request.user;

    if (!authenticatedUser) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    if (authenticatedUser.roleName !== ROLE_NAMES.PROVIDER) {
      return response.status(403).json({
        message: "Only provider accounts can access provider documents",
      });
    }

    const documents = await prisma.provider_documents.findMany({
      where: {
        provider_id: authenticatedUser.userId,
      },
      select: {
        id: true,
        document_type: true,
        document_number: true,
        file_url: true,
        verification_status: true,
        rejection_reason: true,
        reviewed_at: true,
        created_at: true,
        updated_at: true,
      },
      orderBy: {
        created_at: "asc",
      },
    });

    return response.status(200).json({
      message: "Provider documents fetched successfully",
      documents,
    });
  } catch (error: unknown) {
    console.error("Get provider documents error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching provider documents",
    });
  }
};

export const deleteMyProviderDocument = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const authenticatedUser = request.user;

    if (!authenticatedUser) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    if (authenticatedUser.roleName !== ROLE_NAMES.PROVIDER) {
      return response.status(403).json({
        message: "Only provider accounts can delete provider documents",
      });
    }

    const documentId = parsePositiveInteger(request.params.id);

    if (!documentId) {
      return response.status(400).json({
        message: "Invalid document ID",
      });
    }

    const document = await prisma.provider_documents.findFirst({
      where: {
        id: documentId,
        provider_id: authenticatedUser.userId,
      },
      select: {
        id: true,
        verification_status: true,
      },
    });

    if (!document) {
      return response.status(404).json({
        message: "Provider document not found",
      });
    }

    if (document.verification_status === "approved") {
      return response.status(409).json({
        message: "An approved document cannot be deleted",
      });
    }

    await prisma.provider_documents.delete({
      where: {
        id: document.id,
      },
    });

    return response.status(200).json({
      message: "Provider document deleted successfully",
    });
  } catch (error: unknown) {
    console.error("Delete provider document error:", error);

    return response.status(500).json({
      message: "Something went wrong while deleting the provider document",
    });
  }
};

export const getProviderRegistrationProgress = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const authenticatedUser = request.user;

    if (!authenticatedUser) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    if (authenticatedUser.roleName !== ROLE_NAMES.PROVIDER) {
      return response.status(403).json({
        message:
          "Only provider accounts can view provider registration progress",
      });
    }

    const provider = await prisma.users.findUnique({
      where: {
        id: authenticatedUser.userId,
      },
      select: {
        id: true,
        full_name: true,
        phone: true,
        email: true,
        provider_profiles_provider_profiles_provider_idTousers: {
          select: {
            address: true,
            profile_photo_url: true,
            bio: true,
            verification_status: true,
            verification_note: true,
            rejection_reason: true,
          },
        },
        providerCategories: {
          select: {
            id: true,
          },
        },
        provider_experience_types: {
          select: {
            id: true,
          },
        },
        provider_documents_provider_documents_provider_idTousers: {
          select: {
            id: true,
            document_type: true,
            verification_status: true,
          },
        },
      },
    });

    if (!provider) {
      return response.status(404).json({
        message: "Provider account not found",
      });
    }

    const profile =
      provider.provider_profiles_provider_profiles_provider_idTousers;

    const documents =
      provider.provider_documents_provider_documents_provider_idTousers;

    const hasGovernmentId = documents.some((document) =>
      [
        "government_id_front",
        "citizenship",
        "passport",
        "driving_license",
      ].includes(document.document_type),
    );

    const hasVerificationDocument = documents.some((document) =>
      [
        "police_clearance",
        "training_certificate",
        "experience_certificate",
        "other",
      ].includes(document.document_type),
    );

    const steps = {
      personal_details:
        Boolean(provider.full_name) &&
        Boolean(provider.phone) &&
        Boolean(profile?.address),
      profile_photo: Boolean(profile?.profile_photo_url),
      categories: provider.providerCategories.length > 0,
      experiences: provider.provider_experience_types.length > 0,
      government_id: hasGovernmentId,
      verification_document: hasVerificationDocument,
    };

    const completedSteps = Object.values(steps).filter(Boolean).length;

    const totalSteps = Object.keys(steps).length;

    const completionPercentage = Math.round(
      (completedSteps / totalSteps) * 100,
    );

    return response.status(200).json({
      message: "Provider registration progress fetched successfully",
      provider_status: profile?.verification_status || "profile_missing",
      verification_note: profile?.verification_note || null,
      rejection_reason: profile?.rejection_reason || null,
      steps,
      completed_steps: completedSteps,
      total_steps: totalSteps,
      completion_percentage: completionPercentage,
      registration_complete: completedSteps === totalSteps,
      documents: documents.map((document) => ({
        id: document.id,
        document_type: document.document_type,
        verification_status: document.verification_status,
      })),
    });
  } catch (error: unknown) {
    console.error("Get provider registration progress error:", error);

    return response.status(500).json({
      message:
        "Something went wrong while loading provider registration progress",
    });
  }
};
