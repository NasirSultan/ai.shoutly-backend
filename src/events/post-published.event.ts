// Emitted after a post is confirmed live on at least one platform.
// Decouples "the post got published" from "what happens as a result" (right
// now: a notification email) — the two producers below don't know or care
// who's listening, and a listener can be added/removed without touching them.
export class PostPublishedEvent {
  constructor(
    public readonly userEmail: string,
    public readonly userName: string,
    public readonly platforms: Array<{ platform: string; accountName: string }>,
    // Captured by the producer at the moment of successful publish, not by
    // the listener at whatever later moment it happens to run.
    public readonly publishedAt: Date,
    public readonly userTimezone: string | null,
  ) {}
}
