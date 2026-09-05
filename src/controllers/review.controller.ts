import type { Response } from "express";
import { prisma } from "../config/prisma";
import type { AuthenticatedRequest } from "../middlewares/auth.middleware";

/*
|--------------------------------------------------------------------------
| Customer: Create review for a completed booking
|--------------------------------------------------------------------------
*/

export const createReview = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const customerId = request.user?.userId;
    const bookingId = Number(request.params.bookingId);
    const rating = Number(request.body.rating);
    const comment = request.body.comment;

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

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return response.status(400).json({
        message: "Rating must be a whole number between 1 and 5",
      });
    }

    if (
      comment !== undefined &&
      comment !== null &&
      typeof comment !== "string"
    ) {
      return response.status(400).json({
        message: "Comment must be text",
      });
    }

    if (typeof comment === "string" && comment.trim().length > 1000) {
      return response.status(400).json({
        message: "Comment must not exceed 1000 characters",
      });
    }

    const booking = await prisma.bookings.findFirst({
      where: {
        id: bookingId,
        customer_id: customerId,
      },
      select: {
        id: true,
        customer_id: true,
        provider_id: true,
        service_id: true,
        status: true,
        completed_at: true,
        services: {
          select: {
            id: true,
            name: true,
            category_id: true,
            service_categories: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
          },
        },
      },
    });

    if (!booking) {
      return response.status(404).json({
        message: "Booking not found",
      });
    }

    if (booking.status !== "completed") {
      return response.status(400).json({
        message: "Only completed bookings can be reviewed",
      });
    }

    if (!booking.provider_id) {
      return response.status(400).json({
        message: "This booking does not have a service provider",
      });
    }

    const existingReview = await prisma.reviews.findUnique({
      where: {
        booking_id: bookingId,
      },
    });

    if (existingReview) {
      return response.status(409).json({
        message: "A review already exists for this booking",
      });
    }

    const review = await prisma.reviews.create({
      data: {
        booking_id: booking.id,
        customer_id: customerId,
        provider_id: booking.provider_id,
        rating,
        comment:
          typeof comment === "string" && comment.trim().length > 0
            ? comment.trim()
            : null,
        is_visible: true,
        updated_at: new Date(),
      },
      include: {
        bookings: {
          select: {
            id: true,
            status: true,
            completed_at: true,
            services: {
              select: {
                id: true,
                name: true,
                category_id: true,
                service_categories: {
                  select: {
                    id: true,
                    name: true,
                    slug: true,
                  },
                },
              },
            },
          },
        },
        users_reviews_provider_idTousers: {
          select: {
            id: true,
            full_name: true,
            phone: true,
          },
        },
      },
    });

    return response.status(201).json({
      message: "Review created successfully",
      review,
    });
  } catch (error) {
    console.error("Create review error:", error);

    return response.status(500).json({
      message: "Something went wrong while creating the review",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin: Update review visibility
|--------------------------------------------------------------------------
*/

export const updateReviewVisibility = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const reviewId = Number(request.params.id);
    const { isVisible } = request.body;

    if (!Number.isInteger(reviewId) || reviewId <= 0) {
      return response.status(400).json({
        message: "Invalid review ID",
      });
    }

    if (typeof isVisible !== "boolean") {
      return response.status(400).json({
        message: "isVisible must be true or false",
      });
    }

    const existingReview = await prisma.reviews.findUnique({
      where: {
        id: reviewId,
      },
    });

    if (!existingReview) {
      return response.status(404).json({
        message: "Review not found",
      });
    }

    const review = await prisma.reviews.update({
      where: {
        id: reviewId,
      },
      data: {
        is_visible: isVisible,
        updated_at: new Date(),
      },
    });

    return response.status(200).json({
      message: isVisible
        ? "Review made visible successfully"
        : "Review hidden successfully",
      review,
    });
  } catch (error) {
    console.error("Update review visibility error:", error);

    return response.status(500).json({
      message: "Something went wrong while updating the review",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin: Get all reviews
|--------------------------------------------------------------------------
*/

export const getAllReviewsForAdmin = async (
  _request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const reviews = await prisma.reviews.findMany({
      include: {
        users_reviews_customer_idTousers: {
          select: {
            id: true,
            full_name: true,
            phone: true,
          },
        },
        users_reviews_provider_idTousers: {
          select: {
            id: true,
            full_name: true,
            phone: true,
          },
        },
        bookings: {
          select: {
            id: true,
            service_id: true,
            status: true,
            completed_at: true,
            services: {
              select: {
                id: true,
                name: true,
                category_id: true,
                service_categories: {
                  select: {
                    id: true,
                    name: true,
                    slug: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        created_at: "desc",
      },
    });

    return response.status(200).json({
      message: "All reviews fetched successfully",
      reviews,
    });
  } catch (error) {
    console.error("Get all reviews error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching reviews",
    });
  }
};
