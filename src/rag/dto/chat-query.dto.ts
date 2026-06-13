import { IsString, IsNotEmpty, IsOptional, IsInt, Min, Max } from 'class-validator'

export class ChatQueryDto {
  @IsString()
  @IsNotEmpty()
  query: string

  @IsInt()
  @Min(1)
  @Max(10)
  @IsOptional()
  topK?: number = 5
}
