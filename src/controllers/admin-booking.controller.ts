import type { Response } from "express";
import { prisma } from "../config/prisma";
import type { AuthenticatedRequest } from "../middlewares/auth.middleware";
import {
  createNotification,
  recordBookingStatusHistory,
} from "../services/booking-event.service";
import { safelySyncOrderChatWithBookingStatus } from "../services/order-chat-lifecycle.service";

const allowedBookingStatuses = [
  "pending",
  "accepted",
  "assigned",
  "in_progress",
  "completed",
  "cancelled",
] as const;

type BookingStatus = (typeof allowedBookingStatuses)[number];

/*
|--------------------------------------------------------------------------
| Admin: Get all bookings with filters
|--------------------------------------------------------------------------
|
| GET /api/bookings/admin/all
|
| Optional query parameters:
| ?search=Ram
| ?status=pending
| ?serviceId=1
| ?providerId=3
| ?dateFrom=2026-07-01
| ?dateTo=2026-07-31
| ?page=1
| ?limit=20
|
|--------------------------------------------------------------------------
*/

export const getAllBookingsForAdmin = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const search =
      typeof request.query.search === "string"
        ? request.query.search.trim()
        : "";

    const statusValue =
      typeof request.query.status === "string"
        ? request.query.status.trim().toLowerCase()
        : "";

    const serviceIdValue = request.query.serviceId;
    const providerIdValue = request.query.providerId;
    const dateFromValue = request.query.dateFrom;
    const dateToValue = request.query.dateTo;

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

    let status: BookingStatus | undefined;

    if (statusValue && statusValue !== "all") {
      if (!allowedBookingStatuses.includes(statusValue as BookingStatus)) {
        return response.status(400).json({
          message: "Invalid booking status filter",
        });
      }

      status = statusValue as BookingStatus;
    }

    let serviceId: number | undefined;

    if (
      serviceIdValue !== undefined &&
      serviceIdValue !== "" &&
      serviceIdValue !== "all"
    ) {
      serviceId = Number(serviceIdValue);

      if (!Number.isInteger(serviceId) || serviceId <= 0) {
        return response.status(400).json({
          message: "Invalid service ID filter",
        });
      }
    }

    let providerId: number | undefined;

    if (
      providerIdValue !== undefined &&
      providerIdValue !== "" &&
      providerIdValue !== "all"
    ) {
      providerId = Number(providerIdValue);

      if (!Number.isInteger(providerId) || providerId <= 0) {
        return response.status(400).json({
          message: "Invalid provider ID filter",
        });
      }
    }

    let dateFrom: Date | undefined;
    let dateTo: Date | undefined;

    if (typeof dateFromValue === "string" && dateFromValue.trim()) {
      dateFrom = new Date(dateFromValue);

      if (Number.isNaN(dateFrom.getTime())) {
        return response.status(400).json({
          message: "Invalid start date",
        });
      }

      dateFrom.setHours(0, 0, 0, 0);
    }

    if (typeof dateToValue === "string" && dateToValue.trim()) {
      dateTo = new Date(dateToValue);

      if (Number.isNaN(dateTo.getTime())) {
        return response.status(400).json({
          message: "Invalid end date",
        });
      }

      dateTo.setHours(23, 59, 59, 999);
    }

    if (dateFrom && dateTo && dateFrom.getTime() > dateTo.getTime()) {
      return response.status(400).json({
        message: "Start date cannot be after the end date",
      });
    }

    const whereCondition = {
      ...(status
        ? {
            status,
          }
        : {}),

      ...(serviceId
        ? {
            service_id: serviceId,
          }
        : {}),

      ...(providerId
        ? {
            provider_id: providerId,
          }
        : {}),

      ...(dateFrom || dateTo
        ? {
            created_at: {
              ...(dateFrom
                ? {
                    gte: dateFrom,
                  }
                : {}),
              ...(dateTo
                ? {
                    lte: dateTo,
                  }
                : {}),
            },
          }
        : {}),

      ...(search
        ? {
            OR: [
              {
                service_address: {
                  contains: search,
                  mode: "insensitive" as const,
                },
              },
              {
                service_area: {
                  contains: search,
                  mode: "insensitive" as const,
                },
              },
              {
                notes: {
                  contains: search,
                  mode: "insensitive" as const,
                },
              },
              {
                users_bookings_customer_idTousers: {
                  is: {
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
                    ],
                  },
                },
              },
              {
                users_bookings_provider_idTousers: {
                  is: {
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
                    ],
                  },
                },
              },
              {
                services: {
                  is: {
                    name: {
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

    const [
      bookings,
      totalRecords,
      pendingCount,
      acceptedCount,
      assignedCount,
      inProgressCount,
      completedCount,
      cancelledCount,
    ] = await prisma.$transaction([
      prisma.bookings.findMany({
        where: whereCondition,
        skip,
        take: limit,
        orderBy: {
          created_at: "desc",
        },
        include: {
          users_bookings_customer_idTousers: {
            select: {
              id: true,
              full_name: true,
              phone: true,
              email: true,
              is_active: true,
            },
          },
          users_bookings_provider_idTousers: {
            select: {
              id: true,
              full_name: true,
              phone: true,
              email: true,
              is_active: true,
            },
          },
          services: {
            select: {
              id: true,
              name: true,
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
        },
      }),

      prisma.bookings.count({
        where: whereCondition,
      }),

      prisma.bookings.count({
        where: {
          status: "pending",
        },
      }),

      prisma.bookings.count({
        where: {
          status: "accepted",
        },
      }),

      prisma.bookings.count({
        where: {
          status: "assigned",
        },
      }),

      prisma.bookings.count({
        where: {
          status: "in_progress",
        },
      }),

      prisma.bookings.count({
        where: {
          status: "completed",
        },
      }),

      prisma.bookings.count({
        where: {
          status: "cancelled",
        },
      }),
    ]);

    const totalPages = Math.ceil(totalRecords / limit);

    return response.status(200).json({
      message: "All bookings fetched successfully",
      bookings,
      summary: {
        pending: pendingCount,
        accepted: acceptedCount,
        assigned: assignedCount,
        in_progress: inProgressCount,
        completed: completedCount,
        cancelled: cancelledCount,
      },
      filters: {
        search: search || null,
        status: status ?? "all",
        service_id: serviceId ?? null,
        provider_id: providerId ?? null,
        date_from: dateFromValue ?? null,
        date_to: dateToValue ?? null,
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
    console.error("Admin get bookings error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching bookings",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin: Get one booking with complete details
|--------------------------------------------------------------------------
|
| GET /api/bookings/admin/:id
|
|--------------------------------------------------------------------------
*/

export const getBookingByIdForAdmin = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const bookingId = Number(request.params.id);

    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      return response.status(400).json({
        message: "Invalid booking ID",
      });
    }

    const booking = await prisma.bookings.findUnique({
      where: {
        id: bookingId,
      },
      include: {
        users_bookings_customer_idTousers: {
          select: {
            id: true,
            full_name: true,
            phone: true,
            email: true,
            is_active: true,
            created_at: true,
          },
        },

        users_bookings_provider_idTousers: {
          select: {
            id: true,
            full_name: true,
            phone: true,
            email: true,
            is_active: true,
            created_at: true,
          },
        },

        services: {
          select: {
            id: true,
            name: true,
            description: true,
            base_price: true,
            duration_minutes: true,
            is_active: true,
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
            is_default: true,
            is_active: true,
          },
        },

        payments: true,

        reviews: true,

        booking_status_history: {
          orderBy: {
            created_at: "asc",
          },
          include: {
            users: {
              select: {
                id: true,
                full_name: true,
                phone: true,
              },
            },
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
    console.error("Admin get booking detail error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching the booking",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin: Cancel booking
|--------------------------------------------------------------------------
|
| PATCH /api/bookings/admin/:id/cancel
|
|--------------------------------------------------------------------------
*/

export const cancelBookingForAdmin = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const adminId = request.user?.userId;
    const bookingId = Number(request.params.id);
    const cancellationReason = request.body.cancellationReason;

    if (!adminId) {
      return response.status(401).json({
        message: "Admin is not authenticated",
      });
    }

    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      return response.status(400).json({
        message: "Invalid booking ID",
      });
    }

    if (
      cancellationReason !== undefined &&
      cancellationReason !== null &&
      typeof cancellationReason !== "string"
    ) {
      return response.status(400).json({
        message: "Cancellation reason must be text",
      });
    }

    if (
      typeof cancellationReason === "string" &&
      cancellationReason.trim().length > 500
    ) {
      return response.status(400).json({
        message: "Cancellation reason must not exceed 500 characters",
      });
    }

    const booking = await prisma.bookings.findUnique({
      where: {
        id: bookingId,
      },
      select: {
        id: true,
        customer_id: true,
        provider_id: true,
        status: true,
        services: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!booking) {
      return response.status(404).json({
        message: "Booking not found",
      });
    }

    if (booking.status === "cancelled") {
      return response.status(400).json({
        message: "Booking is already cancelled",
      });
    }

    if (booking.status === "completed") {
      return response.status(400).json({
        message: "Completed bookings cannot be cancelled",
      });
    }

    const reason =
      typeof cancellationReason === "string" && cancellationReason.trim()
        ? cancellationReason.trim()
        : "Booking cancelled by administrator.";

    const now = new Date();

    const cancelledBooking = await prisma.bookings.update({
      where: {
        id: bookingId,
      },
      data: {
        status: "cancelled",
        cancelled_at: now,
        cancelled_by: "admin",
        cancellation_reason: reason,
        updated_at: now,
      },
    });

    await recordBookingStatusHistory({
      bookingId,
      oldStatus: booking.status as BookingStatus,
      newStatus: "cancelled",
      changedByUserId: adminId,
      changedByRole: "admin",
      note: reason,
    });

    await createNotification({
      userId: booking.customer_id,
      bookingId,
      notificationType: "booking_cancelled",
      title: "Booking Cancelled",
      message: `Your booking #${bookingId} for ${booking.services.name} was cancelled. ${reason}`,
    });

    if (booking.provider_id) {
      await createNotification({
        userId: booking.provider_id,
        bookingId,
        notificationType: "booking_cancelled",
        title: "Assigned Booking Cancelled",
        message: `Booking #${bookingId} has been cancelled by the administrator.`,
      });
    }
    await safelySyncOrderChatWithBookingStatus(bookingId, "cancelled");

    return response.status(200).json({
      message: "Booking cancelled successfully",
      booking: cancelledBooking,
    });
  } catch (error) {
    console.error("Admin cancel booking error:", error);

    return response.status(500).json({
      message: "Something went wrong while cancelling the booking",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin: Assign or reassign provider
|--------------------------------------------------------------------------
|
| PATCH /api/bookings/admin/:id/assign-provider
|
| Body:
| {
|   "providerId": 3
| }
|
|--------------------------------------------------------------------------
*/

export const assignProviderToBooking = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const adminId = request.user?.userId;
    const bookingId = Number(request.params.id);
    const providerId = Number(request.body.providerId);

    if (!adminId) {
      return response.status(401).json({
        message: "Admin is not authenticated",
      });
    }

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
      select: {
        id: true,
        customer_id: true,
        provider_id: true,
        status: true,
        services: {
          select: {
            name: true,
          },
        },
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
        message: `Provider cannot be assigned while booking status is ${booking.status}`,
      });
    }

    const providerRole = await prisma.roles.findUnique({
      where: {
        name: "provider",
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
        id: providerId,
        role_id: providerRole.id,
        is_active: true,
      },
      select: {
        id: true,
        full_name: true,
        phone: true,
      },
    });

    if (!provider) {
      return response.status(404).json({
        message: "Active provider not found",
      });
    }

    const previousProviderId = booking.provider_id;
    const now = new Date();

    const updatedBooking = await prisma.bookings.update({
      where: {
        id: bookingId,
      },
      data: {
        provider_id: provider.id,
        status: "assigned",
        accepted_at: null,
        assigned_at: now,
        updated_at: now,
      },
      include: {
        users_bookings_provider_idTousers: {
          select: {
            id: true,
            full_name: true,
            phone: true,
          },
        },
      },
    });

    await recordBookingStatusHistory({
      bookingId,
      oldStatus: booking.status as BookingStatus,
      newStatus: "assigned",
      changedByUserId: adminId,
      changedByRole: "admin",
      note: previousProviderId
        ? `Provider reassigned to ${provider.full_name}.`
        : `Provider manually assigned: ${provider.full_name}.`,
    });

    await createNotification({
      userId: booking.customer_id,
      bookingId,
      notificationType: "job_assigned",
      title: "Service Provider Assigned",
      message: `${provider.full_name} has been assigned to your ${booking.services.name} booking.`,
    });

    await createNotification({
      userId: provider.id,
      bookingId,
      notificationType: "job_assigned",
      title: "New Booking Assigned",
      message: `Booking #${bookingId} for ${booking.services.name} has been assigned to you.`,
    });

    if (previousProviderId && previousProviderId !== provider.id) {
      await createNotification({
        userId: previousProviderId,
        bookingId,
        notificationType: "general",
        title: "Booking Reassigned",
        message: `Booking #${bookingId} has been reassigned to another provider.`,
      });
    }

    return response.status(200).json({
      message: previousProviderId
        ? "Provider reassigned successfully"
        : "Provider assigned successfully",
      booking: updatedBooking,
    });
  } catch (error) {
    console.error("Admin assign provider error:", error);

    return response.status(500).json({
      message: "Something went wrong while assigning the provider",
    });
  }
};
