import { IsArray, IsNotEmpty, IsOptional, IsString, IsUrl } from 'class-validator';

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
  platforms: string[];
}
