import type { Response } from "express";
import { prisma } from "../config/prisma";
import type { AuthenticatedRequest } from "../middlewares/auth.middleware";
import {
  createNotification,
  recordBookingStatusHistory,
} from "../services/booking-event.service";
import { resolveCustomerBookingAddress } from "../services/customer-address.service";
import { safelySyncOrderChatWithBookingStatus } from "../services/order-chat-lifecycle.service";
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
      notes,
      paymentMethod,
      promoCode,
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

    const grossAmount = Number(service.base_price);

    let selectedPromotion: {
      id: number;
      code: string;
      discountPercent: number;
      discountAmount: number;
      payableAmount: number;
    } | null = null;

    const normalizedPromoCode =
      typeof promoCode === "string" && promoCode.trim().length > 0
        ? promoCode.trim().toUpperCase()
        : null;

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
          notes:
            typeof notes === "string" && notes.trim().length > 0
              ? notes.trim()
              : null,
          status: "pending",
          payment_method: normalizedPaymentMethod,

          estimated_price: service.base_price,
          final_price: null,

          promotion_id: selectedPromotion?.id ?? null,
          promo_code_snapshot: selectedPromotion?.code ?? null,
          discount_amount: selectedPromotion?.discountAmount ?? 0,
          customer_payable_amount:
            selectedPromotion?.payableAmount ?? service.base_price,

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
            gross_amount: service.base_price,
            discount_amount: selectedPromotion.discountAmount,
            payable_amount: selectedPromotion.payableAmount,
          },
        });
      }

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

      await transaction.notifications.create({
        data: {
          user_id: customerId,
          booking_id: createdBooking.id,
          notification_type: "booking_created",
          title: "Service Request Submitted",
          message: selectedPromotion
            ? `Your request for ${service.name} has been submitted. Promo ${selectedPromotion.code} saved you Rs. ${selectedPromotion.discountAmount}.`
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

    const cancelledBooking = await prisma.bookings.update({
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
    await recordBookingStatusHistory({
      bookingId: cancelledBooking.id,
      oldStatus: booking.status as
        | "pending"
        | "accepted"
        | "assigned"
        | "in_progress"
        | "completed"
        | "cancelled",
      newStatus: "cancelled",
      changedByUserId: customerId,
      changedByRole: "customer",
      note:
        typeof cancellationReason === "string" &&
        cancellationReason.trim().length > 0
          ? cancellationReason.trim()
          : "Booking cancelled by customer.",
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

    return response.status(200).json({
      message: "Assigned bookings fetched successfully",
      bookings,
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

    if (booking.status !== "assigned" && booking.status !== "accepted") {
      return response.status(400).json({
        message: `Booking cannot be started because its status is ${booking.status}`,
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
        provider_id: true,
        status: true,
        payment_method: true,
        discount_amount: true,
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

    const result = await prisma.$transaction(async (transaction) => {
      /*
      |--------------------------------------------------------------------------
      | Read admin-configured provider commission
      |--------------------------------------------------------------------------
      */

      const commissionSetting = await transaction.system_settings.findUnique({
        where: {
          setting_key: "provider_commission_percent",
        },
        select: {
          setting_value: true,
        },
      });

      const commissionPercentage = Number(
        commissionSetting?.setting_value ?? "5",
      );

      if (
        !Number.isFinite(commissionPercentage) ||
        commissionPercentage < 0 ||
        commissionPercentage > 100
      ) {
        throw new Error(
          "Invalid provider commission percentage in system settings",
        );
      }

      /*
      |--------------------------------------------------------------------------
      | Calculate provider earning
      |--------------------------------------------------------------------------
      */

      const roundedFinalPrice = Math.round(finalPrice * 100) / 100;
      const existingDiscountAmount = Math.max(
        0,
        Math.round(Number(booking.discount_amount ?? 0) * 100) / 100,
      );

      const appliedDiscountAmount = Math.min(
        existingDiscountAmount,
        roundedFinalPrice,
      );

      const customerPayableAmount =
        Math.round(
          Math.max(0, roundedFinalPrice - appliedDiscountAmount) * 100,
        ) / 100;

      const commissionAmount =
        Math.round(roundedFinalPrice * (commissionPercentage / 100) * 100) /
        100;

      const providerNetAmount =
        Math.round((roundedFinalPrice - commissionAmount) * 100) / 100;

      const isCashBooking = booking.payment_method === PAYMENT_METHODS.CASH;

      /*
      |--------------------------------------------------------------------------
      | Atomically complete booking
      |--------------------------------------------------------------------------
      |
      | updateMany prevents duplicate completion and duplicate wallet credits.
      |--------------------------------------------------------------------------
      */

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
      | Create provider wallet when it does not exist
      |--------------------------------------------------------------------------
      */

      const wallet = await transaction.wallets.upsert({
        where: {
          user_id: providerId,
        },
        update: {},
        create: {
          user_id: providerId,
          balance: "0.00",
          currency: "NPR",
          is_active: true,
          created_at: now,
          updated_at: now,
        },
        select: {
          id: true,
          balance: true,
          currency: true,
          is_active: true,
        },
      });

      if (!wallet.is_active) {
        throw new Error("PROVIDER_WALLET_INACTIVE");
      }

      const balanceBefore = Math.round(Number(wallet.balance) * 100) / 100;

      /*
      |--------------------------------------------------------------------------
      | Cash bookings: the customer already paid the provider directly, so
      | only the platform's commission is pulled from the wallet. If the
      | wallet doesn't have enough available balance to cover it, the
      | balance simply goes negative — that is the amount the provider owes
      | the platform, and it is automatically repaid out of the next
      | online-payment earnings that get credited to the same wallet.
      |
      | Online bookings (eSewa/Khalti/Connect IPS): the platform collected
      | the money, so the provider's net share (after commission) is
      | credited to the wallet as before.
      |--------------------------------------------------------------------------
      */

      const walletDelta = isCashBooking
        ? Math.round((providerNetAmount - customerPayableAmount) * 100) / 100
        : providerNetAmount;

      const balanceAfter =
        Math.round((balanceBefore + walletDelta) * 100) / 100;

      /*
      |--------------------------------------------------------------------------
      | Create earning record
      |--------------------------------------------------------------------------
      */

      const earning = await transaction.provider_earnings.create({
        data: {
          booking_id: bookingId,
          provider_id: providerId,
          gross_amount: roundedFinalPrice.toFixed(2),
          commission_percentage: commissionPercentage.toFixed(2),
          commission_amount: commissionAmount.toFixed(2),
          net_amount: providerNetAmount.toFixed(2),
          status: isCashBooking ? "cash_collected_by_provider" : "available",
          credited_at: now,
          created_at: now,
          updated_at: now,
        },
      });

      /*
      |--------------------------------------------------------------------------
      | Update provider wallet
      |--------------------------------------------------------------------------
      */

      const updatedWallet = await transaction.wallets.update({
        where: {
          id: wallet.id,
        },
        data: {
          balance: balanceAfter.toFixed(2),
          updated_at: now,
        },
      });

      /*
      |--------------------------------------------------------------------------
      | Create wallet transaction history
      |--------------------------------------------------------------------------
      */

      const walletTransactionType = walletDelta < 0 ? "debit" : "credit";

      const walletTransactionAmount =
        Math.round(Math.abs(walletDelta) * 100) / 100;

      const walletSourceType = isCashBooking
        ? walletDelta < 0
          ? "cash_commission_due"
          : "cash_booking_adjustment"
        : "booking_earning";

      const walletDescription = isCashBooking
        ? walletDelta < 0
          ? `Settlement due to platform for cash booking #${bookingId}`
          : walletDelta > 0
            ? `Platform-funded promotion adjustment credited for cash booking #${bookingId}`
            : `Cash booking #${bookingId} settled with no wallet adjustment`
        : `Earning credited for completed booking #${bookingId}`;

      const walletTransaction = await transaction.wallet_transactions.create({
        data: {
          wallet_id: wallet.id,
          booking_id: bookingId,

          transaction_type: walletTransactionType,

          source_type: walletSourceType,

          amount: walletTransactionAmount.toFixed(2),

          balance_before: balanceBefore.toFixed(2),

          balance_after: balanceAfter.toFixed(2),

          description: walletDescription,

          created_at: now,
        },
      });

      /*
      |--------------------------------------------------------------------------
      | Record the payment collected for this booking
      |--------------------------------------------------------------------------
      */

      const payment = await transaction.payments.upsert({
        where: {
          booking_id: bookingId,
        },
        update: {
          amount: customerPayableAmount.toFixed(2),
          payment_method: booking.payment_method,
          payment_status: "paid",
          paid_at: now,
          updated_at: now,
        },
        create: {
          booking_id: bookingId,
          amount: customerPayableAmount.toFixed(2),
          payment_method: booking.payment_method,
          payment_status: "paid",
          paid_at: now,
          created_at: now,
          updated_at: now,
        },
      });

      /*
      |--------------------------------------------------------------------------
      | Update completed-job counter
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
      | Add booking status history
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
            ? "Booking completed by provider. Customer paid in cash."
            : "Booking completed by provider.",
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
        earning,
        wallet: updatedWallet,
        walletTransaction,
        payment,
        commissionPercentage,
        commissionAmount,
        providerNetAmount,
        isCashBooking,
      };
    });

    await safelySyncOrderChatWithBookingStatus(bookingId, "completed");

    return response.status(200).json({
      message: "Booking completed successfully",
      booking: result.completedBooking,
      earning: {
        gross_amount: finalPrice,
        commission_percentage: result.commissionPercentage,
        commission_amount: result.commissionAmount,
        net_amount: result.providerNetAmount,
        settlement: result.isCashBooking
          ? "cash_collected_by_provider"
          : "credited_to_wallet",
      },
      payment: {
        method: result.payment.payment_method,
        status: result.payment.payment_status,
      },
      wallet: {
        balance: result.wallet.balance,
        currency: result.wallet.currency,
        is_negative: Number(result.wallet.balance) < 0,
        amount_owed_to_platform:
          Number(result.wallet.balance) < 0
            ? Math.abs(Number(result.wallet.balance)).toFixed(2)
            : "0.00",
      },
    });
  } catch (error) {
    console.error("Complete booking error:", error);

    if (
      error instanceof Error &&
      error.message === "BOOKING_ALREADY_COMPLETED_OR_CHANGED"
    ) {
      return response.status(409).json({
        message: "Booking has already been completed or its status has changed",
      });
    }

    if (
      error instanceof Error &&
      error.message === "PROVIDER_WALLET_INACTIVE"
    ) {
      return response.status(403).json({
        message: "Your provider wallet is inactive. Please contact support.",
      });
    }

    if (
      error instanceof Error &&
      error.message.includes("provider commission percentage")
    ) {
      return response.status(500).json({
        message:
          "Provider commission setting is invalid. Please contact the administrator.",
      });
    }

    return response.status(500).json({
      message: "Something went wrong while completing the booking",
    });
  }
};
