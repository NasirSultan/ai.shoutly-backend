import { IsNotEmpty, IsString } from 'class-validator';

// The handle and app password open a Bluesky session. The password is used
// once and is not stored.
export class ConnectBlueskyDto {
  @IsString()
  @IsNotEmpty()
  handle: string;

  @IsString()
  @IsNotEmpty()
  appPassword: string;
}
