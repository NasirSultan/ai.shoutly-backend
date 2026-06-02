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
  platforms: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScheduledPostItemDto)
  posts: ScheduledPostItemDto[];
}
