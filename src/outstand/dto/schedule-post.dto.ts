// import { IsArray, IsDateString, IsNotEmpty, IsOptional, IsString, IsUrl } from 'class-validator';

// export class SchedulePostDto {
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
//   socialAccountIds: string[];

//   @IsDateString()
//   @IsNotEmpty()
//   scheduledAt: string; // ISO 8601 Timestamp string
// }


// schedule-post.dto.ts
import { IsArray, IsDateString, IsNotEmpty, IsOptional, IsString, IsUrl, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { YoutubeOptionsDto } from './youtube-options.dto';
import { PinterestOptionsDto } from './pinterest-options.dto';

export class ScheduledPostItemDto {
  @IsString()
  @IsNotEmpty()
  content: string;

  @IsArray()
  @IsUrl({}, { each: true })
  @IsOptional()
  mediaUrls?: string[];

  @IsDateString()
  @IsNotEmpty()
  scheduledAt: string;

  // Only used when "youtube" is included in platforms — each scheduled
  // video can carry its own title/privacy/Shorts settings.
  @ValidateNested()
  @Type(() => YoutubeOptionsDto)
  @IsOptional()
  youtube?: YoutubeOptionsDto;

  // Required when "pinterest" is included in platforms — every scheduled
  // Pin needs its own board_id.
  @ValidateNested()
  @Type(() => PinterestOptionsDto)
  @IsOptional()
  pinterest?: PinterestOptionsDto;
}

export class SchedulePostDto {
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty()
  platforms: string[]; // shared across all posts in the batch

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScheduledPostItemDto)
  posts: ScheduledPostItemDto[];
}