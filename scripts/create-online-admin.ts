import bcrypt from "bcryptjs";

import { prisma } from "../src/config/prisma";

async function main() {
  const adminName = process.env.ADMIN_NAME?.trim();
  const adminPhone = process.env.ADMIN_PHONE?.trim();
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminName) {
    throw new Error("ADMIN_NAME is required.");
  }

  if (!adminPhone) {
    throw new Error("ADMIN_PHONE is required.");
  }

  if (!adminPassword || adminPassword.length < 8) {
    throw new Error(
      "ADMIN_PASSWORD is required and must be at least 8 characters.",
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Make sure required roles exist
  |--------------------------------------------------------------------------
  */

  const customerRole = await prisma.roles.upsert({
    where: {
      name: "customer",
    },
    update: {},
    create: {
      name: "customer",
    },
  });

  const providerRole = await prisma.roles.upsert({
    where: {
      name: "provider",
    },
    update: {},
    create: {
      name: "provider",
    },
  });

  const adminRole = await prisma.roles.upsert({
    where: {
      name: "admin",
    },
    update: {},
    create: {
      name: "admin",
    },
  });

  console.log("Roles ready:");
  console.log({
    customer: customerRole.id,
    provider: providerRole.id,
    admin: adminRole.id,
  });

  /*
  |--------------------------------------------------------------------------
  | Hash admin password
  |--------------------------------------------------------------------------
  */

  const passwordHash = await bcrypt.hash(adminPassword, 12);

  /*
  |--------------------------------------------------------------------------
  | Find existing admin
  |--------------------------------------------------------------------------
  */

  const existingAdmin = await prisma.users.findFirst({
    where: {
      role_id: adminRole.id,
      OR: [
        {
          phone: adminPhone,
        },
        ...(adminEmail
          ? [
              {
                email: adminEmail,
              },
            ]
          : []),
      ],
    },
  });

  if (existingAdmin) {
    const updatedAdmin = await prisma.users.update({
      where: {
        id: existingAdmin.id,
      },
      data: {
        full_name: adminName,
        phone: adminPhone,
        email: adminEmail || null,
        password_hash: passwordHash,
        role_id: adminRole.id,
        is_active: true,
        updated_at: new Date(),
      },
      select: {
        id: true,
        full_name: true,
        phone: true,
        email: true,
        is_active: true,
      },
    });

    console.log("Existing admin updated successfully:");
    console.log(updatedAdmin);

    return;
  }

  /*
  |--------------------------------------------------------------------------
  | Create admin
  |--------------------------------------------------------------------------
  */

  const admin = await prisma.users.create({
    data: {
      full_name: adminName,
      phone: adminPhone,
      email: adminEmail || null,
      password_hash: passwordHash,
      role_id: adminRole.id,
      is_active: true,
      email_verified_at: adminEmail ? new Date() : null,
    },
    select: {
      id: true,
      full_name: true,
      phone: true,
      email: true,
      is_active: true,
    },
  });

  console.log("Online admin created successfully:");
  console.log(admin);
}

main()
  .catch((error) => {
    console.error("Failed to create online admin:");
    console.error(error);

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
