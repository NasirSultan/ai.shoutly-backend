import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { Currency } from '../../subscription/subscription.constants';

export class TemplateCheckoutDto {
  // The downloadToken returned by POST /templates/apply-logo.
  @IsString()
  @IsNotEmpty()
  token: string;

  @IsEnum(Currency)
  currency: Currency;
}
