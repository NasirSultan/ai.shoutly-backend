import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class TiktokOptionsDto {
  @IsString()
  privacyLevel: string;

  @IsBoolean()
  @IsOptional()
  disableComment?: boolean;

  @IsBoolean()
  @IsOptional()
  disableDuet?: boolean;

  @IsBoolean()
  @IsOptional()
  disableStitch?: boolean;

  @IsBoolean()
  @IsOptional()
  brandOrganic?: boolean;

  @IsBoolean()
  @IsOptional()
  brandContent?: boolean;

  @IsBoolean()
  @IsOptional()
  isAigc?: boolean;
}
