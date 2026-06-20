import { Response } from "express";
import { prisma } from "../config/prisma";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";

export const createPaymentForBooking = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const bookingId = Number(request.params.bookingId);
    const { paymentMethod, transactionReference } = request.body;

    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      return response.status(400).json({
        message: "Invalid booking ID",
      });
    }

    const allowedMethods = ["cash", "esewa", "khalti", "bank_transfer"];

    if (!allowedMethods.includes(paymentMethod)) {
      return response.status(400).json({
        message: "Invalid payment method",
      });
    }

    const booking = await prisma.bookings.findUnique({
      where: {
        id: bookingId,
      },
    });

    if (!booking) {
      return response.status(404).json({
        message: "Booking not found",
      });
    }

    if (booking.status !== "completed") {
      return response.status(400).json({
        message: "Only completed bookings can be marked as paid",
      });
    }

    if (!booking.final_price) {
      return response.status(400).json({
        message: "Final price is missing from the booking",
      });
    }

    const existingPayment = await prisma.payments.findUnique({
      where: {
        booking_id: bookingId,
      },
    });

    if (existingPayment) {
      return response.status(409).json({
        message: "A payment record already exists for this booking",
      });
    }

    const payment = await prisma.payments.create({
      data: {
        booking_id: bookingId,
        amount: booking.final_price,
        payment_method: paymentMethod,
        payment_status: "paid",
        transaction_reference: transactionReference || null,
        paid_at: new Date(),
      },
    });

    return response.status(201).json({
      message: "Payment recorded successfully",
      payment,
    });
  } catch (error) {
    console.error("Create payment error:", error);

    return response.status(500).json({
      message: "Something went wrong while recording payment",
    });
  }
};
