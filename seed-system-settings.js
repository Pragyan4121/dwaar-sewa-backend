const { prisma } = require("./dist/config/prisma.js");

const settings = [
  {
    setting_key: "business_name",
    setting_value: "Dwaar Sewa",
    value_type: "string",
    description: "Business name displayed across Dwaar Sewa.",
    is_public: true,
  },
  {
    setting_key: "support_phone",
    setting_value: "",
    value_type: "string",
    description: "Primary customer support phone number.",
    is_public: true,
  },
  {
    setting_key: "support_email",
    setting_value: "",
    value_type: "string",
    description: "Primary customer support email address.",
    is_public: true,
  },
  {
    setting_key: "default_service_area",
    setting_value: "Bharatpur",
    value_type: "string",
    description: "Default service area for Dwaar Sewa.",
    is_public: true,
  },
  {
    setting_key: "customer_cancellation_window_minutes",
    setting_value: "60",
    value_type: "number",
    description:
      "Minimum time before a scheduled service during which customer cancellation is allowed.",
    is_public: false,
  },
  {
    setting_key: "cash_payment_enabled",
    setting_value: "true",
    value_type: "boolean",
    description: "Allow customers to select cash payment.",
    is_public: true,
  },
  {
    setting_key: "provider_commission_percent",
    setting_value: "10",
    value_type: "number",
    description:
      "Platform commission percentage deducted from provider earnings.",
    is_public: false,
  },
  {
    setting_key: "maintenance_mode",
    setting_value: "false",
    value_type: "boolean",
    description:
      "Temporarily place the customer and provider platform in maintenance mode.",
    is_public: true,
  },
  {
    setting_key: "maintenance_badge",
    setting_value: "Scheduled Maintenance",
    value_type: "string",
    description: "Small label displayed above the maintenance page title.",
    is_public: true,
  },
  {
    setting_key: "maintenance_title",
    setting_value: "We're Under Maintenance",
    value_type: "string",
    description: "Main maintenance page title.",
    is_public: true,
  },
  {
    setting_key: "maintenance_message",
    setting_value:
      "We're making Dwaar Sewa better for you. Customer and provider services are temporarily unavailable.",
    value_type: "string",
    description: "Main maintenance page message.",
    is_public: true,
  },
  {
    setting_key: "maintenance_return_title",
    setting_value: "We'll be back soon",
    value_type: "string",
    description: "Heading shown for the expected return section.",
    is_public: true,
  },
  {
    setting_key: "maintenance_return_message",
    setting_value:
      "Our team is working to restore all services as quickly as possible.",
    value_type: "string",
    description: "Message shown under the return heading.",
    is_public: true,
  },
  {
    setting_key: "maintenance_support_title",
    setting_value: "Need urgent help?",
    value_type: "string",
    description: "Support section heading displayed during maintenance.",
    is_public: true,
  },
  {
    setting_key: "maintenance_thank_you_title",
    setting_value: "Thank you for your patience",
    value_type: "string",
    description: "Thank-you heading on the maintenance screen.",
    is_public: true,
  },
  {
    setting_key: "maintenance_thank_you_message",
    setting_value:
      "We appreciate your understanding while we improve Dwaar Sewa.",
    value_type: "string",
    description: "Thank-you message on the maintenance screen.",
    is_public: true,
  },
  {
    setting_key: "maintenance_side_note",
    setting_value: "Your account and existing booking information remain safe.",
    value_type: "string",
    description: "Additional reassurance note on the maintenance screen.",
    is_public: true,
  },
  {
    setting_key: "maintenance_service_message",
    setting_value:
      "Booking, provider and account services will resume after maintenance.",
    value_type: "string",
    description: "Service availability message shown during maintenance.",
    is_public: true,
  },
  {
    setting_key: "maintenance_footer_item_1",
    setting_value: "Secure platform",
    value_type: "string",
    description: "First footer highlight on the maintenance screen.",
    is_public: true,
  },
  {
    setting_key: "maintenance_footer_item_2",
    setting_value: "Verified professionals",
    value_type: "string",
    description: "Second footer highlight on the maintenance screen.",
    is_public: true,
  },
  {
    setting_key: "maintenance_footer_item_3",
    setting_value: "Reliable home services",
    value_type: "string",
    description: "Third footer highlight on the maintenance screen.",
    is_public: true,
  },
  {
    setting_key: "maintenance_brand_tagline",
    setting_value: "Reliable Home Services at Your Doorstep",
    value_type: "string",
    description: "Brand tagline displayed on the maintenance screen.",
    is_public: true,
  },
];

async function main() {
  for (const setting of settings) {
    await prisma.system_settings.upsert({
      where: {
        setting_key: setting.setting_key,
      },
      update: {
        value_type: setting.value_type,
        description: setting.description,
        is_public: setting.is_public,
      },
      create: setting,
    });

    console.log(`Ready: ${setting.setting_key}`);
  }

  console.log("All system settings are ready.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
