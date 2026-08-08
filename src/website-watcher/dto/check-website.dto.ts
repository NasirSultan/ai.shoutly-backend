import { IsNotEmpty, IsUrl } from 'class-validator'

export class CheckWebsiteDto {
  @IsNotEmpty()
  @IsUrl()
  url: string
}
