import { IsDateString, IsEnum, IsString, IsOptional } from 'class-validator'
import { FestivalType } from '@prisma/client'

export class UpdateFestivalDto {
  @IsOptional()
  @IsDateString()
  date?: string

  @IsOptional()
  @IsString()
  event?: string

  @IsOptional()
  @IsEnum(FestivalType)
  type?: FestivalType

  @IsOptional()
  @IsString()
  country?: string
}
