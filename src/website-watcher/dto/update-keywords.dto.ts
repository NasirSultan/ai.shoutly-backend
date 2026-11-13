import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, MaxLength } from 'class-validator'
import { KEYWORD_MAX_LENGTH, USER_KEYWORD_MAX } from '../website-watcher.util'

export class UpdateKeywordsDto {
  // The full new list: the frontend adds, removes or edits, then sends it all.
  @IsArray()
  @ArrayMinSize(1, { message: 'Keep at least 1 keyword.' })
  @ArrayMaxSize(USER_KEYWORD_MAX, { message: `You can have at most ${USER_KEYWORD_MAX} keywords.` })
  @IsString({ each: true })
  @MaxLength(KEYWORD_MAX_LENGTH, {
    each: true,
    message: `Each keyword can be at most ${KEYWORD_MAX_LENGTH} characters.`,
  })
  keywords!: string[]
}
