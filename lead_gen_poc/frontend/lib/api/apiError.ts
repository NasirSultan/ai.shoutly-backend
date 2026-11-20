// Same class as Shoulty-Ai/lib/api/apiError.ts.
/** An Error that keeps the HTTP status, so callers can react to e.g. a 429. */
export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}
