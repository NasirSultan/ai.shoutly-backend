import { IsEnum } from "class-validator";
import { Plan, Billing, Currency } from "../subscription.constants";

export class CreateSubscriptionDto {
  @IsEnum(Plan)
  plan: Plan;

  @IsEnum(Billing)
  billing: Billing;

  @IsEnum(Currency)
  currency: Currency;
}
