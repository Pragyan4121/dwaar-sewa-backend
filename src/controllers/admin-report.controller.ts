import type { Response } from "express";
import { prisma } from "../config/prisma";
import type { AuthenticatedRequest } from "../middlewares/auth.middleware";

const parseDateRange = (dateFromValue: unknown, dateToValue: unknown) => {
  let dateFrom: Date | undefined;
  let dateTo: Date | undefined;

  if (typeof dateFromValue === "string" && dateFromValue.trim()) {
    dateFrom = new Date(dateFromValue);

    if (Number.isNaN(dateFrom.getTime())) {
      throw new Error("INVALID_START_DATE");
    }

    dateFrom.setHours(0, 0, 0, 0);
  }

  if (typeof dateToValue === "string" && dateToValue.trim()) {
    dateTo = new Date(dateToValue);

    if (Number.isNaN(dateTo.getTime())) {
      throw new Error("INVALID_END_DATE");
    }

    dateTo.setHours(23, 59, 59, 999);
  }

  if (dateFrom && dateTo && dateFrom.getTime() > dateTo.getTime()) {
    throw new Error("INVALID_DATE_RANGE");
  }

  return {
    dateFrom,
    dateTo,
  };
};

/*
|--------------------------------------------------------------------------
| Admin: Get reports overview
|--------------------------------------------------------------------------
|
| GET /api/admin/reports/overview
|
| Optional query:
| ?dateFrom=2026-07-01
| ?dateTo=2026-07-31
|
|--------------------------------------------------------------------------
*/

export const getAdminReportsOverview = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const { dateFrom, dateTo } = parseDateRange(
      request.query.dateFrom,
      request.query.dateTo,
    );

    const bookingDateFilter =
      dateFrom || dateTo
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
        : {};

    const paymentDateFilter =
      dateFrom || dateTo
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
        : {};

    const [
      totalBookings,
      pendingBookings,
      acceptedBookings,
      assignedBookings,
      inProgressBookings,
      completedBookings,
      cancelledBookings,
      totalCustomers,
      totalProviders,
      totalServices,
      paidPaymentSummary,
      refundedPaymentSummary,
      paymentStatusGroups,
      bookingStatusGroups,
    ] = await Promise.all([
      prisma.bookings.count({
        where: bookingDateFilter,
      }),

      prisma.bookings.count({
        where: {
          ...bookingDateFilter,
          status: "pending",
        },
      }),

      prisma.bookings.count({
        where: {
          ...bookingDateFilter,
          status: "accepted",
        },
      }),

      prisma.bookings.count({
        where: {
          ...bookingDateFilter,
          status: "assigned",
        },
      }),

      prisma.bookings.count({
        where: {
          ...bookingDateFilter,
          status: "in_progress",
        },
      }),

      prisma.bookings.count({
        where: {
          ...bookingDateFilter,
          status: "completed",
        },
      }),

      prisma.bookings.count({
        where: {
          ...bookingDateFilter,
          status: "cancelled",
        },
      }),

      prisma.users.count({
        where: {
          roles: {
            name: "customer",
          },
        },
      }),

      prisma.users.count({
        where: {
          roles: {
            name: "provider",
          },
        },
      }),

      prisma.services.count(),

      prisma.payments.aggregate({
        where: {
          ...paymentDateFilter,
          payment_status: "paid",
        },
        _sum: {
          amount: true,
        },
        _count: {
          _all: true,
        },
      }),

      prisma.payments.aggregate({
        where: {
          ...paymentDateFilter,
          payment_status: "refunded",
        },
        _sum: {
          amount: true,
        },
        _count: {
          _all: true,
        },
      }),

      prisma.payments.groupBy({
        by: ["payment_status"],
        where: paymentDateFilter,
        _count: {
          _all: true,
        },
        _sum: {
          amount: true,
        },
      }),

      prisma.bookings.groupBy({
        by: ["status"],
        where: bookingDateFilter,
        _count: {
          _all: true,
        },
      }),
    ]);

    const completionRate =
      totalBookings > 0
        ? Number(((completedBookings / totalBookings) * 100).toFixed(2))
        : 0;

    const cancellationRate =
      totalBookings > 0
        ? Number(((cancelledBookings / totalBookings) * 100).toFixed(2))
        : 0;

    return response.status(200).json({
      message: "Reports overview fetched successfully",

      date_range: {
        date_from:
          typeof request.query.dateFrom === "string"
            ? request.query.dateFrom
            : null,
        date_to:
          typeof request.query.dateTo === "string"
            ? request.query.dateTo
            : null,
      },

      overview: {
        total_bookings: totalBookings,
        total_customers: totalCustomers,
        total_providers: totalProviders,
        total_services: totalServices,

        total_paid_amount: paidPaymentSummary._sum.amount ?? 0,

        total_paid_transactions: paidPaymentSummary._count._all,

        total_refunded_amount: refundedPaymentSummary._sum.amount ?? 0,

        total_refunded_transactions: refundedPaymentSummary._count._all,

        completion_rate: completionRate,
        cancellation_rate: cancellationRate,
      },

      booking_summary: {
        pending: pendingBookings,
        accepted: acceptedBookings,
        assigned: assignedBookings,
        in_progress: inProgressBookings,
        completed: completedBookings,
        cancelled: cancelledBookings,
      },

      booking_status_breakdown: bookingStatusGroups.map((item) => ({
        status: item.status,
        count: item._count._all,
      })),

      payment_status_breakdown: paymentStatusGroups.map((item) => ({
        status: item.payment_status,
        count: item._count._all,
        amount: item._sum.amount ?? 0,
      })),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_START_DATE") {
      return response.status(400).json({
        message: "Invalid start date",
      });
    }

    if (error instanceof Error && error.message === "INVALID_END_DATE") {
      return response.status(400).json({
        message: "Invalid end date",
      });
    }

    if (error instanceof Error && error.message === "INVALID_DATE_RANGE") {
      return response.status(400).json({
        message: "Start date cannot be after end date",
      });
    }

    console.error("Admin reports overview error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching reports overview",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin: Get top services report
|--------------------------------------------------------------------------
|
| GET /api/admin/reports/top-services
|
|--------------------------------------------------------------------------
*/

export const getTopServicesReport = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const { dateFrom, dateTo } = parseDateRange(
      request.query.dateFrom,
      request.query.dateTo,
    );

    const requestedLimit = Number(request.query.limit ?? 10);

    const limit =
      Number.isInteger(requestedLimit) &&
      requestedLimit > 0 &&
      requestedLimit <= 50
        ? requestedLimit
        : 10;

    const bookingDateFilter =
      dateFrom || dateTo
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
        : {};

    const bookingGroups = await prisma.bookings.groupBy({
      by: ["service_id"],
      where: bookingDateFilter,
      _count: {
        _all: true,
      },
      _sum: {
        estimated_price: true,
        final_price: true,
      },
      orderBy: {
        _count: {
          service_id: "desc",
        },
      },
      take: limit,
    });

    const serviceIds = bookingGroups.map((group) => group.service_id);

    const services =
      serviceIds.length > 0
        ? await prisma.services.findMany({
            where: {
              id: {
                in: serviceIds,
              },
            },
            select: {
              id: true,
              name: true,
              base_price: true,
              service_categories: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          })
        : [];

    const topServices = bookingGroups.map((group) => {
      const service = services.find((item) => item.id === group.service_id);

      return {
        service_id: group.service_id,
        service_name: service?.name ?? "Unknown Service",
        category: service?.service_categories ?? null,
        base_price: service?.base_price ?? null,
        total_bookings: group._count._all,
        estimated_revenue: group._sum.estimated_price ?? 0,
        final_revenue: group._sum.final_price ?? 0,
      };
    });

    return response.status(200).json({
      message: "Top services report fetched successfully",
      services: topServices,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      ["INVALID_START_DATE", "INVALID_END_DATE", "INVALID_DATE_RANGE"].includes(
        error.message,
      )
    ) {
      return response.status(400).json({
        message:
          error.message === "INVALID_START_DATE"
            ? "Invalid start date"
            : error.message === "INVALID_END_DATE"
              ? "Invalid end date"
              : "Start date cannot be after end date",
      });
    }

    console.error("Top services report error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching top services report",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin: Get top providers report
|--------------------------------------------------------------------------
|
| GET /api/admin/reports/top-providers
|
|--------------------------------------------------------------------------
*/

export const getTopProvidersReport = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const { dateFrom, dateTo } = parseDateRange(
      request.query.dateFrom,
      request.query.dateTo,
    );

    const requestedLimit = Number(request.query.limit ?? 10);

    const limit =
      Number.isInteger(requestedLimit) &&
      requestedLimit > 0 &&
      requestedLimit <= 50
        ? requestedLimit
        : 10;

    const bookingDateFilter =
      dateFrom || dateTo
        ? {
            completed_at: {
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
        : {};

    const providerGroups = await prisma.bookings.groupBy({
      by: ["provider_id"],
      where: {
        ...bookingDateFilter,
        status: "completed",
        provider_id: {
          not: null,
        },
      },
      _count: {
        _all: true,
      },
      _sum: {
        final_price: true,
        estimated_price: true,
      },
      orderBy: {
        _count: {
          provider_id: "desc",
        },
      },
      take: limit,
    });

    const providerIds = providerGroups
      .map((group) => group.provider_id)
      .filter((providerId): providerId is number => providerId !== null);

    const [providers, profiles] = await Promise.all([
      providerIds.length > 0
        ? prisma.users.findMany({
            where: {
              id: {
                in: providerIds,
              },
            },
            select: {
              id: true,
              full_name: true,
              phone: true,
              email: true,
              is_active: true,
            },
          })
        : [],

      providerIds.length > 0
        ? prisma.provider_profiles.findMany({
            where: {
              provider_id: {
                in: providerIds,
              },
            },
            select: {
              provider_id: true,
              verification_status: true,
              average_rating: true,
              total_reviews: true,
            },
          })
        : [],
    ]);

    const topProviders = providerGroups.map((group) => {
      const provider = providers.find((item) => item.id === group.provider_id);

      const profile = profiles.find(
        (item) => item.provider_id === group.provider_id,
      );

      return {
        provider_id: group.provider_id,
        full_name: provider?.full_name ?? "Unknown Provider",
        phone: provider?.phone ?? null,
        email: provider?.email ?? null,
        is_active: provider?.is_active ?? false,
        verification_status: profile?.verification_status ?? "pending",
        average_rating: profile?.average_rating ?? 0,
        total_reviews: profile?.total_reviews ?? 0,
        completed_bookings: group._count._all,
        total_revenue:
          group._sum.final_price ?? group._sum.estimated_price ?? 0,
      };
    });

    return response.status(200).json({
      message: "Top providers report fetched successfully",
      providers: topProviders,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      ["INVALID_START_DATE", "INVALID_END_DATE", "INVALID_DATE_RANGE"].includes(
        error.message,
      )
    ) {
      return response.status(400).json({
        message:
          error.message === "INVALID_START_DATE"
            ? "Invalid start date"
            : error.message === "INVALID_END_DATE"
              ? "Invalid end date"
              : "Start date cannot be after end date",
      });
    }

    console.error("Top providers report error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching top providers report",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin: Get daily trends report
|--------------------------------------------------------------------------
|
| GET /api/admin/reports/daily-trends
|
|--------------------------------------------------------------------------
*/

export const getDailyTrendsReport = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const { dateFrom, dateTo } = parseDateRange(
      request.query.dateFrom,
      request.query.dateTo,
    );

    const endDate = dateTo ?? new Date();

    const startDate =
      dateFrom ??
      new Date(
        endDate.getFullYear(),
        endDate.getMonth(),
        endDate.getDate() - 29,
        0,
        0,
        0,
        0,
      );

    const bookings = await prisma.bookings.findMany({
      where: {
        created_at: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        id: true,
        status: true,
        created_at: true,
      },
      orderBy: {
        created_at: "asc",
      },
    });

    const payments = await prisma.payments.findMany({
      where: {
        created_at: {
          gte: startDate,
          lte: endDate,
        },
        payment_status: "paid",
      },
      select: {
        amount: true,
        created_at: true,
      },
      orderBy: {
        created_at: "asc",
      },
    });

    const trendMap = new Map<
      string,
      {
        date: string;
        total_bookings: number;
        completed_bookings: number;
        cancelled_bookings: number;
        paid_revenue: number;
      }
    >();

    const cursor = new Date(startDate);

    cursor.setHours(0, 0, 0, 0);

    const finalDate = new Date(endDate);

    finalDate.setHours(0, 0, 0, 0);

    while (cursor.getTime() <= finalDate.getTime()) {
      const dateKey = cursor.toISOString().split("T")[0];

      trendMap.set(dateKey, {
        date: dateKey,
        total_bookings: 0,
        completed_bookings: 0,
        cancelled_bookings: 0,
        paid_revenue: 0,
      });

      cursor.setDate(cursor.getDate() + 1);
    }

    bookings.forEach((booking) => {
      if (!booking.created_at) {
        return;
      }

      const dateKey = booking.created_at.toISOString().split("T")[0];
      const item = trendMap.get(dateKey);

      if (!item) {
        return;
      }

      item.total_bookings += 1;

      if (booking.status === "completed") {
        item.completed_bookings += 1;
      }

      if (booking.status === "cancelled") {
        item.cancelled_bookings += 1;
      }
    });

    payments.forEach((payment) => {
      if (!payment.created_at) {
        return;
      }

      const dateKey = payment.created_at.toISOString().split("T")[0];

      const item = trendMap.get(dateKey);

      if (!item) {
        return;
      }

      item.paid_revenue += Number(payment.amount);
    });

    return response.status(200).json({
      message: "Daily trends report fetched successfully",

      date_range: {
        date_from: startDate.toISOString(),
        date_to: endDate.toISOString(),
      },

      trends: Array.from(trendMap.values()),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      ["INVALID_START_DATE", "INVALID_END_DATE", "INVALID_DATE_RANGE"].includes(
        error.message,
      )
    ) {
      return response.status(400).json({
        message:
          error.message === "INVALID_START_DATE"
            ? "Invalid start date"
            : error.message === "INVALID_END_DATE"
              ? "Invalid end date"
              : "Start date cannot be after end date",
      });
    }

    console.error("Daily trends report error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching daily trends report",
    });
  }
};
