import type { Response } from "express";

import { prisma } from "../config/prisma";
import type { AuthenticatedRequest } from "../middlewares/auth.middleware";

import {
  createNotification,
  recordBookingStatusHistory,
} from "../services/booking-event.service";

import { createOrderChatAfterProviderAcceptance } from "../services/order-chat.service";

function parseBookingId(value: unknown): number | null {
  const bookingId = Number(value);

  if (!Number.isInteger(bookingId) || bookingId <= 0) {
    return null;
  }

  return bookingId;
}

async function getProviderCategoryIds(providerId: number): Promise<number[]> {
  const categories = await prisma.provider_categories.findMany({
    where: {
      provider_id: providerId,
    },
    select: {
      category_id: true,
    },
  });

  return categories.map((item) => item.category_id);
}

/*
|--------------------------------------------------------------------------
| Provider: Get available bookings
|--------------------------------------------------------------------------
*/

export const getAvailableBookingsForProvider = async (
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

    const providerCategoryIds = await getProviderCategoryIds(providerId);

    if (providerCategoryIds.length === 0) {
      return response.status(200).json({
        message: "Available bookings fetched successfully",
        bookings: [],
      });
    }

    const bookings = await prisma.bookings.findMany({
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

      select: {
        id: true,
        customer_id: true,
        service_id: true,
        provider_id: true,
        service_address: true,
        service_area: true,
        preferred_date: true,
        preferred_time: true,
        notes: true,
        status: true,
        payment_method: true,
        estimated_price: true,
        created_at: true,
        updated_at: true,

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
              },
            },
          },
        },

        users_bookings_customer_idTousers: {
          select: {
            id: true,
            full_name: true,
          },
        },
      },

      orderBy: [
        {
          preferred_date: "asc",
        },
        {
          created_at: "asc",
        },
      ],
    });

    return response.status(200).json({
      message: "Available bookings fetched successfully",
      bookings,
    });
  } catch (error) {
    console.error("Get available provider bookings error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching available bookings",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Provider: Get own booking details
|--------------------------------------------------------------------------
*/

export const getProviderBookingById = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const providerId = request.user?.userId;
    const bookingId = parseBookingId(request.params.id);

    if (!providerId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    if (!bookingId) {
      return response.status(400).json({
        message: "Invalid booking ID",
      });
    }

    const providerCategoryIds = await getProviderCategoryIds(providerId);

    const booking = await prisma.bookings.findFirst({
      where: {
        id: bookingId,

        OR: [
          {
            provider_id: providerId,
          },
          {
            provider_id: null,
            status: "pending",

            services: {
              category_id: {
                in: providerCategoryIds,
              },
              is_active: true,
            },
          },
        ],
      },

      select: {
        id: true,
        customer_id: true,
        service_id: true,
        provider_id: true,
        customer_address_id: true,
        service_address: true,
        service_area: true,
        preferred_date: true,
        preferred_time: true,
        notes: true,
        status: true,
        payment_method: true,
        estimated_price: true,
        final_price: true,
        accepted_at: true,
        assigned_at: true,
        started_at: true,
        completed_at: true,
        cancelled_at: true,
        cancelled_by: true,
        cancellation_reason: true,
        created_at: true,
        updated_at: true,

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

        customer_addresses: {
          select: {
            id: true,
            label: true,
            full_address: true,
            service_area: true,
            landmark: true,
            latitude: true,
            longitude: true,
          },
        },

        payments: {
          select: {
            id: true,
            amount: true,
            payment_method: true,
            payment_status: true,
            transaction_reference: true,
            paid_at: true,
            created_at: true,
          },
        },

        reviews: {
          where: {
            is_visible: true,
          },
          select: {
            id: true,
            rating: true,
            comment: true,
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

        chat_rooms: {
          select: {
            id: true,
            activated_at: true,
            archived_at: true,
          },
        },
      },
    });

    if (!booking) {
      return response.status(404).json({
        message: "Booking not found or is not available to this provider",
      });
    }

    return response.status(200).json({
      message: "Provider booking fetched successfully",
      booking,
    });
  } catch (error) {
    console.error("Get provider booking details error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching the booking",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Provider: Accept booking
|--------------------------------------------------------------------------
|
| A provider can accept in either of these cases:
|
| 1. Open request:
|    pending + provider_id null
|    -> provider claims it immediately
|
| 2. Admin assignment:
|    assigned + provider_id equals current provider
|    -> assigned provider accepts it
|
| In both cases the final state is accepted and chat is created.
|--------------------------------------------------------------------------
*/

export const acceptBookingForProvider = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const providerId = request.user?.userId;
    const bookingId = parseBookingId(request.params.id);

    if (!providerId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    if (!bookingId) {
      return response.status(400).json({
        message: "Invalid booking ID",
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

        provider_profiles_provider_profiles_provider_idTousers: {
          select: {
            verification_status: true,
            is_available: true,
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

    if (!profile || profile.verification_status !== "approved") {
      return response.status(403).json({
        message: "Only approved providers can accept bookings",
        code: "PROVIDER_NOT_APPROVED",
      });
    }

    if (!profile.is_available) {
      return response.status(403).json({
        message: "You must be online before accepting a booking",
        code: "PROVIDER_OFFLINE",
      });
    }

    const providerCategoryIds = provider.providerCategories.map(
      (item) => item.category_id,
    );

    const booking = await prisma.bookings.findFirst({
      where: {
        id: bookingId,

        OR: [
          {
            provider_id: null,
            status: "pending",
          },
          {
            provider_id: providerId,
            status: "assigned",
          },
        ],

        services: {
          category_id: {
            in: providerCategoryIds,
          },
          is_active: true,
        },
      },

      select: {
        id: true,
        customer_id: true,
        provider_id: true,
        status: true,
        assigned_at: true,

        services: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!booking) {
      const existingBooking = await prisma.bookings.findUnique({
        where: {
          id: bookingId,
        },
        select: {
          id: true,
          provider_id: true,
          status: true,
        },
      });

      if (!existingBooking) {
        return response.status(404).json({
          message: "Booking not found",
          code: "BOOKING_NOT_FOUND",
        });
      }

      if (
        existingBooking.provider_id !== null &&
        existingBooking.provider_id !== providerId
      ) {
        return response.status(409).json({
          message: "This booking has already been assigned to another provider",
          code: "BOOKING_ASSIGNED_TO_OTHER_PROVIDER",
        });
      }

      return response.status(409).json({
        message: "This booking is no longer available for acceptance",
        code: "BOOKING_NOT_AVAILABLE",
      });
    }

    const oldStatus = booking.status;
    const now = new Date();

    const acceptanceWhere =
      oldStatus === "assigned"
        ? {
            id: bookingId,
            provider_id: providerId,
            status: "assigned",
          }
        : {
            id: bookingId,
            provider_id: null,
            status: "pending",
          };

    const updateResult = await prisma.bookings.updateMany({
      where: acceptanceWhere,

      data: {
        provider_id: providerId,
        status: "accepted",
        accepted_at: now,
        assigned_at: booking.assigned_at ?? now,
        updated_at: now,
      },
    });

    if (updateResult.count !== 1) {
      return response.status(409).json({
        message: "Another provider or administrator changed this booking first",
        code: "BOOKING_ALREADY_CHANGED",
      });
    }

    await Promise.all([
      recordBookingStatusHistory({
        bookingId,
        oldStatus,
        newStatus: "accepted",
        changedByUserId: providerId,
        changedByRole: "provider",
        note:
          oldStatus === "assigned"
            ? `Assigned booking accepted by provider ${provider.full_name}.`
            : `Open booking claimed and accepted by provider ${provider.full_name}.`,
      }),

      createNotification({
        userId: booking.customer_id,
        bookingId,
        notificationType: "job_accepted",
        title: "Provider Accepted Your Booking",
        message: `${provider.full_name} accepted your ${booking.services.name} request.`,
      }),
    ]);

    /*
    |--------------------------------------------------------------------------
    | Create chat only after successful provider acceptance
    |--------------------------------------------------------------------------
    */

    try {
      await createOrderChatAfterProviderAcceptance(bookingId);
    } catch (chatError) {
      console.error(
        `Order chat creation failed for booking ${bookingId}:`,
        chatError,
      );
    }

    const acceptedBooking = await prisma.bookings.findUnique({
      where: {
        id: bookingId,
      },

      select: {
        id: true,
        customer_id: true,
        service_id: true,
        provider_id: true,
        service_address: true,
        service_area: true,
        preferred_date: true,
        preferred_time: true,
        notes: true,
        status: true,
        payment_method: true,
        estimated_price: true,
        accepted_at: true,
        assigned_at: true,
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

        chat_rooms: {
          select: {
            id: true,
            activated_at: true,
            archived_at: true,
          },
        },
      },
    });

    return response.status(200).json({
      message:
        oldStatus === "assigned"
          ? "Assigned booking accepted successfully"
          : "Booking claimed and accepted successfully",
      booking: acceptedBooking,
    });
  } catch (error) {
    console.error("Provider accept booking error:", error);

    return response.status(500).json({
      message: "Something went wrong while accepting the booking",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Provider: Mark booking as travelling
|--------------------------------------------------------------------------
*/

export const markAssignedBookingTravelling = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const providerId = request.user?.userId;
    const bookingId = parseBookingId(request.params.id);

    if (!providerId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    if (!bookingId) {
      return response.status(400).json({
        message: "Invalid booking ID",
      });
    }

    const booking = await prisma.bookings.findFirst({
      where: {
        id: bookingId,
        provider_id: providerId,
        status: "accepted",
      },
      select: {
        id: true,
        customer_id: true,
        status: true,
      },
    });

    if (!booking) {
      return response.status(409).json({
        message: "Only your accepted booking can be marked as travelling",
        code: "BOOKING_NOT_ACCEPTED",
      });
    }

    const now = new Date();

    const updateResult = await prisma.bookings.updateMany({
      where: {
        id: bookingId,
        provider_id: providerId,
        status: "accepted",
      },
      data: {
        status: "travelling",
        updated_at: now,
      },
    });

    if (updateResult.count !== 1) {
      return response.status(409).json({
        message: "This booking can no longer be marked as travelling",
        code: "BOOKING_ALREADY_CHANGED",
      });
    }

    await Promise.all([
      recordBookingStatusHistory({
        bookingId,
        oldStatus: "accepted",
        newStatus: "travelling",
        changedByUserId: providerId,
        changedByRole: "provider",
        note: "Provider started travelling to the service location.",
      }),
      createNotification({
        userId: booking.customer_id,
        bookingId,
        notificationType: "provider_travelling",
        title: "Provider Is On The Way",
        message: "Your service provider is travelling to your location.",
      }),
    ]);

    const updatedBooking = await prisma.bookings.findUnique({
      where: {
        id: bookingId,
      },
      select: {
        id: true,
        customer_id: true,
        service_id: true,
        provider_id: true,
        status: true,
        preferred_date: true,
        preferred_time: true,
        accepted_at: true,
        assigned_at: true,
        updated_at: true,
        chat_rooms: {
          select: {
            id: true,
            activated_at: true,
            archived_at: true,
          },
        },
      },
    });

    return response.status(200).json({
      message: "Booking marked as travelling",
      booking: updatedBooking,
    });
  } catch (error) {
    console.error("Provider travelling booking error:", error);

    return response.status(500).json({
      message: "Something went wrong while updating the booking",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Provider: Mark booking as arrived
|--------------------------------------------------------------------------
*/

export const markAssignedBookingArrived = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const providerId = request.user?.userId;
    const bookingId = parseBookingId(request.params.id);

    if (!providerId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    if (!bookingId) {
      return response.status(400).json({
        message: "Invalid booking ID",
      });
    }

    const booking = await prisma.bookings.findFirst({
      where: {
        id: bookingId,
        provider_id: providerId,
        status: "travelling",
      },
      select: {
        id: true,
        customer_id: true,
        status: true,
      },
    });

    if (!booking) {
      return response.status(409).json({
        message: "Only your travelling booking can be marked as arrived",
        code: "BOOKING_NOT_TRAVELLING",
      });
    }

    const now = new Date();

    const updateResult = await prisma.bookings.updateMany({
      where: {
        id: bookingId,
        provider_id: providerId,
        status: "travelling",
      },
      data: {
        status: "arrived",
        updated_at: now,
      },
    });

    if (updateResult.count !== 1) {
      return response.status(409).json({
        message: "This booking can no longer be marked as arrived",
        code: "BOOKING_ALREADY_CHANGED",
      });
    }

    await Promise.all([
      recordBookingStatusHistory({
        bookingId,
        oldStatus: "travelling",
        newStatus: "arrived",
        changedByUserId: providerId,
        changedByRole: "provider",
        note: "Provider arrived at the service location.",
      }),
      createNotification({
        userId: booking.customer_id,
        bookingId,
        notificationType: "provider_arrived",
        title: "Provider Has Arrived",
        message: "Your service provider has arrived at your location.",
      }),
    ]);

    const updatedBooking = await prisma.bookings.findUnique({
      where: {
        id: bookingId,
      },
      select: {
        id: true,
        customer_id: true,
        service_id: true,
        provider_id: true,
        status: true,
        preferred_date: true,
        preferred_time: true,
        accepted_at: true,
        assigned_at: true,
        updated_at: true,
        chat_rooms: {
          select: {
            id: true,
            activated_at: true,
            archived_at: true,
          },
        },
      },
    });

    return response.status(200).json({
      message: "Booking marked as arrived",
      booking: updatedBooking,
    });
  } catch (error) {
    console.error("Provider arrived booking error:", error);

    return response.status(500).json({
      message: "Something went wrong while updating the booking",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Provider: Reject / dismiss booking
|--------------------------------------------------------------------------
|
| Open pending request:
| - provider can dismiss it locally
| - booking remains pending and available to other providers
|
| Admin-assigned request:
| - assigned provider can reject it
| - provider assignment is removed
| - booking returns to pending and becomes open again
|--------------------------------------------------------------------------
*/

export const rejectBookingForProvider = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const providerId = request.user?.userId;
    const bookingId = parseBookingId(request.params.id);

    if (!providerId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    if (!bookingId) {
      return response.status(400).json({
        message: "Invalid booking ID",
      });
    }

    const reason =
      typeof request.body?.reason === "string"
        ? request.body.reason.trim()
        : "";

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

    const providerCategoryIds = provider.providerCategories.map(
      (item) => item.category_id,
    );

    const booking = await prisma.bookings.findFirst({
      where: {
        id: bookingId,

        OR: [
          {
            provider_id: null,
            status: "pending",
          },
          {
            provider_id: providerId,
            status: "assigned",
          },
        ],

        services: {
          category_id: {
            in: providerCategoryIds,
          },
          is_active: true,
        },
      },

      select: {
        id: true,
        provider_id: true,
        status: true,
      },
    });

    if (!booking) {
      return response.status(409).json({
        message: "This booking is no longer available to reject or dismiss",
        code: "BOOKING_NOT_AVAILABLE",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Open request: dismiss only
    |--------------------------------------------------------------------------
    */

    if (booking.status === "pending" && booking.provider_id === null) {
      return response.status(200).json({
        message: "Booking dismissed successfully",
        booking_id: booking.id,
        status: "pending",
        provider_id: null,
        rejected: true,
        dismissed_only: true,
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Admin-assigned request: release back to open pending pool
    |--------------------------------------------------------------------------
    */

    const now = new Date();

    const updateResult = await prisma.bookings.updateMany({
      where: {
        id: bookingId,
        provider_id: providerId,
        status: "assigned",
      },

      data: {
        provider_id: null,
        status: "pending",
        assigned_at: null,
        accepted_at: null,
        updated_at: now,
      },
    });

    if (updateResult.count !== 1) {
      return response.status(409).json({
        message: "This booking can no longer be rejected",
        code: "BOOKING_ALREADY_CHANGED",
      });
    }

    await recordBookingStatusHistory({
      bookingId,
      oldStatus: "assigned",
      newStatus: "pending",
      changedByUserId: providerId,
      changedByRole: "provider",
      note: reason
        ? `Provider ${provider.full_name} rejected the assigned booking: ${reason}`
        : `Provider ${provider.full_name} rejected the assigned booking.`,
    });

    return response.status(200).json({
      message: "Assigned booking rejected and returned to available jobs",
      booking_id: bookingId,
      status: "pending",
      provider_id: null,
      rejected: true,
      dismissed_only: false,
    });
  } catch (error) {
    console.error("Provider reject booking error:", error);

    return response.status(500).json({
      message: "Something went wrong while rejecting the booking",
    });
  }
};
