import { IsString, IsOptional, IsObject, MaxLength } from 'class-validator'

export class UpdateDocumentDto {
  @IsString()
  @IsOptional()
  @MaxLength(200)
  title?: string

  @IsString()
  @IsOptional()
  content?: string

  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>
}
