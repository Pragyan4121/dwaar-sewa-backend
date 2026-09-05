import type { Response } from "express";

import { prisma } from "../config/prisma";
import type { AuthenticatedRequest } from "../middlewares/auth.middleware";

import {
  deleteChatImageFile,
  getChatImagePublicUrl,
} from "../middlewares/chat-image-upload.middleware";

import {
  getOrderChatAccess,
  getOtherChatParticipantId,
  isOrderChatActiveStatus,
  parseOrderChatBookingId,
  touchOrderChatRoom,
} from "../services/order-chat.service";

import {
  emitOrderChatMessage,
  emitOrderChatReadUpdate,
} from "../services/chat-socket.service";

/*
|--------------------------------------------------------------------------
| Types
|--------------------------------------------------------------------------
*/

type CurrentUserRole = "customer" | "provider" | "admin";

/*
|--------------------------------------------------------------------------
| Get authenticated user's role
|--------------------------------------------------------------------------
*/

async function getAuthenticatedUserRole(
  userId: number,
): Promise<CurrentUserRole | null> {
  const user = await prisma.users.findUnique({
    where: {
      id: userId,
    },

    select: {
      id: true,

      roles: {
        select: {
          name: true,
        },
      },
    },
  });

  if (!user) {
    return null;
  }

  const roleName = user.roles.name;

  if (
    roleName !== "customer" &&
    roleName !== "provider" &&
    roleName !== "admin"
  ) {
    return null;
  }

  return roleName;
}

/*
|--------------------------------------------------------------------------
| Chat error mapper
|--------------------------------------------------------------------------
*/

function getChatErrorResponse(error: unknown): {
  status: number;
  message: string;
  code: string;
} {
  const code = error instanceof Error ? error.message : "CHAT_UNKNOWN_ERROR";

  switch (code) {
    case "CHAT_NOT_AVAILABLE":
      return {
        status: 404,
        message:
          "Chat is not available for this booking yet. Chat becomes available after the provider accepts the booking.",
        code,
      };

    case "CHAT_ACCESS_DENIED":
      return {
        status: 403,
        message: "You do not have permission to access this order chat.",
        code,
      };

    case "CHAT_ARCHIVED":
      return {
        status: 410,
        message:
          "This order chat has been archived because the order is no longer active.",
        code,
      };

    case "CHAT_PARTICIPANT_REQUIRED":
      return {
        status: 403,
        message:
          "Only the assigned customer and provider can perform this action.",
        code,
      };

    case "CHAT_BOOKING_NOT_FOUND":
      return {
        status: 404,
        message: "Booking not found.",
        code,
      };

    case "CHAT_PROVIDER_NOT_ASSIGNED":
      return {
        status: 409,
        message: "A provider has not been assigned to this booking.",
        code,
      };

    case "CHAT_BOOKING_NOT_ACCEPTED":
      return {
        status: 409,
        message:
          "Chat is available only after the provider accepts the booking.",
        code,
      };

    default:
      return {
        status: 500,
        message: "Something went wrong while processing the order chat.",
        code: "CHAT_INTERNAL_ERROR",
      };
  }
}

/*
|--------------------------------------------------------------------------
| Normalize text
|--------------------------------------------------------------------------
*/

function normalizeText(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

/*
|--------------------------------------------------------------------------
| GET ORDER CHAT
|--------------------------------------------------------------------------
|
| Customer/provider:
|
| GET /api/chats/orders/:bookingId
|--------------------------------------------------------------------------
*/

export const getOrderChat = async (
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

    const bookingId = parseOrderChatBookingId(request.params.bookingId);

    if (!bookingId) {
      return response.status(400).json({
        message: "Invalid booking ID",
      });
    }

    const roleName = await getAuthenticatedUserRole(userId);

    if (!roleName) {
      return response.status(403).json({
        message: "Invalid user role",
      });
    }

    if (roleName === "admin") {
      return response.status(403).json({
        message:
          "Admin chat history must be accessed through the admin chat endpoint.",
      });
    }

    const access = await getOrderChatAccess({
      bookingId,
      userId,
      roleName,
      allowArchived: true,
    });

    const room = await prisma.chat_rooms.findUnique({
      where: {
        id: access.chatRoomId,
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

        bookings: {
          select: {
            id: true,
            status: true,
            preferred_date: true,
            preferred_time: true,
            service_address: true,
            service_area: true,

            services: {
              select: {
                id: true,
                name: true,
              },
            },

            users_bookings_customer_idTousers: {
              select: {
                id: true,
                full_name: true,
                phone: true,
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
        },

        chat_messages: {
          orderBy: [
            {
              created_at: "asc",
            },
            {
              id: "asc",
            },
          ],

          select: {
            id: true,
            chat_room_id: true,
            booking_id: true,
            sender_user_id: true,
            sender_role: true,
            message_type: true,
            message_text: true,
            image_url: true,
            delivered_at: true,
            read_at: true,
            created_at: true,
          },
        },
      },
    });

    if (!room) {
      return response.status(404).json({
        message: "Chat room not found",
      });
    }

    const isActive =
      room.archived_at === null &&
      isOrderChatActiveStatus(room.bookings.status);

    return response.status(200).json({
      message: "Order chat fetched successfully",

      chat: {
        id: room.id,

        booking_id: room.booking_id,

        customer_id: room.customer_id,

        provider_id: room.provider_id,

        activated_at: room.activated_at,

        archived_at: room.archived_at,

        created_at: room.created_at,

        updated_at: room.updated_at,

        is_active: isActive,

        is_archived: !isActive,

        booking: room.bookings,

        messages: room.chat_messages,
      },
    });
  } catch (error) {
    console.error("Get order chat error:", error);

    const result = getChatErrorResponse(error);

    return response.status(result.status).json({
      message: result.message,

      code: result.code,
    });
  }
};

/*
|--------------------------------------------------------------------------
| SEND TEXT MESSAGE
|--------------------------------------------------------------------------
|
| POST /api/chats/orders/:bookingId/messages
|--------------------------------------------------------------------------
*/

export const sendOrderChatTextMessage = async (
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

    const bookingId = parseOrderChatBookingId(request.params.bookingId);

    if (!bookingId) {
      return response.status(400).json({
        message: "Invalid booking ID",
      });
    }

    const messageText = normalizeText(
      request.body?.message ?? request.body?.message_text,
    );

    if (!messageText) {
      return response.status(400).json({
        message: "Message cannot be empty",
      });
    }

    if (messageText.length > 4000) {
      return response.status(400).json({
        message: "Message is too long. Maximum length is 4000 characters.",
      });
    }

    const roleName = await getAuthenticatedUserRole(userId);

    if (roleName !== "customer" && roleName !== "provider") {
      return response.status(403).json({
        message: "Only the assigned customer or provider can send messages.",
      });
    }

    const access = await getOrderChatAccess({
      bookingId,
      userId,
      roleName,
      allowArchived: false,
    });

    if (!isOrderChatActiveStatus(access.bookingStatus)) {
      return response.status(409).json({
        message: "Messages can only be sent while the order is active.",

        code: "CHAT_ORDER_NOT_ACTIVE",
      });
    }

    /*
      |--------------------------------------------------------------------------
      | Store message
      |--------------------------------------------------------------------------
      |
      | delivered_at intentionally starts as NULL.
      |
      | It becomes populated only after the recipient's mobile app receives
      | the Socket.IO message and acknowledges it with chat:delivered.
      |--------------------------------------------------------------------------
      */

    const chatMessage = await prisma.chat_messages.create({
      data: {
        chat_room_id: access.chatRoomId,

        booking_id: bookingId,

        sender_user_id: userId,

        sender_role: roleName,

        message_type: "text",

        message_text: messageText,

        image_url: null,

        delivered_at: null,

        read_at: null,
      },

      select: {
        id: true,
        chat_room_id: true,
        booking_id: true,
        sender_user_id: true,
        sender_role: true,
        message_type: true,
        message_text: true,
        image_url: true,
        delivered_at: true,
        read_at: true,
        created_at: true,
      },
    });

    try {
      await touchOrderChatRoom(access.chatRoomId);
    } catch (touchError) {
      console.error("Failed to update chat room activity:", touchError);
    }

    /*
      |--------------------------------------------------------------------------
      | Real-time emit
      |--------------------------------------------------------------------------
      */

    emitOrderChatMessage(bookingId, chatMessage);

    return response.status(201).json({
      message: "Message sent successfully",

      chat_message: chatMessage,
    });
  } catch (error) {
    console.error("Send order chat message error:", error);

    const result = getChatErrorResponse(error);

    return response.status(result.status).json({
      message: result.message,

      code: result.code,
    });
  }
};

/*
|--------------------------------------------------------------------------
| SEND IMAGE MESSAGE
|--------------------------------------------------------------------------
|
| POST /api/chats/orders/:bookingId/images
|
| multipart/form-data
|
| image = required
| message = optional caption
|--------------------------------------------------------------------------
*/

export const sendOrderChatImageMessage = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  let imageStoredInDatabase = false;

  try {
    const userId = request.user?.userId;

    if (!userId) {
      await deleteChatImageFile(request.file?.path);

      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    const bookingId = parseOrderChatBookingId(request.params.bookingId);

    if (!bookingId) {
      await deleteChatImageFile(request.file?.path);

      return response.status(400).json({
        message: "Invalid booking ID",
      });
    }

    if (!request.file) {
      return response.status(400).json({
        message: "Please select an image to send.",

        code: "CHAT_IMAGE_REQUIRED",
      });
    }

    const caption = normalizeText(
      request.body?.message ?? request.body?.caption,
    );

    if (caption.length > 2000) {
      await deleteChatImageFile(request.file.path);

      return response.status(400).json({
        message:
          "Image caption is too long. Maximum length is 2000 characters.",
      });
    }

    const roleName = await getAuthenticatedUserRole(userId);

    if (roleName !== "customer" && roleName !== "provider") {
      await deleteChatImageFile(request.file.path);

      return response.status(403).json({
        message: "Only the assigned customer or provider can send chat images.",
      });
    }

    const access = await getOrderChatAccess({
      bookingId,
      userId,
      roleName,
      allowArchived: false,
    });

    if (!isOrderChatActiveStatus(access.bookingStatus)) {
      await deleteChatImageFile(request.file.path);

      return response.status(409).json({
        message: "Images can only be sent while the order is active.",

        code: "CHAT_ORDER_NOT_ACTIVE",
      });
    }

    const imageUrl = getChatImagePublicUrl(request.file.filename);

    /*
      |--------------------------------------------------------------------------
      | Store image message
      |--------------------------------------------------------------------------
      |
      | delivered_at starts NULL just like text messages.
      |--------------------------------------------------------------------------
      */

    const chatMessage = await prisma.chat_messages.create({
      data: {
        chat_room_id: access.chatRoomId,

        booking_id: bookingId,

        sender_user_id: userId,

        sender_role: roleName,

        message_type: "image",

        message_text: caption || null,

        image_url: imageUrl,

        delivered_at: null,

        read_at: null,
      },

      select: {
        id: true,
        chat_room_id: true,
        booking_id: true,
        sender_user_id: true,
        sender_role: true,
        message_type: true,
        message_text: true,
        image_url: true,
        delivered_at: true,
        read_at: true,
        created_at: true,
      },
    });

    /*
     * From here onward, the database owns the image.
     */
    imageStoredInDatabase = true;

    try {
      await touchOrderChatRoom(access.chatRoomId);
    } catch (touchError) {
      console.error(
        "Failed to update chat room activity after image message:",
        touchError,
      );
    }

    /*
      |--------------------------------------------------------------------------
      | Real-time emit
      |--------------------------------------------------------------------------
      */

    emitOrderChatMessage(bookingId, chatMessage);

    return response.status(201).json({
      message: "Image sent successfully",

      chat_message: chatMessage,
    });
  } catch (error) {
    if (!imageStoredInDatabase) {
      await deleteChatImageFile(request.file?.path);
    }

    console.error("Send order chat image error:", error);

    const result = getChatErrorResponse(error);

    return response.status(result.status).json({
      message: result.message,

      code: result.code,
    });
  }
};

/*
|--------------------------------------------------------------------------
| MARK CHAT AS READ
|--------------------------------------------------------------------------
|
| PATCH /api/chats/orders/:bookingId/read
|--------------------------------------------------------------------------
*/

export const markOrderChatAsRead = async (
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

    const bookingId = parseOrderChatBookingId(request.params.bookingId);

    if (!bookingId) {
      return response.status(400).json({
        message: "Invalid booking ID",
      });
    }

    const roleName = await getAuthenticatedUserRole(userId);

    if (roleName !== "customer" && roleName !== "provider") {
      return response.status(403).json({
        message:
          "Only the assigned customer or provider can mark chat messages as read.",
      });
    }

    const access = await getOrderChatAccess({
      bookingId,
      userId,
      roleName,
      allowArchived: false,
    });

    const readAt = new Date();

    /*
      |--------------------------------------------------------------------------
      | Mark only messages from the other side as read
      |--------------------------------------------------------------------------
      */

    const updateResult = await prisma.chat_messages.updateMany({
      where: {
        chat_room_id: access.chatRoomId,

        read_at: null,

        OR: [
          {
            sender_user_id: {
              not: userId,
            },
          },

          {
            sender_role: "system",
          },
        ],
      },

      data: {
        read_at: readAt,
      },
    });

    /*
      |--------------------------------------------------------------------------
      | Real-time read receipt
      |--------------------------------------------------------------------------
      |
      | Sender immediately gets informed that the other participant has read
      | the conversation.
      |--------------------------------------------------------------------------
      */

    if (updateResult.count > 0) {
      emitOrderChatReadUpdate({
        bookingId,
        userId,
        readAt,
      });
    }

    return response.status(200).json({
      message: "Messages marked as read",

      updated_count: updateResult.count,

      read_at: readAt,
    });
  } catch (error) {
    console.error("Mark order chat read error:", error);

    const result = getChatErrorResponse(error);

    return response.status(result.status).json({
      message: result.message,

      code: result.code,
    });
  }
};

/*
|--------------------------------------------------------------------------
| PROVIDER QUICK REPLIES
|--------------------------------------------------------------------------
*/

export const getProviderQuickReplies = async (
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

    const roleName = await getAuthenticatedUserRole(userId);

    if (roleName !== "provider") {
      return response.status(403).json({
        message: "Quick reply templates are available only to providers.",
      });
    }

    return response.status(200).json({
      message: "Quick replies fetched successfully",

      quick_replies: [
        {
          id: "booking_confirmed",

          label: "Booking confirmed",

          message:
            "Your booking is confirmed. I will provide the service at the scheduled time.",
        },

        {
          id: "on_my_way",

          label: "On my way",

          message: "I am on my way to your service location.",
        },

        {
          id: "arriving_soon",

          label: "Arriving soon",

          message: "I will arrive at your location shortly.",
        },

        {
          id: "arrived",

          label: "I have arrived",

          message: "I have arrived at your service location.",
        },

        {
          id: "please_call",

          label: "Please call me",

          message: "Please call me when convenient regarding this booking.",
        },

        {
          id: "location_help",

          label: "Need location help",

          message: "I am nearby but need some help locating your address.",
        },
      ],
    });
  } catch (error) {
    console.error("Get provider quick replies error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching quick replies.",
    });
  }
};

/*
|--------------------------------------------------------------------------
| CREATE VOICE CALL LOG
|--------------------------------------------------------------------------
*/

export const createOrderChatCallLog = async (
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

    const bookingId = parseOrderChatBookingId(request.params.bookingId);

    if (!bookingId) {
      return response.status(400).json({
        message: "Invalid booking ID",
      });
    }

    const roleName = await getAuthenticatedUserRole(userId);

    if (roleName !== "customer" && roleName !== "provider") {
      return response.status(403).json({
        message:
          "Only the assigned customer or provider can start an order call.",
      });
    }

    const access = await getOrderChatAccess({
      bookingId,
      userId,
      roleName,
      allowArchived: false,
    });

    if (!isOrderChatActiveStatus(access.bookingStatus)) {
      return response.status(409).json({
        message: "Voice calling is available only while the order is active.",

        code: "CALL_ORDER_NOT_ACTIVE",
      });
    }

    const recipientUserId = getOtherChatParticipantId({
      customerId: access.customerId,

      providerId: access.providerId,

      currentUserId: userId,

      currentRole: roleName,
    });

    const recipient = await prisma.users.findUnique({
      where: {
        id: recipientUserId,
      },

      select: {
        id: true,
        full_name: true,
        phone: true,
      },
    });

    if (!recipient) {
      return response.status(404).json({
        message: "Call recipient was not found",
      });
    }

    const callLog = await prisma.chat_call_logs.create({
      data: {
        chat_room_id: access.chatRoomId,

        booking_id: bookingId,

        initiated_by_id: userId,

        recipient_user_id: recipientUserId,

        call_type: "voice",

        status: "initiated",

        started_at: new Date(),

        ended_at: null,

        duration_seconds: null,
      },

      select: {
        id: true,
        chat_room_id: true,
        booking_id: true,
        initiated_by_id: true,
        recipient_user_id: true,
        call_type: true,
        status: true,
        started_at: true,
        ended_at: true,
        duration_seconds: true,
        created_at: true,
      },
    });

    return response.status(201).json({
      message: "Voice call logged successfully",

      call: callLog,

      recipient: {
        id: recipient.id,

        full_name: recipient.full_name,

        phone: recipient.phone,
      },
    });
  } catch (error) {
    console.error("Create order chat call log error:", error);

    const result = getChatErrorResponse(error);

    return response.status(result.status).json({
      message: result.message,

      code: result.code,
    });
  }
};

/*
|--------------------------------------------------------------------------
| ADMIN - LIST ORDER CHATS
|--------------------------------------------------------------------------
*/

export const getAdminOrderChats = async (
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

    const roleName = await getAuthenticatedUserRole(userId);

    if (roleName !== "admin") {
      return response.status(403).json({
        message: "Admin access required",
      });
    }

    const rooms = await prisma.chat_rooms.findMany({
      orderBy: {
        updated_at: "desc",
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

        bookings: {
          select: {
            id: true,
            status: true,
            preferred_date: true,
            preferred_time: true,
            service_address: true,
            service_area: true,

            services: {
              select: {
                id: true,
                name: true,
              },
            },

            users_bookings_customer_idTousers: {
              select: {
                id: true,
                full_name: true,
                phone: true,
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
        },

        _count: {
          select: {
            chat_messages: true,

            chat_call_logs: true,
          },
        },
      },
    });

    return response.status(200).json({
      message: "Order chats fetched successfully",

      chats: rooms,
    });
  } catch (error) {
    console.error("Admin get order chats error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching order chats.",
    });
  }
};

/*
|--------------------------------------------------------------------------
| ADMIN - COMPLETE ORDER CHAT HISTORY
|--------------------------------------------------------------------------
*/

export const getAdminOrderChatHistory = async (
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

    const roleName = await getAuthenticatedUserRole(userId);

    if (roleName !== "admin") {
      return response.status(403).json({
        message: "Admin access required",
      });
    }

    const bookingId = parseOrderChatBookingId(request.params.bookingId);

    if (!bookingId) {
      return response.status(400).json({
        message: "Invalid booking ID",
      });
    }

    const access = await getOrderChatAccess({
      bookingId,
      userId,
      roleName,
      allowArchived: false,
    });

    const room = await prisma.chat_rooms.findUnique({
      where: {
        id: access.chatRoomId,
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

        bookings: {
          select: {
            id: true,
            status: true,
            payment_method: true,
            preferred_date: true,
            preferred_time: true,
            service_address: true,
            service_area: true,
            created_at: true,
            completed_at: true,
            cancelled_at: true,

            services: {
              select: {
                id: true,
                name: true,
              },
            },

            users_bookings_customer_idTousers: {
              select: {
                id: true,
                full_name: true,
                phone: true,
                email: true,
              },
            },

            users_bookings_provider_idTousers: {
              select: {
                id: true,
                full_name: true,
                phone: true,
                email: true,
              },
            },
          },
        },

        chat_messages: {
          orderBy: [
            {
              created_at: "asc",
            },
            {
              id: "asc",
            },
          ],

          select: {
            id: true,
            chat_room_id: true,
            booking_id: true,
            sender_user_id: true,
            sender_role: true,
            message_type: true,
            message_text: true,
            image_url: true,
            delivered_at: true,
            read_at: true,
            created_at: true,
          },
        },

        chat_call_logs: {
          orderBy: [
            {
              started_at: "asc",
            },
            {
              id: "asc",
            },
          ],

          select: {
            id: true,
            chat_room_id: true,
            booking_id: true,
            initiated_by_id: true,
            recipient_user_id: true,
            call_type: true,
            status: true,
            started_at: true,
            ended_at: true,
            duration_seconds: true,
            created_at: true,

            users_chat_call_logs_initiated_by_idTousers: {
              select: {
                id: true,
                full_name: true,
                phone: true,
              },
            },

            users_chat_call_logs_recipient_user_idTousers: {
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

    if (!room) {
      return response.status(404).json({
        message: "Order chat not found",
      });
    }

    return response.status(200).json({
      message: "Order chat history fetched successfully",

      chat: room,
    });
  } catch (error) {
    console.error("Admin get order chat history error:", error);

    const result = getChatErrorResponse(error);

    return response.status(result.status).json({
      message: result.message,

      code: result.code,
    });
  }
};
