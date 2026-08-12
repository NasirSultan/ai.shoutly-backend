import { IsArray, IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

export class YoutubeOptionsDto {
  @IsBoolean()
  @IsOptional()
  isShort?: boolean;

  @IsIn(['public', 'private', 'unlisted'])
  @IsOptional()
  privacyStatus?: 'public' | 'private' | 'unlisted';

  @IsString()
  @IsOptional()
  title?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @IsBoolean()
  @IsOptional()
  madeForKids?: boolean;

  @IsString()
  @IsOptional()
  categoryId?: string;
}
