import type { Response } from "express";
import { prisma } from "../config/prisma";
import type { AuthenticatedRequest } from "../middlewares/auth.middleware";

const getCustomerRoleId = async () => {
  const customerRole = await prisma.roles.findUnique({
    where: {
      name: "customer",
    },
    select: {
      id: true,
    },
  });

  return customerRole?.id ?? null;
};

/*
|--------------------------------------------------------------------------
| Admin: Get all customers
|--------------------------------------------------------------------------
|
| GET /api/admin/customers
|
| Optional query:
| ?search=Ram
| ?status=active
| ?page=1
| ?limit=20
|
|--------------------------------------------------------------------------
*/

export const getAllCustomersForAdmin = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const customerRoleId = await getCustomerRoleId();

    if (!customerRoleId) {
      return response.status(500).json({
        message: "Customer role is not configured in the database",
      });
    }

    const search =
      typeof request.query.search === "string"
        ? request.query.search.trim()
        : "";

    const statusValue =
      typeof request.query.status === "string"
        ? request.query.status.trim().toLowerCase()
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

    let isActive: boolean | undefined;

    if (statusValue !== "all") {
      if (statusValue === "active") {
        isActive = true;
      } else if (statusValue === "inactive") {
        isActive = false;
      } else {
        return response.status(400).json({
          message: "Status must be active, inactive, or all",
        });
      }
    }

    const whereCondition = {
      role_id: customerRoleId,

      ...(isActive !== undefined
        ? {
            is_active: isActive,
          }
        : {}),

      ...(search
        ? {
            OR: [
              {
                full_name: {
                  contains: search,
                  mode: "insensitive" as const,
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
                  mode: "insensitive" as const,
                },
              },
            ],
          }
        : {}),
    };

    const [customers, totalRecords, totalActive, totalInactive] =
      await prisma.$transaction([
        prisma.users.findMany({
          where: whereCondition,
          skip,
          take: limit,
          orderBy: {
            created_at: "desc",
          },
          select: {
            id: true,
            full_name: true,
            phone: true,
            email: true,
            is_active: true,
            created_at: true,
            updated_at: true,
          },
        }),

        prisma.users.count({
          where: whereCondition,
        }),

        prisma.users.count({
          where: {
            role_id: customerRoleId,
            is_active: true,
          },
        }),

        prisma.users.count({
          where: {
            role_id: customerRoleId,
            is_active: false,
          },
        }),
      ]);

    const customerIds = customers.map((customer) => customer.id);

    const [
      bookingGroups,
      completedGroups,
      cancelledGroups,
      addressGroups,
      reviewGroups,
    ] = await Promise.all([
      prisma.bookings.groupBy({
        by: ["customer_id"],
        where: {
          customer_id: {
            in: customerIds,
          },
        },
        _count: {
          _all: true,
        },
      }),

      prisma.bookings.groupBy({
        by: ["customer_id"],
        where: {
          customer_id: {
            in: customerIds,
          },
          status: "completed",
        },
        _count: {
          _all: true,
        },
      }),

      prisma.bookings.groupBy({
        by: ["customer_id"],
        where: {
          customer_id: {
            in: customerIds,
          },
          status: "cancelled",
        },
        _count: {
          _all: true,
        },
      }),

      prisma.customer_addresses.groupBy({
        by: ["customer_id"],
        where: {
          customer_id: {
            in: customerIds,
          },
          is_active: true,
        },
        _count: {
          _all: true,
        },
      }),

      prisma.reviews.groupBy({
        by: ["customer_id"],
        where: {
          customer_id: {
            in: customerIds,
          },
        },
        _count: {
          _all: true,
        },
      }),
    ]);

    const customersWithSummary = customers.map((customer) => {
      const totalBookings =
        bookingGroups.find((item) => item.customer_id === customer.id)?._count
          ._all ?? 0;

      const completedBookings =
        completedGroups.find((item) => item.customer_id === customer.id)?._count
          ._all ?? 0;

      const cancelledBookings =
        cancelledGroups.find((item) => item.customer_id === customer.id)?._count
          ._all ?? 0;

      const savedAddresses =
        addressGroups.find((item) => item.customer_id === customer.id)?._count
          ._all ?? 0;

      const reviewsCount =
        reviewGroups.find((item) => item.customer_id === customer.id)?._count
          ._all ?? 0;

      return {
        ...customer,

        summary: {
          total_bookings: totalBookings,
          completed_bookings: completedBookings,
          cancelled_bookings: cancelledBookings,
          saved_addresses: savedAddresses,
          reviews_count: reviewsCount,
        },
      };
    });

    const totalPages = Math.ceil(totalRecords / limit);

    return response.status(200).json({
      message: "Customers fetched successfully",
      customers: customersWithSummary,

      summary: {
        total: totalActive + totalInactive,
        active: totalActive,
        inactive: totalInactive,
      },

      filters: {
        search: search || null,
        status: statusValue,
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
    console.error("Admin get customers error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching customers",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin: Get customer details
|--------------------------------------------------------------------------
|
| GET /api/admin/customers/:id
|
|--------------------------------------------------------------------------
*/

export const getCustomerByIdForAdmin = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const customerId = Number(request.params.id);

    if (!Number.isInteger(customerId) || customerId <= 0) {
      return response.status(400).json({
        message: "Invalid customer ID",
      });
    }

    const customerRoleId = await getCustomerRoleId();

    if (!customerRoleId) {
      return response.status(500).json({
        message: "Customer role is not configured in the database",
      });
    }

    const customer = await prisma.users.findFirst({
      where: {
        id: customerId,
        role_id: customerRoleId,
      },
      select: {
        id: true,
        full_name: true,
        phone: true,
        email: true,
        is_active: true,
        created_at: true,
        updated_at: true,
      },
    });

    if (!customer) {
      return response.status(404).json({
        message: "Customer not found",
      });
    }

    const [
      addresses,
      bookings,
      totalBookings,
      completedBookings,
      cancelledBookings,
      pendingBookings,
      reviews,
    ] = await Promise.all([
      prisma.customer_addresses.findMany({
        where: {
          customer_id: customerId,
        },
        orderBy: [
          {
            is_default: "desc",
          },
          {
            created_at: "desc",
          },
        ],
      }),

      prisma.bookings.findMany({
        where: {
          customer_id: customerId,
        },
        orderBy: {
          created_at: "desc",
        },
        take: 20,
        include: {
          services: {
            select: {
              id: true,
              name: true,
            },
          },
          users_bookings_provider_idTousers: {
            select: {
              id: true,
              full_name: true,
              phone: true,
            },
          },
        },
      }),

      prisma.bookings.count({
        where: {
          customer_id: customerId,
        },
      }),

      prisma.bookings.count({
        where: {
          customer_id: customerId,
          status: "completed",
        },
      }),

      prisma.bookings.count({
        where: {
          customer_id: customerId,
          status: "cancelled",
        },
      }),

      prisma.bookings.count({
        where: {
          customer_id: customerId,
          status: "pending",
        },
      }),

      prisma.reviews.findMany({
        where: {
          customer_id: customerId,
        },
        orderBy: {
          created_at: "desc",
        },
        take: 20,
      }),
    ]);

    return response.status(200).json({
      message: "Customer fetched successfully",

      customer: {
        ...customer,
        addresses,
        recent_bookings: bookings,
        recent_reviews: reviews,

        booking_summary: {
          total_bookings: totalBookings,
          pending_bookings: pendingBookings,
          completed_bookings: completedBookings,
          cancelled_bookings: cancelledBookings,
        },
      },
    });
  } catch (error) {
    console.error("Admin get customer detail error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching customer details",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin: Deactivate customer
|--------------------------------------------------------------------------
|
| PATCH /api/admin/customers/:id/deactivate
|
|--------------------------------------------------------------------------
*/

export const deactivateCustomerForAdmin = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const customerId = Number(request.params.id);

    if (!Number.isInteger(customerId) || customerId <= 0) {
      return response.status(400).json({
        message: "Invalid customer ID",
      });
    }

    const customerRoleId = await getCustomerRoleId();

    const customer = await prisma.users.findFirst({
      where: {
        id: customerId,
        role_id: customerRoleId ?? -1,
      },
      select: {
        id: true,
        is_active: true,
      },
    });

    if (!customer) {
      return response.status(404).json({
        message: "Customer not found",
      });
    }

    if (!customer.is_active) {
      return response.status(400).json({
        message: "Customer account is already inactive",
      });
    }

    const activeBookingCount = await prisma.bookings.count({
      where: {
        customer_id: customerId,
        status: {
          in: ["pending", "accepted", "assigned", "in_progress"],
        },
      },
    });

    if (activeBookingCount > 0) {
      return response.status(400).json({
        message:
          "Customer has active bookings. Complete or cancel them before deactivating the account.",
      });
    }

    const updatedCustomer = await prisma.users.update({
      where: {
        id: customerId,
      },
      data: {
        is_active: false,
        updated_at: new Date(),
      },
      select: {
        id: true,
        full_name: true,
        phone: true,
        email: true,
        is_active: true,
        updated_at: true,
      },
    });

    return response.status(200).json({
      message: "Customer account deactivated successfully",
      customer: updatedCustomer,
    });
  } catch (error) {
    console.error("Admin deactivate customer error:", error);

    return response.status(500).json({
      message: "Something went wrong while deactivating the customer",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin: Reactivate customer
|--------------------------------------------------------------------------
|
| PATCH /api/admin/customers/:id/reactivate
|
|--------------------------------------------------------------------------
*/

export const reactivateCustomerForAdmin = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const customerId = Number(request.params.id);

    if (!Number.isInteger(customerId) || customerId <= 0) {
      return response.status(400).json({
        message: "Invalid customer ID",
      });
    }

    const customerRoleId = await getCustomerRoleId();

    const customer = await prisma.users.findFirst({
      where: {
        id: customerId,
        role_id: customerRoleId ?? -1,
      },
      select: {
        id: true,
        is_active: true,
      },
    });

    if (!customer) {
      return response.status(404).json({
        message: "Customer not found",
      });
    }

    if (customer.is_active) {
      return response.status(400).json({
        message: "Customer account is already active",
      });
    }

    const updatedCustomer = await prisma.users.update({
      where: {
        id: customerId,
      },
      data: {
        is_active: true,
        updated_at: new Date(),
      },
      select: {
        id: true,
        full_name: true,
        phone: true,
        email: true,
        is_active: true,
        updated_at: true,
      },
    });

    return response.status(200).json({
      message: "Customer account reactivated successfully",
      customer: updatedCustomer,
    });
  } catch (error) {
    console.error("Admin reactivate customer error:", error);

    return response.status(500).json({
      message: "Something went wrong while reactivating the customer",
    });
  }
};
