import { IsNotEmpty, IsString } from 'class-validator';

// Bluesky has no OAuth step — the handle + app password are submitted
// straight through to Outstand, which uses them once to create an AT
// Protocol session. This must come from the account owner, entered
// directly in the connect form — never hardcoded, logged, or relayed.
export class ConnectBlueskyDto {
  @IsString()
  @IsNotEmpty()
  handle: string;

  @IsString()
  @IsNotEmpty()
  appPassword: string;
}
