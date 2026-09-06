import type { Response } from "express";

import { prisma } from "../config/prisma";
import type { AuthenticatedRequest } from "../middlewares/auth.middleware";

function parsePositiveAmount(value: unknown): number | null {
  const amount = Number(value);

  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  return Math.round(amount * 100) / 100;
}

/*
|--------------------------------------------------------------------------
| Provider: Create withdrawal request
|--------------------------------------------------------------------------
*/

export const createProviderWithdrawal = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const providerId = request.user?.userId;

    const amount = parsePositiveAmount(request.body.amount);

    const paymentMethod =
      typeof request.body.paymentMethod === "string"
        ? request.body.paymentMethod.trim()
        : "bank_transfer";

    const accountName =
      typeof request.body.accountName === "string"
        ? request.body.accountName.trim()
        : "";

    const accountNumber =
      typeof request.body.accountNumber === "string"
        ? request.body.accountNumber.trim()
        : "";

    const bankName =
      typeof request.body.bankName === "string"
        ? request.body.bankName.trim()
        : "";

    const providerNote =
      typeof request.body.providerNote === "string"
        ? request.body.providerNote.trim()
        : "";

    if (!providerId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    if (!amount) {
      return response.status(400).json({
        message: "A valid withdrawal amount is required",
      });
    }

    if (
      paymentMethod === "bank_transfer" &&
      (!accountName || !accountNumber || !bankName)
    ) {
      return response.status(400).json({
        message: "Account name, account number, and bank name are required",
      });
    }

    const now = new Date();

    const result = await prisma.$transaction(async (transaction) => {
      const wallet = await transaction.wallets.findUnique({
        where: {
          user_id: providerId,
        },
        select: {
          id: true,
          balance: true,
          currency: true,
          is_active: true,
        },
      });

      if (!wallet) {
        throw new Error("WALLET_NOT_FOUND");
      }

      if (!wallet.is_active) {
        throw new Error("WALLET_INACTIVE");
      }

      /*
      |--------------------------------------------------------------------------
      | Atomically reserve withdrawal amount
      |--------------------------------------------------------------------------
      |
      | The balance condition and decrement happen in the same database query.
      | This prevents two simultaneous withdrawals from spending the same
      | wallet balance.
      |
      |--------------------------------------------------------------------------
      */

      const walletUpdateResult = await transaction.wallets.updateMany({
        where: {
          id: wallet.id,
          is_active: true,
          balance: {
            gte: amount,
          },
        },
        data: {
          balance: {
            decrement: amount,
          },
          updated_at: now,
        },
      });

      if (walletUpdateResult.count !== 1) {
        throw new Error("INSUFFICIENT_WALLET_BALANCE");
      }

      /*
      |--------------------------------------------------------------------------
      | Read balance after atomic debit
      |--------------------------------------------------------------------------
      */

      const updatedWallet = await transaction.wallets.findUnique({
        where: {
          id: wallet.id,
        },
        select: {
          id: true,
          balance: true,
          currency: true,
          is_active: true,
        },
      });

      if (!updatedWallet) {
        throw new Error("WALLET_NOT_FOUND");
      }

      const balanceAfter =
        Math.round(Number(updatedWallet.balance) * 100) / 100;
      const balanceBefore = Math.round((balanceAfter + amount) * 100) / 100;

      /*
      |--------------------------------------------------------------------------
      | Create withdrawal request
      |--------------------------------------------------------------------------
      */

      const withdrawal = await transaction.withdrawals.create({
        data: {
          provider_id: providerId,
          wallet_id: wallet.id,
          amount: amount.toFixed(2),
          status: "pending",
          payment_method: paymentMethod || "bank_transfer",
          account_name: accountName || null,
          account_number: accountNumber || null,
          bank_name: bankName || null,
          provider_note: providerNote || null,
          requested_at: now,
          created_at: now,
          updated_at: now,
        },
      });

      /*
      |--------------------------------------------------------------------------
      | Record wallet transaction
      |--------------------------------------------------------------------------
      */

      const walletTransaction = await transaction.wallet_transactions.create({
        data: {
          wallet_id: wallet.id,
          booking_id: null,
          transaction_type: "debit",
          source_type: "withdrawal_request",
          amount: amount.toFixed(2),
          balance_before: balanceBefore.toFixed(2),
          balance_after: balanceAfter.toFixed(2),
          description: `Withdrawal request #${withdrawal.id}`,
          created_at: now,
        },
      });

      return {
        withdrawal,
        wallet: updatedWallet,
        walletTransaction,
      };
    });

    return response.status(201).json({
      message: "Withdrawal request created successfully",
      withdrawal: result.withdrawal,
      wallet: {
        balance: result.wallet.balance,
        currency: result.wallet.currency,
      },
    });
  } catch (error) {
    console.error("Create provider withdrawal error:", error);

    if (error instanceof Error && error.message === "WALLET_NOT_FOUND") {
      return response.status(404).json({
        message: "Provider wallet not found",
      });
    }

    if (error instanceof Error && error.message === "WALLET_INACTIVE") {
      return response.status(403).json({
        message: "Your wallet is inactive. Please contact support.",
      });
    }

    if (
      error instanceof Error &&
      error.message === "INSUFFICIENT_WALLET_BALANCE"
    ) {
      return response.status(400).json({
        message: "Insufficient wallet balance",
      });
    }

    return response.status(500).json({
      message: "Something went wrong while creating the withdrawal request",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Provider: Withdrawal history
|--------------------------------------------------------------------------
*/

export const getProviderWithdrawals = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const providerId = request.user?.userId;

    if (!providerId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    const page = Math.max(Number(request.query.page) || 1, 1);

    const limit = Math.min(Math.max(Number(request.query.limit) || 20, 1), 100);

    const skip = (page - 1) * limit;

    const [withdrawals, total] = await Promise.all([
      prisma.withdrawals.findMany({
        where: {
          provider_id: providerId,
        },

        select: {
          id: true,
          amount: true,
          status: true,
          payment_method: true,
          account_name: true,
          account_number: true,
          bank_name: true,
          provider_note: true,
          admin_note: true,
          requested_at: true,
          processed_at: true,
          created_at: true,
          updated_at: true,
        },

        orderBy: {
          requested_at: "desc",
        },

        skip,
        take: limit,
      }),

      prisma.withdrawals.count({
        where: {
          provider_id: providerId,
        },
      }),
    ]);

    return response.status(200).json({
      message: "Provider withdrawals fetched successfully",
      withdrawals,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Get provider withdrawals error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching withdrawals",
    });
  }
};
