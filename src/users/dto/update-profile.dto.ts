import { IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator'
import { SocialPlatform } from '@prisma/client'

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
  @Matches(/^#[0-9A-Fa-f]{6}$/)
  primaryColor?: string

  @IsOptional()
  @IsIn(['glass', 'solid', 'outline', 'minimal'])
  badgeStyle?: string

  @IsOptional()
  @IsIn(['white', 'dark'])
  textColor?: string

  @IsOptional()
  @IsInt()
  @Min(20)
  @Max(100)
  opacity?: number

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(24)
  blur?: number

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(28)
  radius?: number

  @IsOptional()
  @IsArray()
  @IsEnum(SocialPlatform, { each: true })
  applyPlatforms?: SocialPlatform[]

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
