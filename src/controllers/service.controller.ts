import { Request, Response } from "express";
import { prisma } from "../config/prisma";

export const getActiveServices = async (
  request: Request,
  response: Response,
) => {
  try {
    const services = await prisma.services.findMany({
      where: {
        is_active: true,
      },
      orderBy: {
        name: "asc",
      },
    });

    return response.status(200).json({
      message: "Services fetched successfully",
      services,
    });
  } catch (error) {
    console.error("Get services error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching services",
    });
  }
};
