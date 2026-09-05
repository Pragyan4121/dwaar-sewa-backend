import type { Response } from "express";
import { prisma } from "../config/prisma";
import type { AuthenticatedRequest } from "../middlewares/auth.middleware";

/*
|--------------------------------------------------------------------------
| Admin: Get all reviews
|--------------------------------------------------------------------------
|
| GET /api/admin/reviews
|
| Optional query:
| ?search=Ram
| ?rating=5
| ?visibility=visible
| ?page=1
| ?limit=20
|
|--------------------------------------------------------------------------
*/

export const getAllReviewsForAdmin = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const search =
      typeof request.query.search === "string"
        ? request.query.search.trim()
        : "";

    const ratingValue =
      typeof request.query.rating === "string"
        ? request.query.rating.trim()
        : "all";

    const visibilityValue =
      typeof request.query.visibility === "string"
        ? request.query.visibility.trim().toLowerCase()
        : "all";

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

    let rating: number | undefined;

    if (ratingValue !== "all") {
      rating = Number(ratingValue);

      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return response.status(400).json({
          message: "Rating filter must be between 1 and 5",
        });
      }
    }

    let isVisible: boolean | undefined;

    if (visibilityValue !== "all") {
      if (visibilityValue === "visible") {
        isVisible = true;
      } else if (visibilityValue === "hidden") {
        isVisible = false;
      } else {
        return response.status(400).json({
          message: "Visibility must be visible, hidden, or all",
        });
      }
    }

    let matchedCustomerIds: number[] = [];
    let matchedProviderIds: number[] = [];
    let matchedBookingIds: number[] = [];

    if (search) {
      const matchingUsers = await prisma.users.findMany({
        where: {
          OR: [
            {
              full_name: {
                contains: search,
                mode: "insensitive",
              },
            },
            {
              phone: {
                contains: search,
              },
            },
            {
              email: {
                contains: search,
                mode: "insensitive",
              },
            },
          ],
        },
        select: {
          id: true,
          role_id: true,
        },
      });

      const customerRole = await prisma.roles.findUnique({
        where: {
          name: "customer",
        },
        select: {
          id: true,
        },
      });

      const providerRole = await prisma.roles.findUnique({
        where: {
          name: "provider",
        },
        select: {
          id: true,
        },
      });

      matchedCustomerIds = matchingUsers
        .filter((user) => user.role_id === customerRole?.id)
        .map((user) => user.id);

      matchedProviderIds = matchingUsers
        .filter((user) => user.role_id === providerRole?.id)
        .map((user) => user.id);

      const matchingServices = await prisma.services.findMany({
        where: {
          name: {
            contains: search,
            mode: "insensitive",
          },
        },
        select: {
          id: true,
        },
      });

      const matchedServiceIds = matchingServices.map((service) => service.id);

      if (matchedServiceIds.length > 0) {
        const matchingBookings = await prisma.bookings.findMany({
          where: {
            service_id: {
              in: matchedServiceIds,
            },
          },
          select: {
            id: true,
          },
        });

        matchedBookingIds = matchingBookings.map((booking) => booking.id);
      }
    }

    const whereCondition = {
      ...(rating !== undefined
        ? {
            rating,
          }
        : {}),

      ...(isVisible !== undefined
        ? {
            is_visible: isVisible,
          }
        : {}),

      ...(search
        ? {
            OR: [
              {
                comment: {
                  contains: search,
                  mode: "insensitive" as const,
                },
              },

              ...(matchedCustomerIds.length > 0
                ? [
                    {
                      customer_id: {
                        in: matchedCustomerIds,
                      },
                    },
                  ]
                : []),

              ...(matchedProviderIds.length > 0
                ? [
                    {
                      provider_id: {
                        in: matchedProviderIds,
                      },
                    },
                  ]
                : []),

              ...(matchedBookingIds.length > 0
                ? [
                    {
                      booking_id: {
                        in: matchedBookingIds,
                      },
                    },
                  ]
                : []),
            ],
          }
        : {}),
    };

    const [reviews, totalRecords, visibleCount, hiddenCount, ratingSummary] =
      await prisma.$transaction([
        prisma.reviews.findMany({
          where: whereCondition,
          skip,
          take: limit,
          orderBy: {
            created_at: "desc",
          },
        }),

        prisma.reviews.count({
          where: whereCondition,
        }),

        prisma.reviews.count({
          where: {
            is_visible: true,
          },
        }),

        prisma.reviews.count({
          where: {
            is_visible: false,
          },
        }),

        prisma.reviews.groupBy({
          by: ["rating"],
          _count: {
            _all: true,
          },
          orderBy: {
            rating: "desc",
          },
        }),
      ]);

    const customerIds = [
      ...new Set(reviews.map((review) => review.customer_id)),
    ];

    const providerIds = [
      ...new Set(reviews.map((review) => review.provider_id)),
    ];

    const bookingIds = [...new Set(reviews.map((review) => review.booking_id))];

    const [customers, providers, bookings] = await Promise.all([
      customerIds.length > 0
        ? prisma.users.findMany({
            where: {
              id: {
                in: customerIds,
              },
            },
            select: {
              id: true,
              full_name: true,
              phone: true,
              email: true,
              is_active: true,
            },
          })
        : [],

      providerIds.length > 0
        ? prisma.users.findMany({
            where: {
              id: {
                in: providerIds,
              },
            },
            select: {
              id: true,
              full_name: true,
              phone: true,
              email: true,
              is_active: true,
            },
          })
        : [],

      bookingIds.length > 0
        ? prisma.bookings.findMany({
            where: {
              id: {
                in: bookingIds,
              },
            },
            select: {
              id: true,
              status: true,
              service_id: true,
              service_address: true,
              service_area: true,
              completed_at: true,
              created_at: true,
            },
          })
        : [],
    ]);

    const serviceIds = [
      ...new Set(bookings.map((booking) => booking.service_id)),
    ];

    const services =
      serviceIds.length > 0
        ? await prisma.services.findMany({
            where: {
              id: {
                in: serviceIds,
              },
            },
            select: {
              id: true,
              name: true,
            },
          })
        : [];

    const reviewsWithDetails = reviews.map((review) => {
      const booking = bookings.find((item) => item.id === review.booking_id);

      const service = booking
        ? services.find((item) => item.id === booking.service_id)
        : null;

      return {
        ...review,

        customer:
          customers.find((item) => item.id === review.customer_id) ?? null,

        provider:
          providers.find((item) => item.id === review.provider_id) ?? null,

        booking: booking
          ? {
              ...booking,
              service: service ?? null,
            }
          : null,
      };
    });

    const ratingCounts = {
      5: 0,
      4: 0,
      3: 0,
      2: 0,
      1: 0,
    };

    const getGroupCount = (item: (typeof ratingSummary)[number]): number => {
      if (typeof item._count === "number") {
        return item._count;
      }

      if (item._count && typeof item._count === "object") {
        return item._count._all ?? 0;
      }

      return 0;
    };

    ratingSummary.forEach((item) => {
      if (item.rating >= 1 && item.rating <= 5) {
        ratingCounts[item.rating as keyof typeof ratingCounts] =
          getGroupCount(item);
      }
    });

    const totalReviews = ratingSummary.reduce(
      (total, item) => total + getGroupCount(item),
      0,
    );

    const totalRatingPoints = ratingSummary.reduce(
      (total, item) => total + item.rating * getGroupCount(item),
      0,
    );

    const averageRating =
      totalReviews > 0 ? totalRatingPoints / totalReviews : 0;

    const totalPages = Math.ceil(totalRecords / limit);

    return response.status(200).json({
      message: "Reviews fetched successfully",

      reviews: reviewsWithDetails,

      summary: {
        total: totalReviews,
        visible: visibleCount,
        hidden: hiddenCount,
        average_rating: Number(averageRating.toFixed(2)),
        rating_counts: ratingCounts,
      },

      filters: {
        search: search || null,
        rating: ratingValue === "all" ? "all" : rating,
        visibility: visibilityValue,
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
    console.error("Admin get reviews error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching reviews",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin: Get one review
|--------------------------------------------------------------------------
|
| GET /api/admin/reviews/:id
|
|--------------------------------------------------------------------------
*/

export const getReviewByIdForAdmin = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const reviewId = Number(request.params.id);

    if (!Number.isInteger(reviewId) || reviewId <= 0) {
      return response.status(400).json({
        message: "Invalid review ID",
      });
    }

    const review = await prisma.reviews.findUnique({
      where: {
        id: reviewId,
      },
    });

    if (!review) {
      return response.status(404).json({
        message: "Review not found",
      });
    }

    const [customer, provider, booking] = await Promise.all([
      prisma.users.findUnique({
        where: {
          id: review.customer_id,
        },
        select: {
          id: true,
          full_name: true,
          phone: true,
          email: true,
          is_active: true,
          created_at: true,
        },
      }),

      prisma.users.findUnique({
        where: {
          id: review.provider_id,
        },
        select: {
          id: true,
          full_name: true,
          phone: true,
          email: true,
          is_active: true,
          created_at: true,
        },
      }),

      prisma.bookings.findUnique({
        where: {
          id: review.booking_id,
        },
        select: {
          id: true,
          status: true,
          service_id: true,
          service_address: true,
          service_area: true,
          preferred_date: true,
          preferred_time: true,
          estimated_price: true,
          final_price: true,
          completed_at: true,
          created_at: true,
        },
      }),
    ]);

    let service = null;

    if (booking) {
      service = await prisma.services.findUnique({
        where: {
          id: booking.service_id,
        },
        select: {
          id: true,
          name: true,
          description: true,
          base_price: true,
        },
      });
    }

    return response.status(200).json({
      message: "Review fetched successfully",

      review: {
        ...review,
        customer,
        provider,
        booking: booking
          ? {
              ...booking,
              service,
            }
          : null,
      },
    });
  } catch (error) {
    console.error("Admin get review detail error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching review details",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin: Update review visibility
|--------------------------------------------------------------------------
|
| PATCH /api/admin/reviews/:id/visibility
|
| Body:
| {
|   "isVisible": false
| }
|
|--------------------------------------------------------------------------
*/

export const updateReviewVisibilityForAdmin = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const reviewId = Number(request.params.id);
    const isVisible = request.body.isVisible;

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

    if (existingReview.is_visible === isVisible) {
      return response.status(400).json({
        message: isVisible
          ? "Review is already visible"
          : "Review is already hidden",
      });
    }

    const updatedReview = await prisma.reviews.update({
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
      review: updatedReview,
    });
  } catch (error) {
    console.error("Admin update review visibility error:", error);

    return response.status(500).json({
      message: "Something went wrong while updating review visibility",
    });
  }
};
