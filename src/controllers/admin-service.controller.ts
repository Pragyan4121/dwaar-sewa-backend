import type { Response } from "express";
import { prisma } from "../config/prisma";
import type { AuthenticatedRequest } from "../middlewares/auth.middleware";

/*
|--------------------------------------------------------------------------
| Admin: Create service
|--------------------------------------------------------------------------
*/

export const createService = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const {
      name,
      description,
      basePrice,
      durationMinutes,
      categoryId,
      isActive,
    } = request.body;

    if (
      typeof name !== "string" ||
      name.trim().length < 2 ||
      name.trim().length > 150
    ) {
      return response.status(400).json({
        message: "Service name must be between 2 and 150 characters",
      });
    }

    if (
      description !== undefined &&
      description !== null &&
      typeof description !== "string"
    ) {
      return response.status(400).json({
        message: "Description must be text",
      });
    }

    const parsedBasePrice = Number(basePrice);

    if (!Number.isFinite(parsedBasePrice) || parsedBasePrice < 0) {
      return response.status(400).json({
        message: "Base price must be a valid non-negative amount",
      });
    }

    const parsedDuration =
      durationMinutes === undefined ||
      durationMinutes === null ||
      durationMinutes === ""
        ? null
        : Number(durationMinutes);

    if (
      parsedDuration !== null &&
      (!Number.isInteger(parsedDuration) || parsedDuration <= 0)
    ) {
      return response.status(400).json({
        message: "Duration must be a positive whole number of minutes",
      });
    }

    const parsedCategoryId = Number(categoryId);

    if (!Number.isInteger(parsedCategoryId) || parsedCategoryId <= 0) {
      return response.status(400).json({
        message: "Valid category ID is required",
      });
    }

    if (isActive !== undefined && typeof isActive !== "boolean") {
      return response.status(400).json({
        message: "isActive must be true or false",
      });
    }

    const category = await prisma.service_categories.findUnique({
      where: {
        id: parsedCategoryId,
      },
      select: {
        id: true,
        name: true,
        is_active: true,
      },
    });

    if (!category) {
      return response.status(404).json({
        message: "Service category not found",
      });
    }

    const existingService = await prisma.services.findFirst({
      where: {
        name: {
          equals: name.trim(),
          mode: "insensitive",
        },
      },
      select: {
        id: true,
      },
    });

    if (existingService) {
      return response.status(409).json({
        message: "A service with this name already exists",
      });
    }

    const service = await prisma.services.create({
      data: {
        name: name.trim(),
        description:
          typeof description === "string" && description.trim().length > 0
            ? description.trim()
            : null,
        base_price: parsedBasePrice.toString(),
        duration_minutes: parsedDuration,
        category_id: category.id,
        is_active: isActive ?? true,
        updated_at: new Date(),
      },
      include: {
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

    return response.status(201).json({
      message: "Service created successfully",
      service,
    });
  } catch (error) {
    console.error("Create service error:", error);

    return response.status(500).json({
      message: "Something went wrong while creating the service",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin: Update service
|--------------------------------------------------------------------------
*/

export const updateService = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const serviceId = Number(request.params.id);

    if (!Number.isInteger(serviceId) || serviceId <= 0) {
      return response.status(400).json({
        message: "Invalid service ID",
      });
    }

    const existingService = await prisma.services.findUnique({
      where: {
        id: serviceId,
      },
    });

    if (!existingService) {
      return response.status(404).json({
        message: "Service not found",
      });
    }

    const {
      name,
      description,
      basePrice,
      durationMinutes,
      categoryId,
      isActive,
    } = request.body;

    if (
      name !== undefined &&
      (typeof name !== "string" ||
        name.trim().length < 2 ||
        name.trim().length > 150)
    ) {
      return response.status(400).json({
        message: "Service name must be between 2 and 150 characters",
      });
    }

    if (
      description !== undefined &&
      description !== null &&
      typeof description !== "string"
    ) {
      return response.status(400).json({
        message: "Description must be text",
      });
    }

    let parsedBasePrice: number | undefined;

    if (basePrice !== undefined) {
      parsedBasePrice = Number(basePrice);

      if (!Number.isFinite(parsedBasePrice) || parsedBasePrice < 0) {
        return response.status(400).json({
          message: "Base price must be a valid non-negative amount",
        });
      }
    }

    let parsedDuration: number | null | undefined;

    if (durationMinutes !== undefined) {
      parsedDuration =
        durationMinutes === null || durationMinutes === ""
          ? null
          : Number(durationMinutes);

      if (
        parsedDuration !== null &&
        (!Number.isInteger(parsedDuration) || parsedDuration <= 0)
      ) {
        return response.status(400).json({
          message: "Duration must be a positive whole number of minutes",
        });
      }
    }

    let parsedCategoryId: number | undefined;

    if (categoryId !== undefined) {
      parsedCategoryId = Number(categoryId);

      if (!Number.isInteger(parsedCategoryId) || parsedCategoryId <= 0) {
        return response.status(400).json({
          message: "Valid category ID is required",
        });
      }

      const category = await prisma.service_categories.findUnique({
        where: {
          id: parsedCategoryId,
        },
        select: {
          id: true,
        },
      });

      if (!category) {
        return response.status(404).json({
          message: "Service category not found",
        });
      }
    }

    if (isActive !== undefined && typeof isActive !== "boolean") {
      return response.status(400).json({
        message: "isActive must be true or false",
      });
    }

    const finalName =
      typeof name === "string" ? name.trim() : existingService.name;

    if (finalName !== existingService.name) {
      const duplicateService = await prisma.services.findFirst({
        where: {
          id: {
            not: serviceId,
          },
          name: {
            equals: finalName,
            mode: "insensitive",
          },
        },
        select: {
          id: true,
        },
      });

      if (duplicateService) {
        return response.status(409).json({
          message: "A service with this name already exists",
        });
      }
    }

    const updatedService = await prisma.services.update({
      where: {
        id: serviceId,
      },
      data: {
        ...(name !== undefined
          ? {
              name: finalName,
            }
          : {}),
        ...(description !== undefined
          ? {
              description:
                description === null || String(description).trim().length === 0
                  ? null
                  : String(description).trim(),
            }
          : {}),
        ...(parsedBasePrice !== undefined
          ? {
              base_price: parsedBasePrice.toString(),
            }
          : {}),
        ...(parsedDuration !== undefined
          ? {
              duration_minutes: parsedDuration,
            }
          : {}),
        ...(parsedCategoryId !== undefined
          ? {
              category_id: parsedCategoryId,
            }
          : {}),
        ...(isActive !== undefined
          ? {
              is_active: isActive,
            }
          : {}),
        updated_at: new Date(),
      },
      include: {
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
      message: "Service updated successfully",
      service: updatedService,
    });
  } catch (error) {
    console.error("Update service error:", error);

    return response.status(500).json({
      message: "Something went wrong while updating the service",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin: Get one service
|--------------------------------------------------------------------------
*/

export const getServiceByIdForAdmin = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const serviceId = Number(request.params.id);

    if (!Number.isInteger(serviceId) || serviceId <= 0) {
      return response.status(400).json({
        message: "Invalid service ID",
      });
    }

    const service = await prisma.services.findUnique({
      where: {
        id: serviceId,
      },
      include: {
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
        message: "Service not found",
      });
    }

    return response.status(200).json({
      message: "Service fetched successfully",
      service,
    });
  } catch (error) {
    console.error("Get service error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching the service",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin: Get all services
|--------------------------------------------------------------------------
*/

export const getAllServicesForAdmin = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const categoryIdValue = request.query.categoryId;

    const statusValue = request.query.status;

    const searchValue = request.query.search;

    let categoryId: number | undefined;

    if (categoryIdValue !== undefined) {
      categoryId = Number(categoryIdValue);

      if (!Number.isInteger(categoryId) || categoryId <= 0) {
        return response.status(400).json({
          message: "Invalid category ID filter",
        });
      }
    }

    let isActive: boolean | undefined;

    if (statusValue !== undefined) {
      const normalizedStatus = String(statusValue).trim().toLowerCase();

      if (normalizedStatus === "active") {
        isActive = true;
      } else if (normalizedStatus === "inactive") {
        isActive = false;
      } else if (normalizedStatus !== "all") {
        return response.status(400).json({
          message: "Status filter must be active, inactive, or all",
        });
      }
    }

    const search = typeof searchValue === "string" ? searchValue.trim() : "";

    const services = await prisma.services.findMany({
      where: {
        ...(categoryId
          ? {
              category_id: categoryId,
            }
          : {}),
        ...(isActive !== undefined
          ? {
              is_active: isActive,
            }
          : {}),
        ...(search.length > 0
          ? {
              OR: [
                {
                  name: {
                    contains: search,
                    mode: "insensitive",
                  },
                },
                {
                  description: {
                    contains: search,
                    mode: "insensitive",
                  },
                },
                {
                  service_categories: {
                    name: {
                      contains: search,
                      mode: "insensitive",
                    },
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: [
        {
          created_at: "desc",
        },
        {
          name: "asc",
        },
      ],
      include: {
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
      message: "All services fetched successfully",
      filters: {
        category_id: categoryId ?? null,
        status:
          isActive === undefined ? "all" : isActive ? "active" : "inactive",
        search: search || null,
      },
      services,
    });
  } catch (error) {
    console.error("Get all services error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching services",
    });
  }
};
/*
|--------------------------------------------------------------------------
| Admin: Delete unused service
|--------------------------------------------------------------------------
|
| DELETE /api/services/admin/:id
|
| A service can be permanently deleted only when it has never been used
| in a booking. Used services should be disabled instead.
|
|--------------------------------------------------------------------------
*/

export const deleteServiceForAdmin = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const serviceId = Number(request.params.id);

    if (!Number.isInteger(serviceId) || serviceId <= 0) {
      return response.status(400).json({
        message: "Invalid service ID",
      });
    }

    const service = await prisma.services.findUnique({
      where: {
        id: serviceId,
      },
      select: {
        id: true,
        name: true,
        is_active: true,
      },
    });

    if (!service) {
      return response.status(404).json({
        message: "Service not found",
      });
    }

    const bookingCount = await prisma.bookings.count({
      where: {
        service_id: serviceId,
      },
    });

    if (bookingCount > 0) {
      return response.status(400).json({
        message:
          "This service has already been used in bookings. Disable it instead of deleting it.",
        booking_count: bookingCount,
      });
    }

    await prisma.services.delete({
      where: {
        id: serviceId,
      },
    });

    return response.status(200).json({
      message: "Service deleted successfully",
      deleted_service: {
        id: service.id,
        name: service.name,
      },
    });
  } catch (error) {
    console.error("Delete service error:", error);

    return response.status(500).json({
      message: "Something went wrong while deleting the service",
    });
  }
};
