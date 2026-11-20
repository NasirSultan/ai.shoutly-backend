import { Type } from 'class-transformer'
import { IsEnum, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator'
import { FinderLeadStatus, LeadPlatform, LeadSentiment } from '@prisma/client'

export class ListLeadsDto {
  @IsOptional()
  @IsEnum(FinderLeadStatus)
  status?: FinderLeadStatus

  @IsOptional()
  @IsEnum(LeadPlatform)
  platform?: LeadPlatform

  @IsOptional()
  @IsEnum(LeadSentiment)
  sentiment?: LeadSentiment

  @IsOptional()
  @IsUUID()
  profileId?: string

  @IsOptional()
  @IsIn(['newest', 'score'])
  sort?: 'newest' | 'score'

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number
}
