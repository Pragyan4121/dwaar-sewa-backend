import type { Request, Response } from "express";
import type { AuthenticatedRequest } from "../middlewares/auth.middleware";
import { prisma } from "../config/prisma";
import { ROLE_NAMES } from "../constants/roles";

const APPROVED_PROVIDER_STATUS = "approved";

function parsePositiveInteger(value: unknown): number | null {
  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    return null;
  }

  return parsedValue;
}
/*
|--------------------------------------------------------------------------
| Authenticated provider: Get own profile/session
|--------------------------------------------------------------------------
*/

export const getMyProviderProfile = async (
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
          name: ROLE_NAMES.PROVIDER,
        },
      },
      select: {
        id: true,
        full_name: true,
        phone: true,
        email: true,
        email_verified_at: true,
        role_id: true,
        is_active: true,
        created_at: true,
        updated_at: true,

        provider_profiles_provider_profiles_provider_idTousers: {
          select: {
            id: true,
            address: true,
            profile_photo_url: true,
            years_of_experience: true,
            bio: true,
            verification_status: true,
            verification_note: true,
            verified_at: true,
            suspended_at: true,
            rejection_reason: true,
            average_rating: true,
            total_reviews: true,
            total_completed_jobs: true,
            created_at: true,
            updated_at: true,
          },
        },

        providerCategories: {
          select: {
            id: true,
            category_id: true,
            created_at: true,
            service_categories: {
              select: {
                id: true,
                name: true,
                slug: true,
                description: true,
                image_url: true,
                is_active: true,
              },
            },
          },
          orderBy: {
            created_at: "asc",
          },
        },
        provider_experience_types: {
          select: {
            id: true,
            experience_type_id: true,
            created_at: true,
            experience_types: {
              select: {
                id: true,
                name: true,
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
        message: "Provider account not found",
      });
    }

    const profile =
      provider.provider_profiles_provider_profiles_provider_idTousers;

    return response.status(200).json({
      message: "Provider profile fetched successfully",

      provider: {
        id: provider.id,
        full_name: provider.full_name,
        phone: provider.phone,
        email: provider.email,
        email_verified: Boolean(provider.email_verified_at),
        email_verified_at: provider.email_verified_at,
        role_id: provider.role_id,
        role_name: ROLE_NAMES.PROVIDER,
        is_active: Boolean(provider.is_active),
        joined_at: provider.created_at,
        updated_at: provider.updated_at,

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
              suspended_at: profile.suspended_at,
              rejection_reason: profile.rejection_reason,
              average_rating: profile.average_rating,
              total_reviews: profile.total_reviews,
              total_completed_jobs: profile.total_completed_jobs,
              created_at: profile.created_at,
              updated_at: profile.updated_at,
            }
          : null,

        categories: provider.providerCategories.map((providerCategory) => ({
          id: providerCategory.id,
          category_id: providerCategory.category_id,
          created_at: providerCategory.created_at,
          category: providerCategory.service_categories,
        })),

        experiences: provider.provider_experience_types.map(
          (providerExperience) => ({
            id: providerExperience.id,
            experience_type_id: providerExperience.experience_type_id,
            created_at: providerExperience.created_at,
            experience_type: providerExperience.experience_types,
          }),
        ),
      },
    });
  } catch (error) {
    console.error("Get own provider profile error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching the provider profile",
    });
  }
};
/*
|--------------------------------------------------------------------------
| Authenticated provider: Update own profile
|--------------------------------------------------------------------------
*/

export const updateMyProviderProfile = async (
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

    const {
      fullName,
      phone,
      address,
      bio,
      yearsOfExperience,
      profilePhotoUrl,
    } = request.body;

    const existingProvider = await prisma.users.findFirst({
      where: {
        id: providerId,
        is_active: true,
        roles: {
          name: ROLE_NAMES.PROVIDER,
        },
      },
      select: {
        id: true,
        phone: true,
        provider_profiles_provider_profiles_provider_idTousers: {
          select: {
            id: true,
          },
        },
      },
    });

    if (!existingProvider) {
      return response.status(404).json({
        message: "Provider account not found",
      });
    }

    const userUpdateData: {
      full_name?: string;
      phone?: string;
      updated_at: Date;
    } = {
      updated_at: new Date(),
    };

    const profileUpdateData: {
      address?: string | null;
      bio?: string | null;
      years_of_experience?: number;
      profile_photo_url?: string | null;
      updated_at: Date;
    } = {
      updated_at: new Date(),
    };

    if (fullName !== undefined) {
      if (
        typeof fullName !== "string" ||
        fullName.trim().length < 2 ||
        fullName.trim().length > 100
      ) {
        return response.status(400).json({
          message: "Full name must contain between 2 and 100 characters",
          field: "fullName",
        });
      }

      userUpdateData.full_name = fullName.trim();
    }

    if (phone !== undefined) {
      if (
        typeof phone !== "string" ||
        !/^[0-9+\-\s]{7,20}$/.test(phone.trim())
      ) {
        return response.status(400).json({
          message: "Enter a valid phone number",
          field: "phone",
        });
      }

      const normalizedPhone = phone.trim();

      if (normalizedPhone !== existingProvider.phone) {
        const phoneAlreadyExists = await prisma.users.findFirst({
          where: {
            phone: normalizedPhone,
            id: {
              not: providerId,
            },
          },
          select: {
            id: true,
          },
        });

        if (phoneAlreadyExists) {
          return response.status(409).json({
            message: "This phone number is already used by another account",
            field: "phone",
          });
        }
      }

      userUpdateData.phone = normalizedPhone;
    }

    if (address !== undefined) {
      if (
        address !== null &&
        (typeof address !== "string" || address.trim().length > 500)
      ) {
        return response.status(400).json({
          message: "Address must not exceed 500 characters",
          field: "address",
        });
      }

      profileUpdateData.address =
        typeof address === "string" && address.trim().length > 0
          ? address.trim()
          : null;
    }

    if (bio !== undefined) {
      if (
        bio !== null &&
        (typeof bio !== "string" || bio.trim().length > 1000)
      ) {
        return response.status(400).json({
          message: "Bio must not exceed 1000 characters",
          field: "bio",
        });
      }

      profileUpdateData.bio =
        typeof bio === "string" && bio.trim().length > 0 ? bio.trim() : null;
    }

    if (yearsOfExperience !== undefined) {
      const parsedYears = Number(yearsOfExperience);

      if (
        !Number.isInteger(parsedYears) ||
        parsedYears < 0 ||
        parsedYears > 80
      ) {
        return response.status(400).json({
          message: "Years of experience must be between 0 and 80",
          field: "yearsOfExperience",
        });
      }

      profileUpdateData.years_of_experience = parsedYears;
    }

    if (profilePhotoUrl !== undefined) {
      if (profilePhotoUrl !== null && typeof profilePhotoUrl !== "string") {
        return response.status(400).json({
          message: "Profile photo URL must be text",
          field: "profilePhotoUrl",
        });
      }

      profileUpdateData.profile_photo_url =
        typeof profilePhotoUrl === "string" && profilePhotoUrl.trim().length > 0
          ? profilePhotoUrl.trim()
          : null;
    }

    const hasUserUpdates =
      userUpdateData.full_name !== undefined ||
      userUpdateData.phone !== undefined;

    const hasProfileUpdates =
      profileUpdateData.address !== undefined ||
      profileUpdateData.bio !== undefined ||
      profileUpdateData.years_of_experience !== undefined ||
      profileUpdateData.profile_photo_url !== undefined;

    if (!hasUserUpdates && !hasProfileUpdates) {
      return response.status(400).json({
        message: "No profile changes were provided",
      });
    }

    await prisma.$transaction(async (transaction) => {
      if (hasUserUpdates) {
        await transaction.users.update({
          where: {
            id: providerId,
          },
          data: userUpdateData,
        });
      }

      if (hasProfileUpdates) {
        const providerProfile =
          existingProvider.provider_profiles_provider_profiles_provider_idTousers;

        if (providerProfile) {
          await transaction.provider_profiles.update({
            where: {
              id: providerProfile.id,
            },
            data: profileUpdateData,
          });
        } else {
          await transaction.provider_profiles.create({
            data: {
              provider_id: providerId,
              address: profileUpdateData.address ?? null,
              bio: profileUpdateData.bio ?? null,
              years_of_experience: profileUpdateData.years_of_experience ?? 0,
              profile_photo_url: profileUpdateData.profile_photo_url ?? null,
              verification_status: "pending",
              is_available: false,
            },
          });
        }
      }
    });

    const updatedProvider = await prisma.users.findUnique({
      where: {
        id: providerId,
      },
      select: {
        id: true,
        full_name: true,
        phone: true,
        email: true,
        email_verified_at: true,
        role_id: true,
        is_active: true,
        created_at: true,
        updated_at: true,

        provider_profiles_provider_profiles_provider_idTousers: {
          select: {
            id: true,
            address: true,
            profile_photo_url: true,
            years_of_experience: true,
            bio: true,
            verification_status: true,
            verification_note: true,
            verified_at: true,
            suspended_at: true,
            rejection_reason: true,
            average_rating: true,
            total_reviews: true,
            total_completed_jobs: true,
            is_available: true,
            created_at: true,
            updated_at: true,
          },
        },
      },
    });

    return response.status(200).json({
      message: "Provider profile updated successfully",
      provider: updatedProvider,
    });
  } catch (error) {
    console.error("Update provider profile error:", error);

    return response.status(500).json({
      message: "Something went wrong while updating the provider profile",
    });
  }
};
/*
|--------------------------------------------------------------------------
| Public provider profile
|--------------------------------------------------------------------------
*/

export const getProviderProfile = async (
  request: Request,
  response: Response,
) => {
  try {
    const providerId = parsePositiveInteger(request.params.id);

    if (!providerId) {
      return response.status(400).json({
        message: "Invalid provider ID",
      });
    }

    const provider = await prisma.users.findFirst({
      where: {
        id: providerId,
        is_active: true,
        roles: {
          name: ROLE_NAMES.PROVIDER,
        },
        provider_profiles_provider_profiles_provider_idTousers: {
          is: {
            verification_status: APPROVED_PROVIDER_STATUS,
          },
        },
      },
      select: {
        id: true,
        full_name: true,
        created_at: true,

        provider_profiles_provider_profiles_provider_idTousers: {
          select: {
            address: true,
            profile_photo_url: true,
            years_of_experience: true,
            bio: true,
            verification_status: true,
            average_rating: true,
            total_reviews: true,
            total_completed_jobs: true,
          },
        },

        provider_experience_types: {
          select: {
            id: true,
            experience_type_id: true,
            experience_types: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },

        reviews_reviews_provider_idTousers: {
          where: {
            is_visible: true,
          },
          select: {
            id: true,
            rating: true,
            comment: true,
            created_at: true,
            users_reviews_customer_idTousers: {
              select: {
                id: true,
                full_name: true,
              },
            },
          },
          orderBy: {
            created_at: "desc",
          },
          take: 20,
        },
      },
    });

    if (!provider) {
      return response.status(404).json({
        message: "Approved provider not found",
      });
    }

    const profile =
      provider.provider_profiles_provider_profiles_provider_idTousers;

    return response.status(200).json({
      message: "Provider profile fetched successfully",
      provider: {
        id: provider.id,
        full_name: provider.full_name,
        joined_at: provider.created_at,

        profile_photo_url: profile?.profile_photo_url ?? null,
        address: profile?.address ?? null,
        years_of_experience: profile?.years_of_experience ?? 0,
        bio: profile?.bio ?? null,
        verification_status: profile?.verification_status ?? null,
        average_rating: profile?.average_rating ?? 0,
        total_reviews: profile?.total_reviews ?? 0,
        total_completed_jobs: profile?.total_completed_jobs ?? 0,

        experiences: provider.provider_experience_types.map(
          (providerExperience) => ({
            id: providerExperience.id,
            experience_type_id: providerExperience.experience_type_id,
            name: providerExperience.experience_types.name,
          }),
        ),

        reviews: provider.reviews_reviews_provider_idTousers.map((review) => ({
          id: review.id,
          rating: review.rating,
          comment: review.comment,
          created_at: review.created_at,
          customer: {
            id: review.users_reviews_customer_idTousers.id,
            full_name: review.users_reviews_customer_idTousers.full_name,
          },
        })),
      },
    });
  } catch (error: unknown) {
    console.error("Get provider profile error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching the provider profile",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Public approved provider list
|--------------------------------------------------------------------------
*/

export const getActiveProviders = async (
  request: Request,
  response: Response,
) => {
  try {
    const page = Math.max(Number(request.query.page) || 1, 1);

    const limit = Math.min(Math.max(Number(request.query.limit) || 20, 1), 100);

    const search =
      typeof request.query.search === "string"
        ? request.query.search.trim()
        : "";

    const minimumRatingValue = Number(request.query.minimumRating);

    const hasMinimumRating =
      Number.isFinite(minimumRatingValue) &&
      minimumRatingValue >= 0 &&
      minimumRatingValue <= 5;

    const where = {
      is_active: true,

      roles: {
        name: ROLE_NAMES.PROVIDER,
      },

      provider_profiles_provider_profiles_provider_idTousers: {
        is: {
          verification_status: APPROVED_PROVIDER_STATUS,

          ...(hasMinimumRating
            ? {
                average_rating: {
                  gte: minimumRatingValue,
                },
              }
            : {}),
        },
      },

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
                provider_profiles_provider_profiles_provider_idTousers: {
                  is: {
                    bio: {
                      contains: search,
                      mode: "insensitive" as const,
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [providers, total] = await prisma.$transaction([
      prisma.users.findMany({
        where,

        select: {
          id: true,
          full_name: true,
          created_at: true,

          provider_profiles_provider_profiles_provider_idTousers: {
            select: {
              address: true,
              profile_photo_url: true,
              years_of_experience: true,
              bio: true,
              verification_status: true,
              average_rating: true,
              total_reviews: true,
              total_completed_jobs: true,
            },
          },

          provider_experience_types: {
            select: {
              id: true,
              experience_type_id: true,
              experience_types: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },

        orderBy: [
          {
            provider_profiles_provider_profiles_provider_idTousers: {
              average_rating: "desc",
            },
          },
          {
            created_at: "desc",
          },
        ],

        skip: (page - 1) * limit,
        take: limit,
      }),

      prisma.users.count({
        where,
      }),
    ]);

    return response.status(200).json({
      message: "Approved providers fetched successfully",

      providers: providers.map((provider) => {
        const profile =
          provider.provider_profiles_provider_profiles_provider_idTousers;

        return {
          id: provider.id,
          full_name: provider.full_name,
          joined_at: provider.created_at,

          profile_photo_url: profile?.profile_photo_url ?? null,
          address: profile?.address ?? null,
          years_of_experience: profile?.years_of_experience ?? 0,
          bio: profile?.bio ?? null,
          average_rating: profile?.average_rating ?? 0,
          total_reviews: profile?.total_reviews ?? 0,
          total_completed_jobs: profile?.total_completed_jobs ?? 0,

          experiences: provider.provider_experience_types.map(
            (providerExperience) => ({
              id: providerExperience.id,
              experience_type_id: providerExperience.experience_type_id,
              name: providerExperience.experience_types.name,
            }),
          ),
        };
      }),

      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    });
  } catch (error: unknown) {
    console.error("Get active providers error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching providers",
    });
  }
};
