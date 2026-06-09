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