// import { IsArray, IsNotEmpty, IsOptional, IsString, IsUrl } from 'class-validator';

// export class PublishPostDto {
//   @IsString()
//   @IsNotEmpty()
//   content: string;

//   @IsArray()
//   @IsUrl({}, { each: true })
//   @IsOptional()
//   mediaUrls?: string[];

//   @IsArray()
//   @IsString({ each: true })
//   @IsNotEmpty()
//   socialAccountIds: string[]; // IDs from your local Database
// }

// publish-post.dto.ts
import { IsArray, IsNotEmpty, IsOptional, IsString, IsUrl, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { YoutubeOptionsDto } from './youtube-options.dto';

export class PublishPostDto {
  @IsString()
  @IsNotEmpty()
  content: string;

  @IsArray()
  @IsUrl({}, { each: true })
  @IsOptional()
  mediaUrls?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty()
  platforms: string[]; // e.g. ["instagram", "facebook"]

  // Only used when "youtube" is included in platforms — a video file
  // requires this to know title/privacy/Shorts settings.
  @ValidateNested()
  @Type(() => YoutubeOptionsDto)
  @IsOptional()
  youtube?: YoutubeOptionsDto;
}