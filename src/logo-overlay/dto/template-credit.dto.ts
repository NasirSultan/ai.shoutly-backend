import { IsEmail, IsInt, IsNotEmpty, IsString, Length, Matches, Max, Min } from 'class-validator';

export class SendCreditOtpDto {
  @IsEmail()
  email: string;
}

export class VerifyCreditOtpDto {
  @IsEmail()
  email: string;

  @Length(6, 6)
  @Matches(/^\d{6}$/)
  otp: string;
}

export class RedeemCreditDto {
  // The downloadToken returned by POST /templates/apply-logo.
  @IsString()
  @IsNotEmpty()
  token: string;

  // The creditToken returned by POST /templates/credits/verify-otp.
  @IsString()
  @IsNotEmpty()
  creditToken: string;
}

export class GrantCreditsDto {
  @IsEmail()
  email: string;

  @IsInt()
  @Min(1)
  @Max(10000)
  credits: number;
}
