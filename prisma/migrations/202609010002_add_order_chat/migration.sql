-- ============================================================
-- DWAAR SEWA
-- Order-based Live Chat
--
-- Each booking/order has at most one chat room.
-- Chat room is created only after the assigned provider accepts.
--
-- Features supported by these tables:
-- - Order-specific chat
-- - Customer/provider access
-- - Text messages
-- - Image messages
-- - System messages
-- - Delivery status
-- - Read status
-- - Message timestamps
-- - Chat archive
-- - Voice call logs
-- - Admin dispute history
-- ============================================================


-- ============================================================
-- 1. CHAT ROOMS
-- ============================================================

CREATE TABLE "chat_rooms" (
    "id" SERIAL NOT NULL,
    "booking_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "provider_id" INTEGER NOT NULL,

    "activated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- When booking becomes completed/cancelled/expired,
    -- the room is archived rather than deleted.
    "archived_at" TIMESTAMP(6),

    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_rooms_pkey"
        PRIMARY KEY ("id"),

    CONSTRAINT "chat_rooms_booking_id_key"
        UNIQUE ("booking_id")
);


-- ============================================================
-- 2. CHAT MESSAGES
-- ============================================================

CREATE TABLE "chat_messages" (
    "id" SERIAL NOT NULL,

    "chat_room_id" INTEGER NOT NULL,
    "booking_id" INTEGER NOT NULL,

    -- NULL for automatic system messages.
    "sender_user_id" INTEGER,

    -- customer | provider | system
    "sender_role" VARCHAR(20) NOT NULL,

    -- text | image | system
    "message_type" VARCHAR(20) NOT NULL DEFAULT 'text',

    "message_text" TEXT,

    -- Used when message_type = image.
    "image_url" TEXT,

    -- When the backend successfully makes the message
    -- available to the recipient.
    "delivered_at" TIMESTAMP(6),

    -- When recipient opens/reads the message.
    "read_at" TIMESTAMP(6),

    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey"
        PRIMARY KEY ("id"),

    CONSTRAINT "chat_messages_sender_role_check"
        CHECK (
            "sender_role" IN (
                'customer',
                'provider',
                'system'
            )
        ),

    CONSTRAINT "chat_messages_message_type_check"
        CHECK (
            "message_type" IN (
                'text',
                'image',
                'system'
            )
        ),

    CONSTRAINT "chat_messages_content_check"
        CHECK (
            (
                "message_type" = 'text'
                AND "message_text" IS NOT NULL
            )
            OR
            (
                "message_type" = 'image'
                AND "image_url" IS NOT NULL
            )
            OR
            (
                "message_type" = 'system'
                AND "message_text" IS NOT NULL
            )
        ),

    CONSTRAINT "chat_messages_system_sender_check"
        CHECK (
            (
                "sender_role" = 'system'
                AND "sender_user_id" IS NULL
            )
            OR
            (
                "sender_role" IN ('customer', 'provider')
                AND "sender_user_id" IS NOT NULL
            )
        )
);


-- ============================================================
-- 3. CHAT VOICE CALL LOGS
-- ============================================================

CREATE TABLE "chat_call_logs" (
    "id" SERIAL NOT NULL,

    "chat_room_id" INTEGER NOT NULL,
    "booking_id" INTEGER NOT NULL,

    "initiated_by_id" INTEGER NOT NULL,
    "recipient_user_id" INTEGER NOT NULL,

    -- Only voice calling is supported.
    "call_type" VARCHAR(20) NOT NULL DEFAULT 'voice',

    -- initiated
    -- answered
    -- completed
    -- missed
    -- cancelled
    -- failed
    "status" VARCHAR(30) NOT NULL DEFAULT 'initiated',

    "started_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(6),

    "duration_seconds" INTEGER,

    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_call_logs_pkey"
        PRIMARY KEY ("id"),

    CONSTRAINT "chat_call_logs_call_type_check"
        CHECK (
            "call_type" = 'voice'
        ),

    CONSTRAINT "chat_call_logs_status_check"
        CHECK (
            "status" IN (
                'initiated',
                'answered',
                'completed',
                'missed',
                'cancelled',
                'failed'
            )
        ),

    CONSTRAINT "chat_call_logs_duration_check"
        CHECK (
            "duration_seconds" IS NULL
            OR "duration_seconds" >= 0
        ),

    CONSTRAINT "chat_call_logs_users_check"
        CHECK (
            "initiated_by_id" <> "recipient_user_id"
        )
);


-- ============================================================
-- 4. FOREIGN KEYS - CHAT ROOMS
-- ============================================================

ALTER TABLE "chat_rooms"
ADD CONSTRAINT "fk_chat_rooms_booking"
FOREIGN KEY ("booking_id")
REFERENCES "bookings"("id")
ON DELETE CASCADE
ON UPDATE NO ACTION;


ALTER TABLE "chat_rooms"
ADD CONSTRAINT "fk_chat_rooms_customer"
FOREIGN KEY ("customer_id")
REFERENCES "users"("id")
ON DELETE NO ACTION
ON UPDATE NO ACTION;


ALTER TABLE "chat_rooms"
ADD CONSTRAINT "fk_chat_rooms_provider"
FOREIGN KEY ("provider_id")
REFERENCES "users"("id")
ON DELETE NO ACTION
ON UPDATE NO ACTION;


-- ============================================================
-- 5. FOREIGN KEYS - CHAT MESSAGES
-- ============================================================

ALTER TABLE "chat_messages"
ADD CONSTRAINT "fk_chat_messages_room"
FOREIGN KEY ("chat_room_id")
REFERENCES "chat_rooms"("id")
ON DELETE CASCADE
ON UPDATE NO ACTION;


ALTER TABLE "chat_messages"
ADD CONSTRAINT "fk_chat_messages_booking"
FOREIGN KEY ("booking_id")
REFERENCES "bookings"("id")
ON DELETE CASCADE
ON UPDATE NO ACTION;


ALTER TABLE "chat_messages"
ADD CONSTRAINT "fk_chat_messages_sender"
FOREIGN KEY ("sender_user_id")
REFERENCES "users"("id")
ON DELETE SET NULL
ON UPDATE NO ACTION;


-- ============================================================
-- 6. FOREIGN KEYS - CALL LOGS
-- ============================================================

ALTER TABLE "chat_call_logs"
ADD CONSTRAINT "fk_chat_call_logs_room"
FOREIGN KEY ("chat_room_id")
REFERENCES "chat_rooms"("id")
ON DELETE CASCADE
ON UPDATE NO ACTION;


ALTER TABLE "chat_call_logs"
ADD CONSTRAINT "fk_chat_call_logs_booking"
FOREIGN KEY ("booking_id")
REFERENCES "bookings"("id")
ON DELETE CASCADE
ON UPDATE NO ACTION;


ALTER TABLE "chat_call_logs"
ADD CONSTRAINT "fk_chat_call_logs_initiator"
FOREIGN KEY ("initiated_by_id")
REFERENCES "users"("id")
ON DELETE NO ACTION
ON UPDATE NO ACTION;


ALTER TABLE "chat_call_logs"
ADD CONSTRAINT "fk_chat_call_logs_recipient"
FOREIGN KEY ("recipient_user_id")
REFERENCES "users"("id")
ON DELETE NO ACTION
ON UPDATE NO ACTION;


-- ============================================================
-- 7. INDEXES
-- ============================================================

-- Customer active/archive chat lookup.
CREATE INDEX "idx_chat_rooms_customer_active"
ON "chat_rooms"(
    "customer_id",
    "archived_at",
    "updated_at" DESC
);


-- Provider active/archive chat lookup.
CREATE INDEX "idx_chat_rooms_provider_active"
ON "chat_rooms"(
    "provider_id",
    "archived_at",
    "updated_at" DESC
);


-- Messages in chronological order for a room.
CREATE INDEX "idx_chat_messages_room_created"
ON "chat_messages"(
    "chat_room_id",
    "created_at"
);


-- Admin booking chat history.
CREATE INDEX "idx_chat_messages_booking_created"
ON "chat_messages"(
    "booking_id",
    "created_at"
);


CREATE INDEX "idx_chat_messages_sender"
ON "chat_messages"(
    "sender_user_id"
);


-- Useful for unread-message queries.
CREATE INDEX "idx_chat_messages_room_unread"
ON "chat_messages"(
    "chat_room_id",
    "read_at"
);


-- Call history by chat.
CREATE INDEX "idx_chat_call_logs_room_started"
ON "chat_call_logs"(
    "chat_room_id",
    "started_at" DESC
);


-- Call history by booking for admin dispute resolution.
CREATE INDEX "idx_chat_call_logs_booking_started"
ON "chat_call_logs"(
    "booking_id",
    "started_at" DESC
);