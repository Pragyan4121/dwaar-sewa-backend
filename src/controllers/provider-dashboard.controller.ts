import type { Response } from "express";

import { prisma } from "../config/prisma";
import type { AuthenticatedRequest } from "../middlewares/auth.middleware";

/*
|--------------------------------------------------------------------------
| Provider: Dashboard
|--------------------------------------------------------------------------
*/

export const getProviderDashboard = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const providerId = request.user?.userId;

    if (!providerId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    const provider = await prisma.users.findFirst({
      where: {
        id: providerId,
        is_active: true,
        roles: {
          name: "provider",
        },
      },
      select: {
        id: true,
        full_name: true,
        email: true,
        provider_profiles_provider_profiles_provider_idTousers: {
          select: {
            id: true,
            verification_status: true,
            is_available: true,
            average_rating: true,
            total_reviews: true,
            total_completed_jobs: true,
          },
        },
        providerCategories: {
          select: {
            category_id: true,
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

    const providerCategoryIds = provider.providerCategories.map(
      (item) => item.category_id,
    );

    const [
      acceptedJobs,
      assignedJobs,
      inProgressJobs,
      completedJobs,
      cancelledJobs,
      availableBookings,
      recentBookings,
    ] = await Promise.all([
      prisma.bookings.count({
        where: {
          provider_id: providerId,
          status: "accepted",
        },
      }),

      prisma.bookings.count({
        where: {
          provider_id: providerId,
          status: "assigned",
        },
      }),

      prisma.bookings.count({
        where: {
          provider_id: providerId,
          status: "in_progress",
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

      providerCategoryIds.length > 0
        ? prisma.bookings.count({
            where: {
              provider_id: null,
              status: "pending",
              services: {
                category_id: {
                  in: providerCategoryIds,
                },
                is_active: true,
              },
            },
          })
        : Promise.resolve(0),

      prisma.bookings.findMany({
        where: {
          provider_id: providerId,
        },
        orderBy: {
          updated_at: "desc",
        },
        take: 5,
        select: {
          id: true,
          status: true,
          service_address: true,
          service_area: true,
          preferred_date: true,
          preferred_time: true,
          estimated_price: true,
          final_price: true,
          created_at: true,
          updated_at: true,
          services: {
            select: {
              id: true,
              name: true,
              base_price: true,
              service_categories: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                },
              },
            },
          },
          users_bookings_customer_idTousers: {
            select: {
              id: true,
              full_name: true,
              phone: true,
            },
          },
        },
      }),
    ]);

    const activeJobs = acceptedJobs + assignedJobs + inProgressJobs;

    return response.status(200).json({
      message: "Provider dashboard fetched successfully",

      provider: {
        id: provider.id,
        full_name: provider.full_name,
        email: provider.email,
        verification_status: profile?.verification_status ?? "pending",
        is_available: profile?.is_available ?? false,
        average_rating: profile?.average_rating ?? 0,
        total_reviews: profile?.total_reviews ?? 0,
        total_completed_jobs: profile?.total_completed_jobs ?? completedJobs,
      },

      statistics: {
        available_requests: availableBookings,
        active_jobs: activeJobs,
        accepted_jobs: acceptedJobs,
        assigned_jobs: assignedJobs,
        in_progress_jobs: inProgressJobs,
        completed_jobs: completedJobs,
        cancelled_jobs: cancelledJobs,
      },

      recent_bookings: recentBookings,
    });
  } catch (error) {
    console.error("Provider dashboard error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching the provider dashboard",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Provider: Update availability
|--------------------------------------------------------------------------
*/

export const updateProviderAvailability = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const providerId = request.user?.userId;
    const isAvailable = request.body.isAvailable;

    if (!providerId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    if (typeof isAvailable !== "boolean") {
      return response.status(400).json({
        message: "isAvailable must be true or false",
        field: "isAvailable",
      });
    }

    const provider = await prisma.users.findFirst({
      where: {
        id: providerId,
        is_active: true,
        roles: {
          name: "provider",
        },
      },
      select: {
        id: true,
        provider_profiles_provider_profiles_provider_idTousers: {
          select: {
            id: true,
            verification_status: true,
            is_available: true,
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

    if (!profile) {
      return response.status(404).json({
        message: "Provider profile not found",
      });
    }

    if (isAvailable && profile.verification_status !== "approved") {
      return response.status(403).json({
        message: "Only approved providers can become available for jobs",
        code: "PROVIDER_NOT_APPROVED",
        verification_status: profile.verification_status,
      });
    }

    if (profile.is_available === isAvailable) {
      return response.status(200).json({
        message: isAvailable
          ? "Provider is already online"
          : "Provider is already offline",
        is_available: isAvailable,
      });
    }

    const updatedProfile = await prisma.provider_profiles.update({
      where: {
        id: profile.id,
      },
      data: {
        is_available: isAvailable,
        updated_at: new Date(),
      },
      select: {
        id: true,
        verification_status: true,
        is_available: true,
        updated_at: true,
      },
    });

    return response.status(200).json({
      message: updatedProfile.is_available
        ? "Provider is now online"
        : "Provider is now offline",

      availability: {
        is_available: updatedProfile.is_available,
        verification_status: updatedProfile.verification_status,
        updated_at: updatedProfile.updated_at,
      },
    });
  } catch (error) {
    console.error("Update provider availability error:", error);

    return response.status(500).json({
      message: "Something went wrong while updating provider availability",
    });
  }
};
