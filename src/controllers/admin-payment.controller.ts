import type { Response } from "express";
import { prisma } from "../config/prisma";
import type { AuthenticatedRequest } from "../middlewares/auth.middleware";

const allowedPaymentStatuses = [
  "pending",
  "paid",
  "failed",
  "refunded",
] as const;

type PaymentStatus = (typeof allowedPaymentStatuses)[number];

/*
|--------------------------------------------------------------------------
| Admin: Get all payments
|--------------------------------------------------------------------------
|
| GET /api/admin/payments
|
| Optional query:
| ?search=Ram
| ?status=paid
| ?method=cash
| ?dateFrom=2026-07-01
| ?dateTo=2026-07-31
| ?page=1
| ?limit=20
|
|--------------------------------------------------------------------------
*/

export const getAllPaymentsForAdmin = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const search =
      typeof request.query.search === "string"
        ? request.query.search.trim()
        : "";

    const statusValue =
      typeof request.query.status === "string"
        ? request.query.status.trim().toLowerCase()
        : "all";

    const methodValue =
      typeof request.query.method === "string"
        ? request.query.method.trim().toLowerCase()
        : "all";

    const dateFromValue = request.query.dateFrom;
    const dateToValue = request.query.dateTo;

    const requestedPage = Number(request.query.page ?? 1);

    const requestedLimit = Number(request.query.limit ?? 20);

    const page =
      Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;

    const limit =
      Number.isInteger(requestedLimit) &&
      requestedLimit > 0 &&
      requestedLimit <= 100
        ? requestedLimit
        : 20;

    const skip = (page - 1) * limit;

    let paymentStatus: PaymentStatus | undefined;

    if (statusValue && statusValue !== "all") {
      if (!allowedPaymentStatuses.includes(statusValue as PaymentStatus)) {
        return response.status(400).json({
          message: "Invalid payment status",
        });
      }

      paymentStatus = statusValue as PaymentStatus;
    }

    let dateFrom: Date | undefined;
    let dateTo: Date | undefined;

    if (typeof dateFromValue === "string" && dateFromValue.trim()) {
      dateFrom = new Date(dateFromValue);

      if (Number.isNaN(dateFrom.getTime())) {
        return response.status(400).json({
          message: "Invalid start date",
        });
      }

      dateFrom.setHours(0, 0, 0, 0);
    }

    if (typeof dateToValue === "string" && dateToValue.trim()) {
      dateTo = new Date(dateToValue);

      if (Number.isNaN(dateTo.getTime())) {
        return response.status(400).json({
          message: "Invalid end date",
        });
      }

      dateTo.setHours(23, 59, 59, 999);
    }

    if (dateFrom && dateTo && dateFrom.getTime() > dateTo.getTime()) {
      return response.status(400).json({
        message: "Start date cannot be after end date",
      });
    }

    const whereCondition = {
      ...(paymentStatus
        ? {
            payment_status: paymentStatus,
          }
        : {}),

      ...(methodValue !== "all"
        ? {
            payment_method: {
              equals: methodValue,
              mode: "insensitive" as const,
            },
          }
        : {}),

      ...(dateFrom || dateTo
        ? {
            created_at: {
              ...(dateFrom
                ? {
                    gte: dateFrom,
                  }
                : {}),
              ...(dateTo
                ? {
                    lte: dateTo,
                  }
                : {}),
            },
          }
        : {}),

      ...(search
        ? {
            OR: [
              {
                payment_method: {
                  contains: search,
                  mode: "insensitive" as const,
                },
              },
              {
                bookings: {
                  is: {
                    OR: [
                      {
                        service_address: {
                          contains: search,
                          mode: "insensitive" as const,
                        },
                      },
                      {
                        service_area: {
                          contains: search,
                          mode: "insensitive" as const,
                        },
                      },
                      {
                        users_bookings_customer_idTousers: {
                          is: {
                            OR: [
                              {
                                full_name: {
                                  contains: search,
                                  mode: "insensitive" as const,
                                },
                              },
                              {
                                phone: {
                                  contains: search,
                                },
                              },
                            ],
                          },
                        },
                      },
                      {
                        users_bookings_provider_idTousers: {
                          is: {
                            OR: [
                              {
                                full_name: {
                                  contains: search,
                                  mode: "insensitive" as const,
                                },
                              },
                              {
                                phone: {
                                  contains: search,
                                },
                              },
                            ],
                          },
                        },
                      },
                      {
                        services: {
                          is: {
                            name: {
                              contains: search,
                              mode: "insensitive" as const,
                            },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [
      payments,
      totalRecords,
      pendingCount,
      paidCount,
      failedCount,
      refundedCount,
      paidAmount,
      refundedAmount,
    ] = await prisma.$transaction([
      prisma.payments.findMany({
        where: whereCondition,
        skip,
        take: limit,
        orderBy: {
          created_at: "desc",
        },
        include: {
          bookings: {
            select: {
              id: true,
              status: true,
              service_address: true,
              service_area: true,
              estimated_price: true,
              final_price: true,
              created_at: true,

              services: {
                select: {
                  id: true,
                  name: true,
                },
              },

              users_bookings_customer_idTousers: {
                select: {
                  id: true,
                  full_name: true,
                  phone: true,
                  email: true,
                },
              },

              users_bookings_provider_idTousers: {
                select: {
                  id: true,
                  full_name: true,
                  phone: true,
                  email: true,
                },
              },
            },
          },
        },
      }),

      prisma.payments.count({
        where: whereCondition,
      }),

      prisma.payments.count({
        where: {
          payment_status: "pending",
        },
      }),

      prisma.payments.count({
        where: {
          payment_status: "paid",
        },
      }),

      prisma.payments.count({
        where: {
          payment_status: "failed",
        },
      }),

      prisma.payments.count({
        where: {
          payment_status: "refunded",
        },
      }),

      prisma.payments.aggregate({
        where: {
          payment_status: "paid",
        },
        _sum: {
          amount: true,
        },
      }),

      prisma.payments.aggregate({
        where: {
          payment_status: "refunded",
        },
        _sum: {
          amount: true,
        },
      }),
    ]);

    const paymentMethods = await prisma.payments.findMany({
      distinct: ["payment_method"],
      select: {
        payment_method: true,
      },
      orderBy: {
        payment_method: "asc",
      },
    });

    const totalPages = Math.ceil(totalRecords / limit);

    return response.status(200).json({
      message: "Payments fetched successfully",

      payments,

      summary: {
        pending: pendingCount,
        paid: paidCount,
        failed: failedCount,
        refunded: refundedCount,
        total_paid_amount: paidAmount._sum.amount ?? 0,
        total_refunded_amount: refundedAmount._sum.amount ?? 0,
      },

      payment_methods: paymentMethods
        .map((payment) => payment.payment_method)
        .filter(Boolean),

      filters: {
        search: search || null,
        status: statusValue,
        method: methodValue,
        date_from: dateFromValue ?? null,
        date_to: dateToValue ?? null,
      },

      pagination: {
        page,
        limit,
        total_records: totalRecords,
        total_pages: totalPages,
        has_next_page: page < totalPages,
        has_previous_page: page > 1,
      },
    });
  } catch (error) {
    console.error("Admin get payments error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching payments",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin: Get one payment
|--------------------------------------------------------------------------
|
| GET /api/admin/payments/:id
|
|--------------------------------------------------------------------------
*/

export const getPaymentByIdForAdmin = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const paymentId = Number(request.params.id);

    if (!Number.isInteger(paymentId) || paymentId <= 0) {
      return response.status(400).json({
        message: "Invalid payment ID",
      });
    }

    const payment = await prisma.payments.findUnique({
      where: {
        id: paymentId,
      },
      include: {
        bookings: {
          include: {
            services: {
              select: {
                id: true,
                name: true,
                description: true,
                base_price: true,
              },
            },

            users_bookings_customer_idTousers: {
              select: {
                id: true,
                full_name: true,
                phone: true,
                email: true,
                is_active: true,
              },
            },

            users_bookings_provider_idTousers: {
              select: {
                id: true,
                full_name: true,
                phone: true,
                email: true,
                is_active: true,
              },
            },
          },
        },
      },
    });

    if (!payment) {
      return response.status(404).json({
        message: "Payment not found",
      });
    }

    return response.status(200).json({
      message: "Payment fetched successfully",
      payment,
    });
  } catch (error) {
    console.error("Admin get payment detail error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching payment details",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin: Update payment status
|--------------------------------------------------------------------------
|
| PATCH /api/admin/payments/:id/status
|
| Body:
| {
|   "status": "paid"
| }
|
|--------------------------------------------------------------------------
*/

/*
|--------------------------------------------------------------------------
| Admin: Providers who owe commission on cash bookings
|--------------------------------------------------------------------------
|
| GET /api/admin/payments/cash-commission-due
|
| When a customer pays a provider in cash, the platform's commission is
| deducted straight from the provider's wallet instead of being withheld
| upfront. If the wallet doesn't have enough balance, it goes negative —
| this lists every provider currently in that state, i.e. the amount each
| one still owes the platform, and it self-clears as soon as the provider
| completes enough online-paid (eSewa/Khalti/Connect IPS) bookings for the
| wallet to climb back to zero.
|--------------------------------------------------------------------------
*/

export const getCashCommissionDueForAdmin = async (
  _request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const negativeWallets = await prisma.wallets.findMany({
      where: {
        balance: {
          lt: 0,
        },
      },
      select: {
        id: true,
        balance: true,
        currency: true,
        updated_at: true,
        users: {
          select: {
            id: true,
            full_name: true,
            phone: true,
            email: true,
          },
        },
      },
      orderBy: {
        balance: "asc",
      },
    });

    const totalOwed = negativeWallets.reduce(
      (sum, wallet) => sum + Math.abs(Number(wallet.balance)),
      0,
    );

    return response.status(200).json({
      message: "Cash commission due fetched successfully",

      summary: {
        providers_with_dues: negativeWallets.length,
        total_amount_owed: Math.round(totalOwed * 100) / 100,
      },

      providers: negativeWallets.map((wallet) => ({
        provider_id: wallet.users.id,
        full_name: wallet.users.full_name,
        phone: wallet.users.phone,
        email: wallet.users.email,
        wallet_id: wallet.id,
        currency: wallet.currency,
        amount_owed: Math.abs(Number(wallet.balance)).toFixed(2),
        last_updated: wallet.updated_at,
      })),
    });
  } catch (error) {
    console.error("Admin get cash commission due error:", error);

    return response.status(500).json({
      message:
        "Something went wrong while fetching outstanding cash commission",
    });
  }
};
export const updatePaymentStatusForAdmin = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const paymentId = Number(request.params.id);

    const status =
      typeof request.body.status === "string"
        ? request.body.status.trim().toLowerCase()
        : "";

    if (!Number.isInteger(paymentId) || paymentId <= 0) {
      return response.status(400).json({
        message: "Invalid payment ID",
      });
    }

    if (!allowedPaymentStatuses.includes(status as PaymentStatus)) {
      return response.status(400).json({
        message: "Status must be pending, paid, failed, or refunded",
      });
    }

    const existingPayment = await prisma.payments.findUnique({
      where: {
        id: paymentId,
      },
      include: {
        bookings: {
          select: {
            id: true,
            provider_id: true,
            status: true,
          },
        },
      },
    });

    if (!existingPayment) {
      return response.status(404).json({
        message: "Payment not found",
      });
    }

    if (existingPayment.payment_status === status) {
      return response.status(400).json({
        message: `Payment is already marked as ${status}`,
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Protect financially settled payments
    |--------------------------------------------------------------------------
    |
    | Booking completion already performs the complete settlement:
    | payment + provider earning + commission + wallet transaction.
    |
    | Therefore this generic admin endpoint must NOT manually turn an
    | unsettled payment into "paid", because doing so would bypass commission
    | and provider wallet settlement.
    |
    |--------------------------------------------------------------------------
    */

    if (status === "paid") {
      return response.status(400).json({
        message:
          "Payments cannot be manually marked as paid. A payment becomes paid automatically when the booking settlement is completed.",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Paid payments can only move to refunded
    |--------------------------------------------------------------------------
    */

    if (existingPayment.payment_status === "paid" && status !== "refunded") {
      return response.status(400).json({
        message: "A paid payment can only be changed to refunded.",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Refunded payments are final
    |--------------------------------------------------------------------------
    */

    if (existingPayment.payment_status === "refunded") {
      return response.status(400).json({
        message: "A refunded payment cannot be changed again.",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Refund settlement
    |--------------------------------------------------------------------------
    */

    if (status === "refunded") {
      if (existingPayment.payment_status !== "paid") {
        return response.status(400).json({
          message: "Only a paid payment can be refunded.",
        });
      }

      const bookingId = existingPayment.booking_id;
      const providerId = existingPayment.bookings.provider_id;

      if (!providerId) {
        return response.status(400).json({
          message:
            "This payment cannot be refunded because the booking has no assigned provider.",
        });
      }

      const result = await prisma.$transaction(async (transaction) => {
        /*
        |--------------------------------------------------------------------------
        | Prevent duplicate refund processing
        |--------------------------------------------------------------------------
        */

        const paymentUpdateResult = await transaction.payments.updateMany({
          where: {
            id: paymentId,
            payment_status: "paid",
          },
          data: {
            payment_status: "refunded",
            updated_at: new Date(),
          },
        });

        if (paymentUpdateResult.count !== 1) {
          throw new Error("PAYMENT_ALREADY_CHANGED");
        }

        /*
        |--------------------------------------------------------------------------
        | Find the provider earning created by booking completion
        |--------------------------------------------------------------------------
        */

        const earning = await transaction.provider_earnings.findUnique({
          where: {
            booking_id: bookingId,
          },
        });

        if (!earning) {
          throw new Error("PROVIDER_EARNING_NOT_FOUND");
        }

        if (earning.status === "refunded") {
          throw new Error("EARNING_ALREADY_REFUNDED");
        }

        /*
        |--------------------------------------------------------------------------
        | Find original booking wallet settlement
        |--------------------------------------------------------------------------
        |
        | We reverse the exact recorded transaction instead of recalculating
        | commission using today's settings.
        |
        |--------------------------------------------------------------------------
        */

        const originalWalletTransaction =
          await transaction.wallet_transactions.findFirst({
            where: {
              booking_id: bookingId,
              source_type: {
                in: [
                  "booking_earning",
                  "cash_commission_due",
                  "cash_booking_adjustment",
                ],
              },
            },
            orderBy: {
              id: "asc",
            },
          });

        if (!originalWalletTransaction) {
          throw new Error("ORIGINAL_WALLET_TRANSACTION_NOT_FOUND");
        }

        /*
        |--------------------------------------------------------------------------
        | Prevent duplicate wallet reversal
        |--------------------------------------------------------------------------
        */

        const existingRefundReversal =
          await transaction.wallet_transactions.findFirst({
            where: {
              booking_id: bookingId,
              source_type: "refund_reversal",
            },
          });

        if (existingRefundReversal) {
          throw new Error("REFUND_ALREADY_REVERSED");
        }

        const originalAmount =
          Math.round(Number(originalWalletTransaction.amount) * 100) / 100;

        /*
        |--------------------------------------------------------------------------
        | Calculate exact opposite movement
        |--------------------------------------------------------------------------
        |
        | Original credit  -> refund debit
        | Original debit   -> refund credit
        |
        |--------------------------------------------------------------------------
        */

        const reversalTransactionType =
          originalWalletTransaction.transaction_type === "credit"
            ? "debit"
            : "credit";

        const reversalDelta =
          reversalTransactionType === "credit"
            ? originalAmount
            : -originalAmount;

        /*
        |--------------------------------------------------------------------------
        | Update wallet atomically
        |--------------------------------------------------------------------------
        |
        | Using increment prevents lost updates when another legitimate wallet
        | transaction occurs at nearly the same time.
        |
        |--------------------------------------------------------------------------
        */

        const updatedWallet = await transaction.wallets.update({
          where: {
            id: originalWalletTransaction.wallet_id,
          },
          data: {
            balance: {
              increment: reversalDelta,
            },
            updated_at: new Date(),
          },
        });

        const balanceAfter =
          Math.round(Number(updatedWallet.balance) * 100) / 100;

        const balanceBefore =
          Math.round((balanceAfter - reversalDelta) * 100) / 100;

        /*
        |--------------------------------------------------------------------------
        | Mark earning as refunded
        |--------------------------------------------------------------------------
        */

        const refundedEarning = await transaction.provider_earnings.update({
          where: {
            booking_id: bookingId,
          },
          data: {
            status: "refunded",
            updated_at: new Date(),
          },
        });

        /*
        |--------------------------------------------------------------------------
        | Record refund reversal in wallet history
        |--------------------------------------------------------------------------
        */

        const refundWalletTransaction =
          await transaction.wallet_transactions.create({
            data: {
              wallet_id: originalWalletTransaction.wallet_id,
              booking_id: bookingId,

              transaction_type: reversalTransactionType,

              source_type: "refund_reversal",

              amount: originalAmount.toFixed(2),

              balance_before: balanceBefore.toFixed(2),

              balance_after: balanceAfter.toFixed(2),

              description: `Refund reversal for booking #${bookingId}`,

              created_at: new Date(),
            },
          });

        const refundedPayment = await transaction.payments.findUnique({
          where: {
            id: paymentId,
          },
          include: {
            bookings: {
              select: {
                id: true,
                customer_id: true,
                provider_id: true,
                status: true,
                services: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        });

        return {
          payment: refundedPayment,
          earning: refundedEarning,
          wallet: updatedWallet,
          walletTransaction: refundWalletTransaction,
        };
      });

      return response.status(200).json({
        message:
          "Payment refunded and provider financial settlement reversed successfully",
        payment: result.payment,
        refund: {
          earning_status: result.earning.status,
          wallet_balance: Number(result.wallet.balance),
          wallet_transaction: result.walletTransaction,
        },
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Non-financial pending / failed changes
    |--------------------------------------------------------------------------
    */

    if (
      existingPayment.payment_status !== "pending" &&
      existingPayment.payment_status !== "failed"
    ) {
      return response.status(400).json({
        message:
          "Only pending and failed payments can be changed through this status update.",
      });
    }

    if (status !== "pending" && status !== "failed") {
      return response.status(400).json({
        message:
          "Pending or failed payments may only be changed between pending and failed.",
      });
    }

    const now = new Date();

    const updatedPayment = await prisma.payments.update({
      where: {
        id: paymentId,
      },
      data: {
        payment_status: status,
        paid_at: null,
        updated_at: now,
      },
      include: {
        bookings: {
          select: {
            id: true,
            customer_id: true,
            provider_id: true,
            status: true,
            services: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    return response.status(200).json({
      message: "Payment status updated successfully",
      payment: updatedPayment,
    });
  } catch (error) {
    console.error("Admin update payment status error:", error);

    if (error instanceof Error) {
      if (
        error.message === "PAYMENT_ALREADY_CHANGED" ||
        error.message === "EARNING_ALREADY_REFUNDED" ||
        error.message === "REFUND_ALREADY_REVERSED"
      ) {
        return response.status(409).json({
          message:
            "This payment has already been refunded or changed by another request.",
        });
      }

      if (error.message === "PROVIDER_EARNING_NOT_FOUND") {
        return response.status(409).json({
          message:
            "Refund could not be completed because the provider earning record is missing.",
        });
      }

      if (error.message === "ORIGINAL_WALLET_TRANSACTION_NOT_FOUND") {
        return response.status(409).json({
          message:
            "Refund could not be completed because the original wallet settlement could not be found.",
        });
      }
    }

    return response.status(500).json({
      message: "Something went wrong while updating payment status",
    });
  }
};
