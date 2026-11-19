import { IsString, MaxLength, MinLength } from 'class-validator'

export const DESCRIPTION_MIN_LENGTH = 30
export const DESCRIPTION_MAX_LENGTH = 3000

export class DescribeBusinessDto {
  // The owner's own words: what the business is and what it sells.
  @IsString()
  @MinLength(DESCRIPTION_MIN_LENGTH, {
    message: `Describe your business in at least ${DESCRIPTION_MIN_LENGTH} characters.`,
  })
  @MaxLength(DESCRIPTION_MAX_LENGTH, {
    message: `Keep the description under ${DESCRIPTION_MAX_LENGTH} characters.`,
  })
  description!: string
}
