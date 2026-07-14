import { IsEmail, IsNotEmpty } from 'class-validator'

export class SubscribeNewsletterDto {
  @IsNotEmpty()
  @IsEmail()
  email: string
}
