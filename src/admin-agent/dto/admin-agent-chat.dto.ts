import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator'

export class AdminAgentChatDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message: string

  @IsOptional()
  @IsUUID()
  threadId?: string
}
