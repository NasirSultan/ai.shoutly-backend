import { IsString, IsNotEmpty, IsOptional, IsObject, MaxLength } from 'class-validator'

export class UploadDocumentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string

  @IsString()
  @IsNotEmpty()
  content: string

  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>
}
