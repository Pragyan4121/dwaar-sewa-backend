import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";

import jwt, {
  type JwtPayload,
  JsonWebTokenError,
  TokenExpiredError,
} from "jsonwebtoken";

import { Server, type Socket } from "socket.io";

import { prisma } from "../config/prisma";
import { isRoleName, type RoleName } from "../constants/roles";

/*
|--------------------------------------------------------------------------
| Socket types
|--------------------------------------------------------------------------
*/

type SocketChatRole = "customer" | "provider";

interface AuthenticationTokenPayload extends JwtPayload {
  userId?: number;
  roleId?: number;
  roleName?: RoleName;
}

interface SocketHandshakeAuth {
  token?: string;
  accessToken?: string;
  access_token?: string;
}

interface JoinOrderChatPayload {
  bookingId?: number;
}

interface MarkDeliveredPayload {
  messageId?: number;
}

interface AuthenticatedSocketData {
  userId: number;
  roleId: number;
  roleName: SocketChatRole;
}

/*
|--------------------------------------------------------------------------
| Free-call signaling types
|--------------------------------------------------------------------------
*/

interface StartCallPayload {
  bookingId?: number;
  callType?: "audio";
  call_type?: "audio";
}

interface CallActionPayload {
  bookingId?: number;
  callId?: string;
}

interface CallOfferPayload extends CallActionPayload {
  offer?: unknown;
}

interface CallAnswerPayload extends CallActionPayload {
  answer?: unknown;
}

interface CallIceCandidatePayload extends CallActionPayload {
  candidate?: unknown;
}

interface ActiveCall {
  callId: string;

  bookingId: number;

  customerId: number;

  providerId: number;

  callerUserId: number;

  callerRole: SocketChatRole;

  recipientUserId: number;

  recipientRole: SocketChatRole;

  status: "ringing" | "accepted";

  startedAt: Date;

  acceptedAt: Date | null;
}

interface CallBookingAccess {
  bookingId: number;

  customerId: number;

  providerId: number;

  currentUserId: number;

  currentRole: SocketChatRole;

  otherUserId: number;

  otherRole: SocketChatRole;

  bookingStatus: string;
}

/*
|--------------------------------------------------------------------------
| Socket.IO server instance
|--------------------------------------------------------------------------
*/

let io: Server | null = null;

/*
|--------------------------------------------------------------------------
| In-memory active calls
|--------------------------------------------------------------------------
|
| This is signaling state only.
|
| Audio itself does NOT pass through Socket.IO.
| WebRTC will carry the actual audio peer-to-peer.
|
| If the backend restarts, active call signaling state is cleared.
|--------------------------------------------------------------------------
*/

const activeCallsByBooking = new Map<number, ActiveCall>();

const activeCallsById = new Map<string, ActiveCall>();

/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/*
|--------------------------------------------------------------------------
| Extract socket JWT
|--------------------------------------------------------------------------
*/

function extractSocketToken(socket: Socket): string | null {
  const auth = socket.handshake.auth as SocketHandshakeAuth;

  const rawToken = auth?.token ?? auth?.accessToken ?? auth?.access_token;

  if (typeof rawToken !== "string") {
    return null;
  }

  const trimmedToken = rawToken.trim();

  if (!trimmedToken) {
    return null;
  }

  if (trimmedToken.toLowerCase().startsWith("bearer ")) {
    const token = trimmedToken.slice(7).trim();

    return token || null;
  }

  return trimmedToken;
}

/*
|--------------------------------------------------------------------------
| Authenticate socket
|--------------------------------------------------------------------------
*/

async function authenticateSocket(
  socket: Socket,
): Promise<AuthenticatedSocketData> {
  const token = extractSocketToken(socket);

  if (!token) {
    throw new Error("SOCKET_AUTH_TOKEN_REQUIRED");
  }

  const jwtSecret = process.env.JWT_SECRET;

  if (!jwtSecret) {
    console.error(
      "Socket authentication configuration error: JWT_SECRET is missing",
    );

    throw new Error("SOCKET_AUTH_CONFIGURATION_ERROR");
  }

  const decodedToken = jwt.verify(
    token,
    jwtSecret,
  ) as AuthenticationTokenPayload;

  if (
    !isPositiveInteger(decodedToken.userId) ||
    !isPositiveInteger(decodedToken.roleId)
  ) {
    throw new Error("SOCKET_AUTH_INVALID_TOKEN");
  }

  const user = await prisma.users.findUnique({
    where: {
      id: decodedToken.userId,
    },

    select: {
      id: true,
      role_id: true,
      is_active: true,

      roles: {
        select: {
          name: true,
        },
      },
    },
  });

  if (!user) {
    throw new Error("SOCKET_USER_NOT_FOUND");
  }

  if (!user.is_active) {
    throw new Error("SOCKET_USER_INACTIVE");
  }

  if (user.role_id !== decodedToken.roleId) {
    throw new Error("SOCKET_PERMISSIONS_CHANGED");
  }

  const databaseRoleName = user.roles.name.trim().toLowerCase();

  if (!isRoleName(databaseRoleName)) {
    throw new Error("SOCKET_UNSUPPORTED_ROLE");
  }

  if (
    decodedToken.roleName !== undefined &&
    decodedToken.roleName !== databaseRoleName
  ) {
    throw new Error("SOCKET_PERMISSIONS_CHANGED");
  }

  if (databaseRoleName !== "customer" && databaseRoleName !== "provider") {
    throw new Error("SOCKET_ROLE_NOT_ALLOWED");
  }

  return {
    userId: user.id,

    roleId: user.role_id,

    roleName: databaseRoleName,
  };
}

/*
|--------------------------------------------------------------------------
| Get authenticated socket user
|--------------------------------------------------------------------------
*/

function getSocketUser(socket: Socket): AuthenticatedSocketData | null {
  const userId = socket.data.userId;

  const roleId = socket.data.roleId;

  const roleName = socket.data.roleName;

  if (!isPositiveInteger(userId) || !isPositiveInteger(roleId)) {
    return null;
  }

  if (roleName !== "customer" && roleName !== "provider") {
    return null;
  }

  return {
    userId,
    roleId,
    roleName,
  };
}

/*
|--------------------------------------------------------------------------
| Active chat / call booking statuses
|--------------------------------------------------------------------------
*/

function isActiveChatBookingStatus(status: string): boolean {
  return (
    status === "accepted" ||
    status === "travelling" ||
    status === "arrived" ||
    status === "in_progress"
  );
}

/*
|--------------------------------------------------------------------------
| Verify chat access
|--------------------------------------------------------------------------
*/

async function canAccessBookingChat(input: {
  bookingId: number;
  userId: number;
  roleName: SocketChatRole;
}): Promise<boolean> {
  const room = await prisma.chat_rooms.findUnique({
    where: {
      booking_id: input.bookingId,
    },

    select: {
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
    return false;
  }

  if (room.archived_at !== null) {
    return false;
  }

  if (!isActiveChatBookingStatus(room.bookings.status)) {
    return false;
  }

  if (input.roleName === "customer" && room.customer_id !== input.userId) {
    return false;
  }

  if (input.roleName === "provider" && room.provider_id !== input.userId) {
    return false;
  }

  return true;
}

/*
|--------------------------------------------------------------------------
| Get call access + other participant
|--------------------------------------------------------------------------
*/

async function getCallBookingAccess(input: {
  bookingId: number;

  userId: number;

  roleName: SocketChatRole;
}): Promise<CallBookingAccess | null> {
  const room = await prisma.chat_rooms.findUnique({
    where: {
      booking_id: input.bookingId,
    },

    select: {
      customer_id: true,

      provider_id: true,

      archived_at: true,

      bookings: {
        select: {
          id: true,

          status: true,
        },
      },
    },
  });

  if (!room) {
    return null;
  }

  if (room.archived_at !== null) {
    return null;
  }

  if (!isActiveChatBookingStatus(room.bookings.status)) {
    return null;
  }

  if (input.roleName === "customer") {
    if (room.customer_id !== input.userId) {
      return null;
    }

    return {
      bookingId: input.bookingId,

      customerId: room.customer_id,

      providerId: room.provider_id,

      currentUserId: input.userId,

      currentRole: "customer",

      otherUserId: room.provider_id,

      otherRole: "provider",

      bookingStatus: room.bookings.status,
    };
  }

  if (room.provider_id !== input.userId) {
    return null;
  }

  return {
    bookingId: input.bookingId,

    customerId: room.customer_id,

    providerId: room.provider_id,

    currentUserId: input.userId,

    currentRole: "provider",

    otherUserId: room.customer_id,

    otherRole: "customer",

    bookingStatus: room.bookings.status,
  };
}

/*
|--------------------------------------------------------------------------
| Validate participant against active call
|--------------------------------------------------------------------------
*/

function userBelongsToCall(
  call: ActiveCall,

  userId: number,
): boolean {
  return call.customerId === userId || call.providerId === userId;
}

/*
|--------------------------------------------------------------------------
| Get the other participant in one call
|--------------------------------------------------------------------------
*/

function getOtherCallUserId(
  call: ActiveCall,

  currentUserId: number,
): number | null {
  if (call.customerId === currentUserId) {
    return call.providerId;
  }

  if (call.providerId === currentUserId) {
    return call.customerId;
  }

  return null;
}

/*
|--------------------------------------------------------------------------
| Clear active call
|--------------------------------------------------------------------------
*/

function removeActiveCall(call: ActiveCall): void {
  const currentByBooking = activeCallsByBooking.get(call.bookingId);

  if (currentByBooking?.callId === call.callId) {
    activeCallsByBooking.delete(call.bookingId);
  }

  activeCallsById.delete(call.callId);
}

/*
|--------------------------------------------------------------------------
| Socket room names
|--------------------------------------------------------------------------
*/

function getRoomName(bookingId: number): string {
  return `order-chat:${bookingId}`;
}

function getUserRoomName(userId: number): string {
  return `user:${userId}`;
}

/*
|--------------------------------------------------------------------------
| Emit signaling event directly to one user
|--------------------------------------------------------------------------
*/

function emitToUser(
  userId: number,

  eventName: string,

  payload: unknown,
): void {
  io?.to(getUserRoomName(userId)).emit(eventName, payload);
}

/*
|--------------------------------------------------------------------------
| Initialize Socket.IO
|--------------------------------------------------------------------------
*/

export function initializeChatSocket(httpServer: HttpServer): Server {
  if (io) {
    return io;
  }

  io = new Server(httpServer, {
    cors: {
      origin: true,

      credentials: true,
    },
  });

  /*
  |--------------------------------------------------------------------------
  | Authentication middleware
  |--------------------------------------------------------------------------
  */

  io.use(async (socket, next) => {
    try {
      const authenticatedUser = await authenticateSocket(socket);

      socket.data.userId = authenticatedUser.userId;

      socket.data.roleId = authenticatedUser.roleId;

      socket.data.roleName = authenticatedUser.roleName;

      return next();
    } catch (error) {
      if (error instanceof TokenExpiredError) {
        return next(new Error("AUTH_TOKEN_EXPIRED"));
      }

      if (error instanceof JsonWebTokenError) {
        return next(new Error("AUTH_TOKEN_INVALID"));
      }

      const code =
        error instanceof Error ? error.message : "SOCKET_AUTH_FAILED";

      console.error("Socket authentication rejected:", code);

      return next(new Error(code));
    }
  });

  /*
  |--------------------------------------------------------------------------
  | Connection
  |--------------------------------------------------------------------------
  */

  io.on("connection", (socket) => {
    const socketUser = getSocketUser(socket);

    if (!socketUser) {
      socket.disconnect(true);

      return;
    }

    /*
     * Every authenticated device joins a private user room.
     *
     * Example:
     * user:5
     *
     * This lets call signaling target the correct customer/provider
     * instead of broadcasting call data to every socket in the booking.
     */
    void socket.join(getUserRoomName(socketUser.userId));

    console.log(
      `Chat socket connected: user=${socketUser.userId} role=${socketUser.roleName}`,
    );

    /*
      |--------------------------------------------------------------------------
      | Join order chat
      |--------------------------------------------------------------------------
      */

    socket.on(
      "chat:join",
      async (
        payload: JoinOrderChatPayload,

        callback?: (result: unknown) => void,
      ) => {
        try {
          const bookingId = Number(payload?.bookingId);

          if (!Number.isInteger(bookingId) || bookingId <= 0) {
            callback?.({
              ok: false,

              code: "INVALID_BOOKING_ID",

              message: "Invalid booking ID",
            });

            return;
          }

          const allowed = await canAccessBookingChat({
            bookingId,

            userId: socketUser.userId,

            roleName: socketUser.roleName,
          });

          if (!allowed) {
            callback?.({
              ok: false,

              code: "CHAT_ACCESS_DENIED",

              message: "Chat access denied",
            });

            return;
          }

          await socket.join(getRoomName(bookingId));

          callback?.({
            ok: true,

            bookingId,
          });
        } catch (error) {
          console.error("Socket chat join error:", error);

          callback?.({
            ok: false,

            code: "CHAT_JOIN_FAILED",

            message: "Could not join chat",
          });
        }
      },
    );

    /*
      |--------------------------------------------------------------------------
      | Leave order chat
      |--------------------------------------------------------------------------
      */

    socket.on("chat:leave", async (payload: JoinOrderChatPayload) => {
      try {
        const bookingId = Number(payload?.bookingId);

        if (!Number.isInteger(bookingId) || bookingId <= 0) {
          return;
        }

        await socket.leave(getRoomName(bookingId));
      } catch (error) {
        console.error("Socket chat leave error:", error);
      }
    });

    /*
      |--------------------------------------------------------------------------
      | Message delivered
      |--------------------------------------------------------------------------
      */

    socket.on("chat:delivered", async (payload: MarkDeliveredPayload) => {
      try {
        const messageId = Number(payload?.messageId);

        if (!Number.isInteger(messageId) || messageId <= 0) {
          return;
        }

        const message = await prisma.chat_messages.findUnique({
          where: {
            id: messageId,
          },

          select: {
            id: true,

            booking_id: true,

            sender_user_id: true,

            delivered_at: true,

            chat_rooms: {
              select: {
                customer_id: true,

                provider_id: true,

                archived_at: true,
              },
            },
          },
        });

        if (!message) {
          return;
        }

        if (message.chat_rooms.archived_at !== null) {
          return;
        }

        const recipientIsCustomer =
          socketUser.roleName === "customer" &&
          message.chat_rooms.customer_id === socketUser.userId;

        const recipientIsProvider =
          socketUser.roleName === "provider" &&
          message.chat_rooms.provider_id === socketUser.userId;

        if (!recipientIsCustomer && !recipientIsProvider) {
          return;
        }

        if (message.sender_user_id === socketUser.userId) {
          return;
        }

        if (message.delivered_at) {
          return;
        }

        const deliveredAt = new Date();

        await prisma.chat_messages.update({
          where: {
            id: message.id,
          },

          data: {
            delivered_at: deliveredAt,
          },
        });

        io?.to(getRoomName(message.booking_id)).emit("chat:delivery-updated", {
          messageId: message.id,

          bookingId: message.booking_id,

          deliveredAt,
        });
      } catch (error) {
        console.error("Socket delivery acknowledgement error:", error);
      }
    });

    /*
      |--------------------------------------------------------------------------
      | FREE CALL — START
      |--------------------------------------------------------------------------
      |
      | Caller sends:
      |
      | socket.emit(
      |   "call:start",
      |   { bookingId },
      |   callback
      | );
      |
      | Recipient receives:
      |
      | call:incoming
      |--------------------------------------------------------------------------
      */

    socket.on(
      "call:start",
      async (
        payload: StartCallPayload,

        callback?: (result: unknown) => void,
      ) => {
        try {
          const bookingId = Number(payload?.bookingId);

          if (!Number.isInteger(bookingId) || bookingId <= 0) {
            callback?.({
              ok: false,

              code: "INVALID_BOOKING_ID",

              message: "Invalid booking ID",
            });

            return;
          }

          const access = await getCallBookingAccess({
            bookingId,

            userId: socketUser.userId,

            roleName: socketUser.roleName,
          });

          if (!access) {
            callback?.({
              ok: false,

              code: "CALL_ACCESS_DENIED",

              message: "Call access denied",
            });

            return;
          }

          const existingCall = activeCallsByBooking.get(bookingId);

          if (existingCall) {
            callback?.({
              ok: false,

              code: "CALL_ALREADY_ACTIVE",

              message: "A call is already active for this booking",

              callId: existingCall.callId,
            });

            return;
          }

          const callId = randomUUID();

          const call: ActiveCall = {
            callId,

            bookingId,

            customerId: access.customerId,

            providerId: access.providerId,

            callerUserId: access.currentUserId,

            callerRole: access.currentRole,

            recipientUserId: access.otherUserId,

            recipientRole: access.otherRole,

            status: "ringing",

            startedAt: new Date(),

            acceptedAt: null,
          };

          activeCallsByBooking.set(bookingId, call);

          activeCallsById.set(callId, call);

          const callerUser = await prisma.users.findUnique({
            where: {
              id: call.callerUserId,
            },

            select: {
              full_name: true,
            },
          });

          const callerName =
            callerUser?.full_name?.trim() ||
            (call.callerRole === "provider" ? "Provider" : "Customer");

          emitToUser(call.recipientUserId, "call:incoming", {
            callId: call.callId,
            bookingId: call.bookingId,
            callerUserId: call.callerUserId,
            callerRole: call.callerRole,
            callerName,
            recipientUserId: call.recipientUserId,
            recipientRole: call.recipientRole,
            callType: "audio",
            startedAt: call.startedAt,
          });

          callback?.({
            ok: true,

            callId,

            bookingId,

            recipientUserId: call.recipientUserId,

            status: "ringing",

            startedAt: call.startedAt,
          });

          console.log(
            `Free call started: call=${callId} booking=${bookingId} caller=${socketUser.userId}`,
          );
        } catch (error) {
          console.error("Socket call start error:", error);

          callback?.({
            ok: false,

            code: "CALL_START_FAILED",

            message: "Unable to start call",
          });
        }
      },
    );

    /*
      |--------------------------------------------------------------------------
      | FREE CALL — ACCEPT
      |--------------------------------------------------------------------------
      */

    socket.on(
      "call:accept",
      async (
        payload: CallActionPayload,

        callback?: (result: unknown) => void,
      ) => {
        try {
          const bookingId = Number(payload?.bookingId);

          const callId = payload?.callId;

          if (
            !Number.isInteger(bookingId) ||
            bookingId <= 0 ||
            !isNonEmptyString(callId)
          ) {
            callback?.({
              ok: false,

              code: "INVALID_CALL",

              message: "Invalid call",
            });

            return;
          }

          const access = await getCallBookingAccess({
            bookingId,

            userId: socketUser.userId,

            roleName: socketUser.roleName,
          });

          if (!access) {
            callback?.({
              ok: false,

              code: "CALL_ACCESS_DENIED",

              message: "Call access denied",
            });

            return;
          }

          const call = activeCallsById.get(callId);

          if (!call || call.bookingId !== bookingId) {
            callback?.({
              ok: false,

              code: "CALL_NOT_FOUND",

              message: "Call is no longer available",
            });

            return;
          }

          if (call.recipientUserId !== socketUser.userId) {
            callback?.({
              ok: false,

              code: "CALL_ACCEPT_NOT_ALLOWED",

              message: "Only the recipient can accept this call",
            });

            return;
          }

          if (call.status !== "ringing") {
            callback?.({
              ok: false,

              code: "CALL_NOT_RINGING",

              message: "Call is no longer ringing",
            });

            return;
          }

          const acceptedAt = new Date();

          call.status = "accepted";

          call.acceptedAt = acceptedAt;

          activeCallsById.set(call.callId, call);

          activeCallsByBooking.set(call.bookingId, call);

          emitToUser(
            call.callerUserId,

            "call:accepted",

            {
              callId: call.callId,

              bookingId: call.bookingId,

              acceptedByUserId: socketUser.userId,

              acceptedAt,
            },
          );

          callback?.({
            ok: true,

            callId: call.callId,

            bookingId: call.bookingId,

            status: "accepted",

            acceptedAt,
          });

          console.log(
            `Free call accepted: call=${call.callId} booking=${call.bookingId}`,
          );
        } catch (error) {
          console.error("Socket call accept error:", error);

          callback?.({
            ok: false,

            code: "CALL_ACCEPT_FAILED",

            message: "Unable to accept call",
          });
        }
      },
    );

    /*
      |--------------------------------------------------------------------------
      | FREE CALL — REJECT
      |--------------------------------------------------------------------------
      */

    socket.on(
      "call:reject",
      async (
        payload: CallActionPayload,

        callback?: (result: unknown) => void,
      ) => {
        try {
          const bookingId = Number(payload?.bookingId);

          const callId = payload?.callId;

          if (
            !Number.isInteger(bookingId) ||
            bookingId <= 0 ||
            !isNonEmptyString(callId)
          ) {
            callback?.({
              ok: false,

              code: "INVALID_CALL",

              message: "Invalid call",
            });

            return;
          }

          const access = await getCallBookingAccess({
            bookingId,

            userId: socketUser.userId,

            roleName: socketUser.roleName,
          });

          if (!access) {
            callback?.({
              ok: false,

              code: "CALL_ACCESS_DENIED",

              message: "Call access denied",
            });

            return;
          }

          const call = activeCallsById.get(callId);

          if (!call || call.bookingId !== bookingId) {
            callback?.({
              ok: false,

              code: "CALL_NOT_FOUND",

              message: "Call is no longer available",
            });

            return;
          }

          if (call.recipientUserId !== socketUser.userId) {
            callback?.({
              ok: false,

              code: "CALL_REJECT_NOT_ALLOWED",

              message: "Only the recipient can reject this call",
            });

            return;
          }

          emitToUser(
            call.callerUserId,

            "call:rejected",

            {
              callId: call.callId,

              bookingId: call.bookingId,

              rejectedByUserId: socketUser.userId,

              rejectedAt: new Date(),
            },
          );

          removeActiveCall(call);

          callback?.({
            ok: true,

            callId,

            bookingId,

            status: "rejected",
          });

          console.log(
            `Free call rejected: call=${call.callId} booking=${call.bookingId}`,
          );
        } catch (error) {
          console.error("Socket call reject error:", error);

          callback?.({
            ok: false,

            code: "CALL_REJECT_FAILED",

            message: "Unable to reject call",
          });
        }
      },
    );

    /*
      |--------------------------------------------------------------------------
      | WEBRTC OFFER
      |--------------------------------------------------------------------------
      |
      | Usually caller sends the offer after the recipient accepts.
      |--------------------------------------------------------------------------
      */

    socket.on(
      "call:offer",
      async (
        payload: CallOfferPayload,

        callback?: (result: unknown) => void,
      ) => {
        try {
          const bookingId = Number(payload?.bookingId);

          const callId = payload?.callId;

          if (
            !Number.isInteger(bookingId) ||
            bookingId <= 0 ||
            !isNonEmptyString(callId) ||
            payload?.offer === undefined
          ) {
            callback?.({
              ok: false,

              code: "INVALID_CALL_OFFER",

              message: "Invalid call offer",
            });

            return;
          }

          const access = await getCallBookingAccess({
            bookingId,

            userId: socketUser.userId,

            roleName: socketUser.roleName,
          });

          if (!access) {
            callback?.({
              ok: false,

              code: "CALL_ACCESS_DENIED",

              message: "Call access denied",
            });

            return;
          }

          const call = activeCallsById.get(callId);

          if (
            !call ||
            call.bookingId !== bookingId ||
            !userBelongsToCall(call, socketUser.userId)
          ) {
            callback?.({
              ok: false,

              code: "CALL_NOT_FOUND",

              message: "Call is not available",
            });

            return;
          }

          if (call.status !== "accepted") {
            callback?.({
              ok: false,

              code: "CALL_NOT_ACCEPTED",

              message: "Call must be accepted before WebRTC negotiation",
            });

            return;
          }

          const otherUserId = getOtherCallUserId(
            call,

            socketUser.userId,
          );

          if (!otherUserId) {
            return;
          }

          emitToUser(
            otherUserId,

            "call:offer",

            {
              callId,

              bookingId,

              fromUserId: socketUser.userId,

              offer: payload.offer,
            },
          );

          callback?.({
            ok: true,
          });
        } catch (error) {
          console.error("Socket call offer error:", error);

          callback?.({
            ok: false,

            code: "CALL_OFFER_FAILED",

            message: "Unable to send call offer",
          });
        }
      },
    );

    /*
      |--------------------------------------------------------------------------
      | WEBRTC ANSWER
      |--------------------------------------------------------------------------
      */

    socket.on(
      "call:answer",
      async (
        payload: CallAnswerPayload,

        callback?: (result: unknown) => void,
      ) => {
        try {
          const bookingId = Number(payload?.bookingId);

          const callId = payload?.callId;

          if (
            !Number.isInteger(bookingId) ||
            bookingId <= 0 ||
            !isNonEmptyString(callId) ||
            payload?.answer === undefined
          ) {
            callback?.({
              ok: false,

              code: "INVALID_CALL_ANSWER",

              message: "Invalid call answer",
            });

            return;
          }

          const access = await getCallBookingAccess({
            bookingId,

            userId: socketUser.userId,

            roleName: socketUser.roleName,
          });

          if (!access) {
            callback?.({
              ok: false,

              code: "CALL_ACCESS_DENIED",

              message: "Call access denied",
            });

            return;
          }

          const call = activeCallsById.get(callId);

          if (
            !call ||
            call.bookingId !== bookingId ||
            !userBelongsToCall(call, socketUser.userId)
          ) {
            callback?.({
              ok: false,

              code: "CALL_NOT_FOUND",

              message: "Call is not available",
            });

            return;
          }

          const otherUserId = getOtherCallUserId(
            call,

            socketUser.userId,
          );

          if (!otherUserId) {
            return;
          }

          emitToUser(
            otherUserId,

            "call:answer",

            {
              callId,

              bookingId,

              fromUserId: socketUser.userId,

              answer: payload.answer,
            },
          );

          callback?.({
            ok: true,
          });
        } catch (error) {
          console.error("Socket call answer error:", error);

          callback?.({
            ok: false,

            code: "CALL_ANSWER_FAILED",

            message: "Unable to send call answer",
          });
        }
      },
    );

    /*
      |--------------------------------------------------------------------------
      | WEBRTC ICE CANDIDATE
      |--------------------------------------------------------------------------
      */

    socket.on(
      "call:ice-candidate",
      async (
        payload: CallIceCandidatePayload,

        callback?: (result: unknown) => void,
      ) => {
        try {
          const bookingId = Number(payload?.bookingId);

          const callId = payload?.callId;

          if (
            !Number.isInteger(bookingId) ||
            bookingId <= 0 ||
            !isNonEmptyString(callId) ||
            payload?.candidate === undefined
          ) {
            callback?.({
              ok: false,

              code: "INVALID_ICE_CANDIDATE",

              message: "Invalid ICE candidate",
            });

            return;
          }

          const access = await getCallBookingAccess({
            bookingId,

            userId: socketUser.userId,

            roleName: socketUser.roleName,
          });

          if (!access) {
            callback?.({
              ok: false,

              code: "CALL_ACCESS_DENIED",

              message: "Call access denied",
            });

            return;
          }

          const call = activeCallsById.get(callId);

          if (
            !call ||
            call.bookingId !== bookingId ||
            !userBelongsToCall(call, socketUser.userId)
          ) {
            return;
          }

          const otherUserId = getOtherCallUserId(
            call,

            socketUser.userId,
          );

          if (!otherUserId) {
            return;
          }

          emitToUser(
            otherUserId,

            "call:ice-candidate",

            {
              callId,

              bookingId,

              fromUserId: socketUser.userId,

              candidate: payload.candidate,
            },
          );

          callback?.({
            ok: true,
          });
        } catch (error) {
          console.error("Socket ICE candidate error:", error);

          callback?.({
            ok: false,

            code: "ICE_CANDIDATE_FAILED",

            message: "Unable to send ICE candidate",
          });
        }
      },
    );

    /*
      |--------------------------------------------------------------------------
      | FREE CALL — END
      |--------------------------------------------------------------------------
      |
      | Either customer or provider can end an existing call.
      |--------------------------------------------------------------------------
      */

    socket.on(
      "call:end",
      async (
        payload: CallActionPayload,

        callback?: (result: unknown) => void,
      ) => {
        try {
          const bookingId = Number(payload?.bookingId);

          const callId = payload?.callId;

          if (
            !Number.isInteger(bookingId) ||
            bookingId <= 0 ||
            !isNonEmptyString(callId)
          ) {
            callback?.({
              ok: false,

              code: "INVALID_CALL",

              message: "Invalid call",
            });

            return;
          }

          const call = activeCallsById.get(callId);

          if (!call || call.bookingId !== bookingId) {
            callback?.({
              ok: true,

              callId,

              bookingId,

              status: "ended",
            });

            return;
          }

          if (
            !userBelongsToCall(
              call,

              socketUser.userId,
            )
          ) {
            callback?.({
              ok: false,

              code: "CALL_END_NOT_ALLOWED",

              message: "You cannot end this call",
            });

            return;
          }

          const otherUserId = getOtherCallUserId(
            call,

            socketUser.userId,
          );

          if (otherUserId) {
            emitToUser(
              otherUserId,

              "call:end",

              {
                callId: call.callId,

                bookingId: call.bookingId,

                endedByUserId: socketUser.userId,

                endedAt: new Date(),
              },
            );
          }

          removeActiveCall(call);

          callback?.({
            ok: true,

            callId,

            bookingId,

            status: "ended",
          });

          console.log(
            `Free call ended: call=${call.callId} booking=${call.bookingId}`,
          );
        } catch (error) {
          console.error("Socket call end error:", error);

          callback?.({
            ok: false,

            code: "CALL_END_FAILED",

            message: "Unable to end call",
          });
        }
      },
    );

    /*
      |--------------------------------------------------------------------------
      | Disconnect
      |--------------------------------------------------------------------------
      |
      | We intentionally do not automatically destroy a call here.
      |
      | A phone can temporarily lose a Socket.IO connection during
      | network switching. WebRTC may remain connected or Socket.IO
      | may reconnect immediately.
      |--------------------------------------------------------------------------
      */

    socket.on("disconnect", (reason) => {
      console.log(
        `Chat socket disconnected: user=${socketUser.userId} reason=${reason}`,
      );
    });
  });

  return io;
}

/*
|--------------------------------------------------------------------------
| Emit new chat message
|--------------------------------------------------------------------------
*/

export function emitOrderChatMessage(
  bookingId: number,

  message: unknown,
): void {
  if (!io) {
    return;
  }

  io.to(getRoomName(bookingId)).emit(
    "chat:message",

    message,
  );
}

/*
|--------------------------------------------------------------------------
| Emit read receipt
|--------------------------------------------------------------------------
*/

export function emitOrderChatReadUpdate(input: {
  bookingId: number;

  userId: number;

  readAt: Date;
}): void {
  if (!io) {
    return;
  }

  io.to(getRoomName(input.bookingId)).emit(
    "chat:read-updated",

    {
      bookingId: input.bookingId,

      userId: input.userId,

      readAt: input.readAt,
    },
  );
}

/*
|--------------------------------------------------------------------------
| Emit archived state
|--------------------------------------------------------------------------
*/

export function emitOrderChatArchived(bookingId: number): void {
  if (!io) {
    return;
  }

  /*
   * If a booking becomes archived while an internet call
   * is still active, terminate that signaling session too.
   */
  const activeCall = activeCallsByBooking.get(bookingId);

  if (activeCall) {
    const endedAt = new Date();

    emitToUser(
      activeCall.customerId,

      "call:end",

      {
        callId: activeCall.callId,

        bookingId,

        reason: "booking_archived",

        endedAt,
      },
    );

    emitToUser(
      activeCall.providerId,

      "call:end",

      {
        callId: activeCall.callId,

        bookingId,

        reason: "booking_archived",

        endedAt,
      },
    );

    removeActiveCall(activeCall);
  }

  io.to(getRoomName(bookingId)).emit(
    "chat:archived",

    {
      bookingId,

      archivedAt: new Date(),
    },
  );
}

/*
|--------------------------------------------------------------------------
| Get Socket.IO instance
|--------------------------------------------------------------------------
*/

export function getChatSocketServer(): Server | null {
  return io;
}
