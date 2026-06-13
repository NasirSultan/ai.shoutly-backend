import { IsArray, ValidateNested, ArrayNotEmpty, ArrayMaxSize } from 'class-validator'
import { Type } from 'class-transformer'
import { UploadDocumentDto } from './upload-document.dto'

export class BulkUploadDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => UploadDocumentDto)
  documents: UploadDocumentDto[]
}
