import { IsEnum } from 'class-validator'
import { ContactMessageStatus } from '@prisma/client'

export class UpdateContactStatusDto {
  @IsEnum(ContactMessageStatus)
  status: ContactMessageStatus
}
