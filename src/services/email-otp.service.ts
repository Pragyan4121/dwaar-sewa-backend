import bcrypt from "bcryptjs";
import { randomInt } from "crypto";

import { prisma } from "../config/prisma";
import { sendOtpEmail, type EmailOtpPurpose } from "./email.service";

interface CreateOtpInput {
  userId: number;
  email: string;
  purpose: EmailOtpPurpose;
  recipientName?: string | null;
}

interface VerifyOtpInput {
  userId: number;
  purpose: EmailOtpPurpose;
  code: string;
  markEmailVerified?: boolean;
}

interface CreateOtpResult {
  expiresAt: Date;
  resendAfterSeconds: number;
}

interface VerifyOtpResult {
  verified: true;
  userId: number;
}

export class EmailOtpServiceError extends Error {
  code: string;
  retryAfterSeconds?: number;

  constructor(code: string, retryAfterSeconds?: number) {
    super(code);

    this.name = "EmailOtpServiceError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function getPositiveIntegerEnvironmentValue(
  name: string,
  fallback: number,
): number {
  const value = Number(process.env[name]);

  if (!Number.isInteger(value) || value <= 0) {
    return fallback;
  }

  return value;
}

function generateSixDigitOtp(): string {
  return randomInt(100000, 1000000).toString();
}

function normalizeOtp(code: string): string {
  return code.trim();
}

export async function createAndSendEmailOtp({
  userId,
  email,
  purpose,
  recipientName,
}: CreateOtpInput): Promise<CreateOtpResult> {
  const normalizedEmail = email.trim().toLowerCase();

  if (!Number.isInteger(userId) || userId <= 0) {
    throw new EmailOtpServiceError("INVALID_USER_ID");
  }

  if (!normalizedEmail) {
    throw new EmailOtpServiceError("EMAIL_REQUIRED");
  }

  const expiryMinutes = getPositiveIntegerEnvironmentValue(
    "OTP_EXPIRY_MINUTES",
    10,
  );

  const resendAfterSeconds = getPositiveIntegerEnvironmentValue(
    "OTP_RESEND_SECONDS",
    60,
  );

  const maxAttempts = getPositiveIntegerEnvironmentValue("OTP_MAX_ATTEMPTS", 5);

  const latestOtp = await prisma.email_otps.findFirst({
    where: {
      user_id: userId,
      purpose,
      consumed_at: null,
    },
    orderBy: {
      created_at: "desc",
    },
    select: {
      id: true,
      created_at: true,
    },
  });

  if (latestOtp) {
    const elapsedMilliseconds = Date.now() - latestOtp.created_at.getTime();

    const resendDelayMilliseconds = resendAfterSeconds * 1000;

    if (elapsedMilliseconds < resendDelayMilliseconds) {
      const remainingSeconds = Math.ceil(
        (resendDelayMilliseconds - elapsedMilliseconds) / 1000,
      );

      throw new EmailOtpServiceError("OTP_RESEND_TOO_SOON", remainingSeconds);
    }
  }

  const otp = generateSixDigitOtp();

  const codeHash = await bcrypt.hash(otp, 10);

  const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

  const createdOtp = await prisma.$transaction(async (transaction) => {
    await transaction.email_otps.updateMany({
      where: {
        user_id: userId,
        purpose,
        consumed_at: null,
      },
      data: {
        consumed_at: new Date(),
        updated_at: new Date(),
      },
    });

    return transaction.email_otps.create({
      data: {
        user_id: userId,
        purpose,
        code_hash: codeHash,
        expires_at: expiresAt,
        attempts: 0,
        max_attempts: maxAttempts,
        consumed_at: null,
      },
    });
  });

  try {
    await sendOtpEmail({
      to: normalizedEmail,
      otp,
      purpose,
      recipientName,
    });
  } catch (error) {
    await prisma.email_otps
      .delete({
        where: {
          id: createdOtp.id,
        },
      })
      .catch((deleteError) => {
        console.error("Failed to remove unsent OTP record:", deleteError);
      });

    throw error;
  }

  return {
    expiresAt,
    resendAfterSeconds,
  };
}

export async function verifyEmailOtp({
  userId,
  purpose,
  code,
  markEmailVerified = false,
}: VerifyOtpInput): Promise<VerifyOtpResult> {
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new EmailOtpServiceError("INVALID_USER_ID");
  }

  if (typeof code !== "string") {
    throw new EmailOtpServiceError("INVALID_OTP_FORMAT");
  }

  const normalizedCode = normalizeOtp(code);

  if (!/^\d{6}$/.test(normalizedCode)) {
    throw new EmailOtpServiceError("INVALID_OTP_FORMAT");
  }

  const otpRecord = await prisma.email_otps.findFirst({
    where: {
      user_id: userId,
      purpose,
      consumed_at: null,
    },
    orderBy: {
      created_at: "desc",
    },
  });

  if (!otpRecord) {
    throw new EmailOtpServiceError("OTP_NOT_FOUND");
  }

  if (otpRecord.expires_at.getTime() <= Date.now()) {
    await prisma.email_otps.update({
      where: {
        id: otpRecord.id,
      },
      data: {
        consumed_at: new Date(),
        updated_at: new Date(),
      },
    });

    throw new EmailOtpServiceError("OTP_EXPIRED");
  }

  if (otpRecord.attempts >= otpRecord.max_attempts) {
    throw new EmailOtpServiceError("OTP_MAX_ATTEMPTS_REACHED");
  }

  const otpMatches = await bcrypt.compare(normalizedCode, otpRecord.code_hash);

  if (!otpMatches) {
    const updatedOtp = await prisma.email_otps.update({
      where: {
        id: otpRecord.id,
      },
      data: {
        attempts: {
          increment: 1,
        },
        updated_at: new Date(),
      },
      select: {
        attempts: true,
        max_attempts: true,
      },
    });

    if (updatedOtp.attempts >= updatedOtp.max_attempts) {
      await prisma.email_otps.update({
        where: {
          id: otpRecord.id,
        },
        data: {
          consumed_at: new Date(),
          updated_at: new Date(),
        },
      });

      throw new EmailOtpServiceError("OTP_MAX_ATTEMPTS_REACHED");
    }

    throw new EmailOtpServiceError("INVALID_OTP");
  }

  const verifiedAt = new Date();

  await prisma.$transaction(async (transaction) => {
    await transaction.email_otps.update({
      where: {
        id: otpRecord.id,
      },
      data: {
        consumed_at: verifiedAt,
        updated_at: verifiedAt,
      },
    });

    if (markEmailVerified) {
      await transaction.users.update({
        where: {
          id: userId,
        },
        data: {
          email_verified_at: verifiedAt,
          updated_at: verifiedAt,
        },
      });
    }
  });

  return {
    verified: true,
    userId,
  };
}
