import { Response } from "express";
import { prisma } from "../config/prisma";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";

export const createService = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const { name, description, basePrice, durationMinutes } = request.body;

    if (!name || basePrice === undefined) {
      return response.status(400).json({
        message: "Service name and base price are required",
      });
    }

    const parsedBasePrice = Number(basePrice);
    const parsedDuration = durationMinutes ? Number(durationMinutes) : null;

    if (!Number.isFinite(parsedBasePrice) || parsedBasePrice < 0) {
      return response.status(400).json({
        message: "Base price must be a valid positive amount",
      });
    }

    if (
      parsedDuration !== null &&
      (!Number.isInteger(parsedDuration) || parsedDuration <= 0)
    ) {
      return response.status(400).json({
        message: "Duration must be a positive number of minutes",
      });
    }

    const existingService = await prisma.services.findUnique({
      where: {
        name,
      },
    });

    if (existingService) {
      return response.status(409).json({
        message: "A service with this name already exists",
      });
    }

    const service = await prisma.services.create({
      data: {
        name,
        description: description || null,
        base_price: parsedBasePrice.toString(),
        duration_minutes: parsedDuration,
        is_active: true,
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
export const updateService = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const serviceId = Number(request.params.id);
    const { name, description, basePrice, durationMinutes, isActive } =
      request.body;

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

    const parsedBasePrice =
      basePrice !== undefined ? Number(basePrice) : undefined;

    const parsedDuration =
      durationMinutes !== undefined ? Number(durationMinutes) : undefined;

    if (
      parsedBasePrice !== undefined &&
      (!Number.isFinite(parsedBasePrice) || parsedBasePrice < 0)
    ) {
      return response.status(400).json({
        message: "Base price must be a valid positive amount",
      });
    }

    if (
      parsedDuration !== undefined &&
      (!Number.isInteger(parsedDuration) || parsedDuration <= 0)
    ) {
      return response.status(400).json({
        message: "Duration must be a positive number of minutes",
      });
    }

    if (name && name !== existingService.name) {
      const duplicateService = await prisma.services.findUnique({
        where: {
          name,
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
        ...(name !== undefined && { name }),
        ...(description !== undefined && {
          description: description || null,
        }),
        ...(parsedBasePrice !== undefined && {
          base_price: parsedBasePrice.toString(),
        }),
        ...(parsedDuration !== undefined && {
          duration_minutes: parsedDuration,
        }),
        ...(typeof isActive === "boolean" && {
          is_active: isActive,
        }),
        updated_at: new Date(),
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
