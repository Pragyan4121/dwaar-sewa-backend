import { prisma } from "../config/prisma";
import type { RoleName } from "../constants/roles";

/*
|--------------------------------------------------------------------------
| Order chat booking statuses
|--------------------------------------------------------------------------
|
| Chat becomes available only after the provider accepts the booking.
|
| It remains active during:
| accepted -> travelling -> arrived -> in_progress
|
| It becomes archived when:
| completed -> cancelled
|--------------------------------------------------------------------------
*/

export const ACTIVE_CHAT_BOOKING_STATUSES = [
  "accepted",
  "travelling",
  "arrived",
  "in_progress",
] as const;

export const ARCHIVED_CHAT_BOOKING_STATUSES = [
  "completed",
  "cancelled",
] as const;

export type ChatParticipantRole = "customer" | "provider";

export interface OrderChatAccess {
  bookingId: number;
  chatRoomId: number;
  customerId: number;
  providerId: number;
  bookingStatus: string;
  isArchived: boolean;
  userRole: RoleName;
}

/*
|--------------------------------------------------------------------------
| Parse booking ID
|--------------------------------------------------------------------------
*/

export function parseOrderChatBookingId(value: unknown): number | null {
  const bookingId = Number(value);

  if (!Number.isInteger(bookingId) || bookingId <= 0) {
    return null;
  }

  return bookingId;
}

/*
|--------------------------------------------------------------------------
| Date formatting
|--------------------------------------------------------------------------
*/

function formatPreferredDate(value: Date): string {
  return new Intl.DateTimeFormat("en-NP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Kathmandu",
  }).format(value);
}

function formatPreferredTime(value: Date | null): string | null {
  if (!value) {
    return null;
  }

  /*
   * preferred_time is a PostgreSQL TIME value.
   *
   * The existing booking implementation stores the selected clock
   * time using a UTC-based 1970 date. Reading UTC components prevents
   * the selected time from being shifted by Nepal timezone conversion.
   */
  const hours = value.getUTCHours();
  const minutes = value.getUTCMinutes();

  const period = hours >= 12 ? "PM" : "AM";
  const twelveHour = hours % 12 === 0 ? 12 : hours % 12;

  return `${twelveHour}:${String(minutes).padStart(2, "0")} ${period}`;
}

/*
|--------------------------------------------------------------------------
| Automatic system message
|--------------------------------------------------------------------------
*/

export function buildBookingScheduleSystemMessage(input: {
  preferredDate: Date;
  preferredTime: Date | null;
}): string {
  const dateLabel = formatPreferredDate(input.preferredDate);
  const timeLabel = formatPreferredTime(input.preferredTime);

  if (timeLabel) {
    return `Booking confirmed for ${dateLabel} at ${timeLabel}. You can now use this chat to communicate about this order.`;
  }

  return `Booking confirmed for ${dateLabel}. You can now use this chat to communicate about this order.`;
}

/*
|--------------------------------------------------------------------------
| Is chat-active booking status?
|--------------------------------------------------------------------------
*/

export function isOrderChatActiveStatus(status: string): boolean {
  return ACTIVE_CHAT_BOOKING_STATUSES.some(
    (activeStatus) => activeStatus === status,
  );
}

/*
|--------------------------------------------------------------------------
| Is archived booking status?
|--------------------------------------------------------------------------
*/

export function isOrderChatArchivedStatus(status: string): boolean {
  return ARCHIVED_CHAT_BOOKING_STATUSES.some(
    (archivedStatus) => archivedStatus === status,
  );
}

/*
|--------------------------------------------------------------------------
| Create chat after provider acceptance
|--------------------------------------------------------------------------
|
| IMPORTANT:
|
| Admin assignment must NOT create the chat.
|
| This function is called only after the assigned provider genuinely
| accepts the booking.
|--------------------------------------------------------------------------
*/

export async function createOrderChatAfterProviderAcceptance(
  bookingId: number,
) {
  const booking = await prisma.bookings.findUnique({
    where: {
      id: bookingId,
    },

    select: {
      id: true,
      customer_id: true,
      provider_id: true,
      status: true,
      preferred_date: true,
      preferred_time: true,

      chat_rooms: {
        select: {
          id: true,
          booking_id: true,
          customer_id: true,
          provider_id: true,
          activated_at: true,
          archived_at: true,
          created_at: true,
          updated_at: true,
        },
      },
    },
  });

  if (!booking) {
    throw new Error("CHAT_BOOKING_NOT_FOUND");
  }

  if (booking.provider_id === null) {
    throw new Error("CHAT_PROVIDER_NOT_ASSIGNED");
  }

  /*
   * Preserve provider ID as a definite number before entering the
   * Prisma transaction callback.
   */
  const providerId: number = booking.provider_id;

  /*
   * Chat should normally be created when status first becomes accepted.
   *
   * We also permit the later active states so the system can safely
   * repair a missing room if chat creation failed during acceptance.
   */
  if (!isOrderChatActiveStatus(booking.status)) {
    throw new Error("CHAT_BOOKING_NOT_ACCEPTED");
  }

  /*
   * Existing room means nothing more needs to be created.
   *
   * This also prevents duplicate automatic system messages.
   */
  if (booking.chat_rooms) {
    return booking.chat_rooms;
  }

  const systemMessage = buildBookingScheduleSystemMessage({
    preferredDate: booking.preferred_date,
    preferredTime: booking.preferred_time,
  });

  const now = new Date();

  return prisma.$transaction(async (transaction) => {
    /*
     * Double-check inside the transaction.
     *
     * Two requests could otherwise both attempt chat creation at almost
     * the same moment.
     */
    const existingRoom = await transaction.chat_rooms.findUnique({
      where: {
        booking_id: booking.id,
      },

      select: {
        id: true,
        booking_id: true,
        customer_id: true,
        provider_id: true,
        activated_at: true,
        archived_at: true,
        created_at: true,
        updated_at: true,
      },
    });

    if (existingRoom) {
      return existingRoom;
    }

    const room = await transaction.chat_rooms.create({
      data: {
        booking_id: booking.id,
        customer_id: booking.customer_id,
        provider_id: providerId,
        activated_at: now,
        archived_at: null,
        updated_at: now,
      },

      select: {
        id: true,
        booking_id: true,
        customer_id: true,
        provider_id: true,
        activated_at: true,
        archived_at: true,
        created_at: true,
        updated_at: true,
      },
    });

    /*
     * Create the automatic schedule confirmation message once.
     */
    await transaction.chat_messages.create({
      data: {
        chat_room_id: room.id,
        booking_id: booking.id,

        sender_user_id: null,
        sender_role: "system",
        message_type: "system",

        message_text: systemMessage,
        image_url: null,

        delivered_at: now,
        read_at: null,
      },
    });

    return room;
  });
}

/*
|--------------------------------------------------------------------------
| Archive order chat
|--------------------------------------------------------------------------
|
| Chat history is NEVER deleted here.
|
| Completed/cancelled order communication must remain available to the
| admin for dispute resolution.
|--------------------------------------------------------------------------
*/

export async function archiveOrderChat(bookingId: number): Promise<void> {
  const room = await prisma.chat_rooms.findUnique({
    where: {
      booking_id: bookingId,
    },

    select: {
      id: true,
      archived_at: true,
    },
  });

  if (!room) {
    return;
  }

  if (room.archived_at) {
    return;
  }

  const now = new Date();

  await prisma.chat_rooms.update({
    where: {
      id: room.id,
    },

    data: {
      archived_at: now,
      updated_at: now,
    },
  });
}

/*
|--------------------------------------------------------------------------
| Restore order chat
|--------------------------------------------------------------------------
|
| This is a defensive repair helper.
|
| Under normal operation completed/cancelled bookings should never be
| restored to an active state.
|--------------------------------------------------------------------------
*/

export async function restoreOrderChat(bookingId: number): Promise<void> {
  const room = await prisma.chat_rooms.findUnique({
    where: {
      booking_id: bookingId,
    },

    select: {
      id: true,
      archived_at: true,
    },
  });

  if (!room) {
    return;
  }

  if (!room.archived_at) {
    return;
  }

  await prisma.chat_rooms.update({
    where: {
      id: room.id,
    },

    data: {
      archived_at: null,
      updated_at: new Date(),
    },
  });
}

/*
|--------------------------------------------------------------------------
| Verify order-chat access
|--------------------------------------------------------------------------
|
| Customer:
|   chat.customer_id must equal authenticated user.
|
| Provider:
|   chat.provider_id must equal authenticated user.
|
| Admin:
|   can inspect any existing order chat, including archived history.
|
| This prevents:
|
| Customer A -> accessing Customer B's booking
| Provider A -> accessing Provider B's booking
|--------------------------------------------------------------------------
*/

export async function getOrderChatAccess(input: {
  bookingId: number;
  userId: number;
  roleName: RoleName;
  allowArchived?: boolean;
}): Promise<OrderChatAccess> {
  const { bookingId, userId, roleName, allowArchived = false } = input;

  const room = await prisma.chat_rooms.findUnique({
    where: {
      booking_id: bookingId,
    },

    select: {
      id: true,
      booking_id: true,
      customer_id: true,
      provider_id: true,
      archived_at: true,

      bookings: {
        select: {
          status: true,
        },
      },
    },
  });

  if (!room) {
    throw new Error("CHAT_NOT_AVAILABLE");
  }

  /*
   * Admin may inspect active and archived order communication.
   *
   * Admin sending messages is intentionally not supported.
   */
  if (roleName === "admin") {
    return {
      bookingId: room.booking_id,
      chatRoomId: room.id,
      customerId: room.customer_id,
      providerId: room.provider_id,
      bookingStatus: room.bookings.status,
      isArchived:
        room.archived_at !== null ||
        isOrderChatArchivedStatus(room.bookings.status),
      userRole: roleName,
    };
  }

  if (roleName === "customer") {
    if (room.customer_id !== userId) {
      throw new Error("CHAT_ACCESS_DENIED");
    }
  } else if (roleName === "provider") {
    if (room.provider_id !== userId) {
      throw new Error("CHAT_ACCESS_DENIED");
    }
  } else {
    throw new Error("CHAT_ACCESS_DENIED");
  }

  const isArchived =
    room.archived_at !== null ||
    isOrderChatArchivedStatus(room.bookings.status);

  if (isArchived && !allowArchived) {
    throw new Error("CHAT_ARCHIVED");
  }

  return {
    bookingId: room.booking_id,
    chatRoomId: room.id,
    customerId: room.customer_id,
    providerId: room.provider_id,
    bookingStatus: room.bookings.status,
    isArchived,
    userRole: roleName,
  };
}

/*
|--------------------------------------------------------------------------
| Get other chat participant
|--------------------------------------------------------------------------
*/

export function getOtherChatParticipantId(input: {
  customerId: number;
  providerId: number;
  currentUserId: number;
  currentRole: RoleName;
}): number {
  if (input.currentRole === "customer") {
    if (input.currentUserId !== input.customerId) {
      throw new Error("CHAT_ACCESS_DENIED");
    }

    return input.providerId;
  }

  if (input.currentRole === "provider") {
    if (input.currentUserId !== input.providerId) {
      throw new Error("CHAT_ACCESS_DENIED");
    }

    return input.customerId;
  }

  throw new Error("CHAT_PARTICIPANT_REQUIRED");
}

/*
|--------------------------------------------------------------------------
| Touch order-chat room
|--------------------------------------------------------------------------
|
| updated_at allows us to sort chats by most recent activity.
|--------------------------------------------------------------------------
*/

export async function touchOrderChatRoom(chatRoomId: number): Promise<void> {
  await prisma.chat_rooms.update({
    where: {
      id: chatRoomId,
    },

    data: {
      updated_at: new Date(),
    },
  });
}
