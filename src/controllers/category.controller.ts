import type { Request, Response } from "express";
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
| Public: Get active service categories
|--------------------------------------------------------------------------
*/

export const getActiveCategories = async (
  _request: Request,
  response: Response,
) => {
  try {
    const categories = await prisma.service_categories.findMany({
      where: {
        is_active: true,
      },
      orderBy: [
        {
          display_order: "asc",
        },
        {
          name: "asc",
        },
      ],
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        image_url: true,
        display_order: true,
        created_at: true,
        updated_at: true,
        _count: {
          select: {
            services: {
              where: {
                is_active: true,
              },
            },
          },
        },
      },
    });

    return response.status(200).json({
      message: "Active service categories fetched successfully",
      categories: categories.map((category) => ({
        id: category.id,
        name: category.name,
        slug: category.slug,
        description: category.description,
        image_url: category.image_url,
        display_order: category.display_order,
        active_services_count: category._count.services,
        created_at: category.created_at,
        updated_at: category.updated_at,
      })),
    });
  } catch (error) {
    console.error("Get active categories error:", error);

    return response.status(500).json({
      message: "Could not fetch service categories",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Public: Get one active category with active services
|--------------------------------------------------------------------------
*/

export const getActiveCategoryById = async (
  request: Request,
  response: Response,
) => {
  try {
    const categoryId = Number(request.params.id);

    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      return response.status(400).json({
        message: "Invalid category ID",
      });
    }

    const category = await prisma.service_categories.findFirst({
      where: {
        id: categoryId,
        is_active: true,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        image_url: true,
        display_order: true,
        created_at: true,
        updated_at: true,
        services: {
          where: {
            is_active: true,
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
            created_at: true,
            updated_at: true,
          },
        },
      },
    });

    if (!category) {
      return response.status(404).json({
        message: "Service category not found",
      });
    }

    return response.status(200).json({
      message: "Service category fetched successfully",
      category,
    });
  } catch (error) {
    console.error("Get category by ID error:", error);

    return response.status(500).json({
      message: "Could not fetch service category",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin: Get all categories
|--------------------------------------------------------------------------
*/

export const getAllCategoriesForAdmin = async (
  _request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const categories = await prisma.service_categories.findMany({
      orderBy: [
        {
          display_order: "asc",
        },
        {
          name: "asc",
        },
      ],
      include: {
        _count: {
          select: {
            services: true,
          },
        },
      },
    });

    return response.status(200).json({
      message: "All service categories fetched successfully",
      categories: categories.map((category) => ({
        id: category.id,
        name: category.name,
        slug: category.slug,
        description: category.description,
        image_url: category.image_url,
        is_active: category.is_active,
        display_order: category.display_order,
        services_count: category._count.services,
        created_at: category.created_at,
        updated_at: category.updated_at,
      })),
    });
  } catch (error) {
    console.error("Admin get categories error:", error);

    return response.status(500).json({
      message: "Could not fetch service categories",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin: Get one category
|--------------------------------------------------------------------------
*/

export const getCategoryByIdForAdmin = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const categoryId = Number(request.params.id);

    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      return response.status(400).json({
        message: "Invalid category ID",
      });
    }

    const category = await prisma.service_categories.findUnique({
      where: {
        id: categoryId,
      },
      include: {
        services: {
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
          },
        },
      },
    });

    if (!category) {
      return response.status(404).json({
        message: "Service category not found",
      });
    }

    return response.status(200).json({
      message: "Service category fetched successfully",
      category,
    });
  } catch (error) {
    console.error("Admin get category error:", error);

    return response.status(500).json({
      message: "Could not fetch service category",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin: Upload category image
|--------------------------------------------------------------------------
*/

export const uploadCategoryImage = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    if (!request.file) {
      return response.status(400).json({
        message: "Please choose an image to upload",
      });
    }

    const imageUrl = `/uploads/categories/${request.file.filename}`;

    return response.status(201).json({
      message: "Category image uploaded successfully",
      imageUrl,
    });
  } catch (error) {
    console.error("Upload category image error:", error);

    return response.status(500).json({
      message: "Could not upload category image",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin: Create category
|--------------------------------------------------------------------------
*/

export const createCategory = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const { name, slug, description, imageUrl, displayOrder, isActive } =
      request.body;

    if (
      typeof name !== "string" ||
      name.trim().length < 2 ||
      name.trim().length > 100
    ) {
      return response.status(400).json({
        message: "Category name must be between 2 and 100 characters",
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

    if (
      imageUrl !== undefined &&
      imageUrl !== null &&
      typeof imageUrl !== "string"
    ) {
      return response.status(400).json({
        message: "Image URL must be text",
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

    const duplicateDisplayOrder = await prisma.service_categories.findFirst({
      where: {
        display_order: parsedDisplayOrder,
      },
      select: {
        id: true,
      },
    });

    if (duplicateDisplayOrder) {
      return response.status(409).json({
        message: `Display order ${parsedDisplayOrder} is already assigned to another category`,
      });
    }

    const generatedSlug =
      typeof slug === "string" && slug.trim().length > 0
        ? createSlug(slug)
        : createSlug(name);

    if (!generatedSlug) {
      return response.status(400).json({
        message: "A valid category slug could not be generated",
      });
    }

    const duplicateCategory = await prisma.service_categories.findFirst({
      where: {
        OR: [
          {
            name: {
              equals: name.trim(),
              mode: "insensitive",
            },
          },
          {
            slug: generatedSlug,
          },
        ],
      },
      select: {
        id: true,
      },
    });

    if (duplicateCategory) {
      return response.status(409).json({
        message: "A category with this name or slug already exists",
      });
    }

    const category = await prisma.service_categories.create({
      data: {
        name: name.trim(),
        slug: generatedSlug,
        description:
          typeof description === "string" && description.trim().length > 0
            ? description.trim()
            : null,
        image_url:
          typeof imageUrl === "string" && imageUrl.trim().length > 0
            ? imageUrl.trim()
            : null,
        display_order: parsedDisplayOrder,
        is_active: isActive ?? true,
        updated_at: new Date(),
      },
    });

    return response.status(201).json({
      message: "Service category created successfully",
      category,
    });
  } catch (error) {
    console.error("Create category error:", error);

    return response.status(500).json({
      message: "Could not create service category",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin: Update category
|--------------------------------------------------------------------------
*/

export const updateCategory = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const categoryId = Number(request.params.id);

    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      return response.status(400).json({
        message: "Invalid category ID",
      });
    }

    const existingCategory = await prisma.service_categories.findUnique({
      where: {
        id: categoryId,
      },
    });

    if (!existingCategory) {
      return response.status(404).json({
        message: "Service category not found",
      });
    }

    const { name, slug, description, imageUrl, displayOrder, isActive } =
      request.body;

    if (
      name !== undefined &&
      (typeof name !== "string" ||
        name.trim().length < 2 ||
        name.trim().length > 100)
    ) {
      return response.status(400).json({
        message: "Category name must be between 2 and 100 characters",
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

    if (
      imageUrl !== undefined &&
      imageUrl !== null &&
      typeof imageUrl !== "string"
    ) {
      return response.status(400).json({
        message: "Image URL must be text",
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

      const duplicateDisplayOrder = await prisma.service_categories.findFirst({
        where: {
          id: {
            not: categoryId,
          },
          display_order: parsedDisplayOrder,
        },
        select: {
          id: true,
        },
      });

      if (duplicateDisplayOrder) {
        return response.status(409).json({
          message: `Display order ${parsedDisplayOrder} is already assigned to another category`,
        });
      }
    }

    const finalName =
      typeof name === "string" ? name.trim() : existingCategory.name;

    const finalSlug =
      typeof slug === "string" && slug.trim().length > 0
        ? createSlug(slug)
        : name !== undefined
          ? createSlug(finalName)
          : existingCategory.slug;

    if (!finalSlug) {
      return response.status(400).json({
        message: "A valid category slug could not be generated",
      });
    }

    const duplicateCategory = await prisma.service_categories.findFirst({
      where: {
        id: {
          not: categoryId,
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

    if (duplicateCategory) {
      return response.status(409).json({
        message: "A category with this name or slug already exists",
      });
    }

    const category = await prisma.service_categories.update({
      where: {
        id: categoryId,
      },
      data: {
        ...(name !== undefined
          ? {
              name: finalName,
            }
          : {}),
        ...(slug !== undefined || name !== undefined
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
        ...(imageUrl !== undefined
          ? {
              image_url:
                imageUrl === null || String(imageUrl).trim().length === 0
                  ? null
                  : String(imageUrl).trim(),
            }
          : {}),
        ...(parsedDisplayOrder !== undefined
          ? {
              display_order: parsedDisplayOrder,
            }
          : {}),
        ...(isActive !== undefined
          ? {
              is_active: isActive,
            }
          : {}),
        updated_at: new Date(),
      },
    });

    return response.status(200).json({
      message: "Service category updated successfully",
      category,
    });
  } catch (error) {
    console.error("Update category error:", error);

    return response.status(500).json({
      message: "Could not update service category",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin: Delete category
|--------------------------------------------------------------------------
*/

export const deleteCategory = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const categoryId = Number(request.params.id);

    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      return response.status(400).json({
        message: "Invalid category ID",
      });
    }

    const category = await prisma.service_categories.findUnique({
      where: {
        id: categoryId,
      },
      include: {
        _count: {
          select: {
            services: true,
          },
        },
      },
    });

    if (!category) {
      return response.status(404).json({
        message: "Service category not found",
      });
    }

    if (category._count.services > 0) {
      return response.status(400).json({
        message:
          "This category cannot be deleted because services are linked to it. Disable it instead.",
      });
    }

    await prisma.service_categories.delete({
      where: {
        id: categoryId,
      },
    });

    return response.status(200).json({
      message: "Service category deleted successfully",
    });
  } catch (error) {
    console.error("Delete category error:", error);

    return response.status(500).json({
      message: "Could not delete service category",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin: Get experience types linked to a category
|--------------------------------------------------------------------------
| Returns every active experience type, along with whether it is currently
| linked to this category, so the admin UI can render a checklist.
|--------------------------------------------------------------------------
*/

export const getCategoryExperienceTypes = async (
  request: Request,
  response: Response,
) => {
  try {
    const categoryId = Number(request.params.id);

    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      return response.status(400).json({
        message: "A valid category id is required",
      });
    }

    const category = await prisma.service_categories.findUnique({
      where: {
        id: categoryId,
      },
      select: {
        id: true,
        name: true,
      },
    });

    if (!category) {
      return response.status(404).json({
        message: "Service category not found",
      });
    }

    const [experienceTypes, linkedMappings] = await Promise.all([
      prisma.experience_types.findMany({
        where: {
          is_active: true,
        },
        orderBy: [{ display_order: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          display_order: true,
        },
      }),
      prisma.category_experience_types.findMany({
        where: {
          category_id: categoryId,
        },
        select: {
          experience_type_id: true,
        },
      }),
    ]);

    const linkedIds = new Set(
      linkedMappings.map((mapping) => mapping.experience_type_id),
    );

    const experienceTypesWithLinkStatus = experienceTypes.map(
      (experienceType) => ({
        ...experienceType,
        is_linked: linkedIds.has(experienceType.id),
      }),
    );

    return response.status(200).json({
      message: "Category experience types fetched successfully",
      category: {
        id: category.id,
        name: category.name,
      },
      experience_types: experienceTypesWithLinkStatus,
    });
  } catch (error) {
    console.error("Get category experience types error:", error);

    return response.status(500).json({
      message: "Could not fetch experience types for this category",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin: Set experience types linked to a category
|--------------------------------------------------------------------------
| Replaces the full set of experience types linked to this category with
| the provided list (removes ones no longer present, adds new ones).
|--------------------------------------------------------------------------
*/

export const setCategoryExperienceTypes = async (
  request: Request,
  response: Response,
) => {
  try {
    const categoryId = Number(request.params.id);

    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      return response.status(400).json({
        message: "A valid category id is required",
      });
    }

    const rawIds = Array.isArray(request.body.experienceTypeIds)
      ? request.body.experienceTypeIds
      : [];

    const experienceTypeIds = Array.from(
      new Set(
        rawIds
          .map((id: unknown) => Number(id))
          .filter((id: number) => Number.isInteger(id) && id > 0),
      ),
    ) as number[];

    const category = await prisma.service_categories.findUnique({
      where: {
        id: categoryId,
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

    if (experienceTypeIds.length > 0) {
      const validExperienceTypes = await prisma.experience_types.findMany({
        where: {
          id: {
            in: experienceTypeIds,
          },
        },
        select: {
          id: true,
        },
      });

      if (validExperienceTypes.length !== experienceTypeIds.length) {
        return response.status(400).json({
          message: "One or more experience type ids are invalid",
        });
      }
    }

    await prisma.$transaction([
      prisma.category_experience_types.deleteMany({
        where: {
          category_id: categoryId,
          ...(experienceTypeIds.length > 0
            ? {
                experience_type_id: {
                  notIn: experienceTypeIds,
                },
              }
            : {}),
        },
      }),
      ...(experienceTypeIds.length > 0
        ? [
            prisma.category_experience_types.createMany({
              data: experienceTypeIds.map((experienceTypeId) => ({
                category_id: categoryId,
                experience_type_id: experienceTypeId,
              })),
              skipDuplicates: true,
            }),
          ]
        : []),
    ]);

    return response.status(200).json({
      message: "Category experience types updated successfully",
    });
  } catch (error) {
    console.error("Set category experience types error:", error);

    return response.status(500).json({
      message: "Could not update experience types for this category",
    });
  }
};
