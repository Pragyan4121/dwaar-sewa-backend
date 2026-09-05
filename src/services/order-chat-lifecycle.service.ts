import {
  archiveOrderChat,
  isOrderChatActiveStatus,
  restoreOrderChat,
} from "./order-chat.service";

import { emitOrderChatArchived } from "./chat-socket.service";

/*
|--------------------------------------------------------------------------
| Booking statuses that permanently close active chat
|--------------------------------------------------------------------------
*/

const CHAT_ARCHIVE_STATUSES = new Set(["completed", "cancelled"]);

/*
|--------------------------------------------------------------------------
| Should chat be archived?
|--------------------------------------------------------------------------
*/

export function shouldArchiveOrderChat(bookingStatus: string): boolean {
  return CHAT_ARCHIVE_STATUSES.has(bookingStatus);
}

/*
|--------------------------------------------------------------------------
| Synchronize chat with booking status
|--------------------------------------------------------------------------
|
| Use this after a booking status has successfully changed.
|
| Examples:
|
| accepted
| travelling
| arrived
| in_progress
|      ↓
| chat stays active
|
| completed / cancelled
|      ↓
| archive chat
|      ↓
| emit chat:archived
|      ↓
| mobile screen immediately becomes read-only / hidden from active view
|--------------------------------------------------------------------------
*/

export async function syncOrderChatWithBookingStatus(
  bookingId: number,
  bookingStatus: string,
): Promise<void> {
  /*
  |--------------------------------------------------------------------------
  | Completed / cancelled
  |--------------------------------------------------------------------------
  */

  if (shouldArchiveOrderChat(bookingStatus)) {
    await archiveOrderChat(bookingId);

    emitOrderChatArchived(bookingId);

    return;
  }

  /*
  |--------------------------------------------------------------------------
  | Active order
  |--------------------------------------------------------------------------
  |
  | Normally chat will already be active.
  |
  | restoreOrderChat is defensive in case a booking was manually restored
  | by an admin during development or dispute correction.
  |--------------------------------------------------------------------------
  */

  if (isOrderChatActiveStatus(bookingStatus)) {
    await restoreOrderChat(bookingId);
  }
}

/*
|--------------------------------------------------------------------------
| Safe lifecycle synchronization
|--------------------------------------------------------------------------
|
| Booking completion/cancellation must never fail merely because the chat
| lifecycle operation encounters an unexpected problem.
|
| The booking remains the source of truth.
|--------------------------------------------------------------------------
*/

export async function safelySyncOrderChatWithBookingStatus(
  bookingId: number,
  bookingStatus: string,
): Promise<void> {
  try {
    await syncOrderChatWithBookingStatus(bookingId, bookingStatus);
  } catch (error) {
    console.error(
      `Failed to synchronize order chat lifecycle for booking ${bookingId} with status ${bookingStatus}:`,
      error,
    );
  }
}
