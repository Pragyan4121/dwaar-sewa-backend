import { Response } from "express";

import { ROLE_NAMES } from "../constants/roles";
import { prisma } from "../config/prisma";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export const getMyWallet = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const userId = request.user?.userId;
    const roleName = request.user?.roleName;

    if (!userId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Wallet
    |--------------------------------------------------------------------------
    */

    let wallet = await prisma.wallets.findUnique({
      where: {
        user_id: userId,
      },
    });

    if (!wallet) {
      wallet = await prisma.wallets.create({
        data: {
          user_id: userId,
          balance: "0.00",
          currency: "NPR",
          is_active: true,
        },
      });
    }

    const balance = Number(wallet.balance);
    const commissionDue = Number(wallet.commission_due);

    /*
    |--------------------------------------------------------------------------
    | Customer payment history
    |--------------------------------------------------------------------------
    |
    | Providers still receive the same wallet information as before.
    | Payment history and customer spending totals are only calculated for
    | customer accounts.
    |--------------------------------------------------------------------------
    */

    if (roleName === ROLE_NAMES.CUSTOMER) {
      const payments = await prisma.payments.findMany({
        where: {
          bookings: {
            customer_id: userId,
          },
        },
        orderBy: {
          created_at: "desc",
        },
        select: {
          id: true,
          booking_id: true,
          amount: true,
          payment_method: true,
          payment_status: true,
          transaction_reference: true,
          paid_at: true,
          created_at: true,
          updated_at: true,

          bookings: {
            select: {
              id: true,
              status: true,
              final_price: true,
              created_at: true,

              services: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      });

      /*
      |--------------------------------------------------------------------------
      | Spending calculations
      |--------------------------------------------------------------------------
      |
      | A refunded payment was previously paid, so:
      |
      | total_paid     = paid + refunded payment amounts
      | total_refunded = refunded payment amounts
      | net_spent      = total_paid - total_refunded
      |
      | Pending payments do not count as money spent.
      |--------------------------------------------------------------------------
      */

      let totalPaid = 0;
      let totalRefunded = 0;
      let successfulPaymentCount = 0;
      let refundedPaymentCount = 0;

      for (const payment of payments) {
        const amount = Number(payment.amount);

        if (!Number.isFinite(amount)) {
          continue;
        }

        if (
          payment.payment_status === "paid" ||
          payment.payment_status === "refunded"
        ) {
          totalPaid += amount;
          successfulPaymentCount += 1;
        }

        if (payment.payment_status === "refunded") {
          totalRefunded += amount;
          refundedPaymentCount += 1;
        }
      }

      totalPaid = roundMoney(totalPaid);
      totalRefunded = roundMoney(totalRefunded);

      const netSpent = roundMoney(Math.max(totalPaid - totalRefunded, 0));

      return response.status(200).json({
        message: "Wallet fetched successfully",

        wallet: {
          ...wallet,
          available_balance: balance.toFixed(2),
          amount_owed_to_platform: commissionDue.toFixed(2),
        },

        summary: {
          currency: wallet.currency,
          total_paid: totalPaid.toFixed(2),
          total_refunded: totalRefunded.toFixed(2),
          net_spent: netSpent.toFixed(2),
          successful_payment_count: successfulPaymentCount,
          refunded_payment_count: refundedPaymentCount,
          payment_record_count: payments.length,
        },

        payments: payments.map((payment) => ({
          id: payment.id,
          booking_id: payment.booking_id,
          amount: Number(payment.amount).toFixed(2),
          payment_method: payment.payment_method,
          payment_status: payment.payment_status,
          transaction_reference: payment.transaction_reference,
          paid_at: payment.paid_at,
          created_at: payment.created_at,
          updated_at: payment.updated_at,

          booking: {
            id: payment.bookings.id,
            status: payment.bookings.status,
            final_price:
              payment.bookings.final_price === null
                ? null
                : Number(payment.bookings.final_price).toFixed(2),
            created_at: payment.bookings.created_at,

            service: {
              id: payment.bookings.services.id,
              name: payment.bookings.services.name,
            },
          },
        })),
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Provider wallet response
    |--------------------------------------------------------------------------
    */

    return response.status(200).json({
      message: "Wallet fetched successfully",
      wallet: {
        ...wallet,
        available_balance: Math.max(balance, 0).toFixed(2),
        amount_owed_to_platform: Math.max(-balance, 0).toFixed(2),
      },
    });
  } catch (error) {
    console.error("Get wallet error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching the wallet",
    });
  }
};
