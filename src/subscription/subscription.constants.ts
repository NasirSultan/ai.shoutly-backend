export enum Plan {
  FULL_POWER = "GROWTH",
}

export enum Billing {
  MONTHLY = "MONTHLY",
  YEARLY = "YEARLY",
}

export enum Currency {
  INR = "INR",
  USD = "USD",
}

// Amount charged per billing cycle (monthly = charged every month, yearly = charged once for the year)
export const PlanPrices: Record<Currency, Record<Billing, number>> = {
  [Currency.INR]: {
    [Billing.MONTHLY]: 10000,
    [Billing.YEARLY]: 96000,
  },
  [Currency.USD]: {
    [Billing.MONTHLY]: 119,
    [Billing.YEARLY]: 1143,
  },
};
