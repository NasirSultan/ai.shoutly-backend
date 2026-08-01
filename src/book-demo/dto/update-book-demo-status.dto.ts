import { IsEnum } from 'class-validator'
import { DemoBookingStatus } from '@prisma/client'

export class UpdateBookDemoStatusDto {
  @IsEnum(DemoBookingStatus)
  status: DemoBookingStatus
}
