import { IsEnum } from 'class-validator'
import { IndustryRequestStatus } from '@prisma/client'

export class UpdateIndustryRequestStatusDto {
  @IsEnum(IndustryRequestStatus)
  status: IndustryRequestStatus
}
