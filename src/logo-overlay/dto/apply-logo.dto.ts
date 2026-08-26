import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUrl, Matches, Max, Min } from 'class-validator';

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

  // Scales the whole badge card (padding, font sizes, logo, line height)
  // uniformly — separate from logoSize, which only resizes the logo icon
  // within whatever card size this produces. Optional so existing callers
  // that don't send it keep getting today's size (scale 1).
  @IsOptional()
  @IsNumber()
  @Min(0.75)
  @Max(1.5)
  cardScale?: number;

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

  // "white"/"dark" stay as convenience shortcuts for the two most common
  // choices, but any full hex color is accepted too — not locked to a binary
  // choice.
  @Matches(/^(white|dark|#[0-9A-Fa-f]{6})$/)
  textColor: string;

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
  showBadge: boolean;

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
