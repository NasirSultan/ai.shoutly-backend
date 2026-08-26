import { IsEmail, IsNotEmpty, IsString, IsOptional } from 'class-validator'

export class CreateLeadDto {
  @IsNotEmpty()
  @IsString()
  name: string

  @IsOptional()
  @IsEmail()
  email?: string

  @IsOptional()
  @IsString()
  phone?: string

  @IsOptional()
  @IsString()
  businessName?: string

  @IsOptional()
  @IsString()
  city?: string

  @IsOptional()
  @IsString()
  service?: string

  @IsOptional()
  @IsString()
  message?: string

  @IsOptional()
  @IsString()
  businessSize?: string

  @IsOptional()
  @IsString()
  promotion?: string

  @IsOptional()
  @IsString()
  servicePage?: string

  @IsOptional()
  @IsString()
  serviceCategory?: string

  @IsOptional()
  @IsString()
  pageUrl?: string
}
