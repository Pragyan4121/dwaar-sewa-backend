import bcrypt from "bcryptjs";
import type { Request, Response } from "express";
import jwt from "jsonwebtoken";

import { prisma } from "../config/prisma";
import { ROLE_NAMES, type RoleName } from "../constants/roles";
import type { AuthenticatedRequest } from "../middlewares/auth.middleware";
import { loginUser, registerUser } from "./user.controller";
import {
  createAndSendEmailOtp,
  EmailOtpServiceError,
  verifyEmailOtp,
} from "../services/email-otp.service";

/*
|--------------------------------------------------------------------------
| Shared helpers
|--------------------------------------------------------------------------
*/

function normalizePhone(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedEmail = value.trim().toLowerCase();

  return normalizedEmail || null;
}

function normalizeRequiredText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePositiveIntegerArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalizedValues = value
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0);

  return [...new Set(normalizedValues)];
}

function validatePassword(password: string): string | null {
  if (!password) {
    return "Password is required";
  }

  if (password.length < 8) {
    return "Password must contain at least 8 characters";
  }

  if (password.length > 128) {
    return "Password must not exceed 128 characters";
  }

  return null;
}

function createAccessToken(input: {
  userId: number;
  roleId: number;
  roleName: RoleName;
}): string {
  const jwtSecret = process.env.JWT_SECRET;

  if (!jwtSecret) {
    throw new Error("JWT_SECRET is missing from the environment");
  }

  const expiresIn = process.env.JWT_EXPIRES_IN || "7d";

  return jwt.sign(
    {
      userId: input.userId,
      roleId: input.roleId,
      roleName: input.roleName,
    },
    jwtSecret,
    {
      expiresIn: expiresIn as jwt.SignOptions["expiresIn"],
    },
  );
}
function createProviderPasswordResetToken(input: {
  userId: number;
  email: string;
}): string {
  const jwtSecret = process.env.JWT_SECRET;

  if (!jwtSecret) {
    throw new Error("JWT_SECRET is missing from the environment");
  }

  return jwt.sign(
    {
      userId: input.userId,
      email: input.email,
      purpose: "provider_password_reset",
    },
    jwtSecret,
    {
      expiresIn: "15m",
    },
  );
}
function formatProviderCategories(
  providerCategories: Array<{
    service_categories: {
      id: number;
      name: string;
      slug: string;
      description: string | null;
      image_url: string | null;
      display_order: number;
    };
  }>,
) {
  return providerCategories
    .map((providerCategory) => ({
      id: providerCategory.service_categories.id,
      name: providerCategory.service_categories.name,
      slug: providerCategory.service_categories.slug,
      description: providerCategory.service_categories.description,
      image_url: providerCategory.service_categories.image_url,
      display_order: providerCategory.service_categories.display_order,
    }))
    .sort(
      (firstCategory, secondCategory) =>
        firstCategory.display_order - secondCategory.display_order ||
        firstCategory.name.localeCompare(secondCategory.name),
    );
}

function formatProviderExperiences(
  providerExperiences: Array<{
    experience_types: {
      id: number;
      name: string;
      slug: string;
      description: string | null;
      display_order: number;
    };
  }>,
) {
  return providerExperiences
    .map((providerExperience) => ({
      id: providerExperience.experience_types.id,
      name: providerExperience.experience_types.name,
      slug: providerExperience.experience_types.slug,
      description: providerExperience.experience_types.description,
      display_order: providerExperience.experience_types.display_order,
    }))
    .sort(
      (firstExperience, secondExperience) =>
        firstExperience.display_order - secondExperience.display_order ||
        firstExperience.name.localeCompare(secondExperience.name),
    );
}

function formatProviderCategoryExperience(
  providerCategoryExperiences: Array<{
    service_categories: {
      id: number;
      name: string;
    };
    experience_types: {
      id: number;
      name: string;
    };
  }>,
) {
  return providerCategoryExperiences
    .map((entry) => ({
      category_id: entry.service_categories.id,
      category_name: entry.service_categories.name,
      experience_type: {
        id: entry.experience_types.id,
        name: entry.experience_types.name,
      },
    }))
    .sort((first, second) =>
      first.category_name.localeCompare(second.category_name),
    );
}

/*
|--------------------------------------------------------------------------
| Customer authentication
|--------------------------------------------------------------------------
| These wrappers preserve the completed customer app's behavior while also
| exposing explicit customer-only authentication endpoints.
|--------------------------------------------------------------------------
*/

export const registerCustomer = registerUser;

export const loginCustomer = loginUser;

/*
|--------------------------------------------------------------------------
| Provider registration
|--------------------------------------------------------------------------
*/

export const registerProvider = async (
  request: Request,
  response: Response,
) => {
  try {
    const fullName = normalizeRequiredText(request.body.fullName);

    const phone = normalizePhone(request.body.phone);

    const email = normalizeEmail(request.body.email);
    if (!email) {
      return response.status(400).json({
        message: "Email is required for provider registration",
        field: "email",
      });
    }

    const password =
      typeof request.body.password === "string" ? request.body.password : "";

    const address = normalizeRequiredText(request.body.address);

    const profilePhotoUrl =
      normalizeRequiredText(request.body.profilePhotoUrl) || null;

    const categoryIds = normalizePositiveIntegerArray(request.body.categoryIds);

    /*
     * Experience is selected per category (e.g. "Intermediate" for AC
     * Services, "Beginner" for Plumbing), not as one flat set shared
     * across every category. The client sends one { categoryId,
     * experienceTypeId } pair per selected category.
     */
    const categoryExperienceInput = Array.isArray(
      request.body.categoryExperience,
    )
      ? request.body.categoryExperience
      : [];

    const categoryExperiencePairs: {
      categoryId: number;
      experienceTypeId: number;
    }[] = categoryExperienceInput
      .map((entry: unknown) => {
        if (typeof entry !== "object" || entry === null) {
          return null;
        }

        const categoryId = Number(
          (entry as Record<string, unknown>).categoryId,
        );
        const experienceTypeId = Number(
          (entry as Record<string, unknown>).experienceTypeId,
        );

        if (
          !Number.isInteger(categoryId) ||
          categoryId <= 0 ||
          !Number.isInteger(experienceTypeId) ||
          experienceTypeId <= 0
        ) {
          return null;
        }

        return { categoryId, experienceTypeId };
      })
      .filter(
        (
          pair: { categoryId: number; experienceTypeId: number } | null,
        ): pair is { categoryId: number; experienceTypeId: number } =>
          pair !== null,
      );

    if (!fullName) {
      return response.status(400).json({
        message: "Full name is required",
        field: "fullName",
      });
    }

    if (fullName.length > 100) {
      return response.status(400).json({
        message: "Full name must not exceed 100 characters",
        field: "fullName",
      });
    }

    if (!phone) {
      return response.status(400).json({
        message: "Phone is required",
        field: "phone",
      });
    }

    if (!address) {
      return response.status(400).json({
        message: "Address is required",
        field: "address",
      });
    }

    const passwordError = validatePassword(password);

    if (passwordError) {
      return response.status(400).json({
        message: passwordError,
        field: "password",
      });
    }

    if (categoryIds.length === 0) {
      return response.status(400).json({
        message: "At least one service category must be selected",
        field: "categoryIds",
      });
    }

    if (categoryExperiencePairs.length === 0) {
      return response.status(400).json({
        message: "Select an experience level for at least one category",
        field: "categoryExperience",
      });
    }

    const providerRole = await prisma.roles.findUnique({
      where: {
        name: ROLE_NAMES.PROVIDER,
      },
      select: {
        id: true,
        name: true,
      },
    });

    if (!providerRole) {
      return response.status(500).json({
        message: "Provider role is not configured in the database",
      });
    }

    /*
     * Duplicate checks are limited to the provider role.
     * The same phone/email may exist for an independent customer account.
     */
    const existingProvider = await prisma.users.findFirst({
      where: {
        role_id: providerRole.id,
        OR: [
          {
            phone,
          },
          ...(email
            ? [
                {
                  email,
                },
              ]
            : []),
        ],
      },
      select: {
        id: true,
        phone: true,
        email: true,
      },
    });

    if (existingProvider) {
      const duplicateField =
        existingProvider.phone === phone ? "phone" : "email";

      return response.status(409).json({
        message: `A provider account with this ${duplicateField} already exists`,
        field: duplicateField,
      });
    }

    /*
     * Verify all selected categories exist and are active.
     */
    const selectedCategories = await prisma.service_categories.findMany({
      where: {
        id: {
          in: categoryIds,
        },
        is_active: true,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        image_url: true,
        display_order: true,
      },
    });

    if (selectedCategories.length !== categoryIds.length) {
      return response.status(400).json({
        message:
          "One or more selected service categories are invalid or inactive",
        field: "categoryIds",
      });
    }

    /*
     * Every selected category must have exactly one experience pairing,
     * covering all (and only) the selected categories, with no duplicates.
     */
    const categoryIdsWithExperience = categoryExperiencePairs.map(
      (pair) => pair.categoryId,
    );

    const uniqueCategoryIdsWithExperience = new Set(categoryIdsWithExperience);

    if (
      uniqueCategoryIdsWithExperience.size !== categoryExperiencePairs.length
    ) {
      return response.status(400).json({
        message: "Each category can only have one experience level selected",
        field: "categoryExperience",
      });
    }

    const missingExperienceCategoryIds = categoryIds.filter(
      (categoryId) => !uniqueCategoryIdsWithExperience.has(categoryId),
    );

    if (missingExperienceCategoryIds.length > 0) {
      return response.status(400).json({
        message: "Select an experience level for every selected category",
        field: "categoryExperience",
        missing_category_ids: missingExperienceCategoryIds,
      });
    }

    const extraExperienceCategoryIds = [
      ...uniqueCategoryIdsWithExperience,
    ].filter((categoryId) => !categoryIds.includes(categoryId));

    if (extraExperienceCategoryIds.length > 0) {
      return response.status(400).json({
        message:
          "Experience was selected for a category that isn't in categoryIds",
        field: "categoryExperience",
      });
    }

    const experienceTypeIds = [
      ...new Set(categoryExperiencePairs.map((pair) => pair.experienceTypeId)),
    ];

    /*
     * Verify all referenced experience types exist and are active.
     */
    const selectedExperienceTypes = await prisma.experience_types.findMany({
      where: {
        id: {
          in: experienceTypeIds,
        },
        is_active: true,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        display_order: true,
      },
    });

    if (selectedExperienceTypes.length !== experienceTypeIds.length) {
      return response.status(400).json({
        message:
          "One or more selected experience options are invalid or inactive",
        field: "categoryExperience",
      });
    }

    /*
     * Each { categoryId, experienceTypeId } pair must be a mapping the
     * admin has actually configured as valid for that specific category.
     */
    const validMappings = await prisma.category_experience_types.findMany({
      where: {
        category_id: {
          in: categoryIds,
        },
        experience_type_id: {
          in: experienceTypeIds,
        },
      },
      select: {
        category_id: true,
        experience_type_id: true,
      },
    });

    const validMappingKeys = new Set(
      validMappings.map(
        (mapping) => `${mapping.category_id}:${mapping.experience_type_id}`,
      ),
    );

    const invalidPairs = categoryExperiencePairs.filter(
      (pair) =>
        !validMappingKeys.has(`${pair.categoryId}:${pair.experienceTypeId}`),
    );

    if (invalidPairs.length > 0) {
      return response.status(400).json({
        message:
          "One or more experience selections are not valid for their category",
        field: "categoryExperience",
        invalid_pairs: invalidPairs,
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    /*
     * Account, provider profile, wallet, categories and experiences are
     * created atomically. Any failure rolls back the entire registration.
     */
    const provider = await prisma.$transaction(async (transaction) => {
      const createdUser = await transaction.users.create({
        data: {
          full_name: fullName,
          phone,
          email,
          // Email OTP verification is temporarily disabled, so providers are
          // marked as verified immediately at registration. Restore this to
          // `null` when the OTP flow is re-enabled.
          email_verified_at: new Date(),
          password_hash: passwordHash,
          role_id: providerRole.id,
          is_active: true,
        },
        select: {
          id: true,
          full_name: true,
          phone: true,
          email: true,
          role_id: true,
          is_active: true,
          created_at: true,
          roles: {
            select: {
              name: true,
            },
          },
        },
      });

      const createdProfile = await transaction.provider_profiles.create({
        data: {
          provider_id: createdUser.id,
          address,
          profile_photo_url: profilePhotoUrl,
          verification_status: "pending",
          years_of_experience: 0,
          average_rating: 0,
          total_reviews: 0,
          total_completed_jobs: 0,
        },
        select: {
          id: true,
          provider_id: true,
          address: true,
          profile_photo_url: true,
          verification_status: true,
          created_at: true,
        },
      });

      const createdWallet = await transaction.wallets.create({
        data: {
          user_id: createdUser.id,
          balance: 0,
          currency: "NPR",
          is_active: true,
        },
        select: {
          id: true,
          user_id: true,
          balance: true,
          currency: true,
          is_active: true,
          created_at: true,
        },
      });

      await transaction.provider_categories.createMany({
        data: categoryIds.map((categoryId) => ({
          provider_id: createdUser.id,
          category_id: categoryId,
        })),
        skipDuplicates: true,
      });

      await transaction.provider_experience_types.createMany({
        data: experienceTypeIds.map((experienceTypeId) => ({
          provider_id: createdUser.id,
          experience_type_id: experienceTypeId,
        })),
        skipDuplicates: true,
      });

      await transaction.provider_category_experiences.createMany({
        data: categoryExperiencePairs.map((pair) => ({
          provider_id: createdUser.id,
          category_id: pair.categoryId,
          experience_type_id: pair.experienceTypeId,
        })),
        skipDuplicates: true,
      });

      return {
        user: createdUser,
        profile: createdProfile,
        wallet: createdWallet,
      };
    });

    // Email OTP verification is temporarily disabled. Providers are
    // auto-verified at registration above, so no OTP is created or sent
    // here. Restore the createAndSendEmailOtp call when this is re-enabled.

    const sortedCategories = [...selectedCategories].sort(
      (firstCategory, secondCategory) =>
        firstCategory.display_order - secondCategory.display_order ||
        firstCategory.name.localeCompare(secondCategory.name),
    );
    const sortedExperienceTypes = [...selectedExperienceTypes].sort(
      (firstExperience, secondExperience) =>
        firstExperience.display_order - secondExperience.display_order ||
        firstExperience.name.localeCompare(secondExperience.name),
    );

    const categoryById = new Map(
      sortedCategories.map((category) => [category.id, category]),
    );
    const experienceTypeById = new Map(
      sortedExperienceTypes.map((experienceType) => [
        experienceType.id,
        experienceType,
      ]),
    );

    const categoryExperience = categoryExperiencePairs
      .map((pair) => {
        const category = categoryById.get(pair.categoryId);
        const experienceType = experienceTypeById.get(pair.experienceTypeId);

        if (!category || !experienceType) {
          return null;
        }

        return {
          category_id: category.id,
          category_name: category.name,
          experience_type: {
            id: experienceType.id,
            name: experienceType.name,
          },
        };
      })
      .filter(
        (
          entry,
        ): entry is {
          category_id: number;
          category_name: string;
          experience_type: { id: number; name: string };
        } => entry !== null,
      )
      .sort((first, second) =>
        first.category_name.localeCompare(second.category_name),
      );

    return response.status(201).json({
      message: "Provider registration submitted successfully.",
      provider: {
        id: provider.user.id,
        full_name: provider.user.full_name,
        phone: provider.user.phone,
        email: provider.user.email,
        email_verified: true,
        email_verification_required: false,
        role_id: provider.user.role_id,
        role_name: provider.user.roles.name,
        is_active: provider.user.is_active,
        provider_status: provider.profile.verification_status,
        address: provider.profile.address,
        profile_photo_url: provider.profile.profile_photo_url,
        wallet: {
          balance: provider.wallet.balance,
          currency: provider.wallet.currency,
          is_active: provider.wallet.is_active,
        },
        categories: sortedCategories,
        experience_options: sortedExperienceTypes,
        category_experience: categoryExperience,
        created_at: provider.user.created_at,
      },
    });
  } catch (error: unknown) {
    console.error("Provider registration error:", error);

    return response.status(500).json({
      message: "Something went wrong while registering the provider",
    });
  }
};
export const verifyProviderRegistrationOtp = async (
  request: Request,
  response: Response,
) => {
  try {
    const email = normalizeEmail(request.body.email);

    const code =
      typeof request.body.code === "string" ? request.body.code.trim() : "";

    if (!email) {
      return response.status(400).json({
        message: "Email is required",
        field: "email",
      });
    }

    if (!/^\d{6}$/.test(code)) {
      return response.status(400).json({
        message: "A valid six-digit verification code is required",
        field: "code",
      });
    }

    const providerRole = await prisma.roles.findUnique({
      where: {
        name: ROLE_NAMES.PROVIDER,
      },
      select: {
        id: true,
      },
    });

    if (!providerRole) {
      return response.status(500).json({
        message: "Provider role is not configured in the database",
      });
    }

    const provider = await prisma.users.findFirst({
      where: {
        email,
        role_id: providerRole.id,
      },
      select: {
        id: true,
        full_name: true,
        email: true,
        email_verified_at: true,
        is_active: true,
      },
    });

    if (!provider) {
      return response.status(404).json({
        message: "Provider account not found",
      });
    }

    if (!provider.is_active) {
      return response.status(403).json({
        message: "This provider account is inactive",
      });
    }

    if (provider.email_verified_at) {
      return response.status(200).json({
        message: "Provider email is already verified",
        email_verified: true,
      });
    }

    await verifyEmailOtp({
      userId: provider.id,
      purpose: "forgot_password",
      code,
      markEmailVerified: false,
    });

    const resetToken = createProviderPasswordResetToken({
      userId: provider.id,
      email: provider.email!,
    });
    return response.status(200).json({
      message: "Password reset code verified successfully",
      reset_verified: true,
      reset_token: resetToken,
      reset_token_expires_in: "15 minutes",
      provider: {
        id: provider.id,
        full_name: provider.full_name,
        email: provider.email,
      },
    });
  } catch (error) {
    if (error instanceof EmailOtpServiceError) {
      const errorResponses: Record<
        string,
        { status: number; message: string }
      > = {
        INVALID_OTP_FORMAT: {
          status: 400,
          message: "A valid six-digit verification code is required",
        },
        OTP_NOT_FOUND: {
          status: 404,
          message:
            "No active verification code was found. Please request a new code.",
        },
        OTP_EXPIRED: {
          status: 410,
          message:
            "The verification code has expired. Please request a new code.",
        },
        INVALID_OTP: {
          status: 400,
          message: "The verification code is incorrect",
        },
        OTP_MAX_ATTEMPTS_REACHED: {
          status: 429,
          message:
            "Maximum verification attempts reached. Please request a new code.",
        },
      };

      const mappedError = errorResponses[error.code];

      if (mappedError) {
        return response.status(mappedError.status).json({
          message: mappedError.message,
          code: error.code,
        });
      }
    }

    console.error("Verify provider registration OTP error:", error);

    return response.status(500).json({
      message: "Something went wrong while verifying the email",
    });
  }
};
export const resendProviderRegistrationOtp = async (
  request: Request,
  response: Response,
) => {
  try {
    const email = normalizeEmail(request.body.email);

    if (!email) {
      return response.status(400).json({
        message: "Email is required",
        field: "email",
      });
    }

    const providerRole = await prisma.roles.findUnique({
      where: {
        name: ROLE_NAMES.PROVIDER,
      },
      select: {
        id: true,
      },
    });

    if (!providerRole) {
      return response.status(500).json({
        message: "Provider role is not configured in the database",
      });
    }

    const provider = await prisma.users.findFirst({
      where: {
        email,
        role_id: providerRole.id,
      },
      select: {
        id: true,
        full_name: true,
        email: true,
        email_verified_at: true,
        is_active: true,
      },
    });

    if (!provider || !provider.email) {
      return response.status(404).json({
        message: "Provider account not found",
      });
    }

    if (!provider.is_active) {
      return response.status(403).json({
        message: "This provider account is inactive",
      });
    }

    if (provider.email_verified_at) {
      return response.status(400).json({
        message: "Provider email is already verified",
      });
    }

    const result = await createAndSendEmailOtp({
      userId: provider.id,
      email: provider.email,
      purpose: "provider_registration",
      recipientName: provider.full_name,
    });

    return response.status(200).json({
      message: "A new verification code has been sent",
      otp_expires_at: result.expiresAt,
      otp_resend_after_seconds: result.resendAfterSeconds,
    });
  } catch (error) {
    if (
      error instanceof EmailOtpServiceError &&
      error.code === "OTP_RESEND_TOO_SOON"
    ) {
      return response.status(429).json({
        message: "Please wait before requesting another code",
        code: error.code,
        retry_after_seconds: error.retryAfterSeconds ?? 60,
      });
    }

    if (error instanceof Error && error.message === "OTP_EMAIL_SEND_FAILED") {
      return response.status(502).json({
        message: "Verification email could not be sent",
      });
    }

    console.error("Resend provider registration OTP error:", error);

    return response.status(500).json({
      message: "Something went wrong while resending the verification code",
    });
  }
};
export const forgotProviderPassword = async (
  request: Request,
  response: Response,
) => {
  try {
    const email = normalizeEmail(request.body.email);

    if (!email) {
      return response.status(400).json({
        message: "Email is required",
        field: "email",
      });
    }

    const providerRole = await prisma.roles.findUnique({
      where: {
        name: ROLE_NAMES.PROVIDER,
      },
      select: {
        id: true,
      },
    });

    if (!providerRole) {
      return response.status(500).json({
        message: "Provider role is not configured in the database",
      });
    }

    const provider = await prisma.users.findFirst({
      where: {
        email,
        role_id: providerRole.id,
      },
      select: {
        id: true,
        full_name: true,
        email: true,
        email_verified_at: true,
        is_active: true,
      },
    });

    // Keep response generic so attackers cannot discover valid accounts.
    if (!provider || !provider.email || !provider.is_active) {
      return response.status(200).json({
        message:
          "If a provider account exists for this email, a reset code has been sent.",
      });
    }

    if (!provider.email_verified_at) {
      return response.status(403).json({
        message:
          "Please verify your provider email before requesting a password reset",
        code: "EMAIL_NOT_VERIFIED",
        email_verification_required: true,
      });
    }

    try {
      const otpResult = await createAndSendEmailOtp({
        userId: provider.id,
        email: provider.email,
        purpose: "forgot_password",
        recipientName: provider.full_name,
      });

      return response.status(200).json({
        message:
          "If a provider account exists for this email, a reset code has been sent.",
        otp_expires_at: otpResult.expiresAt,
        otp_resend_after_seconds: otpResult.resendAfterSeconds,
      });
    } catch (error) {
      if (
        error instanceof EmailOtpServiceError &&
        error.code === "OTP_RESEND_TOO_SOON"
      ) {
        return response.status(429).json({
          message: "Please wait before requesting another reset code",
          code: error.code,
          retry_after_seconds: error.retryAfterSeconds ?? 60,
        });
      }

      if (error instanceof Error && error.message === "OTP_EMAIL_SEND_FAILED") {
        return response.status(502).json({
          message: "Password reset email could not be sent",
        });
      }

      throw error;
    }
  } catch (error) {
    console.error("Forgot provider password error:", error);

    return response.status(500).json({
      message: "Something went wrong while requesting the password reset",
    });
  }
};
export const verifyProviderPasswordResetOtp = async (
  request: Request,
  response: Response,
) => {
  try {
    const email = normalizeEmail(request.body.email);

    const code =
      typeof request.body.code === "string" ? request.body.code.trim() : "";

    if (!email) {
      return response.status(400).json({
        message: "Email is required",
        field: "email",
      });
    }

    if (!/^\d{6}$/.test(code)) {
      return response.status(400).json({
        message: "A valid six-digit reset code is required",
        field: "code",
      });
    }

    const providerRole = await prisma.roles.findUnique({
      where: {
        name: ROLE_NAMES.PROVIDER,
      },
      select: {
        id: true,
      },
    });

    if (!providerRole) {
      return response.status(500).json({
        message: "Provider role is not configured in the database",
      });
    }

    const provider = await prisma.users.findFirst({
      where: {
        email,
        role_id: providerRole.id,
      },
      select: {
        id: true,
        full_name: true,
        email: true,
        email_verified_at: true,
        is_active: true,
      },
    });

    if (!provider || !provider.email) {
      return response.status(404).json({
        message: "Provider account not found",
      });
    }

    if (!provider.is_active) {
      return response.status(403).json({
        message: "This provider account is inactive",
      });
    }

    if (!provider.email_verified_at) {
      return response.status(403).json({
        message:
          "Please verify your provider email before resetting the password",
        code: "EMAIL_NOT_VERIFIED",
        email_verification_required: true,
      });
    }

    await verifyEmailOtp({
      userId: provider.id,
      purpose: "forgot_password",
      code,
      markEmailVerified: false,
    });

    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      throw new Error("JWT_SECRET is missing from the environment");
    }

    const resetToken = jwt.sign(
      {
        userId: provider.id,
        email: provider.email,
        purpose: "provider_password_reset",
      },
      jwtSecret,
      {
        expiresIn: "15m",
      },
    );

    return response.status(200).json({
      message: "Password reset code verified successfully",
      reset_verified: true,
      reset_token: resetToken,
      provider: {
        id: provider.id,
        full_name: provider.full_name,
        email: provider.email,
      },
    });
  } catch (error) {
    if (error instanceof EmailOtpServiceError) {
      const errorResponses: Record<
        string,
        { status: number; message: string }
      > = {
        INVALID_OTP_FORMAT: {
          status: 400,
          message: "A valid six-digit reset code is required",
        },
        OTP_NOT_FOUND: {
          status: 404,
          message:
            "No active password reset code was found. Please request a new code.",
        },
        OTP_EXPIRED: {
          status: 410,
          message:
            "The password reset code has expired. Please request a new code.",
        },
        INVALID_OTP: {
          status: 400,
          message: "The password reset code is incorrect",
        },
        OTP_MAX_ATTEMPTS_REACHED: {
          status: 429,
          message:
            "Maximum verification attempts reached. Please request a new code.",
        },
      };

      const mappedError = errorResponses[error.code];

      if (mappedError) {
        return response.status(mappedError.status).json({
          message: mappedError.message,
          code: error.code,
        });
      }
    }

    console.error("Verify provider password reset OTP error:", error);

    return response.status(500).json({
      message: "Something went wrong while verifying the password reset code",
    });
  }
};
export const resetProviderPassword = async (
  request: Request,
  response: Response,
) => {
  try {
    const resetToken =
      typeof request.body.resetToken === "string"
        ? request.body.resetToken.trim()
        : "";

    const newPassword =
      typeof request.body.newPassword === "string"
        ? request.body.newPassword
        : "";

    const confirmPassword =
      typeof request.body.confirmPassword === "string"
        ? request.body.confirmPassword
        : "";

    if (!resetToken) {
      return response.status(400).json({
        message: "Password reset token is required",
        field: "resetToken",
      });
    }

    const passwordError = validatePassword(newPassword);

    if (passwordError) {
      return response.status(400).json({
        message: passwordError,
        field: "newPassword",
      });
    }

    if (newPassword !== confirmPassword) {
      return response.status(400).json({
        message: "Password confirmation does not match",
        field: "confirmPassword",
      });
    }

    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      throw new Error("JWT_SECRET is missing from the environment");
    }

    let tokenPayload: {
      userId: number;
      email: string;
      purpose: string;
    };

    try {
      tokenPayload = jwt.verify(resetToken, jwtSecret) as {
        userId: number;
        email: string;
        purpose: string;
      };
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        return response.status(401).json({
          message:
            "The password reset session has expired. Please request a new code.",
          code: "RESET_TOKEN_EXPIRED",
        });
      }

      return response.status(401).json({
        message: "Invalid password reset token",
        code: "INVALID_RESET_TOKEN",
      });
    }

    if (tokenPayload.purpose !== "provider_password_reset") {
      return response.status(401).json({
        message: "Invalid password reset token",
        code: "INVALID_RESET_TOKEN",
      });
    }

    if (
      !Number.isInteger(tokenPayload.userId) ||
      tokenPayload.userId <= 0 ||
      !tokenPayload.email
    ) {
      return response.status(401).json({
        message: "Invalid password reset token",
        code: "INVALID_RESET_TOKEN",
      });
    }

    const providerRole = await prisma.roles.findUnique({
      where: {
        name: ROLE_NAMES.PROVIDER,
      },
      select: {
        id: true,
      },
    });

    if (!providerRole) {
      return response.status(500).json({
        message: "Provider role is not configured in the database",
      });
    }

    const provider = await prisma.users.findFirst({
      where: {
        id: tokenPayload.userId,
        email: tokenPayload.email.toLowerCase(),
        role_id: providerRole.id,
      },
      select: {
        id: true,
        email: true,
        password_hash: true,
        email_verified_at: true,
        is_active: true,
      },
    });

    if (!provider) {
      return response.status(404).json({
        message: "Provider account not found",
      });
    }

    if (!provider.is_active) {
      return response.status(403).json({
        message: "This provider account is inactive",
      });
    }

    if (!provider.email_verified_at) {
      return response.status(403).json({
        message: "Provider email is not verified",
        code: "EMAIL_NOT_VERIFIED",
      });
    }

    const passwordAlreadyUsed = await bcrypt.compare(
      newPassword,
      provider.password_hash,
    );

    if (passwordAlreadyUsed) {
      return response.status(400).json({
        message: "New password must be different from the current password",
        field: "newPassword",
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await prisma.users.update({
      where: {
        id: provider.id,
      },
      data: {
        password_hash: passwordHash,
        updated_at: new Date(),
      },
    });

    await prisma.email_otps.updateMany({
      where: {
        user_id: provider.id,
        purpose: "forgot_password",
        consumed_at: null,
      },
      data: {
        consumed_at: new Date(),
        updated_at: new Date(),
      },
    });

    return response.status(200).json({
      message:
        "Provider password reset successfully. You can now log in with your new password.",
      password_reset: true,
    });
  } catch (error) {
    console.error("Reset provider password error:", error);

    return response.status(500).json({
      message: "Something went wrong while resetting the provider password",
    });
  }
};
/*
|--------------------------------------------------------------------------
| Customer forgot password
|--------------------------------------------------------------------------
*/

export const forgotCustomerPassword = async (
  request: Request,
  response: Response,
) => {
  try {
    const email = normalizeEmail(request.body.email);

    if (!email) {
      return response.status(400).json({
        message: "Email is required",
        field: "email",
      });
    }

    const customerRole = await prisma.roles.findUnique({
      where: {
        name: ROLE_NAMES.CUSTOMER,
      },
      select: {
        id: true,
      },
    });

    if (!customerRole) {
      return response.status(500).json({
        message: "Customer role is not configured in the database",
      });
    }

    const customer = await prisma.users.findFirst({
      where: {
        email,
        role_id: customerRole.id,
      },
      select: {
        id: true,
        full_name: true,
        email: true,
        is_active: true,
      },
    });

    // Keep response generic so valid accounts cannot be discovered.
    if (!customer || !customer.email || !customer.is_active) {
      return response.status(200).json({
        message:
          "If a customer account exists for this email, a reset code has been sent.",
      });
    }

    try {
      const otpResult = await createAndSendEmailOtp({
        userId: customer.id,
        email: customer.email,
        purpose: "forgot_password",
        recipientName: customer.full_name,
      });

      return response.status(200).json({
        message:
          "If a customer account exists for this email, a reset code has been sent.",
        otp_expires_at: otpResult.expiresAt,
        otp_resend_after_seconds: otpResult.resendAfterSeconds,
      });
    } catch (error) {
      if (
        error instanceof EmailOtpServiceError &&
        error.code === "OTP_RESEND_TOO_SOON"
      ) {
        return response.status(429).json({
          message: "Please wait before requesting another reset code",
          code: error.code,
          retry_after_seconds: error.retryAfterSeconds ?? 60,
        });
      }

      if (error instanceof Error && error.message === "OTP_EMAIL_SEND_FAILED") {
        return response.status(502).json({
          message: "Password reset email could not be sent",
        });
      }

      throw error;
    }
  } catch (error) {
    console.error("Forgot customer password error:", error);

    return response.status(500).json({
      message: "Something went wrong while requesting the password reset",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Customer verify password-reset OTP
|--------------------------------------------------------------------------
*/

export const verifyCustomerPasswordResetOtp = async (
  request: Request,
  response: Response,
) => {
  try {
    const email = normalizeEmail(request.body.email);

    const code =
      typeof request.body.code === "string" ? request.body.code.trim() : "";

    if (!email) {
      return response.status(400).json({
        message: "Email is required",
        field: "email",
      });
    }

    if (!/^\d{6}$/.test(code)) {
      return response.status(400).json({
        message: "A valid six-digit reset code is required",
        field: "code",
      });
    }

    const customerRole = await prisma.roles.findUnique({
      where: {
        name: ROLE_NAMES.CUSTOMER,
      },
      select: {
        id: true,
      },
    });

    if (!customerRole) {
      return response.status(500).json({
        message: "Customer role is not configured in the database",
      });
    }

    const customer = await prisma.users.findFirst({
      where: {
        email,
        role_id: customerRole.id,
      },
      select: {
        id: true,
        full_name: true,
        email: true,
        is_active: true,
      },
    });

    if (!customer || !customer.email) {
      return response.status(404).json({
        message: "Customer account not found",
      });
    }

    if (!customer.is_active) {
      return response.status(403).json({
        message: "This customer account is inactive",
      });
    }

    await verifyEmailOtp({
      userId: customer.id,
      purpose: "forgot_password",
      code,
      markEmailVerified: false,
    });

    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      throw new Error("JWT_SECRET is missing from the environment");
    }

    const resetToken = jwt.sign(
      {
        userId: customer.id,
        email: customer.email,
        purpose: "customer_password_reset",
      },
      jwtSecret,
      {
        expiresIn: "15m",
      },
    );

    return response.status(200).json({
      message: "Password reset code verified successfully",
      reset_verified: true,
      reset_token: resetToken,
      customer: {
        id: customer.id,
        full_name: customer.full_name,
        email: customer.email,
      },
    });
  } catch (error) {
    if (error instanceof EmailOtpServiceError) {
      const errorResponses: Record<
        string,
        {
          status: number;
          message: string;
        }
      > = {
        INVALID_OTP_FORMAT: {
          status: 400,
          message: "A valid six-digit reset code is required",
        },
        OTP_NOT_FOUND: {
          status: 404,
          message:
            "No active password reset code was found. Please request a new code.",
        },
        OTP_EXPIRED: {
          status: 410,
          message:
            "The password reset code has expired. Please request a new code.",
        },
        INVALID_OTP: {
          status: 400,
          message: "The password reset code is incorrect",
        },
        OTP_MAX_ATTEMPTS_REACHED: {
          status: 429,
          message:
            "Maximum verification attempts reached. Please request a new code.",
        },
      };

      const mappedError = errorResponses[error.code];

      if (mappedError) {
        return response.status(mappedError.status).json({
          message: mappedError.message,
          code: error.code,
        });
      }
    }

    console.error("Verify customer password reset OTP error:", error);

    return response.status(500).json({
      message: "Something went wrong while verifying the password reset code",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Customer reset password
|--------------------------------------------------------------------------
*/

export const resetCustomerPassword = async (
  request: Request,
  response: Response,
) => {
  try {
    const resetToken =
      typeof request.body.resetToken === "string"
        ? request.body.resetToken.trim()
        : "";

    const newPassword =
      typeof request.body.newPassword === "string"
        ? request.body.newPassword
        : "";

    const confirmPassword =
      typeof request.body.confirmPassword === "string"
        ? request.body.confirmPassword
        : "";

    if (!resetToken) {
      return response.status(400).json({
        message: "Password reset token is required",
        field: "resetToken",
      });
    }

    const passwordError = validatePassword(newPassword);

    if (passwordError) {
      return response.status(400).json({
        message: passwordError,
        field: "newPassword",
      });
    }

    if (newPassword !== confirmPassword) {
      return response.status(400).json({
        message: "Password confirmation does not match",
        field: "confirmPassword",
      });
    }

    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      throw new Error("JWT_SECRET is missing from the environment");
    }

    let tokenPayload: {
      userId: number;
      email: string;
      purpose: string;
    };

    try {
      tokenPayload = jwt.verify(resetToken, jwtSecret) as {
        userId: number;
        email: string;
        purpose: string;
      };
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        return response.status(401).json({
          message:
            "The password reset session has expired. Please request a new code.",
          code: "RESET_TOKEN_EXPIRED",
        });
      }

      return response.status(401).json({
        message: "Invalid password reset token",
        code: "INVALID_RESET_TOKEN",
      });
    }

    if (tokenPayload.purpose !== "customer_password_reset") {
      return response.status(401).json({
        message: "Invalid password reset token",
        code: "INVALID_RESET_TOKEN",
      });
    }

    if (
      !Number.isInteger(tokenPayload.userId) ||
      tokenPayload.userId <= 0 ||
      !tokenPayload.email
    ) {
      return response.status(401).json({
        message: "Invalid password reset token",
        code: "INVALID_RESET_TOKEN",
      });
    }

    const customerRole = await prisma.roles.findUnique({
      where: {
        name: ROLE_NAMES.CUSTOMER,
      },
      select: {
        id: true,
      },
    });

    if (!customerRole) {
      return response.status(500).json({
        message: "Customer role is not configured in the database",
      });
    }

    const customer = await prisma.users.findFirst({
      where: {
        id: tokenPayload.userId,
        email: tokenPayload.email.toLowerCase(),
        role_id: customerRole.id,
      },
      select: {
        id: true,
        email: true,
        password_hash: true,
        is_active: true,
      },
    });

    if (!customer) {
      return response.status(404).json({
        message: "Customer account not found",
      });
    }

    if (!customer.is_active) {
      return response.status(403).json({
        message: "This customer account is inactive",
      });
    }

    const passwordAlreadyUsed = await bcrypt.compare(
      newPassword,
      customer.password_hash,
    );

    if (passwordAlreadyUsed) {
      return response.status(400).json({
        message: "New password must be different from the current password",
        field: "newPassword",
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await prisma.users.update({
      where: {
        id: customer.id,
      },
      data: {
        password_hash: passwordHash,
        updated_at: new Date(),
      },
    });

    await prisma.email_otps.updateMany({
      where: {
        user_id: customer.id,
        purpose: "forgot_password",
        consumed_at: null,
      },
      data: {
        consumed_at: new Date(),
        updated_at: new Date(),
      },
    });

    return response.status(200).json({
      message:
        "Customer password reset successfully. You can now log in with your new password.",
      password_reset: true,
    });
  } catch (error) {
    console.error("Reset customer password error:", error);

    return response.status(500).json({
      message: "Something went wrong while resetting the customer password",
    });
  }
};
/*
|--------------------------------------------------------------------------
| Provider login
|--------------------------------------------------------------------------
*/

export const loginProvider = async (request: Request, response: Response) => {
  try {
    const phone = normalizePhone(request.body.phone);

    const email = normalizeEmail(request.body.email);

    const password =
      typeof request.body.password === "string" ? request.body.password : "";

    if ((!phone && !email) || !password) {
      return response.status(400).json({
        message: "Phone or email and password are required",
      });
    }

    const providerRole = await prisma.roles.findUnique({
      where: {
        name: ROLE_NAMES.PROVIDER,
      },
      select: {
        id: true,
        name: true,
      },
    });

    if (!providerRole) {
      return response.status(500).json({
        message: "Provider role is not configured in the database",
      });
    }

    const provider = await prisma.users.findFirst({
      where: {
        role_id: providerRole.id,
        OR: [
          ...(phone
            ? [
                {
                  phone,
                },
              ]
            : []),
          ...(email
            ? [
                {
                  email,
                },
              ]
            : []),
        ],
      },
      select: {
        id: true,
        full_name: true,
        phone: true,
        email: true,
        email_verified_at: true,
        password_hash: true,
        role_id: true,
        is_active: true,
        roles: {
          select: {
            name: true,
          },
        },
        provider_profiles_provider_profiles_provider_idTousers: {
          select: {
            address: true,
            profile_photo_url: true,
            verification_status: true,
            verification_note: true,
            rejection_reason: true,
            average_rating: true,
            total_reviews: true,
            total_completed_jobs: true,
          },
        },
        providerCategories: {
          select: {
            service_categories: {
              select: {
                id: true,
                name: true,
                slug: true,
                description: true,
                image_url: true,
                display_order: true,
              },
            },
          },
        },
        provider_experience_types: {
          select: {
            experience_types: {
              select: {
                id: true,
                name: true,
                slug: true,
                description: true,
                display_order: true,
              },
            },
          },
        },
        provider_category_experiences: {
          select: {
            service_categories: {
              select: {
                id: true,
                name: true,
              },
            },
            experience_types: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (!provider) {
      return response.status(401).json({
        message: "Invalid provider credentials",
      });
    }

    if (!provider.is_active) {
      return response.status(403).json({
        message: "This provider account is inactive",
      });
    }

    if (!provider.email_verified_at) {
      return response.status(403).json({
        message: "Please verify your email before logging in",
        code: "EMAIL_NOT_VERIFIED",
        email_verification_required: true,
        email: provider.email,
      });
    }

    const passwordMatches = await bcrypt.compare(
      password,
      provider.password_hash,
    );

    if (!passwordMatches) {
      return response.status(401).json({
        message: "Invalid provider credentials",
      });
    }

    const providerProfile =
      provider.provider_profiles_provider_profiles_provider_idTousers;

    if (!providerProfile) {
      return response.status(403).json({
        message: "Provider profile is incomplete",
        provider_status: "profile_missing",
      });
    }

    const providerStatus = providerProfile.verification_status
      .trim()
      .toLowerCase();

    /*
     * Pending providers receive a token so they can enter Provider Mode
     * and view their application status. Operational endpoints remain
     * protected by requireApprovedProvider.
     */
    const token = createAccessToken({
      userId: provider.id,
      roleId: provider.role_id,
      roleName: ROLE_NAMES.PROVIDER,
    });

    return response.status(200).json({
      message: "Provider login successful",
      token,
      user: {
        id: provider.id,
        full_name: provider.full_name,
        phone: provider.phone,
        email: provider.email,
        role_id: provider.role_id,
        role_name: provider.roles.name,
        is_active: provider.is_active,
      },
      provider_profile: {
        address: providerProfile.address,
        profile_photo_url: providerProfile.profile_photo_url,
        verification_status: providerStatus,
        verification_note: providerProfile.verification_note,
        rejection_reason: providerProfile.rejection_reason,
        average_rating: providerProfile.average_rating,
        total_reviews: providerProfile.total_reviews,
        total_completed_jobs: providerProfile.total_completed_jobs,
        can_receive_jobs: providerStatus === "approved",
        categories: formatProviderCategories(provider.providerCategories),
        experience_options: formatProviderExperiences(
          provider.provider_experience_types,
        ),
        category_experience: formatProviderCategoryExperience(
          provider.provider_category_experiences as Array<{
            service_categories: {
              id: number;
              name: string;
            };
            experience_types: {
              id: number;
              name: string;
            };
          }>,
        ),
      },
    });
  } catch (error: unknown) {
    console.error("Provider login error:", error);

    return response.status(500).json({
      message: "Something went wrong while logging in as provider",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin login
|--------------------------------------------------------------------------
*/

export const loginAdmin = async (request: Request, response: Response) => {
  try {
    const phone = normalizePhone(request.body.phone);

    const email = normalizeEmail(request.body.email);

    const password =
      typeof request.body.password === "string" ? request.body.password : "";

    if ((!phone && !email) || !password) {
      return response.status(400).json({
        message: "Phone or email and password are required",
      });
    }

    const adminRole = await prisma.roles.findUnique({
      where: {
        name: ROLE_NAMES.ADMIN,
      },
      select: {
        id: true,
        name: true,
      },
    });

    if (!adminRole) {
      return response.status(500).json({
        message: "Admin role is not configured in the database",
      });
    }

    const admin = await prisma.users.findFirst({
      where: {
        role_id: adminRole.id,
        OR: [
          ...(phone
            ? [
                {
                  phone,
                },
              ]
            : []),
          ...(email
            ? [
                {
                  email,
                },
              ]
            : []),
        ],
      },
      select: {
        id: true,
        full_name: true,
        phone: true,
        email: true,
        password_hash: true,
        role_id: true,
        is_active: true,
        roles: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!admin) {
      return response.status(401).json({
        message: "Invalid admin credentials",
      });
    }

    if (!admin.is_active) {
      return response.status(403).json({
        message: "This admin account is inactive",
      });
    }

    const passwordMatches = await bcrypt.compare(password, admin.password_hash);

    if (!passwordMatches) {
      return response.status(401).json({
        message: "Invalid admin credentials",
      });
    }

    const token = createAccessToken({
      userId: admin.id,
      roleId: admin.role_id,
      roleName: ROLE_NAMES.ADMIN,
    });

    return response.status(200).json({
      message: "Admin login successful",
      token,
      user: {
        id: admin.id,
        full_name: admin.full_name,
        phone: admin.phone,
        email: admin.email,
        role_id: admin.role_id,
        role_name: admin.roles.name,
        is_active: admin.is_active,
      },
    });
  } catch (error: unknown) {
    console.error("Admin login error:", error);

    return response.status(500).json({
      message: "Something went wrong while logging in as admin",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Current authenticated session
|--------------------------------------------------------------------------
*/

export const getCurrentSession = async (
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

    const user = await prisma.users.findUnique({
      where: {
        id: authenticatedUser.userId,
      },
      select: {
        id: true,
        full_name: true,
        phone: true,
        email: true,
        role_id: true,
        is_active: true,
        created_at: true,
        updated_at: true,
        roles: {
          select: {
            name: true,
          },
        },
        provider_profiles_provider_profiles_provider_idTousers: {
          select: {
            address: true,
            profile_photo_url: true,
            verification_status: true,
            verification_note: true,
            rejection_reason: true,
            average_rating: true,
            total_reviews: true,
            total_completed_jobs: true,
          },
        },
        providerCategories: {
          select: {
            service_categories: {
              select: {
                id: true,
                name: true,
                slug: true,
                description: true,
                image_url: true,
                display_order: true,
              },
            },
          },
        },
        provider_experience_types: {
          select: {
            experience_types: {
              select: {
                id: true,
                name: true,
                slug: true,
                description: true,
                display_order: true,
              },
            },
          },
        },
        provider_category_experiences: {
          select: {
            service_categories: {
              select: {
                id: true,
                name: true,
              },
            },
            experience_types: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      return response.status(401).json({
        message: "User account no longer exists",
      });
    }

    if (!user.is_active) {
      return response.status(403).json({
        message: "This account is inactive",
      });
    }

    const roleName = user.roles.name.trim().toLowerCase();

    const responseData: {
      user: {
        id: number;
        full_name: string;
        phone: string;
        email: string | null;
        role_id: number;
        role_name: string;
        is_active: boolean | null;
        created_at: Date | null;
        updated_at: Date | null;
      };
      provider_profile?: {
        address: string | null;
        profile_photo_url: string | null;
        verification_status: string;
        verification_note: string | null;
        rejection_reason: string | null;
        average_rating: unknown;
        total_reviews: number | null;
        total_completed_jobs: number | null;
        can_receive_jobs: boolean;
        categories: Array<{
          id: number;
          name: string;
          slug: string;
          description: string | null;
          image_url: string | null;
          display_order: number;
        }>;
        experience_options: Array<{
          id: number;
          name: string;
          slug: string;
          description: string | null;
          display_order: number;
        }>;
        category_experience: Array<{
          category_id: number;
          category_name: string;
          experience_type: { id: number; name: string };
        }>;
      };
    } = {
      user: {
        id: user.id,
        full_name: user.full_name,
        phone: user.phone,
        email: user.email,
        role_id: user.role_id,
        role_name: roleName,
        is_active: user.is_active,
        created_at: user.created_at,
        updated_at: user.updated_at,
      },
    };

    if (roleName === ROLE_NAMES.PROVIDER) {
      const providerProfile =
        user.provider_profiles_provider_profiles_provider_idTousers;

      if (!providerProfile) {
        responseData.provider_profile = {
          address: null,
          profile_photo_url: null,
          verification_status: "profile_missing",
          verification_note: null,
          rejection_reason: null,
          average_rating: 0,
          total_reviews: 0,
          total_completed_jobs: 0,
          can_receive_jobs: false,
          categories: [],
          experience_options: [],
          category_experience: [],
        };
      } else {
        const providerStatus = providerProfile.verification_status
          .trim()
          .toLowerCase();

        responseData.provider_profile = {
          address: providerProfile.address,
          profile_photo_url: providerProfile.profile_photo_url,
          verification_status: providerStatus,
          verification_note: providerProfile.verification_note,
          rejection_reason: providerProfile.rejection_reason,
          average_rating: providerProfile.average_rating,
          total_reviews: providerProfile.total_reviews,
          total_completed_jobs: providerProfile.total_completed_jobs,
          can_receive_jobs: providerStatus === "approved",
          categories: formatProviderCategories(user.providerCategories),
          experience_options: formatProviderExperiences(
            user.provider_experience_types,
          ),
          category_experience: formatProviderCategoryExperience(
            user.provider_category_experiences,
          ),
        };
      }
    }

    return response.status(200).json({
      message: "Current session fetched successfully",
      ...responseData,
    });
  } catch (error: unknown) {
    console.error("Get current session error:", error);

    return response.status(500).json({
      message: "Something went wrong while loading the current session",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Provider Mode availability
|--------------------------------------------------------------------------
| Used when a customer taps "Switch to Provider Mode".
|--------------------------------------------------------------------------
*/

export const getProviderModeStatus = async (
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

    if (authenticatedUser.roleName !== ROLE_NAMES.CUSTOMER) {
      return response.status(403).json({
        message: "Only customer accounts can check Provider Mode availability",
      });
    }

    const customer = await prisma.users.findUnique({
      where: {
        id: authenticatedUser.userId,
      },
      select: {
        id: true,
        phone: true,
        email: true,
        is_active: true,
      },
    });

    if (!customer) {
      return response.status(404).json({
        message: "Customer account not found",
      });
    }

    if (!customer.is_active) {
      return response.status(403).json({
        message: "This customer account is inactive",
      });
    }

    const providerRole = await prisma.roles.findUnique({
      where: {
        name: ROLE_NAMES.PROVIDER,
      },
      select: {
        id: true,
      },
    });

    if (!providerRole) {
      return response.status(500).json({
        message: "Provider role is not configured in the database",
      });
    }

    /*
     * The phone number is used only to determine whether a separate
     * provider identity exists. It does not authenticate that provider.
     */
    const providerAccount = await prisma.users.findUnique({
      where: {
        phone_role_id: {
          phone: customer.phone,
          role_id: providerRole.id,
        },
      },
      select: {
        id: true,
        phone: true,
        email: true,
        is_active: true,
        provider_profiles_provider_profiles_provider_idTousers: {
          select: {
            verification_status: true,
          },
        },
      },
    });

    if (!providerAccount) {
      return response.status(200).json({
        message: "No provider account exists for this customer phone number",
        provider_account_exists: false,
        next_action: "register",
        provider_status: null,
        provider_account_active: null,
      });
    }

    const providerStatus =
      providerAccount.provider_profiles_provider_profiles_provider_idTousers?.verification_status
        ?.trim()
        .toLowerCase() || "profile_missing";

    return response.status(200).json({
      message: "Provider account found",
      provider_account_exists: true,
      next_action: "login",
      provider_status: providerStatus,
      provider_account_active: providerAccount.is_active,
    });
  } catch (error: unknown) {
    console.error("Get Provider Mode status error:", error);

    return response.status(500).json({
      message: "Something went wrong while checking Provider Mode availability",
    });
  }
};
