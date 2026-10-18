import type { Response } from "express";
import { Prisma } from "../generated/prisma/client";
import { prisma } from "../config/prisma";
import type { AuthenticatedRequest } from "../middlewares/auth.middleware";
import {
  createNotification,
  recordBookingStatusHistory,
} from "../services/booking-event.service";
import { resolveCustomerBookingAddress } from "../services/customer-address.service";
import { safelySyncOrderChatWithBookingStatus } from "../services/order-chat-lifecycle.service";
import {
  lockAndValidateConsultationCredit,
  redeemConsultationCredit,
} from "../services/consultation-credit.service";
import {
  ALL_PAYMENT_METHODS,
  PAYMENT_METHODS,
  isPaymentMethod,
} from "../constants/payment-methods";

/*
|--------------------------------------------------------------------------
| Customer: Create booking
|--------------------------------------------------------------------------
*/

/*
|--------------------------------------------------------------------------
| Booking time rules (all evaluated in the business time zone)
|--------------------------------------------------------------------------
|
| The server may run in UTC, but customers book in local (Nepal) time, so
| "today" and "now" are computed in BOOKING_TIME_ZONE.
|
*/

const BOOKING_TIME_ZONE = process.env.BOOKING_TIME_ZONE || "Asia/Kathmandu";
const ASAP_START_MINUTES = 6 * 60;
const ASAP_END_MINUTES = 20 * 60;

const getZonedNow = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BOOKING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());

  const read = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "00";

  const hour = Number(read("hour"));
  const minute = Number(read("minute"));

  return {
    date: `${read("year")}-${read("month")}-${read("day")}`,
    minutes: hour * 60 + minute,
    time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
};

export const createBooking = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const customerId = request.user?.userId;

    const {
      serviceId,
      addressId,
      serviceAddress,
      serviceArea,
      preferredDate,
      preferredTime,
      isAsap,
      notes,
      paymentMethod,
      promoCode,
      bookingType,
      consultationCreditId,
    } = request.body;

    if (!customerId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Validate customer-selected payment method
    |--------------------------------------------------------------------------
    */

    const normalizedPaymentMethod =
      typeof paymentMethod === "string" && paymentMethod.trim().length > 0
        ? paymentMethod.trim().toLowerCase()
        : PAYMENT_METHODS.CASH;

    if (!isPaymentMethod(normalizedPaymentMethod)) {
      return response.status(400).json({
        message: `Payment method must be one of: ${ALL_PAYMENT_METHODS.join(", ")}`,
      });
    }

    const parsedServiceId = Number(serviceId);

    if (!Number.isInteger(parsedServiceId) || parsedServiceId <= 0) {
      return response.status(400).json({
        message: "Valid service ID is required",
      });
    }

    if (!preferredDate) {
      return response.status(400).json({
        message: "Preferred date is required",
      });
    }

    const parsedPreferredDate = new Date(preferredDate);

    if (Number.isNaN(parsedPreferredDate.getTime())) {
      return response.status(400).json({
        message: "Invalid preferred date",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Prevent booking in the past
    |--------------------------------------------------------------------------
    */

    const today = new Date();

    today.setHours(0, 0, 0, 0);

    const selectedDate = new Date(parsedPreferredDate);

    selectedDate.setHours(0, 0, 0, 0);

    if (selectedDate < today) {
      return response.status(400).json({
        message: "Preferred date cannot be in the past",
      });
    }

    let parsedPreferredTime: Date | null = null;

    if (preferredTime !== undefined && preferredTime !== null) {
      if (
        typeof preferredTime !== "string" ||
        !/^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/.test(preferredTime)
      ) {
        return response.status(400).json({
          message: "Preferred time must use HH:mm or HH:mm:ss format",
        });
      }

      const normalizedTime =
        preferredTime.length === 5 ? `${preferredTime}:00` : preferredTime;

      parsedPreferredTime = new Date(`1970-01-01T${normalizedTime}.000Z`);

      if (Number.isNaN(parsedPreferredTime.getTime())) {
        return response.status(400).json({
          message: "Invalid preferred time",
        });
      }
    }

    /*
    |--------------------------------------------------------------------------
    | Time rules: no past dates/times, ASAP only for today within hours
    |--------------------------------------------------------------------------
    */

    const zonedNow = getZonedNow();

    const requestedDateKey = parsedPreferredDate.toISOString().slice(0, 10);

    if (requestedDateKey < zonedNow.date) {
      return response.status(400).json({
        message: "Preferred date cannot be in the past",
      });
    }

    const wantsAsap = isAsap === true || isAsap === "true";

    if (wantsAsap) {
      if (requestedDateKey !== zonedNow.date) {
        return response.status(400).json({
          message: "ASAP bookings can only be made for today",
        });
      }

      if (
        zonedNow.minutes < ASAP_START_MINUTES ||
        zonedNow.minutes >= ASAP_END_MINUTES
      ) {
        return response.status(400).json({
          message:
            "ASAP is only available between 6:00 AM and 8:00 PM. Please choose a scheduled time.",
        });
      }

      parsedPreferredTime = new Date(`1970-01-01T${zonedNow.time}:00.000Z`);
    } else if (parsedPreferredTime && requestedDateKey === zonedNow.date) {
      const requestedMinutes =
        parsedPreferredTime.getUTCHours() * 60 +
        parsedPreferredTime.getUTCMinutes();

      if (requestedMinutes <= zonedNow.minutes) {
        return response.status(400).json({
          message: "That time has already passed. Please choose a later time.",
        });
      }
    }

    const bookingNotes =
      [
        wantsAsap ? "ASAP request - customer needs help within 2 hours." : null,
        typeof notes === "string" && notes.trim().length > 0
          ? notes.trim()
          : null,
      ]
        .filter((part): part is string => part !== null)
        .join("\n") || null;

    if (notes !== undefined && notes !== null && typeof notes !== "string") {
      return response.status(400).json({
        message: "Notes must be text",
      });
    }

    if (typeof notes === "string" && notes.trim().length > 1000) {
      return response.status(400).json({
        message: "Notes must not exceed 1000 characters",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Confirm customer account
    |--------------------------------------------------------------------------
    */

    const customer = await prisma.users.findFirst({
      where: {
        id: customerId,
        role_id: 1,
        is_active: true,
      },
      select: {
        id: true,
        full_name: true,
      },
    });

    if (!customer) {
      return response.status(403).json({
        message: "Active customer account not found",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Confirm service and active category
    |--------------------------------------------------------------------------
    */

    const service = await prisma.services.findFirst({
      where: {
        id: parsedServiceId,
        is_active: true,
        service_categories: {
          is_active: true,
        },
      },
      select: {
        id: true,
        name: true,
        description: true,
        base_price: true,
        duration_minutes: true,
        category_id: true,
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
    });

    if (!service) {
      return response.status(404).json({
        message: "Service not found, inactive, or its category is unavailable",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Validate booking type
    |--------------------------------------------------------------------------
    |
    | video_consultation_price lives on the services table but isn't yet
    | in the generated Prisma Client's `services` select type (see
    | consultation-credit.service.ts for why) — fetched via raw SQL here
    | rather than added to the select above.
    |--------------------------------------------------------------------------
    */

    const normalizedBookingType =
      typeof bookingType === "string" && bookingType.trim().length > 0
        ? bookingType.trim().toLowerCase()
        : "home_visit";

    if (!["home_visit", "video_consultation"].includes(normalizedBookingType)) {
      return response.status(400).json({
        message:
          "bookingType must be either 'home_visit' or 'video_consultation'",
      });
    }

    const isVideoConsultation = normalizedBookingType === "video_consultation";

    // A video consultation has no in-person provider to collect cash, so it
    // must be paid online.
    if (isVideoConsultation && normalizedPaymentMethod === "cash") {
      return response.status(400).json({
        message:
          "Video consultations must be paid online. Please choose eSewa, Khalti or Connect IPS.",
      });
    }

    let videoConsultationPrice: number | null = null;

    if (isVideoConsultation) {
      const [priceRow] = await prisma.$queryRaw<
        Array<{ video_consultation_price: string | null }>
      >`
        SELECT video_consultation_price
        FROM services
        WHERE id = ${service.id}
      `;

      videoConsultationPrice = priceRow?.video_consultation_price
        ? Number(priceRow.video_consultation_price)
        : null;

      if (
        videoConsultationPrice === null ||
        !Number.isFinite(videoConsultationPrice)
      ) {
        return response.status(400).json({
          message: "This service does not offer video consultation",
          code: "VIDEO_CONSULTATION_NOT_OFFERED",
        });
      }
    }

    /*
    |--------------------------------------------------------------------------
    | Resolve saved or manually entered address
    |--------------------------------------------------------------------------
    */

    let resolvedAddress: {
      addressId: number | null;
      serviceAddress: string;
      serviceArea: string;
    };

    try {
      resolvedAddress = await resolveCustomerBookingAddress({
        customerId,
        addressId,
        serviceAddress,
        serviceArea,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "INVALID_ADDRESS_ID") {
        return response.status(400).json({
          message: "Invalid saved address ID",
        });
      }

      if (error instanceof Error && error.message === "ADDRESS_NOT_FOUND") {
        return response.status(404).json({
          message:
            "Saved address not found or does not belong to this customer",
        });
      }

      if (
        error instanceof Error &&
        error.message === "INVALID_SERVICE_ADDRESS"
      ) {
        return response.status(400).json({
          message: "Provide a saved address ID or a valid service address",
        });
      }

      if (error instanceof Error && error.message === "INVALID_SERVICE_AREA") {
        return response.status(400).json({
          message: "Provide a saved address ID or a valid service area",
        });
      }

      throw error;
    }

    /*
    |--------------------------------------------------------------------------
    | Prepare promotion
    |--------------------------------------------------------------------------
    */

    const grossAmount = isVideoConsultation
      ? (videoConsultationPrice as number)
      : Number(service.base_price);

    let selectedPromotion: {
      id: number;
      code: string;
      discountPercent: number;
      maxDiscountAmount: number | null;
      discountAmount: number;
      payableAmount: number;
    } | null = null;

    const normalizedPromoCode =
      typeof promoCode === "string" && promoCode.trim().length > 0
        ? promoCode.trim().toUpperCase()
        : null;

    // Promo codes only apply to home visits. A consultation credit is the
    // only discount a booking can receive, and only on the home visit.
    if (isVideoConsultation && normalizedPromoCode) {
      return response.status(400).json({
        message: "Promo codes can't be used on video consultations.",
        code: "PROMO_NOT_ALLOWED_FOR_VIDEO",
      });
    }

    if (normalizedPromoCode) {
      const now = new Date();

      const promotion = await prisma.promotion_campaigns.findUnique({
        where: {
          code: normalizedPromoCode,
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

      if (promotion.starts_at && promotion.starts_at > now) {
        return response.status(400).json({
          message: "This promo code is not active yet",
          code: "PROMO_NOT_STARTED",
        });
      }

      if (promotion.ends_at && promotion.ends_at < now) {
        return response.status(400).json({
          message: "This promo code has expired",
          code: "PROMO_EXPIRED",
        });
      }

      const minimumOrderAmount =
        promotion.minimum_order_amount === null
          ? null
          : Number(promotion.minimum_order_amount);

      if (minimumOrderAmount !== null && grossAmount < minimumOrderAmount) {
        return response.status(400).json({
          message: `Minimum booking amount for this promo is Rs. ${minimumOrderAmount}`,
          code: "PROMO_MINIMUM_NOT_MET",
        });
      }

      if (promotion.usage_limit !== null) {
        const totalUsage = await prisma.promotion_redemptions.count({
          where: {
            promotion_id: promotion.id,
          },
        });

        if (totalUsage >= promotion.usage_limit) {
          return response.status(400).json({
            message: "This promo code has reached its usage limit",
            code: "PROMO_USAGE_LIMIT_REACHED",
          });
        }
      }

      if (promotion.usage_limit_per_customer !== null) {
        const customerUsage = await prisma.promotion_redemptions.count({
          where: {
            promotion_id: promotion.id,
            customer_id: customerId,
          },
        });

        if (customerUsage >= promotion.usage_limit_per_customer) {
          return response.status(400).json({
            message: "You have already used this promo code",
            code: "PROMO_CUSTOMER_LIMIT_REACHED",
          });
        }
      }

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

      let discountAmount = Number(
        ((grossAmount * discountPercent) / 100).toFixed(2),
      );

      if (promotion.max_discount_amount !== null) {
        discountAmount = Math.min(
          discountAmount,
          Number(promotion.max_discount_amount),
        );
      }

      discountAmount = Math.min(discountAmount, grossAmount);

      const payableAmount = Number(
        Math.max(0, grossAmount - discountAmount).toFixed(2),
      );

      selectedPromotion = {
        id: promotion.id,
        code: promotion.code,
        discountPercent,
        maxDiscountAmount:
          promotion.max_discount_amount === null
            ? null
            : Number(promotion.max_discount_amount),
        discountAmount,
        payableAmount,
      };
    }

    /*
    |--------------------------------------------------------------------------
    | Create booking, promo redemption, status history and notification
    |--------------------------------------------------------------------------
    */

    const booking = await prisma.$transaction(async (transaction) => {
      /*
  |--------------------------------------------------------------------------
  | Lock and revalidate promotion usage atomically
  |--------------------------------------------------------------------------
  |
  | Locking the promotion row makes promo redemptions for the same promo
  | execute one at a time. This prevents two customers from both taking
  | the final available redemption.
  |--------------------------------------------------------------------------
  */

      if (selectedPromotion) {
        await transaction.$queryRaw<Array<{ id: number }>>`
      SELECT id
      FROM promotion_campaigns
      WHERE id = ${selectedPromotion.id}
      FOR UPDATE
    `;

        const lockedPromotion =
          await transaction.promotion_campaigns.findUnique({
            where: {
              id: selectedPromotion.id,
            },
            select: {
              id: true,
              usage_limit: true,
              usage_limit_per_customer: true,
              first_booking_only: true,
            },
          });

        if (!lockedPromotion) {
          throw new Error("PROMO_NOT_FOUND");
        }

        if (lockedPromotion.usage_limit !== null) {
          const totalUsage = await transaction.promotion_redemptions.count({
            where: {
              promotion_id: selectedPromotion.id,
            },
          });

          if (totalUsage >= lockedPromotion.usage_limit) {
            throw new Error("PROMO_USAGE_LIMIT_REACHED");
          }
        }

        if (lockedPromotion.usage_limit_per_customer !== null) {
          const customerUsage = await transaction.promotion_redemptions.count({
            where: {
              promotion_id: selectedPromotion.id,
              customer_id: customerId,
            },
          });

          if (customerUsage >= lockedPromotion.usage_limit_per_customer) {
            throw new Error("PROMO_CUSTOMER_LIMIT_REACHED");
          }
        }

        if (lockedPromotion.first_booking_only) {
          /*
           * Also lock the customer row so two simultaneous "first booking"
           * requests for this customer cannot both succeed.
           */
          await transaction.$queryRaw<Array<{ id: number }>>`
        SELECT id
        FROM users
        WHERE id = ${customerId}
        FOR UPDATE
      `;

          const previousBookingCount = await transaction.bookings.count({
            where: {
              customer_id: customerId,
              NOT: {
                status: "cancelled",
              },
            },
          });

          if (previousBookingCount > 0) {
            throw new Error("PROMO_FIRST_BOOKING_ONLY");
          }
        }
      }

      /*
      |--------------------------------------------------------------------------
      | Lock and redeem a consultation credit, if one was supplied
      |--------------------------------------------------------------------------
      |
      | Only meaningful for a home-visit booking — a credit is earned by
      | a video consultation and spent on the follow-up visit, so it
      | can't be applied to another video consultation. Stacks with a
      | promo code: both discounts subtract from grossAmount, capped so
      | the customer never pays less than zero.
      |--------------------------------------------------------------------------
      */

      let appliedConsultationCredit: {
        id: number;
        amount: number;
      } | null = null;

      const parsedConsultationCreditId = Number(consultationCreditId);

      if (
        !isVideoConsultation &&
        Number.isInteger(parsedConsultationCreditId) &&
        parsedConsultationCreditId > 0
      ) {
        const credit = await lockAndValidateConsultationCredit(transaction, {
          creditId: parsedConsultationCreditId,
          customerId,
        });

        appliedConsultationCredit = {
          id: credit.id,
          amount: Number(credit.credit_amount),
        };
      }

      const promoDiscountAmount = selectedPromotion?.discountAmount ?? 0;

      const combinedDiscountAmount = Number(
        Math.min(
          grossAmount,
          promoDiscountAmount + (appliedConsultationCredit?.amount ?? 0),
        ).toFixed(2),
      );

      const combinedPayableAmount = Number(
        Math.max(0, grossAmount - combinedDiscountAmount).toFixed(2),
      );

      const createdBooking = await transaction.bookings.create({
        data: {
          customer_id: customerId,
          service_id: service.id,
          provider_id: null,
          customer_address_id: resolvedAddress.addressId,
          service_address: resolvedAddress.serviceAddress,
          service_area: resolvedAddress.serviceArea,
          preferred_date: parsedPreferredDate,
          preferred_time: parsedPreferredTime,
          notes: bookingNotes,
          status: "pending",
          payment_method: normalizedPaymentMethod,

          estimated_price: grossAmount,
          final_price: null,

          promotion_id: selectedPromotion?.id ?? null,

          promo_code_snapshot: selectedPromotion?.code ?? null,

          promo_discount_percent_snapshot:
            selectedPromotion?.discountPercent ?? null,

          promo_max_discount_snapshot:
            selectedPromotion?.maxDiscountAmount ?? null,

          discount_amount: combinedDiscountAmount,

          customer_payable_amount: combinedPayableAmount,

          accepted_at: null,
          assigned_at: null,
          started_at: null,
          completed_at: null,
          cancelled_at: null,
          cancelled_by: null,
          cancellation_reason: null,
        },
        include: {
          services: {
            select: {
              id: true,
              name: true,
              description: true,
              base_price: true,
              duration_minutes: true,
              category_id: true,
              service_categories: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  description: true,
                  image_url: true,
                },
              },
            },
          },
          promotion: {
            select: {
              id: true,
              code: true,
              title: true,
              description: true,
              discount_percent: true,
              max_discount_amount: true,
              minimum_order_amount: true,
            },
          },
        },
      });

      if (selectedPromotion) {
        await transaction.promotion_redemptions.create({
          data: {
            promotion_id: selectedPromotion.id,
            customer_id: customerId,
            booking_id: createdBooking.id,
            promo_code: selectedPromotion.code,
            gross_amount: grossAmount,
            discount_amount: selectedPromotion.discountAmount,
            payable_amount: selectedPromotion.payableAmount,
          },
        });
      }

      if (appliedConsultationCredit) {
        await redeemConsultationCredit(transaction, {
          creditId: appliedConsultationCredit.id,
          redeemedBookingId: createdBooking.id,
        });
      }

      await transaction.$executeRaw`
        UPDATE bookings
        SET booking_type = ${normalizedBookingType}
        WHERE id = ${createdBooking.id}
      `;

      await transaction.booking_status_history.create({
        data: {
          booking_id: createdBooking.id,
          old_status: null,
          new_status: "pending",
          changed_by_user_id: customerId,
          changed_by_role: "customer",
          note: selectedPromotion
            ? `Customer created a new service request using promo code ${selectedPromotion.code}.`
            : "Customer created a new service request.",
        },
      });

      const discountNotes = [
        selectedPromotion
          ? `Promo ${selectedPromotion.code} saved you Rs. ${selectedPromotion.discountAmount}.`
          : null,
        appliedConsultationCredit
          ? `Your consultation credit saved you Rs. ${appliedConsultationCredit.amount}.`
          : null,
      ]
        .filter(Boolean)
        .join(" ");

      await transaction.notifications.create({
        data: {
          user_id: customerId,
          booking_id: createdBooking.id,
          notification_type: "booking_created",
          title: "Service Request Submitted",
          message: discountNotes
            ? `Your request for ${service.name} has been submitted. ${discountNotes}`
            : `Your request for ${service.name} has been submitted successfully.`,
          is_read: false,
          read_at: null,
        },
      });

      return createdBooking;
    });

    return response.status(201).json({
      message: "Booking created successfully",
      booking,
      pricing: {
        original_amount: grossAmount,
        discount_amount: selectedPromotion?.discountAmount ?? 0,
        payable_amount: selectedPromotion?.payableAmount ?? grossAmount,
        promo_code: selectedPromotion?.code ?? null,
      },
    });
  } catch (error) {
    console.error("Create booking error:", error);

    if (error instanceof Error) {
      if (error.message === "PROMO_NOT_FOUND") {
        return response.status(400).json({
          message: "Promotion is no longer available",
          code: "PROMO_NOT_FOUND",
        });
      }

      if (error.message === "PROMO_USAGE_LIMIT_REACHED") {
        return response.status(400).json({
          message: "This promo code has reached its usage limit",
          code: "PROMO_USAGE_LIMIT_REACHED",
        });
      }

      if (error.message === "PROMO_CUSTOMER_LIMIT_REACHED") {
        return response.status(400).json({
          message: "You have already used this promo code",
          code: "PROMO_CUSTOMER_LIMIT_REACHED",
        });
      }

      if (error.message === "PROMO_FIRST_BOOKING_ONLY") {
        return response.status(400).json({
          message: "This promo code is available only for your first booking",
          code: "PROMO_FIRST_BOOKING_ONLY",
        });
      }

      if (error.message === "CONSULTATION_CREDIT_NOT_FOUND") {
        return response.status(400).json({
          message: "That consultation credit could not be found",
          code: "CONSULTATION_CREDIT_NOT_FOUND",
        });
      }

      if (error.message === "CONSULTATION_CREDIT_ALREADY_REDEEMED") {
        return response.status(400).json({
          message: "That consultation credit has already been used",
          code: "CONSULTATION_CREDIT_ALREADY_REDEEMED",
        });
      }

      if (error.message === "CONSULTATION_CREDIT_EXPIRED") {
        return response.status(400).json({
          message: "That consultation credit has expired",
          code: "CONSULTATION_CREDIT_EXPIRED",
        });
      }
    }

    return response.status(500).json({
      message: "Unable to create booking",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Customer: Get booking history
|--------------------------------------------------------------------------
| Optional filter:
| GET /api/bookings/me?status=pending
|--------------------------------------------------------------------------
*/

export const getMyBookings = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const customerId = request.user?.userId;
    const statusValue = request.query.status;

    if (!customerId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    const allowedStatuses = [
      "pending",
      "accepted",
      "assigned",
      "in_progress",
      "completed",
      "cancelled",
    ];

    let status: string | undefined;

    if (statusValue !== undefined) {
      status = String(statusValue).trim().toLowerCase();

      if (!allowedStatuses.includes(status)) {
        return response.status(400).json({
          message: "Invalid booking status filter",
        });
      }
    }

    const bookings = await prisma.bookings.findMany({
      where: {
        customer_id: customerId,
        ...(status ? { status } : {}),
      },
      include: {
        services: {
          select: {
            id: true,
            name: true,
            description: true,
            base_price: true,
            duration_minutes: true,
            category_id: true,
            service_categories: {
              select: {
                id: true,
                name: true,
                slug: true,
                description: true,
                image_url: true,
              },
            },
          },
        },
        users_bookings_provider_idTousers: {
          select: {
            id: true,
            full_name: true,
            phone: true,
          },
        },
      },
      orderBy: {
        created_at: "desc",
      },
    });

    return response.status(200).json({
      message: "Bookings fetched successfully",
      filter: {
        status: status ?? null,
      },
      bookings,
    });
  } catch (error) {
    console.error("Get bookings error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching bookings",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Customer: Get one booking
|--------------------------------------------------------------------------
*/

export const getMyBookingById = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const customerId = request.user?.userId;
    const bookingId = Number(request.params.id);

    if (!customerId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      return response.status(400).json({
        message: "Invalid booking ID",
      });
    }

    const booking = await prisma.bookings.findFirst({
      where: {
        id: bookingId,
        customer_id: customerId,
      },
      include: {
        services: {
          select: {
            id: true,
            name: true,
            description: true,
            base_price: true,
            duration_minutes: true,
            category_id: true,
            service_categories: {
              select: {
                id: true,
                name: true,
                slug: true,
                description: true,
                image_url: true,
              },
            },
          },
        },
        users_bookings_provider_idTousers: {
          select: {
            id: true,
            full_name: true,
            phone: true,
          },
        },
        payments: {
          select: {
            id: true,
            amount: true,
            payment_method: true,
            payment_status: true,
            paid_at: true,
            created_at: true,
          },
        },
        reviews: {
          select: {
            id: true,
            rating: true,
            comment: true,
            is_visible: true,
            created_at: true,
          },
        },
        booking_status_history: {
          orderBy: {
            created_at: "asc",
          },
          select: {
            id: true,
            old_status: true,
            new_status: true,
            changed_by_user_id: true,
            changed_by_role: true,
            note: true,
            created_at: true,
          },
        },
      },
    });

    if (!booking) {
      return response.status(404).json({
        message: "Booking not found",
      });
    }

    return response.status(200).json({
      message: "Booking fetched successfully",
      booking,
    });
  } catch (error) {
    console.error("Get booking error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching the booking",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Customer: Cancel booking
|--------------------------------------------------------------------------
*/

export const cancelMyBooking = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const customerId = request.user?.userId;
    const bookingId = Number(request.params.id);
    const { cancellationReason } = request.body;

    if (!customerId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      return response.status(400).json({
        message: "Invalid booking ID",
      });
    }

    if (
      cancellationReason !== undefined &&
      (typeof cancellationReason !== "string" ||
        cancellationReason.trim().length > 500)
    ) {
      return response.status(400).json({
        message:
          "Cancellation reason must be text with a maximum of 500 characters",
      });
    }

    const booking = await prisma.bookings.findFirst({
      where: {
        id: bookingId,
        customer_id: customerId,
      },
    });

    if (!booking) {
      return response.status(404).json({
        message: "Booking not found",
      });
    }

    const cancellableStatuses = ["pending", "accepted", "assigned"];

    if (!cancellableStatuses.includes(booking.status)) {
      return response.status(400).json({
        message: `Booking cannot be cancelled because its status is ${booking.status}`,
      });
    }

    const cancelledBooking = await prisma.$transaction(async (transaction) => {
      const updatedBooking = await transaction.bookings.update({
        where: {
          id: bookingId,
        },
        data: {
          status: "cancelled",
          cancelled_at: new Date(),
          cancelled_by: "customer",
          cancellation_reason:
            typeof cancellationReason === "string" &&
            cancellationReason.trim().length > 0
              ? cancellationReason.trim()
              : null,
          updated_at: new Date(),
        },
        include: {
          services: {
            select: {
              id: true,
              name: true,
              category_id: true,
              service_categories: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                },
              },
            },
          },
        },
      });

      await transaction.promotion_redemptions.deleteMany({
        where: {
          booking_id: bookingId,
        },
      });

      await transaction.booking_status_history.create({
        data: {
          booking_id: bookingId,
          old_status: booking.status,
          new_status: "cancelled",
          changed_by_user_id: customerId,
          changed_by_role: "customer",
          note:
            typeof cancellationReason === "string" &&
            cancellationReason.trim().length > 0
              ? cancellationReason.trim()
              : "Booking cancelled by customer.",
        },
      });

      return updatedBooking;
    });

    await createNotification({
      userId: customerId,
      bookingId: cancelledBooking.id,
      notificationType: "booking_cancelled",
      title: "Booking Cancelled",
      message: `Your booking #${cancelledBooking.id} has been cancelled.`,
    });

    await safelySyncOrderChatWithBookingStatus(bookingId, "cancelled");

    return response.status(200).json({
      message: "Booking cancelled successfully",
      booking: cancelledBooking,
    });
  } catch (error) {
    console.error("Cancel booking error:", error);

    return response.status(500).json({
      message: "Something went wrong while cancelling the booking",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin: Get all bookings
|--------------------------------------------------------------------------
*/

export const getAllBookingsForAdmin = async (
  _request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const bookings = await prisma.bookings.findMany({
      include: {
        users_bookings_customer_idTousers: {
          select: {
            id: true,
            full_name: true,
            phone: true,
            customer_addresses: {
              select: {
                id: true,
                label: true,
                full_address: true,
                service_area: true,
                landmark: true,
                latitude: true,
                longitude: true,
                is_default: true,
              },
            },
          },
        },
        users_bookings_provider_idTousers: {
          select: {
            id: true,
            full_name: true,
            phone: true,
          },
        },
        services: {
          select: {
            id: true,
            name: true,
            base_price: true,
            category_id: true,
            service_categories: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
          },
        },
      },
      orderBy: {
        created_at: "desc",
      },
    });

    return response.status(200).json({
      message: "All bookings fetched successfully",
      bookings,
    });
  } catch (error) {
    console.error("Admin bookings error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching bookings",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin: Manually assign provider
|--------------------------------------------------------------------------
*/

export const assignProviderToBooking = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const bookingId = Number(request.params.id);
    const providerId = Number(request.body.providerId);

    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      return response.status(400).json({
        message: "Invalid booking ID",
      });
    }

    if (!Number.isInteger(providerId) || providerId <= 0) {
      return response.status(400).json({
        message: "Valid provider ID is required",
      });
    }

    const booking = await prisma.bookings.findUnique({
      where: {
        id: bookingId,
      },
    });

    if (!booking) {
      return response.status(404).json({
        message: "Booking not found",
      });
    }

    if (
      booking.status === "cancelled" ||
      booking.status === "completed" ||
      booking.status === "in_progress"
    ) {
      return response.status(400).json({
        message: `Provider cannot be assigned because booking status is ${booking.status}`,
      });
    }

    const providerRole = await prisma.roles.findUnique({
      where: {
        name: "provider",
      },
    });

    if (!providerRole) {
      return response.status(500).json({
        message: "Provider role is not configured in the database",
      });
    }

    const provider = await prisma.users.findFirst({
      where: {
        id: providerId,
        role_id: providerRole.id,
        is_active: true,
      },
    });

    if (!provider) {
      return response.status(404).json({
        message: "Active provider not found",
      });
    }

    const now = new Date();

    const updatedBooking = await prisma.bookings.update({
      where: {
        id: bookingId,
      },
      data: {
        provider_id: providerId,
        status: "assigned",
        accepted_at: booking.accepted_at ?? now,
        assigned_at: now,
        updated_at: now,
      },
    });

    return response.status(200).json({
      message: "Provider assigned successfully",
      booking: updatedBooking,
    });
  } catch (error) {
    console.error("Assign provider error:", error);

    return response.status(500).json({
      message: "Something went wrong while assigning the provider",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Provider: Get assigned bookings
|--------------------------------------------------------------------------
*/

export const getAssignedBookingsForProvider = async (
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

    const bookings = await prisma.bookings.findMany({
      where: {
        provider_id: providerId,
      },
      include: {
        users_bookings_customer_idTousers: {
          select: {
            id: true,
            full_name: true,
            phone: true,
            customer_addresses: {
              select: {
                id: true,
                label: true,
                full_address: true,
                service_area: true,
                landmark: true,
                latitude: true,
                longitude: true,
                is_default: true,
              },
            },
          },
        },
        services: {
          select: {
            id: true,
            name: true,
            base_price: true,
            category_id: true,
            service_categories: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
          },
        },
      },
      orderBy: {
        created_at: "desc",
      },
    });

    /*
     * booking_type isn't in the generated Prisma Client yet — same
     * situation as getProviderBookingById just above. Fetched for the
     * whole list in one query (not N+1) and merged in by id, so the
     * provider's job list can show a "Video Consultation" badge.
     */
    const bookingIds = bookings.map((booking) => booking.id);

    const consultationRows =
      bookingIds.length > 0
        ? await prisma.$queryRaw<Array<{ id: number; booking_type: string }>>`
            SELECT id, booking_type
            FROM bookings
            WHERE id IN (${Prisma.join(bookingIds)})
          `
        : [];

    const bookingTypeById = new Map(
      consultationRows.map((row) => [row.id, row.booking_type]),
    );

    return response.status(200).json({
      message: "Assigned bookings fetched successfully",
      bookings: bookings.map((booking) => ({
        ...booking,
        booking_type: bookingTypeById.get(booking.id) ?? "home_visit",
      })),
    });
  } catch (error) {
    console.error("Provider bookings error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching assigned bookings",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Provider: Start booking
|--------------------------------------------------------------------------
*/

export const startAssignedBooking = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const providerId = request.user?.userId;
    const bookingId = Number(request.params.id);

    if (!providerId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      return response.status(400).json({
        message: "Invalid booking ID",
      });
    }

    const booking = await prisma.bookings.findFirst({
      where: {
        id: bookingId,
        provider_id: providerId,
      },
    });

    if (!booking) {
      return response.status(404).json({
        message: "Assigned booking not found",
      });
    }

    if (booking.status !== "arrived") {
      return response.status(400).json({
        message: `Booking cannot be started because its status is ${booking.status}. Provider must arrive at the service location first.`,
        code: "BOOKING_NOT_ARRIVED",
      });
    }

    const now = new Date();

    const updatedBooking = await prisma.bookings.update({
      where: {
        id: bookingId,
      },
      data: {
        status: "in_progress",
        started_at: now,
        updated_at: now,
      },
    });

    return response.status(200).json({
      message: "Booking started successfully",
      booking: updatedBooking,
    });
  } catch (error) {
    console.error("Start booking error:", error);

    return response.status(500).json({
      message: "Something went wrong while starting the booking",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Provider: Complete booking
|--------------------------------------------------------------------------
*/

/*
|--------------------------------------------------------------------------
| Provider: Complete booking
|--------------------------------------------------------------------------
|
| Completing the service does NOT mean payment has been received.
|
| CASH:
| completed -> payment pending -> provider confirms Payment Received
|
| ONLINE:
| completed -> payment pending -> gateway success verifies payment
|
|--------------------------------------------------------------------------
*/

export const completeAssignedBooking = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const providerId = request.user?.userId;
    const bookingId = Number(request.params.id);
    const finalPrice = Number(request.body.finalPrice);

    if (!providerId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      return response.status(400).json({
        message: "Invalid booking ID",
      });
    }

    if (!Number.isFinite(finalPrice) || finalPrice < 0) {
      return response.status(400).json({
        message: "Valid final price is required",
      });
    }

    const booking = await prisma.bookings.findFirst({
      where: {
        id: bookingId,
        provider_id: providerId,
      },

      select: {
        id: true,
        customer_id: true,
        provider_id: true,
        status: true,
        payment_method: true,

        promotion_id: true,
        promo_discount_percent_snapshot: true,
        promo_max_discount_snapshot: true,
      },
    });

    if (!booking) {
      return response.status(404).json({
        message: "Assigned booking not found",
      });
    }

    if (booking.status !== "in_progress") {
      return response.status(400).json({
        message: `Booking cannot be completed because its status is ${booking.status}`,
      });
    }

    const now = new Date();

    const roundedFinalPrice = Math.round(finalPrice * 100) / 100;

    /*
    |--------------------------------------------------------------------------
    | Recalculate promotion using booking snapshots
    |--------------------------------------------------------------------------
    */

    let appliedDiscountAmount = 0;

    if (
      booking.promotion_id !== null &&
      booking.promo_discount_percent_snapshot !== null
    ) {
      const promoDiscountPercent = Math.max(
        0,
        Number(booking.promo_discount_percent_snapshot),
      );

      appliedDiscountAmount =
        Math.round(((roundedFinalPrice * promoDiscountPercent) / 100) * 100) /
        100;

      if (booking.promo_max_discount_snapshot !== null) {
        appliedDiscountAmount = Math.min(
          appliedDiscountAmount,
          Number(booking.promo_max_discount_snapshot),
        );
      }

      appliedDiscountAmount = Math.min(
        appliedDiscountAmount,
        roundedFinalPrice,
      );

      appliedDiscountAmount = Math.round(appliedDiscountAmount * 100) / 100;
    }

    const customerPayableAmount =
      Math.round(Math.max(0, roundedFinalPrice - appliedDiscountAmount) * 100) /
      100;

    const isCashBooking = booking.payment_method === PAYMENT_METHODS.CASH;

    /*
    |--------------------------------------------------------------------------
    | Complete service + create PENDING payment
    |--------------------------------------------------------------------------
    |
    | IMPORTANT:
    | - no provider earning here
    | - no wallet credit here
    | - no cash commission deduction here
    | - payment is NOT marked paid here
    |
    |--------------------------------------------------------------------------
    */

    const result = await prisma.$transaction(async (transaction) => {
      const bookingUpdateResult = await transaction.bookings.updateMany({
        where: {
          id: bookingId,
          provider_id: providerId,
          status: "in_progress",
        },

        data: {
          status: "completed",
          final_price: roundedFinalPrice.toFixed(2),
          discount_amount: appliedDiscountAmount.toFixed(2),
          customer_payable_amount: customerPayableAmount.toFixed(2),
          completed_at: now,
          updated_at: now,
        },
      });

      if (bookingUpdateResult.count !== 1) {
        throw new Error("BOOKING_ALREADY_COMPLETED_OR_CHANGED");
      }

      /*
        |--------------------------------------------------------------------------
        | Payment remains pending
        |--------------------------------------------------------------------------
        */

      /*
|--------------------------------------------------------------------------
| Initialize payment after service completion
|--------------------------------------------------------------------------
|
| Completing a service does NOT mean payment has been received.
|
| Cash:
|   Provider must confirm "Payment Received".
|
| Online:
|   eSewa / Khalti / ConnectIPS gateway must verify successful payment.
|
|--------------------------------------------------------------------------
*/

      const payment = await transaction.payments.upsert({
        where: {
          booking_id: bookingId,
        },

        update: {
          amount: customerPayableAmount.toFixed(2),

          payment_method: booking.payment_method,

          payment_status: "pending",

          transaction_reference: null,

          paid_at: null,

          updated_at: now,
        },

        create: {
          booking_id: bookingId,

          amount: customerPayableAmount.toFixed(2),

          payment_method: booking.payment_method,

          payment_status: "pending",

          transaction_reference: null,

          paid_at: null,

          created_at: now,

          updated_at: now,
        },
      });

      /*
        |--------------------------------------------------------------------------
        | Completed-job counter
        |--------------------------------------------------------------------------
        */

      await transaction.provider_profiles.updateMany({
        where: {
          provider_id: providerId,
        },

        data: {
          total_completed_jobs: {
            increment: 1,
          },

          updated_at: now,
        },
      });

      /*
        |--------------------------------------------------------------------------
        | Booking status history
        |--------------------------------------------------------------------------
        */

      await transaction.booking_status_history.create({
        data: {
          booking_id: bookingId,

          old_status: "in_progress",

          new_status: "completed",

          changed_by_user_id: providerId,

          changed_by_role: "provider",

          note: isCashBooking
            ? "Booking completed by provider. Cash payment is awaiting provider confirmation."
            : "Booking completed by provider. Online payment is awaiting successful gateway verification.",

          created_at: now,
        },
      });

      const completedBooking = await transaction.bookings.findUnique({
        where: {
          id: bookingId,
        },
      });

      return {
        completedBooking,
        payment,
      };
    });

    await safelySyncOrderChatWithBookingStatus(bookingId, "completed");

    return response.status(200).json({
      message: isCashBooking
        ? "Service completed. Waiting for cash payment confirmation."
        : "Service completed. Online payment is pending.",

      booking: result.completedBooking,

      payment: {
        id: result.payment.id,
        method: result.payment.payment_method,
        status: result.payment.payment_status,
        amount: result.payment.amount,
        paid_at: result.payment.paid_at,
      },

      payment_action: isCashBooking
        ? "provider_payment_received"
        : "customer_online_payment",

      settlement: "awaiting_payment",
    });
  } catch (error) {
    console.error("Complete booking error:", error);

    if (
      error instanceof Error &&
      error.message === "BOOKING_ALREADY_COMPLETED_OR_CHANGED"
    ) {
      return response.status(409).json({
        message: "Booking has already been completed or changed.",
      });
    }

    return response.status(500).json({
      message: "Something went wrong while completing the booking",
    });
  }
};
