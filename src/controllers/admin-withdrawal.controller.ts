import type { Response } from "express";

import { prisma } from "../config/prisma";
import type { AuthenticatedRequest } from "../middlewares/auth.middleware";

function parsePositiveInteger(value: unknown): number | null {
  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    return null;
  }

  return parsedValue;
}

function getOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const cleanedValue = value.trim();

  return cleanedValue || null;
}

/*
|--------------------------------------------------------------------------
| Admin: Get all withdrawal requests
|--------------------------------------------------------------------------
*/

export const getAllWithdrawalsForAdmin = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const page = Math.max(Number(request.query.page) || 1, 1);

    const limit = Math.min(Math.max(Number(request.query.limit) || 20, 1), 100);

    const status =
      typeof request.query.status === "string"
        ? request.query.status.trim()
        : "";

    const search =
      typeof request.query.search === "string"
        ? request.query.search.trim()
        : "";

    const skip = (page - 1) * limit;

    const where = {
      ...(status
        ? {
            status,
          }
        : {}),

      ...(search
        ? {
            OR: [
              {
                provider: {
                  full_name: {
                    contains: search,
                    mode: "insensitive" as const,
                  },
                },
              },
              {
                provider: {
                  phone: {
                    contains: search,
                    mode: "insensitive" as const,
                  },
                },
              },
              {
                provider: {
                  email: {
                    contains: search,
                    mode: "insensitive" as const,
                  },
                },
              },
              {
                account_name: {
                  contains: search,
                  mode: "insensitive" as const,
                },
              },
              {
                account_number: {
                  contains: search,
                  mode: "insensitive" as const,
                },
              },
              {
                bank_name: {
                  contains: search,
                  mode: "insensitive" as const,
                },
              },
            ],
          }
        : {}),
    };

    const [withdrawals, total] = await Promise.all([
      prisma.withdrawals.findMany({
        where,

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

          provider: {
            select: {
              id: true,
              full_name: true,
              phone: true,
              email: true,
              is_active: true,
            },
          },

          wallets: {
            select: {
              id: true,
              balance: true,
              currency: true,
              is_active: true,
            },
          },

          processor: {
            select: {
              id: true,
              full_name: true,
            },
          },
        },

        orderBy: {
          requested_at: "desc",
        },

        skip,
        take: limit,
      }),

      prisma.withdrawals.count({
        where,
      }),
    ]);

    return response.status(200).json({
      message: "Withdrawal requests fetched successfully",
      withdrawals,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Get admin withdrawals error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching withdrawal requests",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin: Get one withdrawal request
|--------------------------------------------------------------------------
*/

export const getWithdrawalByIdForAdmin = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const withdrawalId = parsePositiveInteger(request.params.id);

    if (!withdrawalId) {
      return response.status(400).json({
        message: "Invalid withdrawal ID",
      });
    }

    const withdrawal = await prisma.withdrawals.findUnique({
      where: {
        id: withdrawalId,
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

        provider: {
          select: {
            id: true,
            full_name: true,
            phone: true,
            email: true,
            is_active: true,

            provider_profiles_provider_profiles_provider_idTousers: {
              select: {
                verification_status: true,
              },
            },
          },
        },

        wallets: {
          select: {
            id: true,
            balance: true,
            currency: true,
            is_active: true,
          },
        },

        processor: {
          select: {
            id: true,
            full_name: true,
          },
        },
      },
    });

    if (!withdrawal) {
      return response.status(404).json({
        message: "Withdrawal request not found",
      });
    }

    return response.status(200).json({
      message: "Withdrawal request fetched successfully",
      withdrawal,
    });
  } catch (error) {
    console.error("Get admin withdrawal details error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching the withdrawal request",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin: Approve withdrawal request
|--------------------------------------------------------------------------
*/

export const approveWithdrawalForAdmin = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const adminId = request.user?.userId;

    const withdrawalId = parsePositiveInteger(request.params.id);

    const adminNote = getOptionalText(request.body.adminNote);

    if (!adminId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    if (!withdrawalId) {
      return response.status(400).json({
        message: "Invalid withdrawal ID",
      });
    }

    const now = new Date();

    const updateResult = await prisma.withdrawals.updateMany({
      where: {
        id: withdrawalId,
        status: "pending",
      },

      data: {
        status: "approved",
        admin_note: adminNote,
        processed_by: adminId,
        processed_at: now,
        updated_at: now,
      },
    });

    if (updateResult.count !== 1) {
      return response.status(409).json({
        message: "Only a pending withdrawal can be approved",
      });
    }

    const withdrawal = await prisma.withdrawals.findUnique({
      where: {
        id: withdrawalId,
      },
    });

    return response.status(200).json({
      message: "Withdrawal request approved successfully",
      withdrawal,
    });
  } catch (error) {
    console.error("Approve withdrawal error:", error);

    return response.status(500).json({
      message: "Something went wrong while approving the withdrawal request",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin: Mark approved withdrawal as paid
|--------------------------------------------------------------------------
*/

export const markWithdrawalPaidForAdmin = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const adminId = request.user?.userId;

    const withdrawalId = parsePositiveInteger(request.params.id);

    const adminNote = getOptionalText(request.body.adminNote);

    if (!adminId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    if (!withdrawalId) {
      return response.status(400).json({
        message: "Invalid withdrawal ID",
      });
    }

    const now = new Date();

    const updateResult = await prisma.withdrawals.updateMany({
      where: {
        id: withdrawalId,
        status: "approved",
      },

      data: {
        status: "paid",
        ...(adminNote
          ? {
              admin_note: adminNote,
            }
          : {}),
        processed_by: adminId,
        processed_at: now,
        updated_at: now,
      },
    });

    if (updateResult.count !== 1) {
      return response.status(409).json({
        message: "Only an approved withdrawal can be marked as paid",
      });
    }

    const withdrawal = await prisma.withdrawals.findUnique({
      where: {
        id: withdrawalId,
      },
    });

    return response.status(200).json({
      message: "Withdrawal marked as paid successfully",
      withdrawal,
    });
  } catch (error) {
    console.error("Mark withdrawal paid error:", error);

    return response.status(500).json({
      message: "Something went wrong while marking the withdrawal as paid",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin: Reject withdrawal and refund wallet
|--------------------------------------------------------------------------
*/

export const rejectWithdrawalForAdmin = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const adminId = request.user?.userId;

    const withdrawalId = parsePositiveInteger(request.params.id);

    const adminNote = getOptionalText(request.body.adminNote);

    if (!adminId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    if (!withdrawalId) {
      return response.status(400).json({
        message: "Invalid withdrawal ID",
      });
    }

    if (!adminNote) {
      return response.status(400).json({
        message: "A rejection reason is required",
      });
    }

    const now = new Date();

    const result = await prisma.$transaction(async (transaction) => {
      const withdrawal = await transaction.withdrawals.findFirst({
        where: {
          id: withdrawalId,
          status: {
            in: ["pending", "approved"],
          },
        },
        select: {
          id: true,
          provider_id: true,
          wallet_id: true,
          amount: true,
          status: true,
        },
      });

      if (!withdrawal) {
        throw new Error("WITHDRAWAL_NOT_REJECTABLE");
      }

      /*
      |--------------------------------------------------------------------------
      | Claim withdrawal for rejection
      |--------------------------------------------------------------------------
      */

      const updateResult = await transaction.withdrawals.updateMany({
        where: {
          id: withdrawalId,
          status: withdrawal.status,
        },
        data: {
          status: "rejected",
          admin_note: adminNote,
          processed_by: adminId,
          processed_at: now,
          updated_at: now,
        },
      });

      if (updateResult.count !== 1) {
        throw new Error("WITHDRAWAL_NOT_REJECTABLE");
      }

      /*
      |--------------------------------------------------------------------------
      | Get wallet
      |--------------------------------------------------------------------------
      */

      const wallet = await transaction.wallets.findUnique({
        where: {
          id: withdrawal.wallet_id,
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

      const amount = Math.round(Number(withdrawal.amount) * 100) / 100;

      /*
      |--------------------------------------------------------------------------
      | Atomically restore withdrawal amount
      |--------------------------------------------------------------------------
      */

      const updatedWallet = await transaction.wallets.update({
        where: {
          id: wallet.id,
        },
        data: {
          balance: {
            increment: amount,
          },
          updated_at: now,
        },
        select: {
          id: true,
          balance: true,
          currency: true,
          is_active: true,
        },
      });

      const balanceAfter =
        Math.round(Number(updatedWallet.balance) * 100) / 100;

      const balanceBefore = Math.round((balanceAfter - amount) * 100) / 100;

      /*
      |--------------------------------------------------------------------------
      | Record wallet refund transaction
      |--------------------------------------------------------------------------
      */

      const walletTransaction = await transaction.wallet_transactions.create({
        data: {
          wallet_id: wallet.id,
          booking_id: null,
          transaction_type: "credit",
          source_type: "withdrawal_refund",
          amount: amount.toFixed(2),
          balance_before: balanceBefore.toFixed(2),
          balance_after: balanceAfter.toFixed(2),
          description: `Refund for rejected withdrawal request #${withdrawalId}`,
          created_at: now,
        },
      });

      /*
      |--------------------------------------------------------------------------
      | Return updated withdrawal
      |--------------------------------------------------------------------------
      */

      const rejectedWithdrawal = await transaction.withdrawals.findUnique({
        where: {
          id: withdrawalId,
        },
      });

      return {
        withdrawal: rejectedWithdrawal,
        wallet: updatedWallet,
        walletTransaction,
      };
    });

    return response.status(200).json({
      message: "Withdrawal rejected and wallet refunded successfully",
      withdrawal: result.withdrawal,
      wallet: {
        balance: result.wallet.balance,
        currency: result.wallet.currency,
      },
    });
  } catch (error) {
    console.error("Reject withdrawal error:", error);

    if (
      error instanceof Error &&
      error.message === "WITHDRAWAL_NOT_REJECTABLE"
    ) {
      return response.status(409).json({
        message: "Only a pending or approved withdrawal can be rejected",
      });
    }

    if (error instanceof Error && error.message === "WALLET_NOT_FOUND") {
      return response.status(404).json({
        message: "Provider wallet not found",
      });
    }

    return response.status(500).json({
      message: "Something went wrong while rejecting the withdrawal request",
    });
  }
};
