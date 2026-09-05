import type { Request, Response } from "express";
import { prisma } from "../config/prisma";

function getAuthenticatedUserId(request: Request): number | null {
  const authRequest = request as Request & {
    user?: {
      id?: number;
      userId?: number;
      user_id?: number;
    };
  };

  const rawUserId =
    authRequest.user?.id ??
    authRequest.user?.userId ??
    authRequest.user?.user_id;

  if (!rawUserId) {
    return null;
  }

  const userId = Number(rawUserId);

  if (!Number.isInteger(userId) || userId <= 0) {
    return null;
  }

  return userId;
}

function normalizePromoCode(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().toUpperCase();
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatPromotion(promotion: {
  id: number;
  code: string;
  title: string;
  description: string | null;
  discount_percent: unknown;
  max_discount_amount: unknown;
  minimum_order_amount: unknown;
  first_booking_only: boolean;
  usage_limit_per_customer: number | null;
  starts_at: Date | null;
  ends_at: Date | null;
  show_on_home: boolean;
  home_badge_text: string | null;
}) {
  return {
    id: promotion.id,
    code: promotion.code,
    title: promotion.title,
    description: promotion.description,
    discount_percent: Number(promotion.discount_percent),
    max_discount_amount:
      promotion.max_discount_amount == null
        ? null
        : Number(promotion.max_discount_amount),
    minimum_order_amount:
      promotion.minimum_order_amount == null
        ? null
        : Number(promotion.minimum_order_amount),
    first_booking_only: promotion.first_booking_only,
    usage_limit_per_customer: promotion.usage_limit_per_customer,
    starts_at: promotion.starts_at,
    ends_at: promotion.ends_at,
    show_on_home: promotion.show_on_home,
    home_badge_text: promotion.home_badge_text,
  };
}

/**
 * Public endpoint
 *
 * Returns the current promotion that should be shown
 * on the customer Home screen.
 */
export async function getPublicHomePromotion(
  request: Request,
  response: Response,
) {
  try {
    const now = new Date();

    const promotion = await prisma.promotion_campaigns.findFirst({
      where: {
        is_active: true,
        show_on_home: true,

        AND: [
          {
            OR: [
              {
                starts_at: null,
              },
              {
                starts_at: {
                  lte: now,
                },
              },
            ],
          },
          {
            OR: [
              {
                ends_at: null,
              },
              {
                ends_at: {
                  gte: now,
                },
              },
            ],
          },
        ],
      },

      orderBy: [
        {
          created_at: "desc",
        },
      ],
    });

    if (!promotion) {
      return response.status(200).json({
        promotion: null,
      });
    }

    return response.status(200).json({
      promotion: formatPromotion(promotion),
    });
  } catch (error) {
    console.error("Get public home promotion error:", error);

    return response.status(500).json({
      message: "Unable to load promotion",
      code: "PROMOTION_LOAD_FAILED",
    });
  }
}

/**
 * Customer endpoint
 *
 * Validates a promo code and calculates the discount.
 *
 * Body:
 * {
 *   "code": "WELCOME20",
 *   "amount": 2000
 * }
 *
 * Example:
 * 20% of Rs. 2000 = Rs. 400
 * max discount = Rs. 300
 * final discount = Rs. 300
 * payable = Rs. 1700
 */
export async function validatePromotion(request: Request, response: Response) {
  try {
    const customerId = getAuthenticatedUserId(request);

    if (!customerId) {
      return response.status(401).json({
        message: "Authentication required",
        code: "UNAUTHORIZED",
      });
    }

    const code = normalizePromoCode(request.body?.code);
    const rawAmount = Number(request.body?.amount);

    if (!code) {
      return response.status(400).json({
        message: "Promo code is required",
        code: "PROMO_CODE_REQUIRED",
      });
    }

    if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
      return response.status(400).json({
        message: "A valid booking amount is required",
        code: "INVALID_PROMO_AMOUNT",
      });
    }

    const amount = roundMoney(rawAmount);
    const now = new Date();

    const promotion = await prisma.promotion_campaigns.findUnique({
      where: {
        code,
      },
    });

    if (!promotion) {
      return response.status(404).json({
        message: "Invalid promo code",
        code: "PROMO_NOT_FOUND",
      });
    }

    if (!promotion.is_active) {
      return response.status(400).json({
        message: "This promo code is not active",
        code: "PROMO_INACTIVE",
      });
    }

    if (promotion.starts_at && promotion.starts_at.getTime() > now.getTime()) {
      return response.status(400).json({
        message: "This promo code is not active yet",
        code: "PROMO_NOT_STARTED",
      });
    }

    if (promotion.ends_at && promotion.ends_at.getTime() < now.getTime()) {
      return response.status(400).json({
        message: "This promo code has expired",
        code: "PROMO_EXPIRED",
      });
    }

    const minimumOrderAmount =
      promotion.minimum_order_amount == null
        ? null
        : Number(promotion.minimum_order_amount);

    if (minimumOrderAmount !== null && amount < minimumOrderAmount) {
      return response.status(400).json({
        message: `Minimum booking amount for this promo is Rs. ${minimumOrderAmount}`,
        code: "PROMO_MINIMUM_NOT_MET",
        minimum_order_amount: minimumOrderAmount,
      });
    }

    /**
     * Global campaign usage limit.
     */
    if (promotion.usage_limit !== null && promotion.usage_limit !== undefined) {
      const globalUsageCount = await prisma.promotion_redemptions.count({
        where: {
          promotion_id: promotion.id,
        },
      });

      if (globalUsageCount >= promotion.usage_limit) {
        return response.status(400).json({
          message: "This promo code has reached its usage limit",
          code: "PROMO_USAGE_LIMIT_REACHED",
        });
      }
    }

    /**
     * Per-customer usage limit.
     */
    if (
      promotion.usage_limit_per_customer !== null &&
      promotion.usage_limit_per_customer !== undefined
    ) {
      const customerUsageCount = await prisma.promotion_redemptions.count({
        where: {
          promotion_id: promotion.id,
          customer_id: customerId,
        },
      });

      if (customerUsageCount >= promotion.usage_limit_per_customer) {
        return response.status(400).json({
          message: "You have already used this promo code",
          code: "PROMO_CUSTOMER_LIMIT_REACHED",
        });
      }
    }

    /**
     * First-booking-only validation.
     *
     * Cancelled bookings are ignored so a customer who
     * cancelled before receiving a service can still use
     * a first-booking promotion.
     */
    if (promotion.first_booking_only) {
      const previousBookingCount = await prisma.bookings.count({
        where: {
          customer_id: customerId,

          NOT: {
            status: "cancelled",
          },
        },
      });

      if (previousBookingCount > 0) {
        return response.status(400).json({
          message: "This promo code is available only for your first booking",
          code: "PROMO_FIRST_BOOKING_ONLY",
        });
      }
    }

    const discountPercent = Number(promotion.discount_percent);

    if (
      !Number.isFinite(discountPercent) ||
      discountPercent <= 0 ||
      discountPercent > 100
    ) {
      console.error(
        `Promotion ${promotion.id} has invalid discount percentage`,
      );

      return response.status(500).json({
        message: "Promo configuration is invalid",
        code: "INVALID_PROMO_CONFIGURATION",
      });
    }

    const percentageDiscount = roundMoney((amount * discountPercent) / 100);

    const maxDiscount =
      promotion.max_discount_amount == null
        ? null
        : Number(promotion.max_discount_amount);

    let discountAmount = percentageDiscount;

    if (
      maxDiscount !== null &&
      Number.isFinite(maxDiscount) &&
      maxDiscount >= 0
    ) {
      discountAmount = Math.min(discountAmount, maxDiscount);
    }

    /**
     * Discount can never exceed booking amount.
     */
    discountAmount = roundMoney(Math.min(discountAmount, amount));

    const payableAmount = roundMoney(Math.max(0, amount - discountAmount));

    return response.status(200).json({
      valid: true,

      promotion: formatPromotion(promotion),

      calculation: {
        original_amount: amount,
        discount_percent: discountPercent,
        percentage_discount: percentageDiscount,
        max_discount_amount: maxDiscount,
        discount_amount: discountAmount,
        payable_amount: payableAmount,
      },

      message:
        discountAmount > 0
          ? `Promo applied. You saved Rs. ${discountAmount}.`
          : "Promo code applied.",
    });
  } catch (error) {
    console.error("Validate promotion error:", error);

    return response.status(500).json({
      message: "Unable to validate promo code",
      code: "PROMO_VALIDATION_FAILED",
    });
  }
}
