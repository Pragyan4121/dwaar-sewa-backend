import type { Response } from "express";

import { prisma } from "../config/prisma";
import { ROLE_NAMES } from "../constants/roles";
import type { AuthenticatedRequest } from "../middlewares/auth.middleware";

const ALLOWED_DOCUMENT_REVIEW_STATUSES = ["approved", "rejected"] as const;

type DocumentReviewStatus = (typeof ALLOWED_DOCUMENT_REVIEW_STATUSES)[number];

function parsePositiveInteger(value: unknown): number | null {
  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    return null;
  }

  return parsedValue;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isDocumentReviewStatus(value: string): value is DocumentReviewStatus {
  return ALLOWED_DOCUMENT_REVIEW_STATUSES.includes(
    value as DocumentReviewStatus,
  );
}

async function getProviderRoleId() {
  const providerRole = await prisma.roles.findUnique({
    where: {
      name: ROLE_NAMES.PROVIDER,
    },
    select: {
      id: true,
    },
  });

  return providerRole?.id ?? null;
}

/*
|--------------------------------------------------------------------------
| Get provider documents for Admin
|--------------------------------------------------------------------------
*/

export const getProviderDocumentsForAdmin = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const providerId = parsePositiveInteger(request.params.providerId);

    if (!providerId) {
      return response.status(400).json({
        message: "Invalid provider ID",
      });
    }

    const providerRoleId = await getProviderRoleId();

    if (!providerRoleId) {
      return response.status(500).json({
        message: "Provider role is not configured in the database",
      });
    }

    const provider = await prisma.users.findFirst({
      where: {
        id: providerId,
        role_id: providerRoleId,
      },
      select: {
        id: true,
        full_name: true,
        phone: true,
        email: true,
        is_active: true,
        created_at: true,
        provider_profiles_provider_profiles_provider_idTousers: {
          select: {
            verification_status: true,
            verification_note: true,
            rejection_reason: true,
          },
        },
        provider_documents_provider_documents_provider_idTousers: {
          select: {
            id: true,
            document_type: true,
            document_number: true,
            file_url: true,
            verification_status: true,
            rejection_reason: true,
            reviewed_at: true,
            reviewed_by: true,
            created_at: true,
            updated_at: true,
            users_provider_documents_reviewed_byTousers: {
              select: {
                id: true,
                full_name: true,
              },
            },
          },
          orderBy: {
            created_at: "asc",
          },
        },
      },
    });

    if (!provider) {
      return response.status(404).json({
        message: "Provider not found",
      });
    }

    const documents =
      provider.provider_documents_provider_documents_provider_idTousers;

    const summary = {
      total: documents.length,
      pending: documents.filter(
        (document) => document.verification_status === "pending",
      ).length,
      approved: documents.filter(
        (document) => document.verification_status === "approved",
      ).length,
      rejected: documents.filter(
        (document) => document.verification_status === "rejected",
      ).length,
    };

    return response.status(200).json({
      message: "Provider documents fetched successfully",
      provider: {
        id: provider.id,
        full_name: provider.full_name,
        phone: provider.phone,
        email: provider.email,
        is_active: provider.is_active,
        verification_status:
          provider.provider_profiles_provider_profiles_provider_idTousers
            ?.verification_status ?? "profile_missing",
        verification_note:
          provider.provider_profiles_provider_profiles_provider_idTousers
            ?.verification_note ?? null,
        rejection_reason:
          provider.provider_profiles_provider_profiles_provider_idTousers
            ?.rejection_reason ?? null,
        created_at: provider.created_at,
      },
      summary,
      documents: documents.map((document) => ({
        id: document.id,
        document_type: document.document_type,
        document_number: document.document_number,
        file_url: document.file_url,
        verification_status: document.verification_status,
        rejection_reason: document.rejection_reason,
        reviewed_at: document.reviewed_at,
        reviewed_by: document.users_provider_documents_reviewed_byTousers
          ? {
              id: document.users_provider_documents_reviewed_byTousers.id,
              full_name:
                document.users_provider_documents_reviewed_byTousers.full_name,
            }
          : null,
        created_at: document.created_at,
        updated_at: document.updated_at,
      })),
    });
  } catch (error: unknown) {
    console.error("Get provider documents for Admin error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching provider documents",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Review provider document
|--------------------------------------------------------------------------
*/

export const reviewProviderDocumentForAdmin = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const adminId = request.user?.userId;

    if (!adminId) {
      return response.status(401).json({
        message: "Administrator is not authenticated",
      });
    }

    const providerId = parsePositiveInteger(request.params.providerId);

    const documentId = parsePositiveInteger(request.params.documentId);

    if (!providerId) {
      return response.status(400).json({
        message: "Invalid provider ID",
      });
    }

    if (!documentId) {
      return response.status(400).json({
        message: "Invalid document ID",
      });
    }

    const status = normalizeText(request.body.status).toLowerCase();

    const rejectionReason = normalizeText(request.body.rejectionReason) || null;

    if (!isDocumentReviewStatus(status)) {
      return response.status(400).json({
        message: "Document review status must be approved or rejected",
        field: "status",
        allowed_statuses: ALLOWED_DOCUMENT_REVIEW_STATUSES,
      });
    }

    if (status === "rejected" && !rejectionReason) {
      return response.status(400).json({
        message: "Rejection reason is required when rejecting a document",
        field: "rejectionReason",
      });
    }

    const providerRoleId = await getProviderRoleId();

    if (!providerRoleId) {
      return response.status(500).json({
        message: "Provider role is not configured in the database",
      });
    }

    const provider = await prisma.users.findFirst({
      where: {
        id: providerId,
        role_id: providerRoleId,
      },
      select: {
        id: true,
        provider_profiles_provider_profiles_provider_idTousers: {
          select: {
            verification_status: true,
          },
        },
      },
    });

    if (!provider) {
      return response.status(404).json({
        message: "Provider not found",
      });
    }

    const document = await prisma.provider_documents.findFirst({
      where: {
        id: documentId,
        provider_id: providerId,
      },
      select: {
        id: true,
        document_type: true,
        verification_status: true,
      },
    });

    if (!document) {
      return response.status(404).json({
        message: "Provider document not found",
      });
    }

    const updatedDocument = await prisma.$transaction(async (transaction) => {
      const reviewedDocument = await transaction.provider_documents.update({
        where: {
          id: document.id,
        },
        data: {
          verification_status: status,
          rejection_reason: status === "rejected" ? rejectionReason : null,
          reviewed_at: new Date(),
          reviewed_by: adminId,
          updated_at: new Date(),
        },
        select: {
          id: true,
          provider_id: true,
          document_type: true,
          document_number: true,
          file_url: true,
          verification_status: true,
          rejection_reason: true,
          reviewed_at: true,
          reviewed_by: true,
          created_at: true,
          updated_at: true,
        },
      });

      /*
       * Rejecting any required document also marks the provider
       * application as rejected. The provider may resubmit the
       * rejected file, which returns the application to pending.
       */
      if (status === "rejected") {
        await transaction.provider_profiles.update({
          where: {
            provider_id: providerId,
          },
          data: {
            verification_status: "rejected",
            rejection_reason: rejectionReason,
            verification_note: `Document rejected: ${document.document_type}`,
            verified_at: null,
            verified_by: adminId,
            updated_at: new Date(),
          },
        });
      } else {
        const remainingRejectedDocuments =
          await transaction.provider_documents.count({
            where: {
              provider_id: providerId,
              verification_status: "rejected",
            },
          });

        if (
          remainingRejectedDocuments === 0 &&
          provider.provider_profiles_provider_profiles_provider_idTousers
            ?.verification_status === "rejected"
        ) {
          await transaction.provider_profiles.update({
            where: {
              provider_id: providerId,
            },
            data: {
              verification_status: "pending",
              rejection_reason: null,
              verification_note: null,
              verified_at: null,
              updated_at: new Date(),
            },
          });
        }
      }

      return reviewedDocument;
    });

    return response.status(200).json({
      message:
        status === "approved"
          ? "Provider document approved successfully"
          : "Provider document rejected successfully",
      document: updatedDocument,
    });
  } catch (error: unknown) {
    console.error("Review provider document for Admin error:", error);

    return response.status(500).json({
      message: "Something went wrong while reviewing the provider document",
    });
  }
};
