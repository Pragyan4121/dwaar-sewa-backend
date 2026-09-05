import type { Response } from "express";
import { prisma } from "../config/prisma";
import type { AuthenticatedRequest } from "../middlewares/auth.middleware";

interface AddressInput {
  label?: unknown;
  fullAddress?: unknown;
  serviceArea?: unknown;
  landmark?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  isDefault?: unknown;
}

const parseOptionalCoordinate = (
  value: unknown,
  minimum: number,
  maximum: number,
): number | null | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === "") {
    return null;
  }

  const parsedValue = Number(value);

  if (
    !Number.isFinite(parsedValue) ||
    parsedValue < minimum ||
    parsedValue > maximum
  ) {
    return undefined;
  }

  return parsedValue;
};

/*
|--------------------------------------------------------------------------
| Customer: Get own saved addresses
|--------------------------------------------------------------------------
|
| GET /api/customer/addresses
|
|--------------------------------------------------------------------------
*/

export const getMyAddresses = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const customerId = request.user?.userId;

    if (!customerId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    const addresses = await prisma.customer_addresses.findMany({
      where: {
        customer_id: customerId,
        is_active: true,
      },
      orderBy: [
        {
          is_default: "desc",
        },
        {
          created_at: "desc",
        },
      ],
    });

    return response.status(200).json({
      message: "Customer addresses fetched successfully",
      addresses,
    });
  } catch (error) {
    console.error("Get customer addresses error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching addresses",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Customer: Get one own address
|--------------------------------------------------------------------------
|
| GET /api/customer/addresses/:id
|
|--------------------------------------------------------------------------
*/

export const getMyAddressById = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const customerId = request.user?.userId;
    const addressId = Number(request.params.id);

    if (!customerId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    if (!Number.isInteger(addressId) || addressId <= 0) {
      return response.status(400).json({
        message: "Invalid address ID",
      });
    }

    const address = await prisma.customer_addresses.findFirst({
      where: {
        id: addressId,
        customer_id: customerId,
        is_active: true,
      },
    });

    if (!address) {
      return response.status(404).json({
        message: "Address not found",
      });
    }

    return response.status(200).json({
      message: "Customer address fetched successfully",
      address,
    });
  } catch (error) {
    console.error("Get customer address error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching the address",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Customer: Create saved address
|--------------------------------------------------------------------------
|
| POST /api/customer/addresses
|
|--------------------------------------------------------------------------
*/

export const createMyAddress = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const customerId = request.user?.userId;

    if (!customerId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    const {
      label,
      fullAddress,
      serviceArea,
      landmark,
      latitude,
      longitude,
      isDefault,
    } = request.body as AddressInput;

    if (
      typeof label !== "string" ||
      label.trim().length < 1 ||
      label.trim().length > 50
    ) {
      return response.status(400).json({
        message: "Address label must be between 1 and 50 characters",
      });
    }

    if (typeof fullAddress !== "string" || fullAddress.trim().length < 5) {
      return response.status(400).json({
        message: "Valid full address is required",
      });
    }

    if (
      typeof serviceArea !== "string" ||
      serviceArea.trim().length < 2 ||
      serviceArea.trim().length > 100
    ) {
      return response.status(400).json({
        message: "Valid service area is required",
      });
    }

    if (
      landmark !== undefined &&
      landmark !== null &&
      typeof landmark !== "string"
    ) {
      return response.status(400).json({
        message: "Landmark must be text",
      });
    }

    if (typeof landmark === "string" && landmark.trim().length > 150) {
      return response.status(400).json({
        message: "Landmark must not exceed 150 characters",
      });
    }

    if (isDefault !== undefined && typeof isDefault !== "boolean") {
      return response.status(400).json({
        message: "isDefault must be true or false",
      });
    }

    const parsedLatitude = parseOptionalCoordinate(latitude, -90, 90);

    const parsedLongitude = parseOptionalCoordinate(longitude, -180, 180);

    if (latitude !== undefined && parsedLatitude === undefined) {
      return response.status(400).json({
        message: "Latitude must be between -90 and 90",
      });
    }

    if (longitude !== undefined && parsedLongitude === undefined) {
      return response.status(400).json({
        message: "Longitude must be between -180 and 180",
      });
    }

    const existingAddressCount = await prisma.customer_addresses.count({
      where: {
        customer_id: customerId,
        is_active: true,
      },
    });

    const shouldBeDefault = isDefault === true || existingAddressCount === 0;

    const address = await prisma.$transaction(async (transaction) => {
      if (shouldBeDefault) {
        await transaction.customer_addresses.updateMany({
          where: {
            customer_id: customerId,
            is_active: true,
            is_default: true,
          },
          data: {
            is_default: false,
            updated_at: new Date(),
          },
        });
      }

      return transaction.customer_addresses.create({
        data: {
          customer_id: customerId,
          label: label.trim(),
          full_address: fullAddress.trim(),
          service_area: serviceArea.trim(),
          landmark:
            typeof landmark === "string" && landmark.trim().length > 0
              ? landmark.trim()
              : null,
          latitude: parsedLatitude === undefined ? null : parsedLatitude,
          longitude: parsedLongitude === undefined ? null : parsedLongitude,
          is_default: shouldBeDefault,
          is_active: true,
          updated_at: new Date(),
        },
      });
    });

    return response.status(201).json({
      message: "Customer address created successfully",
      address,
    });
  } catch (error) {
    console.error("Create customer address error:", error);

    return response.status(500).json({
      message: "Something went wrong while creating the address",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Customer: Update own saved address
|--------------------------------------------------------------------------
|
| PATCH /api/customer/addresses/:id
|
|--------------------------------------------------------------------------
*/

export const updateMyAddress = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const customerId = request.user?.userId;
    const addressId = Number(request.params.id);

    if (!customerId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    if (!Number.isInteger(addressId) || addressId <= 0) {
      return response.status(400).json({
        message: "Invalid address ID",
      });
    }

    const existingAddress = await prisma.customer_addresses.findFirst({
      where: {
        id: addressId,
        customer_id: customerId,
        is_active: true,
      },
    });

    if (!existingAddress) {
      return response.status(404).json({
        message: "Address not found",
      });
    }

    const {
      label,
      fullAddress,
      serviceArea,
      landmark,
      latitude,
      longitude,
      isDefault,
    } = request.body as AddressInput;

    if (
      label !== undefined &&
      (typeof label !== "string" ||
        label.trim().length < 1 ||
        label.trim().length > 50)
    ) {
      return response.status(400).json({
        message: "Address label must be between 1 and 50 characters",
      });
    }

    if (
      fullAddress !== undefined &&
      (typeof fullAddress !== "string" || fullAddress.trim().length < 5)
    ) {
      return response.status(400).json({
        message: "Valid full address is required",
      });
    }

    if (
      serviceArea !== undefined &&
      (typeof serviceArea !== "string" ||
        serviceArea.trim().length < 2 ||
        serviceArea.trim().length > 100)
    ) {
      return response.status(400).json({
        message: "Valid service area is required",
      });
    }

    if (
      landmark !== undefined &&
      landmark !== null &&
      typeof landmark !== "string"
    ) {
      return response.status(400).json({
        message: "Landmark must be text",
      });
    }

    if (typeof landmark === "string" && landmark.trim().length > 150) {
      return response.status(400).json({
        message: "Landmark must not exceed 150 characters",
      });
    }

    if (isDefault !== undefined && typeof isDefault !== "boolean") {
      return response.status(400).json({
        message: "isDefault must be true or false",
      });
    }

    const parsedLatitude = parseOptionalCoordinate(latitude, -90, 90);

    const parsedLongitude = parseOptionalCoordinate(longitude, -180, 180);

    if (latitude !== undefined && parsedLatitude === undefined) {
      return response.status(400).json({
        message: "Latitude must be between -90 and 90",
      });
    }

    if (longitude !== undefined && parsedLongitude === undefined) {
      return response.status(400).json({
        message: "Longitude must be between -180 and 180",
      });
    }

    if (existingAddress.is_default && isDefault === false) {
      return response.status(400).json({
        message:
          "Set another address as default before removing the current default",
      });
    }

    const updatedAddress = await prisma.$transaction(async (transaction) => {
      if (isDefault === true) {
        await transaction.customer_addresses.updateMany({
          where: {
            customer_id: customerId,
            is_active: true,
            is_default: true,
            id: {
              not: addressId,
            },
          },
          data: {
            is_default: false,
            updated_at: new Date(),
          },
        });
      }

      return transaction.customer_addresses.update({
        where: {
          id: addressId,
        },
        data: {
          ...(label !== undefined
            ? {
                label: String(label).trim(),
              }
            : {}),
          ...(fullAddress !== undefined
            ? {
                full_address: String(fullAddress).trim(),
              }
            : {}),
          ...(serviceArea !== undefined
            ? {
                service_area: String(serviceArea).trim(),
              }
            : {}),
          ...(landmark !== undefined
            ? {
                landmark:
                  landmark === null || String(landmark).trim().length === 0
                    ? null
                    : String(landmark).trim(),
              }
            : {}),
          ...(latitude !== undefined
            ? {
                latitude: parsedLatitude,
              }
            : {}),
          ...(longitude !== undefined
            ? {
                longitude: parsedLongitude,
              }
            : {}),
          ...(isDefault !== undefined
            ? {
                is_default: isDefault,
              }
            : {}),
          updated_at: new Date(),
        },
      });
    });

    return response.status(200).json({
      message: "Customer address updated successfully",
      address: updatedAddress,
    });
  } catch (error) {
    console.error("Update customer address error:", error);

    return response.status(500).json({
      message: "Something went wrong while updating the address",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Customer: Set one address as default
|--------------------------------------------------------------------------
|
| PATCH /api/customer/addresses/:id/default
|
|--------------------------------------------------------------------------
*/

export const setMyDefaultAddress = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const customerId = request.user?.userId;
    const addressId = Number(request.params.id);

    if (!customerId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    if (!Number.isInteger(addressId) || addressId <= 0) {
      return response.status(400).json({
        message: "Invalid address ID",
      });
    }

    const address = await prisma.customer_addresses.findFirst({
      where: {
        id: addressId,
        customer_id: customerId,
        is_active: true,
      },
    });

    if (!address) {
      return response.status(404).json({
        message: "Address not found",
      });
    }

    const updatedAddress = await prisma.$transaction(async (transaction) => {
      await transaction.customer_addresses.updateMany({
        where: {
          customer_id: customerId,
          is_active: true,
          is_default: true,
        },
        data: {
          is_default: false,
          updated_at: new Date(),
        },
      });

      return transaction.customer_addresses.update({
        where: {
          id: addressId,
        },
        data: {
          is_default: true,
          updated_at: new Date(),
        },
      });
    });

    return response.status(200).json({
      message: "Default address updated successfully",
      address: updatedAddress,
    });
  } catch (error) {
    console.error("Set default address error:", error);

    return response.status(500).json({
      message: "Something went wrong while setting the default address",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Customer: Delete/disable own address
|--------------------------------------------------------------------------
|
| DELETE /api/customer/addresses/:id
|
|--------------------------------------------------------------------------
*/

export const deleteMyAddress = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const customerId = request.user?.userId;
    const addressId = Number(request.params.id);

    if (!customerId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    if (!Number.isInteger(addressId) || addressId <= 0) {
      return response.status(400).json({
        message: "Invalid address ID",
      });
    }

    const address = await prisma.customer_addresses.findFirst({
      where: {
        id: addressId,
        customer_id: customerId,
        is_active: true,
      },
    });

    if (!address) {
      return response.status(404).json({
        message: "Address not found",
      });
    }

    const activeAddressCount = await prisma.customer_addresses.count({
      where: {
        customer_id: customerId,
        is_active: true,
      },
    });

    if (activeAddressCount === 1) {
      return response.status(400).json({
        message: "You must keep at least one active saved address",
      });
    }

    if (address.is_default) {
      return response.status(400).json({
        message: "Set another address as default before deleting this address",
      });
    }

    await prisma.customer_addresses.update({
      where: {
        id: addressId,
      },
      data: {
        is_active: false,
        is_default: false,
        updated_at: new Date(),
      },
    });

    return response.status(200).json({
      message: "Customer address deleted successfully",
    });
  } catch (error) {
    console.error("Delete customer address error:", error);

    return response.status(500).json({
      message: "Something went wrong while deleting the address",
    });
  }
};
