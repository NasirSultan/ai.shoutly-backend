import { IsOptional, IsString, MaxLength } from 'class-validator'

export class CheckWebsiteDto {
  // Optional once the user has a website: their own website is checked.
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  url?: string
}
