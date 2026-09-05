import bcrypt from "bcryptjs";

import { prisma } from "../src/config/prisma";

async function resetAdminPassword() {
  const identifier = process.argv[2]?.trim();
  const newPassword = process.argv[3];

  if (!identifier || !newPassword) {
    console.error(
      'Usage: npx tsx scripts/reset-admin-password.ts "<admin-phone-or-email>" "<new-password>"',
    );

    process.exitCode = 1;
    return;
  }

  if (newPassword.length < 8) {
    console.error("The new password must contain at least 8 characters.");

    process.exitCode = 1;
    return;
  }

  const adminRole = await prisma.roles.findUnique({
    where: {
      name: "admin",
    },
    select: {
      id: true,
    },
  });

  if (!adminRole) {
    console.error('The "admin" role does not exist in the database.');

    process.exitCode = 1;
    return;
  }

  const normalizedIdentifier = identifier.toLowerCase();

  const admin = await prisma.users.findFirst({
    where: {
      role_id: adminRole.id,
      OR: [
        {
          phone: identifier,
        },
        {
          email: normalizedIdentifier,
        },
      ],
    },
    select: {
      id: true,
      full_name: true,
      phone: true,
      email: true,
      is_active: true,
    },
  });

  if (!admin) {
    console.error(
      "No admin account was found with that phone number or email.",
    );

    process.exitCode = 1;
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);

  await prisma.users.update({
    where: {
      id: admin.id,
    },
    data: {
      password_hash: passwordHash,
      is_active: true,
      updated_at: new Date(),
    },
  });

  console.log("Admin password reset successfully.");
  console.log({
    id: admin.id,
    full_name: admin.full_name,
    phone: admin.phone,
    email: admin.email,
    is_active: true,
  });
}

resetAdminPassword()
  .catch((error: unknown) => {
    console.error("Admin password reset failed:", error);

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
