export class UserSignedUpEvent {
  constructor(
    public readonly name: string,
    public readonly email: string,
    public readonly method: 'Email' | 'Google',
    public readonly signedUpAt: Date,
  ) {}
}
