import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator'

export class AdminAgentChatDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message: string

  // Leave out (or send "" / null) to start a new chat; the response returns the new id.
  @ValidateIf((o) => o.threadId !== undefined && o.threadId !== null && o.threadId !== '')
  @IsUUID()
  threadId?: string
}
