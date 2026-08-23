import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUrl, Matches, Max, Min } from 'class-validator';

export class ApplyLogoDto {
  @IsUrl({ require_tld: false })
  templateImageUrl: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  logoUrl?: string;

  @IsIn(['tl', 'tr', 'bl', 'br'])
  position: 'tl' | 'tr' | 'bl' | 'br';

  @IsInt()
  @Min(24)
  @Max(80)
  logoSize: number;

  @IsIn(['glass', 'solid', 'outline', 'minimal'])
  badgeStyle: 'glass' | 'solid' | 'outline' | 'minimal';

  @IsInt()
  @Min(20)
  @Max(100)
  opacity: number;

  @IsInt()
  @Min(0)
  @Max(24)
  blur: number;

  @IsInt()
  @Min(0)
  @Max(28)
  radius: number;

  @Matches(/^#[0-9A-Fa-f]{6}$/)
  primaryColor: string;

  @IsIn(['white', 'dark'])
  textColor: 'white' | 'dark';

  @IsOptional()
  @IsString()
  brandName?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  overlayText?: string;

  @IsBoolean()
  showLogo: boolean;

  @IsBoolean()
  showName: boolean;

  @IsBoolean()
  showContact: boolean;

  @IsBoolean()
  showOvtext: boolean;

  @IsBoolean()
  showCorner: boolean;

  @IsBoolean()
  showTextbar: boolean;
}
