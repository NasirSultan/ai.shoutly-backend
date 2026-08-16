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

  /** Groups turns for short-term memory (last 3 exchanges). Omit for a stateless call. */
  @IsString()
  @IsOptional()
  sessionId?: string
}
