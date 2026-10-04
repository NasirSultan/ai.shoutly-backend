import { Currency } from '../subscription/subscription.constants';

// Flat price to download one rendered template, the same for every template
// for now. Per-template pricing can replace this later without touching the
// payment flow — only getTemplatePrice needs to change.
export const TEMPLATE_PRICE: Record<Currency, number> = {
  [Currency.USD]: 0.2,
  [Currency.INR]: 20,
};

export function getTemplatePrice(currency: Currency): number {
  return TEMPLATE_PRICE[currency];
}
