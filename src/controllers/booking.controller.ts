import { Response } from "express";
import { prisma } from "../config/prisma";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";

export const createBooking = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const customerId = request.user?.userId;

    const {
      serviceId,
      serviceAddress,
      serviceArea,
      preferredDate,
      preferredTime,
      notes,
    } = request.body;

    if (!customerId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    if (!serviceId || !serviceAddress || !serviceArea || !preferredDate) {
      return response.status(400).json({
        message:
          "Service, address, service area and preferred date are required",
      });
    }

    const service = await prisma.services.findUnique({
      where: {
        id: Number(serviceId),
      },
    });

    if (!service || !service.is_active) {
      return response.status(404).json({
        message: "Service not found or inactive",
      });
    }

    const booking = await prisma.bookings.create({
      data: {
        customer_id: customerId,
        service_id: Number(serviceId),
        service_address: serviceAddress,
        service_area: serviceArea,
        preferred_date: new Date(preferredDate),
        preferred_time: preferredTime
          ? new Date(`1970-01-01T${preferredTime}`)
          : null,
        notes: notes || null,
        status: "pending",
        estimated_price: service.base_price,
      },
    });

    return response.status(201).json({
      message: "Booking created successfully",
      booking,
    });
  } catch (error) {
    console.error("Create booking error:", error);

    return response.status(500).json({
      message: "Something went wrong while creating the booking",
    });
  }
};
