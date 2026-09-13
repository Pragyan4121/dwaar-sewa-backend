import type { Response } from "express";

import { prisma } from "../config/prisma";
import type { AuthenticatedRequest } from "../middlewares/auth.middleware";
import { PAYMENT_METHODS } from "../constants/payment-methods";
import crypto from "crypto";

function parseBookingId(value: unknown): number | null {
  const bookingId = Number(value);

  if (!Number.isInteger(bookingId) || bookingId <= 0) {
    return null;
  }

  return bookingId;
}

async function settlePaidBooking(
  bookingId: number,
  expectedPaymentMethod: "cash" | "online",
  transactionReference?: string | null,
) {
  const now = new Date();

  return prisma.$transaction(async (transaction) => {
    const booking = await transaction.bookings.findUnique({
      where: {
        id: bookingId,
      },
      select: {
        id: true,
        customer_id: true,
        provider_id: true,
        status: true,
        payment_method: true,
        final_price: true,
        customer_payable_amount: true,
      },
    });

    if (!booking) {
      throw new Error("BOOKING_NOT_FOUND");
    }

    if (booking.status !== "completed") {
      throw new Error("BOOKING_NOT_COMPLETED");
    }

    if (!booking.provider_id) {
      throw new Error("PROVIDER_NOT_ASSIGNED");
    }

    const isCashBooking = booking.payment_method === PAYMENT_METHODS.CASH;

    if (expectedPaymentMethod === "cash" && !isCashBooking) {
      throw new Error("NOT_CASH_PAYMENT");
    }

    if (expectedPaymentMethod === "online" && isCashBooking) {
      throw new Error("NOT_ONLINE_PAYMENT");
    }

    const payment = await transaction.payments.findUnique({
      where: {
        booking_id: bookingId,
      },
    });

    if (!payment) {
      throw new Error("PAYMENT_NOT_FOUND");
    }

    const paymentUpdate = await transaction.payments.updateMany({
      where: {
        booking_id: bookingId,
        payment_status: "pending",
      },
      data: {
        payment_status: "paid",
        paid_at: now,
        ...(transactionReference
          ? {
              transaction_reference: transactionReference,
            }
          : {}),
        updated_at: now,
      },
    });

    if (paymentUpdate.count !== 1) {
      const latestPayment = await transaction.payments.findUnique({
        where: {
          booking_id: bookingId,
        },
      });

      if (latestPayment?.payment_status === "paid") {
        throw new Error("PAYMENT_ALREADY_PAID");
      }

      throw new Error("PAYMENT_NOT_PENDING");
    }

    const existingEarning = await transaction.provider_earnings.findUnique({
      where: {
        booking_id: bookingId,
      },
    });

    if (existingEarning) {
      throw new Error("BOOKING_ALREADY_FINANCIALLY_SETTLED");
    }

    const commissionSetting = await transaction.system_settings.findUnique({
      where: {
        setting_key: "provider_commission_percent",
      },
    });

    if (!commissionSetting) {
      throw new Error("PROVIDER_COMMISSION_SETTING_MISSING");
    }

    const commissionPercentage = Number(commissionSetting.setting_value);

    if (
      !Number.isFinite(commissionPercentage) ||
      commissionPercentage < 0 ||
      commissionPercentage > 100
    ) {
      throw new Error("PROVIDER_COMMISSION_SETTING_INVALID");
    }

    const grossAmount =
      Math.round(Number(booking.final_price ?? 0) * 100) / 100;

    const customerPayableAmount =
      Math.round(
        Number(booking.customer_payable_amount ?? payment.amount ?? 0) * 100,
      ) / 100;

    const commissionAmount =
      Math.round(grossAmount * (commissionPercentage / 100) * 100) / 100;

    const providerNetAmount =
      Math.round((grossAmount - commissionAmount) * 100) / 100;

    const wallet = await transaction.wallets.upsert({
      where: {
        user_id: booking.provider_id,
      },
      update: {},
      create: {
        user_id: booking.provider_id,
        balance: "0.00",
        commission_due: "0.00",
        currency: "NPR",
        is_active: true,
        created_at: now,
        updated_at: now,
      },
      select: {
        id: true,
        balance: true,
        commission_due: true,
        currency: true,
        is_active: true,
      },
    });

    if (!wallet.is_active) {
      throw new Error("PROVIDER_WALLET_INACTIVE");
    }

    const balanceBefore = Math.round(Number(wallet.balance) * 100) / 100;
    const commissionDueBefore =
      Math.round(Number(wallet.commission_due) * 100) / 100;

    let balanceAfter = balanceBefore;
    let commissionDueAfter = commissionDueBefore;
    let walletTransactionAmount = 0;
    let walletTransactionType: "debit" | "credit" = "credit";
    let sourceType: string;
    let description: string;

    if (isCashBooking) {
      // Provider already collected the full amount in cash, so they owe
      // the platform the commission. Pay it out of their existing wallet
      // balance first; anything the balance can't cover becomes tracked
      // debt in commission_due instead of pushing balance negative.
      const owedAmount =
        Math.round((customerPayableAmount - providerNetAmount) * 100) / 100;

      const paidFromBalance = Math.min(balanceBefore, Math.max(owedAmount, 0));
      const remainderOwed =
        Math.round((owedAmount - paidFromBalance) * 100) / 100;

      balanceAfter = Math.round((balanceBefore - paidFromBalance) * 100) / 100;
      commissionDueAfter =
        Math.round((commissionDueBefore + remainderOwed) * 100) / 100;

      walletTransactionAmount = owedAmount;
      walletTransactionType = "debit";
      sourceType = "cash_commission_due";
      description =
        remainderOwed > 0
          ? `Cash booking #${bookingId}: Rs ${paidFromBalance.toFixed(2)} deducted from wallet, Rs ${remainderOwed.toFixed(2)} added to amount owed`
          : `Cash booking #${bookingId} commission settled from wallet balance`;
    } else {
      // Online payment: credit the provider's net earning, but pay off
      // any outstanding commission debt first before adding to balance.
      const payoff = Math.min(commissionDueBefore, providerNetAmount);
      const amountToBalance =
        Math.round((providerNetAmount - payoff) * 100) / 100;

      commissionDueAfter =
        Math.round((commissionDueBefore - payoff) * 100) / 100;
      balanceAfter = Math.round((balanceBefore + amountToBalance) * 100) / 100;

      walletTransactionAmount = providerNetAmount;
      walletTransactionType = "credit";
      sourceType = "booking_earning";
      description =
        payoff > 0
          ? `Booking #${bookingId} earning: Rs ${payoff.toFixed(2)} used to clear amount owed, Rs ${amountToBalance.toFixed(2)} credited to wallet`
          : `Earning credited for paid online booking #${bookingId}`;
    }

    const earning = await transaction.provider_earnings.create({
      data: {
        booking_id: bookingId,
        provider_id: booking.provider_id,
        gross_amount: grossAmount.toFixed(2),
        commission_percentage: commissionPercentage.toFixed(2),
        commission_amount: commissionAmount.toFixed(2),
        net_amount: providerNetAmount.toFixed(2),
        status: isCashBooking ? "cash_collected_by_provider" : "available",
        credited_at: now,
        created_at: now,
        updated_at: now,
      },
    });

    const updatedWallet = await transaction.wallets.update({
      where: {
        id: wallet.id,
      },
      data: {
        balance: balanceAfter.toFixed(2),
        commission_due: commissionDueAfter.toFixed(2),
        updated_at: now,
      },
    });

    await transaction.wallet_transactions.create({
      data: {
        wallet_id: wallet.id,
        booking_id: bookingId,
        transaction_type: walletTransactionType,
        source_type: sourceType,
        amount: Math.abs(walletTransactionAmount).toFixed(2),
        balance_before: balanceBefore.toFixed(2),
        balance_after: balanceAfter.toFixed(2),
        description,
        created_at: now,
      },
    });

    const updatedPayment = await transaction.payments.findUnique({
      where: {
        booking_id: bookingId,
      },
    });

    return {
      payment: updatedPayment,
      earning,
      wallet: updatedWallet,
    };
  });
}
/*
|--------------------------------------------------------------------------
| Verified online payment settlement
|--------------------------------------------------------------------------
|
| This helper must only be called after eSewa/Khalti/ConnectIPS has been
| verified server-side.
|--------------------------------------------------------------------------
*/

export async function settleVerifiedOnlinePayment(params: {
  bookingId: number;
  transactionReference: string;
}) {
  const bookingId = parseBookingId(params.bookingId);

  if (!bookingId) {
    throw new Error("INVALID_BOOKING_ID");
  }

  const transactionReference =
    typeof params.transactionReference === "string"
      ? params.transactionReference.trim()
      : "";

  if (!transactionReference) {
    throw new Error("TRANSACTION_REFERENCE_REQUIRED");
  }

  return settlePaidBooking(bookingId, "online", transactionReference);
}

export const confirmCashPaymentReceived = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const providerId = request.user?.userId;
    const bookingId = parseBookingId(request.params.bookingId);

    if (!providerId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    if (!bookingId) {
      return response.status(400).json({
        message: "Invalid booking ID",
      });
    }

    const booking = await prisma.bookings.findFirst({
      where: {
        id: bookingId,
        provider_id: providerId,
      },
      select: {
        id: true,
        status: true,
        payment_method: true,
      },
    });

    if (!booking) {
      return response.status(404).json({
        message: "Booking not found for this provider",
      });
    }

    if (booking.payment_method !== PAYMENT_METHODS.CASH) {
      return response.status(400).json({
        message: "Only cash payments can be manually confirmed by the provider",
      });
    }

    const result = await settlePaidBooking(bookingId, "cash");

    return response.status(200).json({
      message: "Cash payment received and confirmed successfully",
      payment: result.payment,
      earning: result.earning,
      wallet: {
        balance: result.wallet.balance,
        currency: result.wallet.currency,
      },
    });
  } catch (error) {
    console.error("Confirm cash payment error:", error);

    if (error instanceof Error && error.message === "PAYMENT_ALREADY_PAID") {
      return response.status(409).json({
        message: "Payment has already been confirmed",
      });
    }

    if (error instanceof Error && error.message === "BOOKING_NOT_COMPLETED") {
      return response.status(409).json({
        message: "Payment can only be confirmed after the service is completed",
      });
    }

    return response.status(500).json({
      message: "Something went wrong while confirming cash payment",
    });
  }
};

/*
|--------------------------------------------------------------------------
| ONLINE PAYMENT HELPERS
|--------------------------------------------------------------------------
*/

type SupportedOnlineMethod = "esewa" | "khalti" | "connectips";

function getPublicAppUrl() {
  return (
    process.env.APP_PUBLIC_URL?.replace(/\/+$/, "") || "http://localhost:8081"
  );
}

function money(value: unknown): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.round(parsed * 100) / 100;
}

async function getCustomerOnlineBooking(
  bookingId: number,
  customerId: number,
  expectedMethod: SupportedOnlineMethod,
) {
  const booking = await prisma.bookings.findFirst({
    where: {
      id: bookingId,
      customer_id: customerId,
    },

    select: {
      id: true,
      customer_id: true,
      provider_id: true,
      status: true,
      payment_method: true,
      final_price: true,
      customer_payable_amount: true,

      services: {
        select: {
          name: true,
        },
      },

      users_bookings_customer_idTousers: {
        select: {
          full_name: true,
          phone: true,
          email: true,
        },
      },

      payments: {
        select: {
          id: true,
          amount: true,
          payment_method: true,
          payment_status: true,
          transaction_reference: true,
        },
      },
    },
  });

  if (!booking) {
    throw new Error("BOOKING_NOT_FOUND");
  }

  if (booking.status !== "completed") {
    throw new Error("BOOKING_NOT_COMPLETED");
  }

  if (booking.payment_method !== expectedMethod) {
    throw new Error("PAYMENT_METHOD_MISMATCH");
  }

  if (booking.payments?.payment_status === "paid") {
    throw new Error("PAYMENT_ALREADY_PAID");
  }

  return booking;
}

function getBookingPaymentAmount(booking: {
  final_price: unknown;
  customer_payable_amount: unknown;
  payments?: {
    amount: unknown;
  } | null;
}) {
  const amount = money(
    booking.customer_payable_amount ??
      booking.payments?.amount ??
      booking.final_price ??
      0,
  );

  if (amount <= 0) {
    throw new Error("INVALID_PAYMENT_AMOUNT");
  }

  return amount;
}

/*
|--------------------------------------------------------------------------
| ESEWA INITIATE
|--------------------------------------------------------------------------
*/

export const initiateEsewaPayment = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const customerId = request.user?.userId;
    const bookingId = parseBookingId(request.params.bookingId);

    if (!customerId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    if (!bookingId) {
      return response.status(400).json({
        message: "Invalid booking ID",
      });
    }

    const booking = await getCustomerOnlineBooking(
      bookingId,
      customerId,
      "esewa",
    );

    const totalAmount = getBookingPaymentAmount(booking);

    const transactionUuid = ["DWAAR", bookingId, Date.now()].join("-");

    const productCode = process.env.ESEWA_PRODUCT_CODE || "EPAYTEST";

    const secretKey = process.env.ESEWA_SECRET_KEY;

    if (!secretKey) {
      return response.status(500).json({
        message: "eSewa payment configuration is missing",
      });
    }

    const totalAmountText = totalAmount.toFixed(2);

    const signedFieldNames = "total_amount,transaction_uuid,product_code";

    const signaturePayload =
      `total_amount=${totalAmountText},` +
      `transaction_uuid=${transactionUuid},` +
      `product_code=${productCode}`;

    const signature = crypto
      .createHmac("sha256", secretKey)
      .update(signaturePayload)
      .digest("base64");

    const appUrl = getPublicAppUrl();

    const isSandbox = process.env.ESEWA_ENV !== "production";

    const paymentUrl = isSandbox
      ? "https://rc-epay.esewa.com.np/api/epay/main/v2/form"
      : "https://epay.esewa.com.np/api/epay/main/v2/form";

    /*
    |--------------------------------------------------------------------------
    | Keep main payment pending.
    |--------------------------------------------------------------------------
    */

    await prisma.payments.update({
      where: {
        booking_id: bookingId,
      },
      data: {
        payment_status: "pending",
        transaction_reference: transactionUuid,
        paid_at: null,
        updated_at: new Date(),
      },
    });

    return response.status(200).json({
      message: "eSewa payment initialized successfully",

      gateway: "esewa",

      payment_url: paymentUrl,

      transaction_uuid: transactionUuid,

      form: {
        amount: totalAmountText,
        tax_amount: "0",
        total_amount: totalAmountText,
        transaction_uuid: transactionUuid,

        product_code: productCode,

        product_service_charge: "0",
        product_delivery_charge: "0",

        success_url:
          `${appUrl}/payment/${bookingId}` + `?method=esewa&result=success`,

        failure_url:
          `${appUrl}/payment/${bookingId}` + `?method=esewa&result=failed`,

        signed_field_names: signedFieldNames,

        signature,
      },
    });
  } catch (error) {
    console.error("Initiate eSewa payment error:", error);

    return handleGatewayError(
      response,
      error,
      "Unable to initialize eSewa payment",
    );
  }
};

/*
|--------------------------------------------------------------------------
| ESEWA VERIFY
|--------------------------------------------------------------------------
*/

export const verifyEsewaPayment = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const customerId = request.user?.userId;
    const bookingId = parseBookingId(request.params.bookingId);

    if (!customerId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    if (!bookingId) {
      return response.status(400).json({
        message: "Invalid booking ID",
      });
    }

    const booking = await getCustomerOnlineBooking(
      bookingId,
      customerId,
      "esewa",
    );

    const amount = getBookingPaymentAmount(booking);

    const transactionUuid = booking.payments?.transaction_reference;

    if (!transactionUuid) {
      return response.status(400).json({
        message: "No eSewa payment attempt was found",
      });
    }

    const productCode = process.env.ESEWA_PRODUCT_CODE || "EPAYTEST";

    const isSandbox = process.env.ESEWA_ENV !== "production";

    const statusBaseUrl = isSandbox
      ? "https://uat.esewa.com.np/api/epay/transaction/status/"
      : "https://epay.esewa.com.np/api/epay/transaction/status/";

    const query = new URLSearchParams({
      product_code: productCode,
      total_amount: amount.toFixed(2),
      transaction_uuid: transactionUuid,
    });

    const gatewayResponse = await fetch(
      `${statusBaseUrl}?${query.toString()}`,
      {
        method: "GET",
      },
    );

    if (!gatewayResponse.ok) {
      throw new Error("ESEWA_STATUS_REQUEST_FAILED");
    }

    const statusData = (await gatewayResponse.json()) as {
      status?: string;
      ref_id?: string | null;
      refId?: string | null;
    };

    const gatewayStatus = String(statusData.status || "").toUpperCase();

    if (gatewayStatus !== "COMPLETE") {
      return response.status(200).json({
        message:
          gatewayStatus === "PENDING"
            ? "eSewa payment is still pending"
            : "eSewa payment was not completed",

        verified: false,
        gateway_status: gatewayStatus || "UNKNOWN",

        payment_status: "pending",
      });
    }

    const reference = statusData.ref_id ?? statusData.refId ?? transactionUuid;

    const result = await settleVerifiedOnlinePayment({
      bookingId,
      transactionReference: String(reference),
    });

    return response.status(200).json({
      message: "eSewa payment verified successfully",

      verified: true,
      gateway_status: "COMPLETE",
      payment_status: "paid",
      payment: result.payment,
    });
  } catch (error) {
    console.error("Verify eSewa payment error:", error);

    return handleGatewayError(
      response,
      error,
      "Unable to verify eSewa payment",
    );
  }
};

/*
|--------------------------------------------------------------------------
| KHALTI SHARED INITIATE
|--------------------------------------------------------------------------
*/

async function initiateKhaltiGatewayPayment(params: {
  bookingId: number;
  customerId: number;
  method: "khalti" | "connectips";
}) {
  const booking = await getCustomerOnlineBooking(
    params.bookingId,
    params.customerId,
    params.method,
  );

  const amountNpr = getBookingPaymentAmount(booking);

  /*
  |--------------------------------------------------------------------------
  | Khalti expects amount in paisa.
  |--------------------------------------------------------------------------
  */

  const amountPaisa = Math.round(amountNpr * 100);

  const secretKey = process.env.KHALTI_SECRET_KEY;

  if (!secretKey) {
    throw new Error("KHALTI_SECRET_KEY_MISSING");
  }

  const isSandbox = process.env.KHALTI_ENV !== "production";

  const apiBaseUrl = isSandbox
    ? "https://dev.khalti.com/api/v2"
    : "https://khalti.com/api/v2";

  const appUrl = getPublicAppUrl();

  const returnUrl =
    `${appUrl}/payment/${params.bookingId}` +
    `?method=${params.method}` +
    `&result=return`;

  const customer = booking.users_bookings_customer_idTousers;

  const payload: Record<string, unknown> = {
    return_url: returnUrl,

    website_url: appUrl,

    amount: amountPaisa,

    purchase_order_id: `DWAAR-${params.bookingId}`,

    purchase_order_name: booking.services.name,

    customer_info: {
      name: customer.full_name,

      ...(customer.email
        ? {
            email: customer.email,
          }
        : {}),

      ...(customer.phone
        ? {
            phone: customer.phone,
          }
        : {}),
    },
  };

  /*
  |--------------------------------------------------------------------------
  | ConnectIPS during development
  |--------------------------------------------------------------------------
  |
  | We intentionally use Khalti KPG for this button for now.
  | Khalti checkout supports connectIPS as a funding source.
  |
  | Direct NCHL integration will replace this after NCHL provides
  | merchant credentials/APIs.
  |--------------------------------------------------------------------------
  */

  const gatewayResponse = await fetch(`${apiBaseUrl}/epayment/initiate/`, {
    method: "POST",

    headers: {
      Authorization: `Key ${secretKey}`,

      "Content-Type": "application/json",
    },

    body: JSON.stringify(payload),
  });

  const data = (await gatewayResponse.json()) as {
    pidx?: string;
    payment_url?: string;
    expires_at?: string;
    expires_in?: number;
    detail?: string;
  };

  if (!gatewayResponse.ok || !data.pidx || !data.payment_url) {
    console.error("Khalti initiate response:", data);

    throw new Error("KHALTI_INITIATE_FAILED");
  }

  await prisma.payments.update({
    where: {
      booking_id: params.bookingId,
    },

    data: {
      payment_status: "pending",

      transaction_reference: data.pidx,

      paid_at: null,

      updated_at: new Date(),
    },
  });

  return {
    gateway: params.method,

    pidx: data.pidx,

    payment_url: data.payment_url,

    expires_at: data.expires_at ?? null,

    expires_in: data.expires_in ?? null,
  };
}

/*
|--------------------------------------------------------------------------
| KHALTI INITIATE
|--------------------------------------------------------------------------
*/

export const initiateKhaltiPayment = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const customerId = request.user?.userId;

    const bookingId = parseBookingId(request.params.bookingId);

    if (!customerId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    if (!bookingId) {
      return response.status(400).json({
        message: "Invalid booking ID",
      });
    }

    const result = await initiateKhaltiGatewayPayment({
      bookingId,
      customerId,
      method: "khalti",
    });

    return response.status(200).json({
      message: "Khalti payment initialized successfully",

      ...result,
    });
  } catch (error) {
    console.error("Initiate Khalti payment error:", error);

    return handleGatewayError(
      response,
      error,
      "Unable to initialize Khalti payment",
    );
  }
};

/*
|--------------------------------------------------------------------------
| CONNECTIPS INITIATE
|--------------------------------------------------------------------------
*/

export const initiateConnectIpsPayment = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const customerId = request.user?.userId;

    const bookingId = parseBookingId(request.params.bookingId);

    if (!customerId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    if (!bookingId) {
      return response.status(400).json({
        message: "Invalid booking ID",
      });
    }

    const result = await initiateKhaltiGatewayPayment({
      bookingId,
      customerId,
      method: "connectips",
    });

    return response.status(200).json({
      message: "ConnectIPS checkout initialized successfully",

      provider: "khalti_kpg",

      ...result,
    });
  } catch (error) {
    console.error("Initiate ConnectIPS payment error:", error);

    return handleGatewayError(
      response,
      error,
      "Unable to initialize ConnectIPS payment",
    );
  }
};

/*
|--------------------------------------------------------------------------
| KHALTI / CONNECTIPS LOOKUP
|--------------------------------------------------------------------------
*/

async function verifyKhaltiGatewayPayment(params: {
  bookingId: number;
  customerId: number;
  method: "khalti" | "connectips";
}) {
  const booking = await getCustomerOnlineBooking(
    params.bookingId,
    params.customerId,
    params.method,
  );

  const pidx = booking.payments?.transaction_reference;

  if (!pidx) {
    throw new Error("KHALTI_PAYMENT_ATTEMPT_NOT_FOUND");
  }

  const secretKey = process.env.KHALTI_SECRET_KEY;

  if (!secretKey) {
    throw new Error("KHALTI_SECRET_KEY_MISSING");
  }

  const isSandbox = process.env.KHALTI_ENV !== "production";

  const apiBaseUrl = isSandbox
    ? "https://dev.khalti.com/api/v2"
    : "https://khalti.com/api/v2";

  const gatewayResponse = await fetch(`${apiBaseUrl}/epayment/lookup/`, {
    method: "POST",

    headers: {
      Authorization: `Key ${secretKey}`,

      "Content-Type": "application/json",
    },

    body: JSON.stringify({
      pidx,
    }),
  });

  const data = (await gatewayResponse.json()) as {
    pidx?: string;
    total_amount?: number;
    status?: string;
    transaction_id?: string | null;
    refunded?: boolean;
  };

  if (!gatewayResponse.ok) {
    console.error("Khalti lookup response:", data);

    throw new Error("KHALTI_LOOKUP_FAILED");
  }

  const expectedPaisa = Math.round(getBookingPaymentAmount(booking) * 100);

  const returnedPaisa = Number(data.total_amount ?? 0);

  const gatewayStatus = String(data.status || "");

  if (gatewayStatus !== "Completed") {
    return {
      verified: false,

      gateway_status: gatewayStatus || "Unknown",

      payment_status: "pending" as const,
    };
  }

  /*
  |--------------------------------------------------------------------------
  | Amount must match.
  |--------------------------------------------------------------------------
  */

  if (returnedPaisa !== expectedPaisa) {
    throw new Error("GATEWAY_AMOUNT_MISMATCH");
  }

  const transactionReference = data.transaction_id || data.pidx || pidx;

  const settlement = await settleVerifiedOnlinePayment({
    bookingId: params.bookingId,

    transactionReference,
  });

  return {
    verified: true,

    gateway_status: "Completed",

    payment_status: "paid" as const,

    payment: settlement.payment,
  };
}

/*
|--------------------------------------------------------------------------
| KHALTI VERIFY
|--------------------------------------------------------------------------
*/

export const verifyKhaltiPayment = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const customerId = request.user?.userId;

    const bookingId = parseBookingId(request.params.bookingId);

    if (!customerId || !bookingId) {
      return response.status(400).json({
        message: "Invalid payment request",
      });
    }

    const result = await verifyKhaltiGatewayPayment({
      bookingId,
      customerId,
      method: "khalti",
    });

    return response.status(200).json({
      message: result.verified
        ? "Khalti payment verified successfully"
        : "Khalti payment has not completed",

      ...result,
    });
  } catch (error) {
    console.error("Verify Khalti payment error:", error);

    return handleGatewayError(
      response,
      error,
      "Unable to verify Khalti payment",
    );
  }
};

/*
|--------------------------------------------------------------------------
| CONNECTIPS VERIFY
|--------------------------------------------------------------------------
*/

export const verifyConnectIpsPayment = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const customerId = request.user?.userId;

    const bookingId = parseBookingId(request.params.bookingId);

    if (!customerId || !bookingId) {
      return response.status(400).json({
        message: "Invalid payment request",
      });
    }

    const result = await verifyKhaltiGatewayPayment({
      bookingId,
      customerId,
      method: "connectips",
    });

    return response.status(200).json({
      message: result.verified
        ? "ConnectIPS payment verified successfully"
        : "ConnectIPS payment has not completed",

      provider: "khalti_kpg",

      ...result,
    });
  } catch (error) {
    console.error("Verify ConnectIPS payment error:", error);

    return handleGatewayError(
      response,
      error,
      "Unable to verify ConnectIPS payment",
    );
  }
};

/*
|--------------------------------------------------------------------------
| COMMON GATEWAY ERROR RESPONSE
|--------------------------------------------------------------------------
*/

function handleGatewayError(
  response: Response,
  error: unknown,
  fallback: string,
) {
  if (!(error instanceof Error)) {
    return response.status(500).json({
      message: fallback,
    });
  }

  switch (error.message) {
    case "BOOKING_NOT_FOUND":
      return response.status(404).json({
        message: "Booking not found",
      });

    case "BOOKING_NOT_COMPLETED":
      return response.status(409).json({
        message:
          "Online payment can only be completed after the service is completed",
      });

    case "PAYMENT_METHOD_MISMATCH":
      return response.status(400).json({
        message:
          "This payment gateway does not match the booking payment method",
      });

    case "PAYMENT_ALREADY_PAID":
      return response.status(409).json({
        message: "This booking has already been paid",
      });

    case "INVALID_PAYMENT_AMOUNT":
      return response.status(400).json({
        message: "The payment amount is invalid",
      });

    case "KHALTI_SECRET_KEY_MISSING":
      return response.status(503).json({
        message: "Khalti sandbox has not been configured yet",
      });

    case "GATEWAY_AMOUNT_MISMATCH":
      return response.status(409).json({
        message: "Payment amount verification failed",
      });

    default:
      return response.status(500).json({
        message: fallback,
      });
  }
}
