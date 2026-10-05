import { IsOptional, IsString, MaxLength } from 'class-validator'

export class SetWatcherWebsiteDto {
  // Empty or null clears it, so the user can pick their website again.
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  website?: string | null
}
