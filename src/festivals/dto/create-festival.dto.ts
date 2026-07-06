import { IsDateString, IsEnum, IsString, IsNotEmpty } from 'class-validator'
import { FestivalType } from '@prisma/client'

export class CreateFestivalDto {
  @IsDateString()
  date: string

  @IsString()
  @IsNotEmpty()
  event: string

  @IsEnum(FestivalType)
  type: FestivalType
}
