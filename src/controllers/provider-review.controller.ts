import { Request, Response } from "express";
import { prisma } from "../config/prisma";

export const getProviderReviews = async (
  request: Request,
  response: Response,
) => {
  try {
    const providerId = Number(request.params.providerId);

    if (!Number.isInteger(providerId) || providerId <= 0) {
      return response.status(400).json({
        message: "Invalid provider ID",
      });
    }

    const provider = await prisma.users.findUnique({
      where: {
        id: providerId,
      },
      select: {
        id: true,
        full_name: true,
        role_id: true,
        is_active: true,
      },
    });

    if (!provider || provider.role_id !== 2 || !provider.is_active) {
      return response.status(404).json({
        message: "Active provider not found",
      });
    }

    const reviews = await prisma.reviews.findMany({
      where: {
        provider_id: providerId,
        is_visible: true,
      },
      select: {
        id: true,
        rating: true,
        comment: true,
        created_at: true,
        users_reviews_customer_idTousers: {
          select: {
            id: true,
            full_name: true,
          },
        },
      },
      orderBy: {
        created_at: "desc",
      },
    });

    const totalReviews = reviews.length;

    const averageRating =
      totalReviews > 0
        ? reviews.reduce((sum, review) => sum + review.rating, 0) / totalReviews
        : 0;

    return response.status(200).json({
      message: "Provider reviews fetched successfully",
      provider: {
        id: provider.id,
        full_name: provider.full_name,
      },
      summary: {
        total_reviews: totalReviews,
        average_rating: Number(averageRating.toFixed(1)),
      },
      reviews,
    });
  } catch (error) {
    console.error("Get provider reviews error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching provider reviews",
    });
  }
};
