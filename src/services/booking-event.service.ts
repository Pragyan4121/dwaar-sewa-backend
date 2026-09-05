import { prisma } from "../config/prisma";

/*
|--------------------------------------------------------------------------
| Booking statuses
|--------------------------------------------------------------------------
|
| This list matches the complete booking lifecycle currently used by
| Dwaar Sewa.
|
| pending
|   ↓
| assigned
|   ↓
| accepted
|   ↓
| travelling
|   ↓
| arrived
|   ↓
| in_progress
|   ↓
| completed
|
| A booking may also become cancelled where permitted.
|--------------------------------------------------------------------------
*/

export type BookingStatus =
  | "pending"
  | "assigned"
  | "accepted"
  | "travelling"
  | "arrived"
  | "in_progress"
  | "completed"
  | "cancelled";

/*
|--------------------------------------------------------------------------
| Actor roles
|--------------------------------------------------------------------------
*/

export type ChangedByRole = "customer" | "provider" | "admin" | "system";

/*
|--------------------------------------------------------------------------
| Notification types
|--------------------------------------------------------------------------
|
| Keep old notification types for compatibility and include the newer
| provider workflow notifications.
|--------------------------------------------------------------------------
*/

export type NotificationType =
  | "booking_created"
  | "new_job"
  | "job_accepted"
  | "job_assigned"
  | "job_started"
  | "job_completed"
  | "booking_cancelled"
  | "provider_verified"
  | "provider_travelling"
  | "provider_arrived"
  | "service_started"
  | "service_completed"
  | "general";

/*
|--------------------------------------------------------------------------
| Record booking status history input
|--------------------------------------------------------------------------
|
| The database stores booking status as a varchar rather than a Prisma enum.
|
| Because Prisma therefore returns booking.status as plain `string`, oldStatus
| intentionally accepts string as well as our known BookingStatus union.
|
| newStatus is kept strongly typed because new status transitions are created
| by our own backend code.
|--------------------------------------------------------------------------
*/

interface RecordBookingStatusHistoryInput {
  bookingId: number;

  oldStatus: BookingStatus | string | null;

  newStatus: BookingStatus;

  changedByUserId?: number | null;

  changedByRole?: ChangedByRole | null;

  note?: string | null;
}

/*
|--------------------------------------------------------------------------
| Notification input
|--------------------------------------------------------------------------
*/

interface CreateNotificationInput {
  userId: number;

  bookingId?: number | null;

  notificationType: NotificationType;

  title: string;

  message: string;
}

/*
|--------------------------------------------------------------------------
| Save booking status history
|--------------------------------------------------------------------------
*/

export const recordBookingStatusHistory = async ({
  bookingId,
  oldStatus,
  newStatus,
  changedByUserId = null,
  changedByRole = null,
  note = null,
}: RecordBookingStatusHistoryInput) => {
  return prisma.booking_status_history.create({
    data: {
      booking_id: bookingId,

      old_status: oldStatus,

      new_status: newStatus,

      changed_by_user_id: changedByUserId,

      changed_by_role: changedByRole,

      note:
        typeof note === "string" && note.trim().length > 0 ? note.trim() : null,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Create one in-app notification
|--------------------------------------------------------------------------
*/

export const createNotification = async ({
  userId,
  bookingId = null,
  notificationType,
  title,
  message,
}: CreateNotificationInput) => {
  return prisma.notifications.create({
    data: {
      user_id: userId,

      booking_id: bookingId,

      notification_type: notificationType,

      title: title.trim(),

      message: message.trim(),

      is_read: false,

      read_at: null,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Create multiple notifications
|--------------------------------------------------------------------------
*/

export const createNotifications = async (
  notifications: CreateNotificationInput[],
) => {
  if (notifications.length === 0) {
    return {
      count: 0,
    };
  }

  return prisma.notifications.createMany({
    data: notifications.map((notification) => ({
      user_id: notification.userId,

      booking_id: notification.bookingId ?? null,

      notification_type: notification.notificationType,

      title: notification.title.trim(),

      message: notification.message.trim(),

      is_read: false,

      read_at: null,
    })),
  });
};

/*
|--------------------------------------------------------------------------
| Combined booking event input
|--------------------------------------------------------------------------
*/

interface RecordBookingEventInput {
  bookingId: number;

  oldStatus: BookingStatus | string | null;

  newStatus: BookingStatus;

  changedByUserId?: number | null;

  changedByRole?: ChangedByRole | null;

  note?: string | null;

  notifications?: CreateNotificationInput[];
}

/*
|--------------------------------------------------------------------------
| Record status history + notifications in one transaction
|--------------------------------------------------------------------------
*/

export const recordBookingEvent = async ({
  bookingId,
  oldStatus,
  newStatus,
  changedByUserId = null,
  changedByRole = null,
  note = null,
  notifications = [],
}: RecordBookingEventInput) => {
  const operations = [
    prisma.booking_status_history.create({
      data: {
        booking_id: bookingId,

        old_status: oldStatus,

        new_status: newStatus,

        changed_by_user_id: changedByUserId,

        changed_by_role: changedByRole,

        note:
          typeof note === "string" && note.trim().length > 0
            ? note.trim()
            : null,
      },
    }),
  ];

  for (const notification of notifications) {
    operations.push(
      prisma.notifications.create({
        data: {
          user_id: notification.userId,

          booking_id: notification.bookingId ?? bookingId,

          notification_type: notification.notificationType,

          title: notification.title.trim(),

          message: notification.message.trim(),

          is_read: false,

          read_at: null,
        },
      }) as never,
    );
  }

  return prisma.$transaction(operations);
};
