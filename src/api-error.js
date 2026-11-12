export class ApiError extends Error {
  constructor(service, status, description, retryAfter = 0) {
    super(`${service}: ${description}`); this.service = service; this.status = status; this.retryAfter = retryAfter;
  }
}
