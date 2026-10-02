// An error with an HTTP status that is safe to show to the client.
// `errors` optionally maps field names to messages for validation failures.
export class AppError extends Error {
  constructor(status, message, errors) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}
