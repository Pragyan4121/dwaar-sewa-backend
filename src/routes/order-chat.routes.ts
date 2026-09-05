import { Router } from "express";

import { ROLE_NAMES } from "../constants/roles";

import {
  createOrderChatCallLog,
  getAdminOrderChatHistory,
  getAdminOrderChats,
  getOrderChat,
  getProviderQuickReplies,
  markOrderChatAsRead,
  sendOrderChatImageMessage,
  sendOrderChatTextMessage,
} from "../controllers/order-chat.controller";

import { authenticateUser } from "../middlewares/auth.middleware";
import { chatImageUpload } from "../middlewares/chat-image-upload.middleware";
import { allowRoles } from "../middlewares/role.middleware";

const router = Router();

/*
|--------------------------------------------------------------------------
| CUSTOMER + PROVIDER ORDER CHAT
|--------------------------------------------------------------------------
*/

/*
|--------------------------------------------------------------------------
| Get order chat
|--------------------------------------------------------------------------
|
| GET /api/chats/orders/:bookingId
|--------------------------------------------------------------------------
*/

router.get(
  "/orders/:bookingId",
  authenticateUser,
  allowRoles(ROLE_NAMES.CUSTOMER, ROLE_NAMES.PROVIDER),
  getOrderChat,
);

/*
|--------------------------------------------------------------------------
| Send text message
|--------------------------------------------------------------------------
|
| POST /api/chats/orders/:bookingId/messages
|
| JSON body:
|
| {
|   "message": "I am on my way"
| }
|--------------------------------------------------------------------------
*/

router.post(
  "/orders/:bookingId/messages",
  authenticateUser,
  allowRoles(ROLE_NAMES.CUSTOMER, ROLE_NAMES.PROVIDER),
  sendOrderChatTextMessage,
);

/*
|--------------------------------------------------------------------------
| Send image message
|--------------------------------------------------------------------------
|
| POST /api/chats/orders/:bookingId/images
|
| multipart/form-data
|
| Required field:
|
| image
|
| Optional field:
|
| message
|--------------------------------------------------------------------------
*/

router.post(
  "/orders/:bookingId/images",
  authenticateUser,
  allowRoles(ROLE_NAMES.CUSTOMER, ROLE_NAMES.PROVIDER),
  chatImageUpload.single("image"),
  sendOrderChatImageMessage,
);

/*
|--------------------------------------------------------------------------
| Mark chat as read
|--------------------------------------------------------------------------
|
| PATCH /api/chats/orders/:bookingId/read
|--------------------------------------------------------------------------
*/

router.patch(
  "/orders/:bookingId/read",
  authenticateUser,
  allowRoles(ROLE_NAMES.CUSTOMER, ROLE_NAMES.PROVIDER),
  markOrderChatAsRead,
);

/*
|--------------------------------------------------------------------------
| Create/log voice call attempt
|--------------------------------------------------------------------------
|
| POST /api/chats/orders/:bookingId/calls
|--------------------------------------------------------------------------
*/

router.post(
  "/orders/:bookingId/calls",
  authenticateUser,
  allowRoles(ROLE_NAMES.CUSTOMER, ROLE_NAMES.PROVIDER),
  createOrderChatCallLog,
);

/*
|--------------------------------------------------------------------------
| PROVIDER QUICK REPLIES
|--------------------------------------------------------------------------
|
| GET /api/chats/quick-replies
|--------------------------------------------------------------------------
*/

router.get(
  "/quick-replies",
  authenticateUser,
  allowRoles(ROLE_NAMES.PROVIDER),
  getProviderQuickReplies,
);

/*
|--------------------------------------------------------------------------
| ADMIN ORDER CHAT HISTORY
|--------------------------------------------------------------------------
|
| Admin is read-only.
|--------------------------------------------------------------------------
*/

/*
|--------------------------------------------------------------------------
| List order chats
|--------------------------------------------------------------------------
|
| GET /api/chats/admin/orders
|--------------------------------------------------------------------------
*/

router.get(
  "/admin/orders",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  getAdminOrderChats,
);

/*
|--------------------------------------------------------------------------
| Get complete order chat history
|--------------------------------------------------------------------------
|
| GET /api/chats/admin/orders/:bookingId
|--------------------------------------------------------------------------
*/

router.get(
  "/admin/orders/:bookingId",
  authenticateUser,
  allowRoles(ROLE_NAMES.ADMIN),
  getAdminOrderChatHistory,
);

export default router;
