import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class PinterestOptionsDto {
  // Required by Outstand/Pinterest — every Pin has to belong to a board.
  @IsString()
  @IsNotEmpty()
  boardId: string;

  @IsString()
  @IsOptional()
  link?: string;

  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  altText?: string;
}
