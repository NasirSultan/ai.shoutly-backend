import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator'

export class AdminAgentChatDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message: string

  // Leave out to start a new chat; the response returns the new id.
  @IsOptional()
  @IsUUID()
  threadId?: string
}
