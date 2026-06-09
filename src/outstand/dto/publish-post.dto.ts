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
import { IsArray, IsNotEmpty, IsOptional, IsString, IsUrl, IsIn } from 'class-validator';

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
}