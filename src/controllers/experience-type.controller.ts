import type { Response } from "express";
import { prisma } from "../config/prisma";
import type { AuthenticatedRequest } from "../middlewares/auth.middleware";

const createSlug = (value: string) => {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
};

/*
|--------------------------------------------------------------------------
| Admin: Get all experience types
|--------------------------------------------------------------------------
|
| GET /api/experience-types/admin/all
|
|--------------------------------------------------------------------------
*/

export const getAllExperienceTypesForAdmin = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const searchValue = request.query.search;
    const statusValue = request.query.status;

    const search = typeof searchValue === "string" ? searchValue.trim() : "";

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

    const experienceTypes = await prisma.experience_types.findMany({
      where: {
        ...(isActive !== undefined
          ? {
              is_active: isActive,
            }
          : {}),
        ...(search
          ? {
              OR: [
                {
                  name: {
                    contains: search,
                    mode: "insensitive",
                  },
                },
                {
                  slug: {
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
              ],
            }
          : {}),
      },
      orderBy: [
        {
          display_order: "asc",
        },
        {
          id: "asc",
        },
      ],
      include: {
        _count: {
          select: {
            provider_experience_types: true,
            category_experience_types: true,
          },
        },
      },
    });

    return response.status(200).json({
      message: "Experience types fetched successfully",
      experience_types: experienceTypes.map((experienceType) => ({
        id: experienceType.id,
        name: experienceType.name,
        slug: experienceType.slug,
        description: experienceType.description,
        is_active: experienceType.is_active,
        display_order: experienceType.display_order,
        providers_count: experienceType._count.provider_experience_types,
        categories_count: experienceType._count.category_experience_types,
        created_at: experienceType.created_at,
        updated_at: experienceType.updated_at,
      })),
    });
  } catch (error) {
    console.error("Get experience types error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching experience types",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin: Get one experience type
|--------------------------------------------------------------------------
|
| GET /api/experience-types/admin/:id
|
|--------------------------------------------------------------------------
*/

export const getExperienceTypeByIdForAdmin = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const experienceTypeId = Number(request.params.id);

    if (!Number.isInteger(experienceTypeId) || experienceTypeId <= 0) {
      return response.status(400).json({
        message: "Invalid experience type ID",
      });
    }

    const experienceType = await prisma.experience_types.findUnique({
      where: {
        id: experienceTypeId,
      },
      include: {
        provider_experience_types: {
          include: {
            users: {
              select: {
                id: true,
                full_name: true,
                phone: true,
                is_active: true,
              },
            },
          },
        },
        category_experience_types: {
          include: {
            service_categories: {
              select: {
                id: true,
                name: true,
                slug: true,
                is_active: true,
              },
            },
          },
        },
      },
    });

    if (!experienceType) {
      return response.status(404).json({
        message: "Experience type not found",
      });
    }

    return response.status(200).json({
      message: "Experience type fetched successfully",
      experience_type: experienceType,
    });
  } catch (error) {
    console.error("Get experience type error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching the experience type",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin: Create experience type
|--------------------------------------------------------------------------
|
| POST /api/experience-types/admin
|
|--------------------------------------------------------------------------
*/

export const createExperienceType = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const { name, slug, description, isActive, displayOrder } = request.body;

    if (
      typeof name !== "string" ||
      name.trim().length < 2 ||
      name.trim().length > 100
    ) {
      return response.status(400).json({
        message: "Experience type name must be between 2 and 100 characters",
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

    if (isActive !== undefined && typeof isActive !== "boolean") {
      return response.status(400).json({
        message: "isActive must be true or false",
      });
    }

    const parsedDisplayOrder =
      displayOrder === undefined ? 0 : Number(displayOrder);

    if (!Number.isInteger(parsedDisplayOrder) || parsedDisplayOrder < 0) {
      return response.status(400).json({
        message: "Display order must be a non-negative whole number",
      });
    }

    const duplicateDisplayOrder = await prisma.experience_types.findFirst({
      where: {
        display_order: parsedDisplayOrder,
      },
      select: {
        id: true,
      },
    });

    if (duplicateDisplayOrder) {
      return response.status(409).json({
        message: `Display order ${parsedDisplayOrder} is already assigned to another experience type`,
      });
    }

    const finalSlug =
      typeof slug === "string" && slug.trim().length > 0
        ? createSlug(slug)
        : createSlug(name);

    if (!finalSlug) {
      return response.status(400).json({
        message: "A valid slug could not be generated",
      });
    }

    const duplicate = await prisma.experience_types.findFirst({
      where: {
        OR: [
          {
            name: {
              equals: name.trim(),
              mode: "insensitive",
            },
          },
          {
            slug: finalSlug,
          },
        ],
      },
      select: {
        id: true,
      },
    });

    if (duplicate) {
      return response.status(409).json({
        message: "An experience type with this name or slug already exists",
      });
    }

    const experienceType = await prisma.experience_types.create({
      data: {
        name: name.trim(),
        slug: finalSlug,
        description:
          typeof description === "string" && description.trim().length > 0
            ? description.trim()
            : null,
        is_active: isActive ?? true,
        display_order: parsedDisplayOrder,
        updated_at: new Date(),
      },
    });

    return response.status(201).json({
      message: "Experience type created successfully",
      experience_type: experienceType,
    });
  } catch (error) {
    console.error("Create experience type error:", error);

    return response.status(500).json({
      message: "Something went wrong while creating the experience type",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin: Update experience type
|--------------------------------------------------------------------------
|
| PATCH /api/experience-types/admin/:id
|
|--------------------------------------------------------------------------
*/

export const updateExperienceType = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const experienceTypeId = Number(request.params.id);

    if (!Number.isInteger(experienceTypeId) || experienceTypeId <= 0) {
      return response.status(400).json({
        message: "Invalid experience type ID",
      });
    }

    const existingExperienceType = await prisma.experience_types.findUnique({
      where: {
        id: experienceTypeId,
      },
    });

    if (!existingExperienceType) {
      return response.status(404).json({
        message: "Experience type not found",
      });
    }

    const { name, slug, description, isActive, displayOrder } = request.body;

    if (
      name !== undefined &&
      (typeof name !== "string" ||
        name.trim().length < 2 ||
        name.trim().length > 100)
    ) {
      return response.status(400).json({
        message: "Experience type name must be between 2 and 100 characters",
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

    if (isActive !== undefined && typeof isActive !== "boolean") {
      return response.status(400).json({
        message: "isActive must be true or false",
      });
    }

    let parsedDisplayOrder: number | undefined;

    if (displayOrder !== undefined) {
      parsedDisplayOrder = Number(displayOrder);

      if (!Number.isInteger(parsedDisplayOrder) || parsedDisplayOrder < 0) {
        return response.status(400).json({
          message: "Display order must be a non-negative whole number",
        });
      }

      const duplicateDisplayOrder = await prisma.experience_types.findFirst({
        where: {
          id: {
            not: experienceTypeId,
          },
          display_order: parsedDisplayOrder,
        },
        select: {
          id: true,
        },
      });

      if (duplicateDisplayOrder) {
        return response.status(409).json({
          message: `Display order ${parsedDisplayOrder} is already assigned to another experience type`,
        });
      }
    }

    const finalName =
      typeof name === "string" ? name.trim() : existingExperienceType.name;

    const finalSlug =
      typeof slug === "string" && slug.trim().length > 0
        ? createSlug(slug)
        : name !== undefined
          ? createSlug(finalName)
          : existingExperienceType.slug;

    if (!finalSlug) {
      return response.status(400).json({
        message: "A valid slug could not be generated",
      });
    }

    const duplicate = await prisma.experience_types.findFirst({
      where: {
        id: {
          not: experienceTypeId,
        },
        OR: [
          {
            name: {
              equals: finalName,
              mode: "insensitive",
            },
          },
          {
            slug: finalSlug,
          },
        ],
      },
      select: {
        id: true,
      },
    });

    if (duplicate) {
      return response.status(409).json({
        message: "An experience type with this name or slug already exists",
      });
    }

    const experienceType = await prisma.experience_types.update({
      where: {
        id: experienceTypeId,
      },
      data: {
        ...(name !== undefined
          ? {
              name: finalName,
            }
          : {}),

        ...(name !== undefined || slug !== undefined
          ? {
              slug: finalSlug,
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

        ...(isActive !== undefined
          ? {
              is_active: isActive,
            }
          : {}),

        ...(parsedDisplayOrder !== undefined
          ? {
              display_order: parsedDisplayOrder,
            }
          : {}),

        updated_at: new Date(),
      },
    });

    return response.status(200).json({
      message: "Experience type updated successfully",
      experience_type: experienceType,
    });
  } catch (error) {
    console.error("Update experience type error:", error);

    return response.status(500).json({
      message: "Something went wrong while updating the experience type",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin: Delete experience type
|--------------------------------------------------------------------------
|
| DELETE /api/experience-types/admin/:id
|
|--------------------------------------------------------------------------
*/

export const deleteExperienceType = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const experienceTypeId = Number(request.params.id);

    if (!Number.isInteger(experienceTypeId) || experienceTypeId <= 0) {
      return response.status(400).json({
        message: "Invalid experience type ID",
      });
    }

    const experienceType = await prisma.experience_types.findUnique({
      where: {
        id: experienceTypeId,
      },
      include: {
        _count: {
          select: {
            provider_experience_types: true,
            category_experience_types: true,
          },
        },
      },
    });

    if (!experienceType) {
      return response.status(404).json({
        message: "Experience type not found",
      });
    }

    if (
      experienceType._count.provider_experience_types > 0 ||
      experienceType._count.category_experience_types > 0
    ) {
      return response.status(400).json({
        message:
          "This experience type is linked to providers or categories. Disable it instead of deleting it.",
      });
    }

    await prisma.experience_types.delete({
      where: {
        id: experienceTypeId,
      },
    });

    return response.status(200).json({
      message: "Experience type deleted successfully",
    });
  } catch (error) {
    console.error("Delete experience type error:", error);

    return response.status(500).json({
      message: "Something went wrong while deleting the experience type",
    });
  }
};
