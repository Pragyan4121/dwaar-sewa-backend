export const PAYMENT_METHODS = {
  CASH: "cash",
  ESEWA: "esewa",
  KHALTI: "khalti",
  CONNECTIPS: "connectips",
} as const;

export type PaymentMethod =
  (typeof PAYMENT_METHODS)[keyof typeof PAYMENT_METHODS];

export const ALL_PAYMENT_METHODS: PaymentMethod[] = [
  PAYMENT_METHODS.CASH,
  PAYMENT_METHODS.ESEWA,
  PAYMENT_METHODS.KHALTI,
  PAYMENT_METHODS.CONNECTIPS,
];

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return (
    typeof value === "string" &&
    ALL_PAYMENT_METHODS.includes(value as PaymentMethod)
  );
}

/*
|--------------------------------------------------------------------------
| Online gateways settle to the platform first, so the provider's net
| share is credited to their wallet. Cash is collected by the provider
| in person, so only the platform's commission is deducted from the
| wallet (and can push it negative — see booking.controller.ts).
|--------------------------------------------------------------------------
*/
export function isOnlinePaymentMethod(method: string): boolean {
  return method !== PAYMENT_METHODS.CASH;
}

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  esewa: "eSewa",
  khalti: "Khalti",
  connectips: "Connect IPS",
};
