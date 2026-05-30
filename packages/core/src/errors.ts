export class TokenOpsError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "TokenOpsError";
    this.code = code;
    this.status = status;
  }
}
