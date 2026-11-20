import { IsUUID } from 'class-validator'

export class FetchLeadsDto {
  @IsUUID()
  profileId!: string
}
