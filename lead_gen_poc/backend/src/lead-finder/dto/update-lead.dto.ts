import { IsBoolean, IsEnum, IsOptional } from 'class-validator'
import { FinderLeadStatus } from '@prisma/client'

export class UpdateLeadDto {
  @IsOptional()
  @IsEnum(FinderLeadStatus)
  status?: FinderLeadStatus

  /** "Not a real lead" feedback. true also dismisses the lead. */
  @IsOptional()
  @IsBoolean()
  notALead?: boolean
}
