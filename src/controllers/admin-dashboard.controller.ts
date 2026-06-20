import { Response } from "express";
import { prisma } from "../config/prisma";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";

export const getAdminDashboardSummary = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const [
      customerRole,
      providerRole,
      totalServices,
      activeServices,
      totalBookings,
      pendingBookings,
      assignedBookings,
      inProgressBookings,
      completedBookings,
      cancelledBookings,
      totalPayments,
      paidPayments,
    ] = await Promise.all([
      prisma.roles.findUnique({
        where: {
          name: "customer",
        },
      }),

      prisma.roles.findUnique({
        where: {
          name: "provider",
        },
      }),

      prisma.services.count(),

      prisma.services.count({
        where: {
          is_active: true,
        },
      }),

      prisma.bookings.count(),

      prisma.bookings.count({
        where: {
          status: "pending",
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

      prisma.payments.count(),

      prisma.payments.aggregate({
        where: {
          payment_status: "paid",
        },
        _sum: {
          amount: true,
        },
      }),
    ]);

    const totalCustomers = customerRole
      ? await prisma.users.count({
          where: {
            role_id: customerRole.id,
          },
        })
      : 0;

    const totalProviders = providerRole
      ? await prisma.users.count({
          where: {
            role_id: providerRole.id,
          },
        })
      : 0;

    const activeProviders = providerRole
      ? await prisma.users.count({
          where: {
            role_id: providerRole.id,
            is_active: true,
          },
        })
      : 0;

    return response.status(200).json({
      message: "Admin dashboard summary fetched successfully",
      summary: {
        users: {
          total_customers: totalCustomers,
          total_providers: totalProviders,
          active_providers: activeProviders,
        },
        services: {
          total: totalServices,
          active: activeServices,
        },
        bookings: {
          total: totalBookings,
          pending: pendingBookings,
          assigned: assignedBookings,
          in_progress: inProgressBookings,
          completed: completedBookings,
          cancelled: cancelledBookings,
        },
        payments: {
          total_records: totalPayments,
          total_paid_amount: paidPayments._sum.amount || "0",
          currency: "NPR",
        },
      },
    });
  } catch (error) {
    console.error("Admin dashboard error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching dashboard summary",
    });
  }
};
