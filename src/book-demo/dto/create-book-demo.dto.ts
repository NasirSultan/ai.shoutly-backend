import { IsEmail, IsISO8601, IsNotEmpty, IsOptional, IsString } from 'class-validator'

export class CreateBookDemoDto {
  @IsNotEmpty()
  @IsString()
  fullName: string

  @IsNotEmpty()
  @IsString()
  businessName: string

  @IsNotEmpty()
  @IsEmail()
  email: string

  @IsOptional()
  @IsString()
  phone?: string

  @IsNotEmpty()
  @IsISO8601()
  slotTime: string

  @IsOptional()
  @IsString()
  message?: string
}
