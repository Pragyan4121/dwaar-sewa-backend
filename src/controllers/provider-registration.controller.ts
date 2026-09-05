import type { Request, Response } from "express";

import { prisma } from "../config/prisma";

/*
|--------------------------------------------------------------------------
| Provider registration options
|--------------------------------------------------------------------------
| Returns active service categories and the active experience options
| mapped to each category by the administrator.
|--------------------------------------------------------------------------
*/

export const getProviderRegistrationOptions = async (
  _request: Request,
  response: Response,
) => {
  try {
    const categories = await prisma.service_categories.findMany({
      where: {
        is_active: true,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        image_url: true,
        display_order: true,
        category_experience_types: {
          where: {
            experience_types: {
              is_active: true,
            },
          },
          select: {
            experience_types: {
              select: {
                id: true,
                name: true,
                slug: true,
                description: true,
                display_order: true,
              },
            },
          },
          orderBy: {
            experience_types: {
              display_order: "asc",
            },
          },
        },
      },
      orderBy: [
        {
          display_order: "asc",
        },
        {
          name: "asc",
        },
      ],
    });

    const formattedCategories = categories.map((category) => ({
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description,
      image_url: category.image_url,
      display_order: category.display_order,
      experience_options: category.category_experience_types.map((mapping) => ({
        id: mapping.experience_types.id,
        name: mapping.experience_types.name,
        slug: mapping.experience_types.slug,
        description: mapping.experience_types.description,
        display_order: mapping.experience_types.display_order,
      })),
    }));

    return response.status(200).json({
      message: "Provider registration options fetched successfully",
      categories: formattedCategories,
    });
  } catch (error: unknown) {
    console.error("Get provider registration options error:", error);

    return response.status(500).json({
      message:
        "Something went wrong while fetching provider registration options",
    });
  }
};
