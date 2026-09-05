import { prisma } from "../config/prisma";

interface ResolveBookingAddressInput {
  customerId: number;
  addressId?: unknown;
  serviceAddress?: unknown;
  serviceArea?: unknown;
}

export interface ResolvedBookingAddress {
  addressId: number | null;
  serviceAddress: string;
  serviceArea: string;
}

/*
|--------------------------------------------------------------------------
| Resolve customer booking address
|--------------------------------------------------------------------------
|
| Supported methods:
|
| 1. Saved address:
|    {
|      "addressId": 1
|    }
|
| 2. Manually entered address:
|    {
|      "serviceAddress": "Bharatpur-10, Hakim Chowk",
|      "serviceArea": "Hakim Chowk"
|    }
|
|--------------------------------------------------------------------------
*/

export const resolveCustomerBookingAddress = async ({
  customerId,
  addressId,
  serviceAddress,
  serviceArea,
}: ResolveBookingAddressInput): Promise<ResolvedBookingAddress> => {
  /*
  |--------------------------------------------------------------------------
  | Use saved address when addressId is supplied
  |--------------------------------------------------------------------------
  */

  if (addressId !== undefined && addressId !== null && addressId !== "") {
    const parsedAddressId = Number(addressId);

    if (!Number.isInteger(parsedAddressId) || parsedAddressId <= 0) {
      throw new Error("INVALID_ADDRESS_ID");
    }

    const savedAddress = await prisma.customer_addresses.findFirst({
      where: {
        id: parsedAddressId,
        customer_id: customerId,
        is_active: true,
      },
      select: {
        id: true,
        full_address: true,
        service_area: true,
      },
    });

    if (!savedAddress) {
      throw new Error("ADDRESS_NOT_FOUND");
    }

    return {
      addressId: savedAddress.id,
      serviceAddress: savedAddress.full_address,
      serviceArea: savedAddress.service_area,
    };
  }

  /*
  |--------------------------------------------------------------------------
  | Otherwise use manually entered address
  |--------------------------------------------------------------------------
  */

  if (typeof serviceAddress !== "string" || serviceAddress.trim().length < 5) {
    throw new Error("INVALID_SERVICE_ADDRESS");
  }

  if (typeof serviceArea !== "string" || serviceArea.trim().length < 2) {
    throw new Error("INVALID_SERVICE_AREA");
  }

  return {
    addressId: null,
    serviceAddress: serviceAddress.trim(),
    serviceArea: serviceArea.trim(),
  };
};
