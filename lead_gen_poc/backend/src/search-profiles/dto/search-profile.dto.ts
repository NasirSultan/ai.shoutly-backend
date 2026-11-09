import { PartialType } from '@nestjs/mapped-types'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator'
import { LeadPlatform } from '@prisma/client'

export class CreateSearchProfileDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string

  @IsOptional()
  @IsString()
  @MaxLength(300)
  websiteUrl?: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  summary?: string

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  keywords!: string[]

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(15)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  subreddits?: string[]

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  exclusions?: string[]

  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(LeadPlatform, { each: true })
  platforms!: LeadPlatform[]

  @IsOptional()
  @IsBoolean()
  active?: boolean
}

export class UpdateSearchProfileDto extends PartialType(CreateSearchProfileDto) {}
