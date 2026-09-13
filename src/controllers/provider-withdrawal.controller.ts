import type { Response } from "express";

import { prisma } from "../config/prisma";
import type { AuthenticatedRequest } from "../middlewares/auth.middleware";

function parsePositiveAmount(value: unknown): number | null {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return null;
  }

  return Math.round(parsedValue * 100) / 100;
}

function getRequiredText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const cleanedValue = value.trim();

  return cleanedValue.length > 0 ? cleanedValue : null;
}

function getOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const cleanedValue = value.trim();

  return cleanedValue.length > 0 ? cleanedValue : null;
}

/*
|--------------------------------------------------------------------------
| Provider: Create withdrawal request
|--------------------------------------------------------------------------
|
| Important:
|
| Creating a withdrawal request DOES NOT deduct the provider wallet.
|
| Pending + approved withdrawal amounts are treated as reserved.
|
| Wallet deduction happens only when admin marks the withdrawal as PAID.
|
|--------------------------------------------------------------------------
*/

export const createProviderWithdrawal = async (
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

    const amount = parsePositiveAmount(request.body.amount);

    if (!amount) {
      return response.status(400).json({
        message: "A valid withdrawal amount is required",
      });
    }

    const paymentMethod = getRequiredText(request.body.paymentMethod);

    if (!paymentMethod) {
      return response.status(400).json({
        message: "Payment method is required",
      });
    }

    const accountName = getRequiredText(request.body.accountName);
    const accountNumber = getRequiredText(request.body.accountNumber);
    const bankName = getOptionalText(request.body.bankName);
    const providerNote = getOptionalText(request.body.providerNote);

    if (!accountName) {
      return response.status(400).json({
        message: "Account name is required",
      });
    }

    if (!accountNumber) {
      return response.status(400).json({
        message: "Account number is required",
      });
    }

    const wallet = await prisma.wallets.findUnique({
      where: {
        user_id: providerId,
      },

      select: {
        id: true,
        user_id: true,
        balance: true,
        currency: true,
        is_active: true,
      },
    });

    if (!wallet) {
      return response.status(404).json({
        message: "Provider wallet not found",
      });
    }

    if (!wallet.is_active) {
      return response.status(403).json({
        message: "Provider wallet is inactive",
      });
    }

    const reservedWithdrawalAggregate = await prisma.withdrawals.aggregate({
      where: {
        provider_id: providerId,

        status: {
          in: ["pending", "approved"],
        },
      },

      _sum: {
        amount: true,
      },
    });

    const walletBalance = Math.round(Number(wallet.balance) * 100) / 100;

    const reservedWithdrawalAmount =
      Math.round(Number(reservedWithdrawalAggregate._sum.amount ?? 0) * 100) /
      100;

    const availableForWithdrawal =
      Math.round(Math.max(walletBalance - reservedWithdrawalAmount, 0) * 100) /
      100;

    if (amount > availableForWithdrawal) {
      return response.status(400).json({
        message: "Withdrawal amount exceeds your available wallet balance",

        wallet_balance: walletBalance,

        reserved_withdrawal_amount: reservedWithdrawalAmount,

        available_for_withdrawal: availableForWithdrawal,
      });
    }

    const now = new Date();

    const withdrawal = await prisma.withdrawals.create({
      data: {
        provider_id: providerId,

        wallet_id: wallet.id,

        amount: amount.toFixed(2),

        status: "pending",

        payment_method: paymentMethod,

        account_name: accountName,

        account_number: accountNumber,

        bank_name: bankName,

        provider_note: providerNote,

        admin_note: null,

        processed_by: null,

        requested_at: now,

        processed_at: null,

        created_at: now,

        updated_at: now,
      },
    });

    const updatedReservedWithdrawalAmount =
      Math.round((reservedWithdrawalAmount + amount) * 100) / 100;

    const updatedAvailableForWithdrawal =
      Math.round(
        Math.max(walletBalance - updatedReservedWithdrawalAmount, 0) * 100,
      ) / 100;

    return response.status(201).json({
      message:
        "Your withdrawal request is being processed. The amount will reach your account within 2–3 business days. If there is any issue, we will contact you.",

      withdrawal,

      wallet: {
        balance: wallet.balance,
        currency: wallet.currency,
      },

      reserved_withdrawal_amount: updatedReservedWithdrawalAmount,

      available_for_withdrawal: updatedAvailableForWithdrawal,
    });
  } catch (error) {
    console.error("Create provider withdrawal error:", error);

    return response.status(500).json({
      message: "Something went wrong while creating the withdrawal request",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Provider: Get withdrawal history
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

    const [withdrawals, wallet, reservedWithdrawalAggregate] =
      await Promise.all([
        prisma.withdrawals.findMany({
          where: {
            provider_id: providerId,
          },

          select: {
            id: true,
            provider_id: true,
            wallet_id: true,
            amount: true,
            status: true,
            payment_method: true,
            account_name: true,
            account_number: true,
            bank_name: true,
            provider_note: true,
            admin_note: true,
            processed_by: true,
            requested_at: true,
            processed_at: true,
            created_at: true,
            updated_at: true,
          },

          orderBy: {
            requested_at: "desc",
          },
        }),

        prisma.wallets.findUnique({
          where: {
            user_id: providerId,
          },

          select: {
            id: true,
            balance: true,
            currency: true,
            is_active: true,
          },
        }),

        prisma.withdrawals.aggregate({
          where: {
            provider_id: providerId,

            status: {
              in: ["pending", "approved"],
            },
          },

          _sum: {
            amount: true,
          },
        }),
      ]);

    const walletBalance = wallet
      ? Math.round(Number(wallet.balance) * 100) / 100
      : 0;

    const reservedWithdrawalAmount =
      Math.round(Number(reservedWithdrawalAggregate._sum.amount ?? 0) * 100) /
      100;

    const availableForWithdrawal =
      Math.round(Math.max(walletBalance - reservedWithdrawalAmount, 0) * 100) /
      100;

    return response.status(200).json({
      message: "Provider withdrawals fetched successfully",

      withdrawals,

      wallet: wallet
        ? {
            id: wallet.id,
            balance: wallet.balance,
            currency: wallet.currency,
            is_active: wallet.is_active,
          }
        : null,

      reserved_withdrawal_amount: reservedWithdrawalAmount,

      available_for_withdrawal: availableForWithdrawal,
    });
  } catch (error) {
    console.error("Get provider withdrawals error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching withdrawal requests",
    });
  }
};
