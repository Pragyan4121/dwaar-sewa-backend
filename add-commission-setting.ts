import { prisma } from "./src/config/prisma";

async function main() {
  const setting = await prisma.system_settings.upsert({
    where: {
      setting_key: "provider_commission_percentage",
    },
    update: {
      setting_value: "5",
      value_type: "number",
      description:
        "Commission percentage deducted from completed provider bookings",
      is_public: false,
    },
    create: {
      setting_key: "provider_commission_percentage",
      setting_value: "5",
      value_type: "number",
      description:
        "Commission percentage deducted from completed provider bookings",
      is_public: false,
    },
  });

  console.log("Commission setting saved:", setting);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
