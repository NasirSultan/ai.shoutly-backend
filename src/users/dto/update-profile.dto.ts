import { IsBoolean, IsOptional, IsString } from 'class-validator'

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  name?: string

  @IsOptional()
  @IsString()
  phone?: string

  @IsOptional()
  @IsString()
  jobTitle?: string

  @IsOptional()
  @IsString()
  timezone?: string

  @IsOptional()
  @IsString()
  language?: string

  @IsOptional()
  @IsString()
  brandName?: string

  @IsOptional()
  @IsString()
  brandLogo?: string

  @IsOptional()
  @IsString()
  website?: string

  @IsOptional()
  @IsBoolean()
  emailNotification?: boolean

  @IsOptional()
  @IsBoolean()
  pushNotification?: boolean

  @IsOptional()
  @IsBoolean()
  weeklyNotification?: boolean
}
