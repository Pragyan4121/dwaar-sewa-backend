import { prisma } from "./src/config/prisma";

const maintenanceSettings = [
  {
    setting_key: "maintenance_badge",
    setting_value: "Scheduled Maintenance",
    value_type: "string",
    description: "Badge text shown on the maintenance screen",
    is_public: true,
  },
  {
    setting_key: "maintenance_title",
    setting_value: "We’re Under Maintenance",
    value_type: "string",
    description: "Main maintenance screen heading",
    is_public: true,
  },
  {
    setting_key: "maintenance_message",
    setting_value:
      "We’re making Dwaar Sewa better for you. Customer and provider services are temporarily unavailable while we perform scheduled maintenance.",
    value_type: "string",
    description: "Main maintenance screen message",
    is_public: true,
  },
  {
    setting_key: "maintenance_return_title",
    setting_value: "We’ll be back soon",
    value_type: "string",
    description: "Maintenance return status title",
    is_public: true,
  },
  {
    setting_key: "maintenance_return_message",
    setting_value: "Improving. Upgrading. Serving you better.",
    value_type: "string",
    description: "Maintenance return status message",
    is_public: true,
  },
  {
    setting_key: "maintenance_support_title",
    setting_value: "Need urgent help? Contact support:",
    value_type: "string",
    description: "Maintenance support section title",
    is_public: true,
  },
  {
    setting_key: "maintenance_thank_you_title",
    setting_value: "Thank you for your patience.",
    value_type: "string",
    description: "Maintenance thank-you title",
    is_public: true,
  },
  {
    setting_key: "maintenance_thank_you_message",
    setting_value: "A better Dwaar Sewa is on the way!",
    value_type: "string",
    description: "Maintenance thank-you message",
    is_public: true,
  },
  {
    setting_key: "maintenance_side_note",
    setting_value: "Good services take a little extra time",
    value_type: "string",
    description: "Small decorative maintenance message",
    is_public: true,
  },
  {
    setting_key: "maintenance_service_message",
    setting_value: "Better Services Ahead",
    value_type: "string",
    description: "Message displayed inside the maintenance illustration",
    is_public: true,
  },
  {
    setting_key: "maintenance_footer_item_1",
    setting_value: "Trusted Professionals",
    value_type: "string",
    description: "First maintenance footer message",
    is_public: true,
  },
  {
    setting_key: "maintenance_footer_item_2",
    setting_value: "Happier Homes",
    value_type: "string",
    description: "Second maintenance footer message",
    is_public: true,
  },
  {
    setting_key: "maintenance_footer_item_3",
    setting_value: "Stronger Communities",
    value_type: "string",
    description: "Third maintenance footer message",
    is_public: true,
  },
  {
    setting_key: "maintenance_brand_tagline",
    setting_value: "Homes Happier. People Brighter.",
    value_type: "string",
    description: "Maintenance screen brand tagline",
    is_public: true,
  },
];

async function main() {
  for (const setting of maintenanceSettings) {
    await prisma.system_settings.upsert({
      where: {
        setting_key: setting.setting_key,
      },
      update: {
        is_public: true,
        description: setting.description,
      },
      create: {
        ...setting,
        updated_at: new Date(),
      },
    });
  }
  await prisma.system_settings.updateMany({
    where: {
      setting_key: {
        in: [
          "maintenance_mode",
          "business_name",
          "support_email",
          "support_phone",
        ],
      },
    },
    data: {
      is_public: true,
    },
  });
  console.log("Maintenance settings added successfully.");
}

main()
  .catch((error) => {
    console.error("Could not add maintenance settings:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
