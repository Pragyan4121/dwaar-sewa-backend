import type { Response } from "express";

import { prisma } from "../config/prisma";
import type { AuthenticatedRequest } from "../middlewares/auth.middleware";
import { createConsultationCredit } from "../services/consultation-credit.service";

/*
|--------------------------------------------------------------------------
| Consultation outcome
|--------------------------------------------------------------------------
|
| Called by the assigned provider once a paid video-consultation booking's
| call has ended. This is the moment that either closes the booking out
| as fully resolved, or earns the customer a consultation_credits row
| they can redeem toward a follow-up home-visit booking.
|
| booking_type and consultation_outcome are raw-SQL here for the same
| reason as consultation-credit.service.ts: the generated Prisma Client
| doesn't know about these columns until `npx prisma generate` has been
| run against a migrated database.
|--------------------------------------------------------------------------
*/

const VALID_OUTCOMES = ["resolved", "needs_visit"] as const;

type ConsultationOutcome = (typeof VALID_OUTCOMES)[number];

function isValidOutcome(value: unknown): value is ConsultationOutcome {
  return (
    typeof value === "string" &&
    (VALID_OUTCOMES as readonly string[]).includes(value)
  );
}

export const setConsultationOutcome = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const providerId = request.user?.userId;
    const bookingId = Number(request.params.id);
    const outcome = request.body.outcome as unknown;

    if (!providerId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      return response.status(400).json({
        message: "Invalid booking ID",
      });
    }

    if (!isValidOutcome(outcome)) {
      return response.status(400).json({
        message: "outcome must be either 'resolved' or 'needs_visit'",
      });
    }

    const booking = await prisma.bookings.findFirst({
      where: {
        id: bookingId,
        provider_id: providerId,
      },

      select: {
        id: true,
        customer_id: true,
        provider_id: true,
        status: true,
        customer_payable_amount: true,

        payments: {
          select: {
            payment_status: true,
          },
        },
      },
    });

    if (!booking) {
      return response.status(404).json({
        message: "Assigned booking not found",
      });
    }

    const [rawBookingType] = await prisma.$queryRaw<
      Array<{ booking_type: string; consultation_outcome: string | null }>
    >`
      SELECT booking_type, consultation_outcome
      FROM bookings
      WHERE id = ${bookingId}
    `;

    if (
      !rawBookingType ||
      rawBookingType.booking_type !== "video_consultation"
    ) {
      return response.status(400).json({
        message: "This endpoint is only for video-consultation bookings",
      });
    }

    if (rawBookingType.consultation_outcome !== null) {
      return response.status(400).json({
        message: "An outcome has already been recorded for this consultation",
      });
    }

    if (booking.status === "cancelled" || booking.status === "completed") {
      return response.status(400).json({
        message: `Booking cannot be updated because its status is ${booking.status}`,
      });
    }

    if (booking.payments?.payment_status !== "paid") {
      // A credit is only meaningful — and only fair to the platform's
      // commission model — once the consultation has actually been paid
      // for. This also stops a provider from farming free credits for a
      // customer via an unpaid booking.
      return response.status(400).json({
        message: "This consultation has not been paid for yet",
      });
    }

    const now = new Date();

    await prisma.$transaction(async (transaction) => {
      const updateResult = await transaction.bookings.updateMany({
        where: {
          id: bookingId,
          provider_id: providerId,
        },

        data: {
          status: "completed",
          completed_at: now,
          updated_at: now,
        },
      });

      if (updateResult.count !== 1) {
        throw new Error("BOOKING_ALREADY_UPDATED");
      }

      await transaction.$executeRaw`
        UPDATE bookings
        SET consultation_outcome = ${outcome}
        WHERE id = ${bookingId}
      `;

      if (outcome === "needs_visit") {
        await createConsultationCredit(transaction, {
          consultationBookingId: bookingId,
          customerId: booking.customer_id,
          creditAmount: Number(booking.customer_payable_amount ?? 0),
        });

        await transaction.notifications.create({
          data: {
            user_id: booking.customer_id,
            booking_id: bookingId,
            notification_type: "consultation_credit_earned",
            title: "You've earned a credit toward a home visit",
            message:
              "Your provider recommended an in-person visit. The amount you paid for the video consultation has been credited toward that visit — book it whenever you're ready.",
            is_read: false,
            read_at: null,
          },
        });
      } else {
        await transaction.notifications.create({
          data: {
            user_id: booking.customer_id,
            booking_id: bookingId,
            notification_type: "consultation_resolved",
            title: "Your consultation is complete",
            message:
              "Your provider marked this issue as resolved. No home visit is needed.",
            is_read: false,
            read_at: null,
          },
        });
      }
    });

    return response.status(200).json({
      message: "Consultation outcome recorded",
      outcome,
    });
  } catch (error: unknown) {
    console.error("Set consultation outcome error:", error);

    return response.status(500).json({
      message: "Something went wrong while recording the consultation outcome",
    });
  }
};

/*
|--------------------------------------------------------------------------
| List my consultation credits
|--------------------------------------------------------------------------
|
| Customer-facing: what a booking-creation screen needs to show "you have
| a Rs. X credit available toward this visit" and let them opt in by ID.
| Lazily expires any credit whose expires_at has passed rather than
| relying on a background job.
|--------------------------------------------------------------------------
*/

export const listMyConsultationCredits = async (
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

    await prisma.$executeRaw`
      UPDATE consultation_credits
      SET status = 'expired'
      WHERE customer_id = ${customerId}
        AND status = 'available'
        AND expires_at < now()
    `;

    const credits = await prisma.$queryRaw<
      Array<{
        id: number;
        consultation_booking_id: number;
        credit_amount: string;
        expires_at: Date;
        created_at: Date;
      }>
    >`
      SELECT id, consultation_booking_id, credit_amount, expires_at, created_at
      FROM consultation_credits
      WHERE customer_id = ${customerId}
        AND status = 'available'
      ORDER BY created_at DESC
    `;

    return response.status(200).json({
      consultation_credits: credits.map((credit) => ({
        id: credit.id,
        consultation_booking_id: credit.consultation_booking_id,
        credit_amount: Number(credit.credit_amount),
        expires_at: credit.expires_at,
        created_at: credit.created_at,
      })),
    });
  } catch (error: unknown) {
    console.error("List consultation credits error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching your consultation credits",
    });
  }
};
