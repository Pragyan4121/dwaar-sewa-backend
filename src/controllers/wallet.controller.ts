import { Response } from "express";
import { prisma } from "../config/prisma";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";

export const getMyWallet = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const userId = request.user?.userId;

    if (!userId) {
      return response.status(401).json({
        message: "User is not authenticated",
      });
    }

    let wallet = await prisma.wallets.findUnique({
      where: {
        user_id: userId,
      },
    });

    if (!wallet) {
      wallet = await prisma.wallets.create({
        data: {
          user_id: userId,
          balance: "0.00",
          currency: "NPR",
          is_active: true,
        },
      });
    }

    const balance = Number(wallet.balance);

    return response.status(200).json({
      message: "Wallet fetched successfully",
      wallet: {
        ...wallet,
        available_balance: Math.max(balance, 0).toFixed(2),
        amount_owed_to_platform: Math.max(-balance, 0).toFixed(2),
      },
    });
  } catch (error) {
    console.error("Get wallet error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching the wallet",
    });
  }
};
