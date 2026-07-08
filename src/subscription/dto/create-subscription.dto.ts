import { IsEnum } from "class-validator";
import { Billing, Currency } from "../subscription.constants";

export class CreateSubscriptionDto {
  @IsEnum(Billing)
  billing: Billing;

  @IsEnum(Currency)
  currency: Currency;
}
