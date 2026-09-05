import type { Response } from "express";

import { prisma } from "../config/prisma";
import type { AuthenticatedRequest } from "../middlewares/auth.middleware";

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);

  return Number.isFinite(parsed) ? parsed : 0;
}

function getStartOfToday(): Date {
  const now = new Date();

  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function getStartOfWeek(): Date {
  const now = new Date();
  const currentDay = now.getDay();
  const daysFromMonday = currentDay === 0 ? 6 : currentDay - 1;

  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - daysFromMonday,
  );
}

function getStartOfMonth(): Date {
  const now = new Date();

  return new Date(now.getFullYear(), now.getMonth(), 1);
}

const MAX_STATEMENT_RANGE_DAYS = 90;

function parseDateOnly(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toDateOnlyString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/*
|--------------------------------------------------------------------------
| Provider: Earnings statement (monthly or custom date range)
|--------------------------------------------------------------------------
|
| Defaults to the current calendar month when no dates are supplied.
| A custom range can be requested via ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD,
| capped at 90 days, so providers can pull a bank-statement-style view of
| any past period.
|--------------------------------------------------------------------------
*/

export const getProviderEarningsStatement = async (
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

    const hasCustomRange =
      request.query.startDate !== undefined ||
      request.query.endDate !== undefined;

    let rangeStart: Date;
    let rangeEnd: Date;

    if (hasCustomRange) {
      const parsedStart = parseDateOnly(request.query.startDate);
      const parsedEnd = parseDateOnly(request.query.endDate);

      if (!parsedStart || !parsedEnd) {
        return response.status(400).json({
          message:
            "startDate and endDate are required and must be in YYYY-MM-DD format",
        });
      }

      if (parsedStart.getTime() > parsedEnd.getTime()) {
        return response.status(400).json({
          message: "startDate must not be after endDate",
        });
      }

      const spanDays =
        (parsedEnd.getTime() - parsedStart.getTime()) / (1000 * 60 * 60 * 24);

      if (spanDays > MAX_STATEMENT_RANGE_DAYS) {
        return response.status(400).json({
          message: `Date range cannot exceed ${MAX_STATEMENT_RANGE_DAYS} days`,
        });
      }

      rangeStart = parsedStart;
      // Include the entire end day.
      rangeEnd = new Date(parsedEnd.getTime() + 24 * 60 * 60 * 1000 - 1);
    } else {
      const monthParam = Number(request.query.month);
      const yearParam = Number(request.query.year);

      const now = new Date();

      const year = Number.isInteger(yearParam) ? yearParam : now.getFullYear();

      const month = Number.isInteger(monthParam)
        ? monthParam - 1
        : now.getMonth();

      rangeStart = new Date(year, month, 1);
      rangeEnd = new Date(year, month + 1, 1);
    }

    const [earnings, summaryAggregate, completedJobs] = await Promise.all([
      prisma.provider_earnings.findMany({
        where: {
          provider_id: providerId,
          created_at: {
            gte: rangeStart,
            lte: rangeEnd,
          },
        },

        select: {
          id: true,
          booking_id: true,
          gross_amount: true,
          commission_percentage: true,
          commission_amount: true,
          net_amount: true,
          status: true,
          credited_at: true,
          created_at: true,

          bookings: {
            select: {
              id: true,
              service_address: true,
              service_area: true,
              preferred_date: true,
              completed_at: true,

              services: {
                select: {
                  id: true,
                  name: true,

                  service_categories: {
                    select: {
                      id: true,
                      name: true,
                    },
                  },
                },
              },

              users_bookings_customer_idTousers: {
                select: {
                  id: true,
                  full_name: true,
                  phone: true,
                },
              },
            },
          },
        },

        orderBy: {
          created_at: "desc",
        },

        take: 500,
      }),

      prisma.provider_earnings.aggregate({
        where: {
          provider_id: providerId,
          created_at: {
            gte: rangeStart,
            lte: rangeEnd,
          },
        },
        _sum: {
          gross_amount: true,
          commission_amount: true,
          net_amount: true,
        },
      }),

      prisma.provider_earnings.count({
        where: {
          provider_id: providerId,
          created_at: {
            gte: rangeStart,
            lte: rangeEnd,
          },
        },
      }),
    ]);

    const totalGross = toNumber(summaryAggregate._sum.gross_amount);
    const totalCommission = toNumber(summaryAggregate._sum.commission_amount);

    const averageCommissionPercentage =
      totalGross > 0
        ? Math.round((totalCommission / totalGross) * 10000) / 100
        : 0;

    return response.status(200).json({
      message: "Provider earnings statement fetched successfully",

      range: {
        start_date: toDateOnlyString(rangeStart),
        end_date: toDateOnlyString(
          new Date(
            rangeEnd.getTime() - (hasCustomRange ? 0 : 24 * 60 * 60 * 1000),
          ),
        ),
        is_custom_range: hasCustomRange,
      },

      summary: {
        completed_jobs: completedJobs,
        total_gross: totalGross,
        total_commission: totalCommission,
        total_net: toNumber(summaryAggregate._sum.net_amount),
        average_commission_percentage: averageCommissionPercentage,
      },

      earnings,
    });
  } catch (error) {
    console.error("Get provider earnings statement error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching the earnings statement",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Provider: Earnings summary
|--------------------------------------------------------------------------
*/

export const getProviderEarningsSummary = async (
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

    const todayStart = getStartOfToday();
    const weekStart = getStartOfWeek();
    const monthStart = getStartOfMonth();

    const [
      wallet,
      totalAggregate,
      todayAggregate,
      weekAggregate,
      monthAggregate,
      completedJobs,
      pendingWithdrawals,
    ] = await Promise.all([
      prisma.wallets.findUnique({
        where: {
          user_id: providerId,
        },
        select: {
          id: true,
          balance: true,
          currency: true,
          is_active: true,
          created_at: true,
          updated_at: true,
        },
      }),

      prisma.provider_earnings.aggregate({
        where: {
          provider_id: providerId,
        },
        _sum: {
          gross_amount: true,
          commission_amount: true,
          net_amount: true,
        },
      }),

      prisma.provider_earnings.aggregate({
        where: {
          provider_id: providerId,
          credited_at: {
            gte: todayStart,
          },
        },
        _sum: {
          net_amount: true,
        },
      }),

      prisma.provider_earnings.aggregate({
        where: {
          provider_id: providerId,
          credited_at: {
            gte: weekStart,
          },
        },
        _sum: {
          net_amount: true,
        },
      }),

      prisma.provider_earnings.aggregate({
        where: {
          provider_id: providerId,
          credited_at: {
            gte: monthStart,
          },
        },
        _sum: {
          net_amount: true,
        },
      }),

      prisma.provider_earnings.count({
        where: {
          provider_id: providerId,
        },
      }),

      prisma.withdrawals.aggregate({
        where: {
          provider_id: providerId,
          status: "pending",
        },
        _sum: {
          amount: true,
        },
      }),
    ]);

    return response.status(200).json({
      message: "Provider earnings summary fetched successfully",

      wallet: {
        balance: toNumber(wallet?.balance),
        currency: wallet?.currency ?? "NPR",
        is_active: wallet?.is_active ?? true,
        available_balance: Math.max(toNumber(wallet?.balance), 0),
        amount_owed_to_platform: Math.max(-toNumber(wallet?.balance), 0),
      },

      earnings: {
        today: toNumber(todayAggregate._sum.net_amount),
        this_week: toNumber(weekAggregate._sum.net_amount),
        this_month: toNumber(monthAggregate._sum.net_amount),
        total_gross: toNumber(totalAggregate._sum.gross_amount),
        total_commission: toNumber(totalAggregate._sum.commission_amount),
        total_net: toNumber(totalAggregate._sum.net_amount),
        completed_jobs: completedJobs,
      },

      withdrawals: {
        pending_amount: toNumber(pendingWithdrawals._sum.amount),
      },
    });
  } catch (error) {
    console.error("Get provider earnings summary error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching provider earnings",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Provider: Earnings history
|--------------------------------------------------------------------------
*/

export const getProviderEarningsHistory = async (
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

    const [earnings, total] = await Promise.all([
      prisma.provider_earnings.findMany({
        where: {
          provider_id: providerId,
        },

        select: {
          id: true,
          booking_id: true,
          gross_amount: true,
          commission_percentage: true,
          commission_amount: true,
          net_amount: true,
          status: true,
          credited_at: true,
          created_at: true,

          bookings: {
            select: {
              id: true,
              service_address: true,
              service_area: true,
              preferred_date: true,
              completed_at: true,

              services: {
                select: {
                  id: true,
                  name: true,

                  service_categories: {
                    select: {
                      id: true,
                      name: true,
                    },
                  },
                },
              },

              users_bookings_customer_idTousers: {
                select: {
                  id: true,
                  full_name: true,
                },
              },
            },
          },
        },

        orderBy: {
          created_at: "desc",
        },

        skip,
        take: limit,
      }),

      prisma.provider_earnings.count({
        where: {
          provider_id: providerId,
        },
      }),
    ]);

    return response.status(200).json({
      message: "Provider earnings history fetched successfully",
      earnings,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Get provider earnings history error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching earnings history",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Provider: Wallet transaction history
|--------------------------------------------------------------------------
*/

export const getProviderWalletTransactions = async (
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

    const wallet = await prisma.wallets.findUnique({
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
      return response.status(200).json({
        message: "Provider wallet transactions fetched successfully",
        wallet: {
          balance: 0,
          currency: "NPR",
          is_active: true,
          available_balance: 0,
          amount_owed_to_platform: 0,
        },
        transactions: [],
        pagination: {
          page,
          limit,
          total: 0,
          total_pages: 0,
        },
      });
    }

    const skip = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      prisma.wallet_transactions.findMany({
        where: {
          wallet_id: wallet.id,
        },

        select: {
          id: true,
          booking_id: true,
          transaction_type: true,
          source_type: true,
          amount: true,
          balance_before: true,
          balance_after: true,
          description: true,
          created_at: true,

          bookings: {
            select: {
              id: true,

              services: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },

        orderBy: {
          created_at: "desc",
        },

        skip,
        take: limit,
      }),

      prisma.wallet_transactions.count({
        where: {
          wallet_id: wallet.id,
        },
      }),
    ]);

    return response.status(200).json({
      message: "Provider wallet transactions fetched successfully",

      wallet: {
        balance: toNumber(wallet.balance),
        currency: wallet.currency,
        is_active: wallet.is_active,
        available_balance: Math.max(toNumber(wallet.balance), 0),
        amount_owed_to_platform: Math.max(-toNumber(wallet.balance), 0),
      },

      transactions,

      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Get provider wallet transactions error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching wallet transactions",
    });
  }
};
