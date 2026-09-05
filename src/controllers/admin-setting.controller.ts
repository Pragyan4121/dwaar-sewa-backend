import type { Response } from "express";
import { prisma } from "../config/prisma";
import type { AuthenticatedRequest } from "../middlewares/auth.middleware";

const allowedValueTypes = ["string", "number", "boolean", "json"] as const;

type SettingValueType = (typeof allowedValueTypes)[number];

const validateSettingValue = (value: unknown, valueType: SettingValueType) => {
  if (valueType === "string") {
    return typeof value === "string";
  }

  if (valueType === "number") {
    if (typeof value === "number" && Number.isFinite(value)) {
      return true;
    }

    if (
      typeof value === "string" &&
      value.trim() !== "" &&
      Number.isFinite(Number(value))
    ) {
      return true;
    }

    return false;
  }

  if (valueType === "boolean") {
    return typeof value === "boolean" || value === "true" || value === "false";
  }

  if (valueType === "json") {
    if (typeof value === "object" && value !== null) {
      return true;
    }

    if (typeof value === "string") {
      try {
        JSON.parse(value);
        return true;
      } catch {
        return false;
      }
    }

    return false;
  }

  return false;
};

const serializeSettingValue = (value: unknown, valueType: SettingValueType) => {
  if (valueType === "string") {
    return String(value);
  }

  if (valueType === "number") {
    return String(Number(value));
  }

  if (valueType === "boolean") {
    return String(value === true || value === "true");
  }

  if (valueType === "json") {
    return typeof value === "string" ? value : JSON.stringify(value);
  }

  return String(value);
};

/*
|--------------------------------------------------------------------------
| Admin: Get all system settings
|--------------------------------------------------------------------------
|
| GET /api/admin/settings
|
|--------------------------------------------------------------------------
*/

export const getAllSettingsForAdmin = async (
  _request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const settings = await prisma.system_settings.findMany({
      orderBy: {
        setting_key: "asc",
      },
    });

    return response.status(200).json({
      message: "Settings fetched successfully",
      settings,
    });
  } catch (error) {
    console.error("Admin get settings error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching settings",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Public: Get public system settings
|--------------------------------------------------------------------------
|
| GET /api/settings/public
|
|--------------------------------------------------------------------------
*/

export const getPublicSettings = async (
  _request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const settings = await prisma.system_settings.findMany({
      where: {
        is_public: true,
      },
      select: {
        setting_key: true,
        setting_value: true,
        value_type: true,
      },
      orderBy: {
        setting_key: "asc",
      },
    });

    const publicSettings = settings.reduce<Record<string, unknown>>(
      (result, setting) => {
        let parsedValue: unknown = setting.setting_value;

        if (setting.value_type === "number" && setting.setting_value !== null) {
          parsedValue = Number(setting.setting_value);
        }

        if (setting.value_type === "boolean") {
          parsedValue = setting.setting_value === "true";
        }

        if (setting.value_type === "json" && setting.setting_value) {
          try {
            parsedValue = JSON.parse(setting.setting_value);
          } catch {
            parsedValue = null;
          }
        }

        result[setting.setting_key] = parsedValue;

        return result;
      },
      {},
    );

    return response.status(200).json({
      message: "Public settings fetched successfully",
      settings: publicSettings,
    });
  } catch (error) {
    console.error("Get public settings error:", error);

    return response.status(500).json({
      message: "Something went wrong while fetching public settings",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin: Update one system setting
|--------------------------------------------------------------------------
|
| PATCH /api/admin/settings/:key
|
| Body:
| {
|   "value": "20"
| }
|
|--------------------------------------------------------------------------
*/

export const updateSettingForAdmin = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const adminId = request.user?.userId;
    const settingKey = request.params.key;
    const value = request.body.value;

    if (!adminId) {
      return response.status(401).json({
        message: "Admin is not authenticated",
      });
    }

    if (typeof settingKey !== "string" || settingKey.trim().length === 0) {
      return response.status(400).json({
        message: "Invalid setting key",
      });
    }

    const existingSetting = await prisma.system_settings.findUnique({
      where: {
        setting_key: settingKey.trim(),
      },
    });

    if (!existingSetting) {
      return response.status(404).json({
        message: "Setting not found",
      });
    }

    const valueType = existingSetting.value_type as SettingValueType;

    if (!allowedValueTypes.includes(valueType)) {
      return response.status(400).json({
        message: "Unsupported setting value type",
      });
    }

    if (!validateSettingValue(value, valueType)) {
      return response.status(400).json({
        message: `Invalid value for ${valueType} setting`,
      });
    }

    const serializedValue = serializeSettingValue(value, valueType);

    const updatedSetting = await prisma.system_settings.update({
      where: {
        setting_key: settingKey.trim(),
      },
      data: {
        setting_value: serializedValue,
        updated_by: adminId,
        updated_at: new Date(),
      },
    });

    return response.status(200).json({
      message: "Setting updated successfully",
      setting: updatedSetting,
    });
  } catch (error) {
    console.error("Admin update setting error:", error);

    return response.status(500).json({
      message: "Something went wrong while updating the setting",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin: Update multiple system settings
|--------------------------------------------------------------------------
|
| PATCH /api/admin/settings
|
| Body:
| {
|   "settings": {
|     "business_name": "Dwaar Sewa",
|     "support_phone": "98XXXXXXXX",
|     "provider_commission_percent": 15
|   }
| }
|
|--------------------------------------------------------------------------
*/

export const updateMultipleSettingsForAdmin = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const adminId = request.user?.userId;
    const settingsInput = request.body.settings;

    if (!adminId) {
      return response.status(401).json({
        message: "Admin is not authenticated",
      });
    }

    if (
      typeof settingsInput !== "object" ||
      settingsInput === null ||
      Array.isArray(settingsInput)
    ) {
      return response.status(400).json({
        message: "Settings must be provided as an object",
      });
    }

    const settingEntries = Object.entries(
      settingsInput as Record<string, unknown>,
    );

    if (settingEntries.length === 0) {
      return response.status(400).json({
        message: "At least one setting is required",
      });
    }

    const settingKeys = settingEntries.map(([key]) => key);

    const existingSettings = await prisma.system_settings.findMany({
      where: {
        setting_key: {
          in: settingKeys,
        },
      },
    });

    const missingKeys = settingKeys.filter(
      (key) => !existingSettings.some((setting) => setting.setting_key === key),
    );

    if (missingKeys.length > 0) {
      return response.status(404).json({
        message: `Unknown setting keys: ${missingKeys.join(", ")}`,
      });
    }

    const updates = settingEntries.map(([key, value]) => {
      const existingSetting = existingSettings.find(
        (setting) => setting.setting_key === key,
      );

      if (!existingSetting) {
        throw new Error(`SETTING_NOT_FOUND:${key}`);
      }

      const valueType = existingSetting.value_type as SettingValueType;

      if (!allowedValueTypes.includes(valueType)) {
        throw new Error(`INVALID_VALUE_TYPE:${key}`);
      }

      if (!validateSettingValue(value, valueType)) {
        throw new Error(`INVALID_VALUE:${key}:${valueType}`);
      }

      return prisma.system_settings.update({
        where: {
          setting_key: key,
        },
        data: {
          setting_value: serializeSettingValue(value, valueType),
          updated_by: adminId,
          updated_at: new Date(),
        },
      });
    });

    const updatedSettings = await prisma.$transaction(updates);

    return response.status(200).json({
      message: "Settings updated successfully",
      settings: updatedSettings,
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("INVALID_VALUE:")) {
      const [, key, valueType] = error.message.split(":");

      return response.status(400).json({
        message: `Invalid value for ${key}. Expected ${valueType}.`,
      });
    }

    console.error("Admin bulk settings update error:", error);

    return response.status(500).json({
      message: "Something went wrong while updating settings",
    });
  }
};
