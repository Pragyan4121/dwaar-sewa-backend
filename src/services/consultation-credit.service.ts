import type { PrismaClient } from "../generated/prisma/client";

import { prisma } from "../config/prisma";

/*
|--------------------------------------------------------------------------
| Consultation credits
|--------------------------------------------------------------------------
|
| A consultation_credits row is earned when a paid video-consultation
| booking ends with the provider marking the outcome as "needs_visit",
| and spent when the customer applies it toward a home-visit booking's
| price. It mirrors promotion_redemptions in spirit — a single-use, row-
| lockable record rather than a raw balance — for the same reason: two
| concurrent booking-creation requests must not both be able to redeem
| the same credit.
|
| These columns/tables (booking_type, consultation_outcome,
| consultation_credits) are defined in the
| 202609240001_add_consultation_credits migration. Until `npx prisma
| generate` has been run against a database that actually has them, the
| generated Prisma Client doesn't know about them — so, like the admin
| login lockout fields before them, this file talks to them via raw SQL
| rather than the typed client. Once you've run the migration + generate
| for real, these can be switched to typed prisma.consultation_credits.*
| calls if you prefer; both are equally safe (parameterized).
|--------------------------------------------------------------------------
*/

type TransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export interface ConsultationCreditRow {
  id: number;
  consultation_booking_id: number;
  customer_id: number;
  credit_amount: string;
  status: "available" | "redeemed" | "expired";
  redeemed_booking_id: number | null;
  expires_at: Date;
  created_at: Date;
  redeemed_at: Date | null;
}

/**
 * Reads the configurable credit-expiry window (in days) from
 * system_settings, falling back to 14 if the row is somehow missing.
 */
export async function getConsultationCreditExpiryDays(): Promise<number> {
  const [row] = await prisma.$queryRaw<Array<{ setting_value: string | null }>>`
    SELECT setting_value
    FROM system_settings
    WHERE setting_key = 'consultation_credit_expiry_days'
  `;

  const parsed = row?.setting_value ? Number(row.setting_value) : NaN;

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 14;
}

/**
 * Creates a consultation credit for a completed, paid video-consultation
 * booking whose outcome was "needs_visit". Must be called from inside
 * the same transaction that marks the booking's outcome, so the two
 * changes commit atomically.
 */
export async function createConsultationCredit(
  transaction: TransactionClient,
  input: {
    consultationBookingId: number;
    customerId: number;
    creditAmount: number;
  },
): Promise<void> {
  const expiryDays = await getConsultationCreditExpiryDays();

  await transaction.$executeRaw`
    INSERT INTO consultation_credits (
      consultation_booking_id,
      customer_id,
      credit_amount,
      status,
      expires_at
    )
    VALUES (
      ${input.consultationBookingId},
      ${input.customerId},
      ${input.creditAmount.toFixed(2)},
      'available',
      now() + (${expiryDays}::text || ' days')::interval
    )
  `;
}

/**
 * Locks and validates a consultation credit for redemption. Must be
 * called from inside the same transaction as the booking that will
 * redeem it. Lazily expires the credit (rather than relying on a cron
 * job) if it's past its expiry when someone tries to use it. Throws a
 * descriptive Error whose message is one of the CONSULTATION_CREDIT_*
 * codes the caller can map to an HTTP response.
 */
export async function lockAndValidateConsultationCredit(
  transaction: TransactionClient,
  input: {
    creditId: number;
    customerId: number;
  },
): Promise<ConsultationCreditRow> {
  await transaction.$queryRaw<Array<{ id: number }>>`
    SELECT id
    FROM consultation_credits
    WHERE id = ${input.creditId}
    FOR UPDATE
  `;

  const [credit] = await transaction.$queryRaw<ConsultationCreditRow[]>`
    SELECT id, consultation_booking_id, customer_id, credit_amount, status,
           redeemed_booking_id, expires_at, created_at, redeemed_at
    FROM consultation_credits
    WHERE id = ${input.creditId}
  `;

  if (!credit) {
    throw new Error("CONSULTATION_CREDIT_NOT_FOUND");
  }

  if (credit.customer_id !== input.customerId) {
    // Same "not found" message as the missing-row case on purpose —
    // this endpoint should not reveal that a credit ID belonging to a
    // different customer exists.
    throw new Error("CONSULTATION_CREDIT_NOT_FOUND");
  }

  if (credit.status === "redeemed") {
    throw new Error("CONSULTATION_CREDIT_ALREADY_REDEEMED");
  }

  if (credit.status === "expired" || credit.expires_at.getTime() < Date.now()) {
    if (credit.status !== "expired") {
      await transaction.$executeRaw`
        UPDATE consultation_credits
        SET status = 'expired'
        WHERE id = ${input.creditId}
      `;
    }

    throw new Error("CONSULTATION_CREDIT_EXPIRED");
  }

  return credit;
}

/**
 * Marks a locked, already-validated credit as redeemed against a
 * home-visit booking. Call only after
 * lockAndValidateConsultationCredit has succeeded, inside the same
 * transaction.
 */
export async function redeemConsultationCredit(
  transaction: TransactionClient,
  input: {
    creditId: number;
    redeemedBookingId: number;
  },
): Promise<void> {
  await transaction.$executeRaw`
    UPDATE consultation_credits
    SET status = 'redeemed',
        redeemed_booking_id = ${input.redeemedBookingId},
        redeemed_at = now()
    WHERE id = ${input.creditId}
  `;
}
