import { IsString, IsNotEmpty } from 'class-validator';

export class SelectSubIndustryDto {
  @IsString()
  @IsNotEmpty()
  subIndustryId: string;
}
