const { prisma } = require("./dist/config/prisma.js");

async function main() {
  await prisma.system_settings.upsert({
    where: {
      setting_key: "provider_commission_percent",
    },
    update: {
      setting_value: "10",
      updated_at: new Date(),
    },
    create: {
      setting_key: "provider_commission_percent",
      setting_value: "10",
      created_at: new Date(),
      updated_at: new Date(),
    },
  });

  console.log("provider_commission_percent = 10 saved");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
