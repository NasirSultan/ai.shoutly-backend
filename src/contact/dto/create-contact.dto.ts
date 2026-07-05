import { IsEmail, IsNotEmpty, IsString, IsOptional } from 'class-validator'

export class CreateContactDto {
  @IsNotEmpty()
  @IsString()
  name: string

  @IsNotEmpty()
  @IsEmail()
  email: string

  @IsNotEmpty()
  @IsString()
  phone: string

  @IsNotEmpty()
  @IsString()
  query: string
}
