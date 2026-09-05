import type { Response } from "express";
import { prisma } from "../config/prisma";
import type { AuthenticatedRequest } from "../middlewares/auth.middleware";

const verificationStatuses = [
  "pending",
  "approved",
  "rejected",
  "suspended",
] as const;

type VerificationStatus = (typeof verificationStatuses)[number];

const getProviderRoleId = async () => {
  const providerRole = await prisma.roles.findUnique({
    where: {
      name: "provider",
    },
    select: {
      id: true,
    },
  });

  return providerRole?.id ?? null;
};

/*
|--------------------------------------------------------------------------
| Admin: Get all providers
|--------------------------------------------------------------------------
|
| GET /api/admin/providers
|
| Optional query:
| ?search=Ram
| ?status=pending
| ?accountStatus=active
| ?page=1
| ?limit=20
|
|--------------------------------------------------------------------------
*/

export const getAllProvidersForAdmin = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const providerRoleId = await getProviderRoleId();

    if (!providerRoleId) {
      return response.status(500).json({
        message: "Provider role is not configured in the database",
      });
    }

    const search =
      typeof request.query.search === "string"
        ? request.query.search.trim()
        : "";

    const verificationStatusValue =
      typeof request.query.status === "string"
        ? request.query.status.trim().toLowerCase()
        : "all";

    const accountStatusValue =
      typeof request.query.accountStatus === "string"
        ? request.query.accountStatus.trim().toLowerCase()
        : "all";

    const requestedPage = Number(request.query.page ?? 1);

    const requestedLimit = Number(request.query.limit ?? 20);

    const page =
      Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;

    const limit =
      Number.isInteger(requestedLimit) &&
      requestedLimit > 0 &&
      requestedLimit <= 100
        ? requestedLimit
        : 20;

    const skip = (page - 1) * limit;

    let verificationStatus: VerificationStatus | undefined;

    if (verificationStatusValue && verificationStatusValue !== "all") {
      if (
        !verificationStatuses.includes(
          verificationStatusValue as VerificationStatus,
        )
      ) {
        return response.status(400).json({
          message: "Invalid provider verification status",
        });
      }

      verificationStatus = verificationStatusValue as VerificationStatus;
    }

    let isActive: boolean | undefined;

    if (accountStatusValue && accountStatusValue !== "all") {
      if (accountStatusValue === "active") {
        isActive = true;
      } else if (accountStatusValue === "inactive") {
        isActive = false;
      } else {
        return response.status(400).json({
          message: "Account status must be active, inactive, or all",
        });
      }
    }

    const userWhere = {
      role_id: providerRoleId,

      ...(isActive !== undefined
        ? {
            is_active: isActive,
          }
        : {}),

      ...(search
        ? {
            OR: [
              {
                full_name: {
                  contains: search,
                  mode: "insensitive" as const,
                },
              },
              {
                phone: {
                  contains: search,
                },
              },
              {
                email: {
                  contains: search,
                  mode: "insensitive" as const,
                },
              },
            ],
          }
        : {}),
    };

    const matchingProfileProviderIds = verificationStatus
      ? await prisma.provider_profiles.findMany({
          where: {
            verification_status: verificationStatus,
          },
          select: {
            provider_id: true,
          },
        })
      : [];

    const providerIdsForStatus = matchingProfileProviderIds.map(
      (profile) => profile.provider_id,
    );

    const finalUserWhere = {
      ...userWhere,

      ...(verificationStatus
        ? {
            id: {
              in: providerIdsForStatus,
            },
          }
        : {}),
    };

    const [providers, totalRecords] = await prisma.$transaction([
      prisma.users.findMany({
        where: finalUserWhere,
        skip,
        take: limit,
        orderBy: {
          created_at: "desc",
        },
        select: {
          id: true,
          full_name: true,
          phone: true,
          email: true,
          is_active: true,
          created_at: true,
          updated_at: true,
        },
      }),

      prisma.users.count({
        where: finalUserWhere,
      }),
    ]);

    const providerIds = providers.map((provider) => provider.id);

    const [
      profiles,
      experienceLinks,
      documents,
      totalPending,
      totalVerified,
      totalRejected,
      totalSuspended,
      totalActive,
      totalInactive,
    ] = await Promise.all([
      prisma.provider_profiles.findMany({
        where: {
          provider_id: {
            in: providerIds,
          },
        },
      }),

      prisma.provider_experience_types.findMany({
        where: {
          provider_id: {
            in: providerIds,
          },
        },
      }),

      prisma.provider_documents.findMany({
        where: {
          provider_id: {
            in: providerIds,
          },
        },
        select: {
          id: true,
          provider_id: true,
          verification_status: true,
        },
      }),

      prisma.provider_profiles.count({
        where: {
          verification_status: "pending",
        },
      }),

      prisma.provider_profiles.count({
        where: {
          verification_status: "approved",
        },
      }),

      prisma.provider_profiles.count({
        where: {
          verification_status: "rejected",
        },
      }),

      prisma.provider_profiles.count({
        where: {
          verification_status: "suspended",
        },
      }),

      prisma.users.count({
        where: {
          role_id: providerRoleId,
          is_active: true,
        },
      }),

      prisma.users.count({
        where: {
          role_id: providerRoleId,
          is_active: false,
        },
      }),
    ]);

    const experienceTypeIds = [
      ...new Set(experienceLinks.map((link) => link.experience_type_id)),
    ];

    const experienceTypes =
      experienceTypeIds.length > 0
        ? await prisma.experience_types.findMany({
            where: {
              id: {
                in: experienceTypeIds,
              },
            },
            select: {
              id: true,
              name: true,
              slug: true,
              is_active: true,
            },
          })
        : [];

    const providersWithDetails = providers.map((provider) => {
      const profile = profiles.find((item) => item.provider_id === provider.id);

      const linkedExperiences = experienceLinks
        .filter((link) => link.provider_id === provider.id)
        .map((link) =>
          experienceTypes.find((type) => type.id === link.experience_type_id),
        )
        .filter((type): type is (typeof experienceTypes)[number] =>
          Boolean(type),
        );

      const providerDocuments = documents.filter(
        (document) => document.provider_id === provider.id,
      );

      return {
        ...provider,

        profile: profile
          ? {
              id: profile.id,
              address: profile.address,
              profile_photo_url: profile.profile_photo_url,
              years_of_experience: profile.years_of_experience,
              bio: profile.bio,
              verification_status: profile.verification_status,
              verification_note: profile.verification_note,
              verified_at: profile.verified_at,
              verified_by: profile.verified_by,
              suspended_at: profile.suspended_at,
              rejection_reason: profile.rejection_reason,
              average_rating: profile.average_rating,
              total_reviews: profile.total_reviews,
              total_completed_jobs: profile.total_completed_jobs,
            }
          : null,

        experience_types: linkedExperiences,

        documents_summary: {
          total: providerDocuments.length,
          pending: providerDocuments.filter(
            (document) => document.verification_status === "pending",
          ).length,
          verified: providerDocuments.filter(
            (document) => document.verification_status === "approved",
          ).length,
          rejected: providerDocuments.filter(
            (document) => document.verification_status === "rejected",
          ).length,
        },
      };
    });

    const totalPages = Math.ceil(totalRecords / limit);

    return response.status(200).json({
      message: "Providers fetched successfully",
      providers: providersWithDetails,

      summary: {
        pending: totalPending,
        verified: totalVerified,
        rejected: totalRejected,
        suspended: totalSuspended,
        active_accounts: totalActive,
        inactive_accounts: totalInactive,
      },

      filters: {
        search: search || null,
        status: verificationStatusValue || "all",
        account_status: accountStatusValue || "all",
      },

      pagination: {
        page,
        limit,
        total_records: totalRecords,
        total_pages: totalPages,
        has_next_page: page < totalPages,
        has_previous_page: page > 1,
      },
    });
  } catch (error) {
    console.error("Admin get providers error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching providers",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin: Get provider details
|--------------------------------------------------------------------------
|
| GET /api/admin/providers/:id
|
|--------------------------------------------------------------------------
*/

export const getProviderByIdForAdmin = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const providerId = Number(request.params.id);

    if (!Number.isInteger(providerId) || providerId <= 0) {
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
        updated_at: true,
      },
    });

    if (!provider) {
      return response.status(404).json({
        message: "Provider not found",
      });
    }

    const [
      profile,
      experienceLinks,
      documents,
      bookingCount,
      completedBookingCount,
      cancelledBookingCount,
      reviews,
    ] = await Promise.all([
      prisma.provider_profiles.findUnique({
        where: {
          provider_id: providerId,
        },
      }),

      prisma.provider_experience_types.findMany({
        where: {
          provider_id: providerId,
        },
      }),

      prisma.provider_documents.findMany({
        where: {
          provider_id: providerId,
        },
        orderBy: {
          created_at: "desc",
        },
      }),

      prisma.bookings.count({
        where: {
          provider_id: providerId,
        },
      }),

      prisma.bookings.count({
        where: {
          provider_id: providerId,
          status: "completed",
        },
      }),

      prisma.bookings.count({
        where: {
          provider_id: providerId,
          status: "cancelled",
        },
      }),

      prisma.reviews.findMany({
        where: {
          provider_id: providerId,
        },
        orderBy: {
          created_at: "desc",
        },
        take: 20,
      }),
    ]);

    const experienceTypeIds = experienceLinks.map(
      (link) => link.experience_type_id,
    );

    const experienceTypes =
      experienceTypeIds.length > 0
        ? await prisma.experience_types.findMany({
            where: {
              id: {
                in: experienceTypeIds,
              },
            },
            orderBy: [
              {
                display_order: "asc",
              },
              {
                name: "asc",
              },
            ],
          })
        : [];

    return response.status(200).json({
      message: "Provider fetched successfully",

      provider: {
        ...provider,
        profile,
        experience_types: experienceTypes,
        documents,

        job_summary: {
          total_bookings: bookingCount,
          completed_bookings: completedBookingCount,
          cancelled_bookings: cancelledBookingCount,
        },

        recent_reviews: reviews,
      },
    });
  } catch (error) {
    console.error("Admin get provider detail error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching provider details",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin: Verify provider
|--------------------------------------------------------------------------
|
| PATCH /api/admin/providers/:id/verify
|
|--------------------------------------------------------------------------
*/

export const verifyProviderForAdmin = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const adminId = request.user?.userId;
    const providerId = Number(request.params.id);

    const verificationNote =
      typeof request.body.verificationNote === "string"
        ? request.body.verificationNote.trim()
        : "";

    if (!adminId) {
      return response.status(401).json({
        message: "Admin is not authenticated",
      });
    }

    if (!Number.isInteger(providerId) || providerId <= 0) {
      return response.status(400).json({
        message: "Invalid provider ID",
      });
    }

    const providerRoleId = await getProviderRoleId();

    const provider = await prisma.users.findFirst({
      where: {
        id: providerId,
        role_id: providerRoleId ?? -1,
      },
      select: {
        id: true,
        full_name: true,
      },
    });

    if (!provider) {
      return response.status(404).json({
        message: "Provider not found",
      });
    }

    const now = new Date();

    const profile = await prisma.provider_profiles.upsert({
      where: {
        provider_id: providerId,
      },
      create: {
        provider_id: providerId,
        verification_status: "approved",
        verification_note: verificationNote || null,
        verified_at: now,
        verified_by: adminId,
        suspended_at: null,
        rejection_reason: null,
        updated_at: now,
      },
      update: {
        verification_status: "approved",
        verification_note: verificationNote || null,
        verified_at: now,
        verified_by: adminId,
        suspended_at: null,
        rejection_reason: null,
        updated_at: now,
      },
    });

    await prisma.users.update({
      where: {
        id: providerId,
      },
      data: {
        is_active: true,
        updated_at: now,
      },
    });

    return response.status(200).json({
      message: "Provider verified successfully",
      profile,
    });
  } catch (error) {
    console.error("Admin verify provider error:", error);

    return response.status(500).json({
      message: "Something went wrong while verifying the provider",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin: Reject provider
|--------------------------------------------------------------------------
|
| PATCH /api/admin/providers/:id/reject
|
| Body:
| {
|   "reason": "Citizenship document is unclear"
| }
|
|--------------------------------------------------------------------------
*/

export const rejectProviderForAdmin = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const adminId = request.user?.userId;
    const providerId = Number(request.params.id);
    const reason = request.body.reason;

    if (!adminId) {
      return response.status(401).json({
        message: "Admin is not authenticated",
      });
    }

    if (!Number.isInteger(providerId) || providerId <= 0) {
      return response.status(400).json({
        message: "Invalid provider ID",
      });
    }

    if (typeof reason !== "string" || reason.trim().length < 5) {
      return response.status(400).json({
        message: "A rejection reason of at least 5 characters is required",
      });
    }

    if (reason.trim().length > 500) {
      return response.status(400).json({
        message: "Rejection reason must not exceed 500 characters",
      });
    }

    const providerRoleId = await getProviderRoleId();

    const provider = await prisma.users.findFirst({
      where: {
        id: providerId,
        role_id: providerRoleId ?? -1,
      },
      select: {
        id: true,
      },
    });

    if (!provider) {
      return response.status(404).json({
        message: "Provider not found",
      });
    }

    const now = new Date();

    const profile = await prisma.provider_profiles.upsert({
      where: {
        provider_id: providerId,
      },
      create: {
        provider_id: providerId,
        verification_status: "rejected",
        rejection_reason: reason.trim(),
        verification_note: null,
        verified_at: null,
        verified_by: adminId,
        suspended_at: null,
        updated_at: now,
      },
      update: {
        verification_status: "rejected",
        rejection_reason: reason.trim(),
        verification_note: null,
        verified_at: null,
        verified_by: adminId,
        suspended_at: null,
        updated_at: now,
      },
    });

    await prisma.users.update({
      where: {
        id: providerId,
      },
      data: {
        is_active: false,
        updated_at: now,
      },
    });

    return response.status(200).json({
      message: "Provider rejected successfully",
      profile,
    });
  } catch (error) {
    console.error("Admin reject provider error:", error);

    return response.status(500).json({
      message: "Something went wrong while rejecting the provider",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin: Suspend provider
|--------------------------------------------------------------------------
|
| PATCH /api/admin/providers/:id/suspend
|
|--------------------------------------------------------------------------
*/

export const suspendProviderForAdmin = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const adminId = request.user?.userId;
    const providerId = Number(request.params.id);

    const reason =
      typeof request.body.reason === "string" ? request.body.reason.trim() : "";

    if (!adminId) {
      return response.status(401).json({
        message: "Admin is not authenticated",
      });
    }

    if (!Number.isInteger(providerId) || providerId <= 0) {
      return response.status(400).json({
        message: "Invalid provider ID",
      });
    }

    if (reason.length > 500) {
      return response.status(400).json({
        message: "Suspension reason must not exceed 500 characters",
      });
    }

    const providerRoleId = await getProviderRoleId();

    const provider = await prisma.users.findFirst({
      where: {
        id: providerId,
        role_id: providerRoleId ?? -1,
      },
      select: {
        id: true,
      },
    });

    if (!provider) {
      return response.status(404).json({
        message: "Provider not found",
      });
    }

    const now = new Date();

    const profile = await prisma.provider_profiles.upsert({
      where: {
        provider_id: providerId,
      },
      create: {
        provider_id: providerId,
        verification_status: "suspended",
        verification_note: reason || "Suspended by administrator.",
        suspended_at: now,
        verified_by: adminId,
        updated_at: now,
      },
      update: {
        verification_status: "suspended",
        verification_note: reason || "Suspended by administrator.",
        suspended_at: now,
        verified_by: adminId,
        updated_at: now,
      },
    });

    await prisma.users.update({
      where: {
        id: providerId,
      },
      data: {
        is_active: false,
        updated_at: now,
      },
    });

    return response.status(200).json({
      message: "Provider suspended successfully",
      profile,
    });
  } catch (error) {
    console.error("Admin suspend provider error:", error);

    return response.status(500).json({
      message: "Something went wrong while suspending the provider",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin: Reactivate provider
|--------------------------------------------------------------------------
|
| PATCH /api/admin/providers/:id/reactivate
|
|--------------------------------------------------------------------------
*/

export const reactivateProviderForAdmin = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const adminId = request.user?.userId;
    const providerId = Number(request.params.id);

    if (!adminId) {
      return response.status(401).json({
        message: "Admin is not authenticated",
      });
    }

    if (!Number.isInteger(providerId) || providerId <= 0) {
      return response.status(400).json({
        message: "Invalid provider ID",
      });
    }

    const providerRoleId = await getProviderRoleId();

    const provider = await prisma.users.findFirst({
      where: {
        id: providerId,
        role_id: providerRoleId ?? -1,
      },
      select: {
        id: true,
      },
    });

    if (!provider) {
      return response.status(404).json({
        message: "Provider not found",
      });
    }

    const existingProfile = await prisma.provider_profiles.findUnique({
      where: {
        provider_id: providerId,
      },
    });

    const restoredStatus = existingProfile?.verified_at
      ? "approved"
      : "pending";

    const now = new Date();

    const profile = await prisma.provider_profiles.upsert({
      where: {
        provider_id: providerId,
      },
      create: {
        provider_id: providerId,
        verification_status: "pending",
        verification_note: "Provider account reactivated by administrator.",
        verified_by: adminId,
        suspended_at: null,
        rejection_reason: null,
        updated_at: now,
      },
      update: {
        verification_status: restoredStatus,
        verification_note: "Provider account reactivated by administrator.",
        verified_by: adminId,
        suspended_at: null,
        rejection_reason: null,
        updated_at: now,
      },
    });

    await prisma.users.update({
      where: {
        id: providerId,
      },
      data: {
        is_active: true,
        updated_at: now,
      },
    });

    return response.status(200).json({
      message: "Provider reactivated successfully",
      profile,
    });
  } catch (error) {
    console.error("Admin reactivate provider error:", error);

    return response.status(500).json({
      message: "Something went wrong while reactivating the provider",
    });
  }
};
