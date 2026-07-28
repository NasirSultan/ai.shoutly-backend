import { IsEmail, IsNotEmpty, IsString } from 'class-validator'

export class CreateIndustryRequestDto {
  @IsNotEmpty()
  @IsString()
  industryName: string

  @IsNotEmpty()
  @IsEmail()
  email: string
}
