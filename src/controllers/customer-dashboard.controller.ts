import type { Response } from "express";
import { prisma } from "../config/prisma";
import type { AuthenticatedRequest } from "../middlewares/auth.middleware";

/*
|--------------------------------------------------------------------------
| Customer: Get own booking and notification summary
|--------------------------------------------------------------------------
|
| GET /api/customer/dashboard/summary
|
|--------------------------------------------------------------------------
*/

export const getCustomerDashboardSummary = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const customerId = request.user?.userId;

    if (!customerId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    const [
      totalBookings,
      pendingBookings,
      acceptedBookings,
      assignedBookings,
      inProgressBookings,
      completedBookings,
      cancelledBookings,
      unreadNotifications,
      submittedReviews,
    ] = await prisma.$transaction([
      prisma.bookings.count({
        where: {
          customer_id: customerId,
        },
      }),

      prisma.bookings.count({
        where: {
          customer_id: customerId,
          status: "pending",
        },
      }),

      prisma.bookings.count({
        where: {
          customer_id: customerId,
          status: "accepted",
        },
      }),

      prisma.bookings.count({
        where: {
          customer_id: customerId,
          status: "assigned",
        },
      }),

      prisma.bookings.count({
        where: {
          customer_id: customerId,
          status: "in_progress",
        },
      }),

      prisma.bookings.count({
        where: {
          customer_id: customerId,
          status: "completed",
        },
      }),

      prisma.bookings.count({
        where: {
          customer_id: customerId,
          status: "cancelled",
        },
      }),

      prisma.notifications.count({
        where: {
          user_id: customerId,
          is_read: false,
        },
      }),

      prisma.reviews.count({
        where: {
          customer_id: customerId,
        },
      }),
    ]);

    const completedWithoutReview = await prisma.bookings.count({
      where: {
        customer_id: customerId,
        status: "completed",
        reviews: null,
      },
    });

    return response.status(200).json({
      message: "Customer dashboard summary fetched successfully",
      summary: {
        bookings: {
          total: totalBookings,
          pending: pendingBookings,
          accepted: acceptedBookings,
          assigned: assignedBookings,
          in_progress: inProgressBookings,
          completed: completedBookings,
          cancelled: cancelledBookings,
        },
        notifications: {
          unread: unreadNotifications,
        },
        reviews: {
          submitted: submittedReviews,
          pending: completedWithoutReview,
        },
      },
    });
  } catch (error) {
    console.error("Customer dashboard summary error:", error);

    return response.status(500).json({
      message:
        "Something went wrong while fetching the customer dashboard summary",
    });
  }
};
