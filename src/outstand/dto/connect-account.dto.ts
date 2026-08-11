import { IsIn, IsNotEmpty, IsOptional, IsString, IsUrl } from 'class-validator';

export class ConnectAccountDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['facebook', 'instagram', 'youtube', 'x', 'linkedin', 'tiktok', 'pinterest', 'threads', 'bluesky', 'google_business'])
  platform: string;

  // Optional override for local/dev testing — production callers omit this
  // and keep getting the hardcoded production dashboard redirect.
  @IsUrl({ require_tld: false })
  @IsOptional()
  redirectUri?: string;
}