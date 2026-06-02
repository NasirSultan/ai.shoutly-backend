import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class ConnectAccountDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['facebook', 'instagram', 'youtube'])
  platform: string;
}
