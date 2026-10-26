/** Carry an intentional HTTP status without leaking database details to clients. */
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
