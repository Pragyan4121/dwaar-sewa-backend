export const ROLE_NAMES = {
  CUSTOMER: "customer",
  PROVIDER: "provider",
  ADMIN: "admin",
} as const;

export type RoleName = (typeof ROLE_NAMES)[keyof typeof ROLE_NAMES];

export const ALL_ROLE_NAMES: RoleName[] = [
  ROLE_NAMES.CUSTOMER,
  ROLE_NAMES.PROVIDER,
  ROLE_NAMES.ADMIN,
];

export function isRoleName(value: unknown): value is RoleName {
  return (
    typeof value === "string" && ALL_ROLE_NAMES.includes(value as RoleName)
  );
}
