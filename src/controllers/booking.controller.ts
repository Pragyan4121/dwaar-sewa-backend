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
export const getMyBookings = async (
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

    const bookings = await prisma.bookings.findMany({
      where: {
        customer_id: customerId,
      },
      include: {
        services: true,
      },
      orderBy: {
        created_at: "desc",
      },
    });

    return response.status(200).json({
      message: "Bookings fetched successfully",
      bookings,
    });
  } catch (error) {
    console.error("Get bookings error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching bookings",
    });
  }
};
export const getMyBookingById = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const customerId = request.user?.userId;
    const bookingId = Number(request.params.id);

    if (!customerId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      return response.status(400).json({
        message: "Invalid booking ID",
      });
    }

    const booking = await prisma.bookings.findFirst({
      where: {
        id: bookingId,
        customer_id: customerId,
      },
      include: {
        services: true,
      },
    });

    if (!booking) {
      return response.status(404).json({
        message: "Booking not found",
      });
    }

    return response.status(200).json({
      message: "Booking fetched successfully",
      booking,
    });
  } catch (error) {
    console.error("Get booking error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching the booking",
    });
  }
};
export const cancelMyBooking = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const customerId = request.user?.userId;
    const bookingId = Number(request.params.id);

    if (!customerId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      return response.status(400).json({
        message: "Invalid booking ID",
      });
    }

    const booking = await prisma.bookings.findFirst({
      where: {
        id: bookingId,
        customer_id: customerId,
      },
    });

    if (!booking) {
      return response.status(404).json({
        message: "Booking not found",
      });
    }

    if (
      booking.status === "completed" ||
      booking.status === "cancelled" ||
      booking.status === "in_progress"
    ) {
      return response.status(400).json({
        message: `Booking cannot be cancelled because its status is ${booking.status}`,
      });
    }

    const cancelledBooking = await prisma.bookings.update({
      where: {
        id: bookingId,
      },
      data: {
        status: "cancelled",
        updated_at: new Date(),
      },
    });

    return response.status(200).json({
      message: "Booking cancelled successfully",
      booking: cancelledBooking,
    });
  } catch (error) {
    console.error("Cancel booking error:", error);

    return response.status(500).json({
      message: "Something went wrong while cancelling the booking",
    });
  }
};
export const getAllBookingsForAdmin = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const bookings = await prisma.bookings.findMany({
      include: {
        users_bookings_customer_idTousers: {
          select: {
            id: true,
            full_name: true,
            phone: true,
          },
        },
        users_bookings_provider_idTousers: {
          select: {
            id: true,
            full_name: true,
            phone: true,
          },
        },
        services: {
          select: {
            id: true,
            name: true,
            base_price: true,
          },
        },
      },
      orderBy: {
        created_at: "desc",
      },
    });

    return response.status(200).json({
      message: "All bookings fetched successfully",
      bookings,
    });
  } catch (error) {
    console.error("Admin bookings error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching bookings",
    });
  }
};
export const assignProviderToBooking = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const bookingId = Number(request.params.id);
    const providerId = Number(request.body.providerId);

    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      return response.status(400).json({
        message: "Invalid booking ID",
      });
    }

    if (!Number.isInteger(providerId) || providerId <= 0) {
      return response.status(400).json({
        message: "Valid provider ID is required",
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

    if (booking.status === "cancelled" || booking.status === "completed") {
      return response.status(400).json({
        message: `Provider cannot be assigned because booking status is ${booking.status}`,
      });
    }

    const providerRole = await prisma.roles.findUnique({
      where: {
        name: "provider",
      },
    });

    if (!providerRole) {
      return response.status(500).json({
        message: "Provider role is not configured in the database",
      });
    }

    const provider = await prisma.users.findFirst({
      where: {
        id: providerId,
        role_id: providerRole.id,
        is_active: true,
      },
    });

    if (!provider) {
      return response.status(404).json({
        message: "Active provider not found",
      });
    }

    const updatedBooking = await prisma.bookings.update({
      where: {
        id: bookingId,
      },
      data: {
        provider_id: providerId,
        status: "assigned",
        updated_at: new Date(),
      },
    });

    return response.status(200).json({
      message: "Provider assigned successfully",
      booking: updatedBooking,
    });
  } catch (error) {
    console.error("Assign provider error:", error);

    return response.status(500).json({
      message: "Something went wrong while assigning the provider",
    });
  }
};
