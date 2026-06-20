import { Request, Response } from "express";
import { prisma } from "../config/prisma";

export const getProviderProfile = async (
  request: Request,
  response: Response,
) => {
  try {
    const providerId = Number(request.params.id);

    if (!Number.isInteger(providerId) || providerId <= 0) {
      return response.status(400).json({
        message: "Invalid provider ID",
      });
    }

    const provider = await prisma.users.findFirst({
      where: {
        id: providerId,
        role_id: 2,
        is_active: true,
      },
      select: {
        id: true,
        full_name: true,
        email: true,
        created_at: true,
      },
    });

    if (!provider) {
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
        rating: true,
      },
    });

    const totalReviews = reviews.length;

    const averageRating =
      totalReviews > 0
        ? reviews.reduce((sum, review) => sum + review.rating, 0) / totalReviews
        : 0;

    return response.status(200).json({
      message: "Provider profile fetched successfully",
      provider: {
        ...provider,
        total_reviews: totalReviews,
        average_rating: Number(averageRating.toFixed(1)),
      },
    });
  } catch (error) {
    console.error("Get provider profile error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching provider profile",
    });
  }
};
export const getActiveProviders = async (
  request: Request,
  response: Response,
) => {
  try {
    const providers = await prisma.users.findMany({
      where: {
        role_id: 2,
        is_active: true,
      },
      select: {
        id: true,
        full_name: true,
        email: true,
        created_at: true,
      },
      orderBy: {
        full_name: "asc",
      },
    });

    return response.status(200).json({
      message: "Providers fetched successfully",
      providers,
    });
  } catch (error) {
    console.error("Get providers error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching providers",
    });
  }
};
