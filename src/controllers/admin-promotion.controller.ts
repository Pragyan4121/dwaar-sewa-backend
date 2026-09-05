import type { Request, Response } from "express";
import { prisma } from "../config/prisma";

function normalizeCode(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function parseOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : NaN;
}

function parseOptionalDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const date = new Date(String(value));

  return Number.isNaN(date.getTime()) ? null : date;
}

function serializePromotion(promotion: {
  id: number;
  code: string;
  title: string;
  description: string | null;
  discount_percent: unknown;
  max_discount_amount: unknown;
  minimum_order_amount: unknown;
  is_active: boolean;
  starts_at: Date | null;
  ends_at: Date | null;
  first_booking_only: boolean;
  usage_limit: number | null;
  usage_limit_per_customer: number | null;
  show_on_home: boolean;
  home_badge_text: string | null;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    ...promotion,
    discount_percent: Number(promotion.discount_percent),
    max_discount_amount:
      promotion.max_discount_amount == null
        ? null
        : Number(promotion.max_discount_amount),
    minimum_order_amount:
      promotion.minimum_order_amount == null
        ? null
        : Number(promotion.minimum_order_amount),
  };
}

export async function getAdminPromotions(request: Request, response: Response) {
  try {
    const promotions = await prisma.promotion_campaigns.findMany({
      orderBy: [
        {
          created_at: "desc",
        },
      ],

      include: {
        _count: {
          select: {
            redemptions: true,
          },
        },
      },
    });

    return response.status(200).json({
      promotions: promotions.map((promotion) => ({
        ...serializePromotion(promotion),
        redemption_count: promotion._count.redemptions,
      })),
    });
  } catch (error) {
    console.error("Get admin promotions error:", error);

    return response.status(500).json({
      message: "Unable to load promotions",
      code: "PROMOTION_LIST_FAILED",
    });
  }
}

export async function getAdminPromotionById(
  request: Request,
  response: Response,
) {
  try {
    const id = Number(request.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return response.status(400).json({
        message: "Invalid promotion id",
        code: "INVALID_PROMOTION_ID",
      });
    }

    const promotion = await prisma.promotion_campaigns.findUnique({
      where: {
        id,
      },

      include: {
        _count: {
          select: {
            redemptions: true,
          },
        },
      },
    });

    if (!promotion) {
      return response.status(404).json({
        message: "Promotion not found",
        code: "PROMOTION_NOT_FOUND",
      });
    }

    return response.status(200).json({
      promotion: {
        ...serializePromotion(promotion),
        redemption_count: promotion._count.redemptions,
      },
    });
  } catch (error) {
    console.error("Get promotion error:", error);

    return response.status(500).json({
      message: "Unable to load promotion",
      code: "PROMOTION_LOAD_FAILED",
    });
  }
}

export async function createPromotion(request: Request, response: Response) {
  try {
    const code = normalizeCode(request.body?.code);

    const title =
      typeof request.body?.title === "string" ? request.body.title.trim() : "";

    const description =
      typeof request.body?.description === "string"
        ? request.body.description.trim() || null
        : null;

    const discountPercent = Number(request.body?.discount_percent);

    const maxDiscountAmount = parseOptionalNumber(
      request.body?.max_discount_amount,
    );

    const minimumOrderAmount = parseOptionalNumber(
      request.body?.minimum_order_amount,
    );

    const usageLimit = parseOptionalNumber(request.body?.usage_limit);

    const usageLimitPerCustomer = parseOptionalNumber(
      request.body?.usage_limit_per_customer,
    );

    const startsAt = request.body?.starts_at
      ? parseOptionalDate(request.body.starts_at)
      : null;

    const endsAt = request.body?.ends_at
      ? parseOptionalDate(request.body.ends_at)
      : null;

    const firstBookingOnly = Boolean(request.body?.first_booking_only);

    const isActive =
      request.body?.is_active === undefined
        ? true
        : Boolean(request.body.is_active);

    const showOnHome = Boolean(request.body?.show_on_home);

    const homeBadgeText =
      typeof request.body?.home_badge_text === "string"
        ? request.body.home_badge_text.trim() || null
        : null;

    if (!code) {
      return response.status(400).json({
        message: "Promo code is required",
        code: "PROMO_CODE_REQUIRED",
      });
    }

    if (code.length > 50) {
      return response.status(400).json({
        message: "Promo code cannot exceed 50 characters",
        code: "PROMO_CODE_TOO_LONG",
      });
    }

    if (!title) {
      return response.status(400).json({
        message: "Promotion title is required",
        code: "PROMOTION_TITLE_REQUIRED",
      });
    }

    if (
      !Number.isFinite(discountPercent) ||
      discountPercent <= 0 ||
      discountPercent > 100
    ) {
      return response.status(400).json({
        message: "Discount percentage must be between 0 and 100",
        code: "INVALID_DISCOUNT_PERCENT",
      });
    }

    if (
      maxDiscountAmount !== null &&
      (!Number.isFinite(maxDiscountAmount) || maxDiscountAmount < 0)
    ) {
      return response.status(400).json({
        message: "Maximum discount amount must be 0 or more",
        code: "INVALID_MAX_DISCOUNT",
      });
    }

    if (
      minimumOrderAmount !== null &&
      (!Number.isFinite(minimumOrderAmount) || minimumOrderAmount < 0)
    ) {
      return response.status(400).json({
        message: "Minimum order amount must be 0 or more",
        code: "INVALID_MINIMUM_ORDER",
      });
    }

    if (
      usageLimit !== null &&
      (!Number.isInteger(usageLimit) || usageLimit <= 0)
    ) {
      return response.status(400).json({
        message: "Usage limit must be a positive whole number",
        code: "INVALID_USAGE_LIMIT",
      });
    }

    if (
      usageLimitPerCustomer !== null &&
      (!Number.isInteger(usageLimitPerCustomer) || usageLimitPerCustomer <= 0)
    ) {
      return response.status(400).json({
        message: "Per-customer usage limit must be a positive whole number",
        code: "INVALID_CUSTOMER_USAGE_LIMIT",
      });
    }

    if (request.body?.starts_at && startsAt === null) {
      return response.status(400).json({
        message: "Invalid start date",
        code: "INVALID_START_DATE",
      });
    }

    if (request.body?.ends_at && endsAt === null) {
      return response.status(400).json({
        message: "Invalid end date",
        code: "INVALID_END_DATE",
      });
    }

    if (startsAt && endsAt && endsAt <= startsAt) {
      return response.status(400).json({
        message: "End date must be after start date",
        code: "INVALID_PROMOTION_DATES",
      });
    }

    const existing = await prisma.promotion_campaigns.findUnique({
      where: {
        code,
      },
    });

    if (existing) {
      return response.status(409).json({
        message: "This promo code already exists",
        code: "PROMO_CODE_EXISTS",
      });
    }

    if (showOnHome) {
      await prisma.promotion_campaigns.updateMany({
        where: {
          show_on_home: true,
        },
        data: {
          show_on_home: false,
        },
      });
    }

    const promotion = await prisma.promotion_campaigns.create({
      data: {
        code,
        title,
        description,
        discount_percent: discountPercent,
        max_discount_amount: maxDiscountAmount,
        minimum_order_amount: minimumOrderAmount,
        is_active: isActive,
        starts_at: startsAt,
        ends_at: endsAt,
        first_booking_only: firstBookingOnly,
        usage_limit: usageLimit === null ? null : usageLimit,
        usage_limit_per_customer:
          usageLimitPerCustomer === null ? null : usageLimitPerCustomer,
        show_on_home: showOnHome,
        home_badge_text: homeBadgeText,
      },
    });

    return response.status(201).json({
      message: "Promotion created successfully",
      promotion: serializePromotion(promotion),
    });
  } catch (error) {
    console.error("Create promotion error:", error);

    return response.status(500).json({
      message: "Unable to create promotion",
      code: "PROMOTION_CREATE_FAILED",
    });
  }
}

export async function updatePromotion(request: Request, response: Response) {
  try {
    const id = Number(request.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return response.status(400).json({
        message: "Invalid promotion id",
        code: "INVALID_PROMOTION_ID",
      });
    }

    const existing = await prisma.promotion_campaigns.findUnique({
      where: {
        id,
      },
    });

    if (!existing) {
      return response.status(404).json({
        message: "Promotion not found",
        code: "PROMOTION_NOT_FOUND",
      });
    }

    const code =
      request.body?.code === undefined
        ? existing.code
        : normalizeCode(request.body.code);

    const title =
      request.body?.title === undefined
        ? existing.title
        : String(request.body.title).trim();

    const description =
      request.body?.description === undefined
        ? existing.description
        : typeof request.body.description === "string"
          ? request.body.description.trim() || null
          : null;

    const discountPercent =
      request.body?.discount_percent === undefined
        ? Number(existing.discount_percent)
        : Number(request.body.discount_percent);

    const maxDiscountAmount =
      request.body?.max_discount_amount === undefined
        ? existing.max_discount_amount == null
          ? null
          : Number(existing.max_discount_amount)
        : parseOptionalNumber(request.body.max_discount_amount);

    const minimumOrderAmount =
      request.body?.minimum_order_amount === undefined
        ? existing.minimum_order_amount == null
          ? null
          : Number(existing.minimum_order_amount)
        : parseOptionalNumber(request.body.minimum_order_amount);

    const usageLimit =
      request.body?.usage_limit === undefined
        ? existing.usage_limit
        : parseOptionalNumber(request.body.usage_limit);

    const usageLimitPerCustomer =
      request.body?.usage_limit_per_customer === undefined
        ? existing.usage_limit_per_customer
        : parseOptionalNumber(request.body.usage_limit_per_customer);

    const startsAt =
      request.body?.starts_at === undefined
        ? existing.starts_at
        : parseOptionalDate(request.body.starts_at);

    const endsAt =
      request.body?.ends_at === undefined
        ? existing.ends_at
        : parseOptionalDate(request.body.ends_at);

    const firstBookingOnly =
      request.body?.first_booking_only === undefined
        ? existing.first_booking_only
        : Boolean(request.body.first_booking_only);

    const isActive =
      request.body?.is_active === undefined
        ? existing.is_active
        : Boolean(request.body.is_active);

    const showOnHome =
      request.body?.show_on_home === undefined
        ? existing.show_on_home
        : Boolean(request.body.show_on_home);

    const homeBadgeText =
      request.body?.home_badge_text === undefined
        ? existing.home_badge_text
        : typeof request.body.home_badge_text === "string"
          ? request.body.home_badge_text.trim() || null
          : null;

    if (!code || !title) {
      return response.status(400).json({
        message: "Promo code and title are required",
        code: "PROMOTION_REQUIRED_FIELDS",
      });
    }

    if (
      !Number.isFinite(discountPercent) ||
      discountPercent <= 0 ||
      discountPercent > 100
    ) {
      return response.status(400).json({
        message: "Discount percentage must be between 0 and 100",
        code: "INVALID_DISCOUNT_PERCENT",
      });
    }

    if (
      maxDiscountAmount !== null &&
      (!Number.isFinite(maxDiscountAmount) || maxDiscountAmount < 0)
    ) {
      return response.status(400).json({
        message: "Maximum discount amount must be 0 or more",
        code: "INVALID_MAX_DISCOUNT",
      });
    }

    if (
      minimumOrderAmount !== null &&
      (!Number.isFinite(minimumOrderAmount) || minimumOrderAmount < 0)
    ) {
      return response.status(400).json({
        message: "Minimum order amount must be 0 or more",
        code: "INVALID_MINIMUM_ORDER",
      });
    }

    if (
      usageLimit !== null &&
      (!Number.isInteger(usageLimit) || usageLimit <= 0)
    ) {
      return response.status(400).json({
        message: "Usage limit must be a positive whole number",
        code: "INVALID_USAGE_LIMIT",
      });
    }

    if (
      usageLimitPerCustomer !== null &&
      (!Number.isInteger(usageLimitPerCustomer) || usageLimitPerCustomer <= 0)
    ) {
      return response.status(400).json({
        message: "Per-customer usage limit must be a positive whole number",
        code: "INVALID_CUSTOMER_USAGE_LIMIT",
      });
    }

    if (startsAt && endsAt && endsAt <= startsAt) {
      return response.status(400).json({
        message: "End date must be after start date",
        code: "INVALID_PROMOTION_DATES",
      });
    }

    if (code !== existing.code) {
      const duplicate = await prisma.promotion_campaigns.findUnique({
        where: {
          code,
        },
      });

      if (duplicate) {
        return response.status(409).json({
          message: "This promo code already exists",
          code: "PROMO_CODE_EXISTS",
        });
      }
    }

    if (showOnHome && !existing.show_on_home) {
      await prisma.promotion_campaigns.updateMany({
        where: {
          show_on_home: true,
          NOT: {
            id,
          },
        },
        data: {
          show_on_home: false,
        },
      });
    }

    const promotion = await prisma.promotion_campaigns.update({
      where: {
        id,
      },

      data: {
        code,
        title,
        description,
        discount_percent: discountPercent,
        max_discount_amount: maxDiscountAmount,
        minimum_order_amount: minimumOrderAmount,
        is_active: isActive,
        starts_at: startsAt,
        ends_at: endsAt,
        first_booking_only: firstBookingOnly,
        usage_limit: usageLimit === null ? null : usageLimit,
        usage_limit_per_customer:
          usageLimitPerCustomer === null ? null : usageLimitPerCustomer,
        show_on_home: showOnHome,
        home_badge_text: homeBadgeText,
      },
    });

    return response.status(200).json({
      message: "Promotion updated successfully",
      promotion: serializePromotion(promotion),
    });
  } catch (error) {
    console.error("Update promotion error:", error);

    return response.status(500).json({
      message: "Unable to update promotion",
      code: "PROMOTION_UPDATE_FAILED",
    });
  }
}

export async function setPromotionStatus(request: Request, response: Response) {
  try {
    const id = Number(request.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return response.status(400).json({
        message: "Invalid promotion id",
        code: "INVALID_PROMOTION_ID",
      });
    }

    const isActive = Boolean(request.body?.is_active);

    const existing = await prisma.promotion_campaigns.findUnique({
      where: {
        id,
      },
    });

    if (!existing) {
      return response.status(404).json({
        message: "Promotion not found",
        code: "PROMOTION_NOT_FOUND",
      });
    }

    const promotion = await prisma.promotion_campaigns.update({
      where: {
        id,
      },

      data: {
        is_active: isActive,
      },
    });

    return response.status(200).json({
      message: isActive
        ? "Promotion activated successfully"
        : "Promotion deactivated successfully",

      promotion: serializePromotion(promotion),
    });
  } catch (error) {
    console.error("Set promotion status error:", error);

    return response.status(500).json({
      message: "Unable to update promotion status",
      code: "PROMOTION_STATUS_UPDATE_FAILED",
    });
  }
}
