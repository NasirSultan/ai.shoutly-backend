export enum Plan {
  STARTER = "STARTER",
  BUSINESS = "BUSINESS",
  AUTOPILOT = "AUTOPILOT",
}

export enum Billing {
  MONTHLY = "MONTHLY",
  YEARLY = "YEARLY",
}

export enum Currency {
  INR = "INR",
  USD = "USD",
}

// Amount charged per billing cycle (monthly = charged every month, yearly = charged once for the year).
// Yearly is monthly x 12 with 20% off, matching the pricing page.
export const PlanPrices: Record<Plan, Record<Currency, Record<Billing, number>>> = {
  [Plan.STARTER]: {
    [Currency.INR]: { [Billing.MONTHLY]: 2500, [Billing.YEARLY]: 24000 },
    [Currency.USD]: { [Billing.MONTHLY]: 29, [Billing.YEARLY]: 278 },
  },
  [Plan.BUSINESS]: {
    [Currency.INR]: { [Billing.MONTHLY]: 6500, [Billing.YEARLY]: 62400 },
    [Currency.USD]: { [Billing.MONTHLY]: 79, [Billing.YEARLY]: 758 },
  },
  [Plan.AUTOPILOT]: {
    [Currency.INR]: { [Billing.MONTHLY]: 10000, [Billing.YEARLY]: 96000 },
    [Currency.USD]: { [Billing.MONTHLY]: 119, [Billing.YEARLY]: 1142 },
  },
};
