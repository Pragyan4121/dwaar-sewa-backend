import type { Response } from "express";
import { prisma } from "../config/prisma";
import type { AuthenticatedRequest } from "../middlewares/auth.middleware";

/*
|--------------------------------------------------------------------------
| Customer/User: Get own notifications
|--------------------------------------------------------------------------
| Optional query parameters:
|
| GET /api/notifications/me
| GET /api/notifications/me?unreadOnly=true
| GET /api/notifications/me?page=1&limit=20
|--------------------------------------------------------------------------
*/

export const getMyNotifications = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const userId = request.user?.userId;

    if (!userId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    const unreadOnly =
      String(request.query.unreadOnly ?? "false").toLowerCase() === "true";

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

    const whereCondition = {
      user_id: userId,
      ...(unreadOnly
        ? {
            is_read: false,
          }
        : {}),
    };

    const [notifications, totalRecords, unreadCount] =
      await prisma.$transaction([
        prisma.notifications.findMany({
          where: whereCondition,
          orderBy: {
            created_at: "desc",
          },
          skip,
          take: limit,
          select: {
            id: true,
            user_id: true,
            booking_id: true,
            notification_type: true,
            title: true,
            message: true,
            is_read: true,
            read_at: true,
            created_at: true,
          },
        }),

        prisma.notifications.count({
          where: whereCondition,
        }),

        prisma.notifications.count({
          where: {
            user_id: userId,
            is_read: false,
          },
        }),
      ]);

    const totalPages = Math.ceil(totalRecords / limit);

    return response.status(200).json({
      message: "Notifications fetched successfully",
      notifications,
      unread_count: unreadCount,
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
    console.error("Get notifications error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching notifications",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Customer/User: Mark one notification as read
|--------------------------------------------------------------------------
*/

export const markNotificationAsRead = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const userId = request.user?.userId;
    const notificationId = Number(request.params.id);

    if (!userId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    if (!Number.isInteger(notificationId) || notificationId <= 0) {
      return response.status(400).json({
        message: "Invalid notification ID",
      });
    }

    const notification = await prisma.notifications.findFirst({
      where: {
        id: notificationId,
        user_id: userId,
      },
    });

    if (!notification) {
      return response.status(404).json({
        message: "Notification not found",
      });
    }

    if (notification.is_read) {
      return response.status(200).json({
        message: "Notification is already marked as read",
        notification,
      });
    }

    const updatedNotification = await prisma.notifications.update({
      where: {
        id: notificationId,
      },
      data: {
        is_read: true,
        read_at: new Date(),
      },
      select: {
        id: true,
        user_id: true,
        booking_id: true,
        notification_type: true,
        title: true,
        message: true,
        is_read: true,
        read_at: true,
        created_at: true,
      },
    });

    return response.status(200).json({
      message: "Notification marked as read successfully",
      notification: updatedNotification,
    });
  } catch (error) {
    console.error("Mark notification read error:", error);

    return response.status(500).json({
      message: "Something went wrong while updating the notification",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Customer/User: Mark all own notifications as read
|--------------------------------------------------------------------------
*/

export const markAllNotificationsAsRead = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const userId = request.user?.userId;

    if (!userId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    const now = new Date();

    const result = await prisma.notifications.updateMany({
      where: {
        user_id: userId,
        is_read: false,
      },
      data: {
        is_read: true,
        read_at: now,
      },
    });

    return response.status(200).json({
      message: "All notifications marked as read successfully",
      updated_count: result.count,
    });
  } catch (error) {
    console.error("Mark all notifications read error:", error);

    return response.status(500).json({
      message: "Something went wrong while updating notifications",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Customer/User: Delete one own notification
|--------------------------------------------------------------------------
*/

export const deleteMyNotification = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const userId = request.user?.userId;
    const notificationId = Number(request.params.id);

    if (!userId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    if (!Number.isInteger(notificationId) || notificationId <= 0) {
      return response.status(400).json({
        message: "Invalid notification ID",
      });
    }

    const notification = await prisma.notifications.findFirst({
      where: {
        id: notificationId,
        user_id: userId,
      },
      select: {
        id: true,
      },
    });

    if (!notification) {
      return response.status(404).json({
        message: "Notification not found",
      });
    }

    await prisma.notifications.delete({
      where: {
        id: notificationId,
      },
    });

    return response.status(200).json({
      message: "Notification deleted successfully",
    });
  } catch (error) {
    console.error("Delete notification error:", error);

    return response.status(500).json({
      message: "Something went wrong while deleting the notification",
    });
  }
};
