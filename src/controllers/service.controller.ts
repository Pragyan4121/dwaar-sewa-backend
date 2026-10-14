import type { Request, Response } from "express";
import { prisma } from "../config/prisma";

/*
|--------------------------------------------------------------------------
| Public: Get active services
|--------------------------------------------------------------------------
|
| GET /api/services
| GET /api/services?categoryId=2
|
|--------------------------------------------------------------------------
*/

export const getActiveServices = async (
  request: Request,
  response: Response,
) => {
  try {
    const categoryIdValue = request.query.categoryId;

    let categoryId: number | undefined;

    if (categoryIdValue !== undefined) {
      categoryId = Number(categoryIdValue);

      if (!Number.isInteger(categoryId) || categoryId <= 0) {
        return response.status(400).json({
          message: "Invalid category ID",
        });
      }
    }

    const services = await prisma.services.findMany({
      where: {
        is_active: true,
        ...(categoryId
          ? {
              category_id: categoryId,
              service_categories: {
                is_active: true,
              },
            }
          : {}),
      },
      orderBy: {
        name: "asc",
      },
      select: {
        id: true,
        name: true,
        description: true,
        base_price: true,
        duration_minutes: true,
        is_active: true,
        category_id: true,
        created_at: true,
        updated_at: true,
        service_categories: {
          select: {
            id: true,
            name: true,
            slug: true,
            description: true,
            image_url: true,
            is_active: true,
            display_order: true,
          },
        },
      },
    });

    return response.status(200).json({
      message: "Active services fetched successfully",
      filters: {
        category_id: categoryId ?? null,
      },
      services,
    });
  } catch (error) {
    console.error("Get active services error:", error);

    return response.status(500).json({
      message: "Could not fetch active services",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Public: Get one active service by ID
|--------------------------------------------------------------------------
|
| GET /api/services/:id
|
|--------------------------------------------------------------------------
*/

export const getActiveServiceById = async (
  request: Request,
  response: Response,
) => {
  try {
    const serviceId = Number(request.params.id);

    if (!Number.isInteger(serviceId) || serviceId <= 0) {
      return response.status(400).json({
        message: "Invalid service ID",
      });
    }

    const service = await prisma.services.findFirst({
      where: {
        id: serviceId,
        is_active: true,
        service_categories: {
          is_active: true,
        },
      },
      select: {
        id: true,
        name: true,
        description: true,
        base_price: true,
        duration_minutes: true,
        is_active: true,
        category_id: true,
        created_at: true,
        updated_at: true,
        service_categories: {
          select: {
            id: true,
            name: true,
            slug: true,
            description: true,
            image_url: true,
            is_active: true,
            display_order: true,
          },
        },
      },
    });

    if (!service) {
      return response.status(404).json({
        message: "Service not found or unavailable",
      });
    }

    /*
     * video_consultation_price isn't in the generated Prisma Client's
     * `services` select type yet — same reasoning as everywhere else in
     * this feature (see consultation-credit.service.ts). Merged in here
     * so the booking screen knows whether to offer a video-consultation
     * option for this service at all.
     */
    const [priceRow] = await prisma.$queryRaw<
      Array<{ video_consultation_price: string | null }>
    >`
      SELECT video_consultation_price
      FROM services
      WHERE id = ${service.id}
    `;

    return response.status(200).json({
      message: "Service fetched successfully",
      service: {
        ...service,
        video_consultation_price: priceRow?.video_consultation_price ?? null,
      },
    });
  } catch (error) {
    console.error("Get service by ID error:", error);

    return response.status(500).json({
      message: "Could not fetch service details",
    });
  }
};
