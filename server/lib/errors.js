/** Typed API errors. Every error surfaced to a client is one of these. */
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message, details) {
    return new ApiError(400, 'bad_request', message, details);
  }
  static validation(details) {
    return new ApiError(422, 'validation_failed', 'Some fields need attention.', details);
  }
  static unauthorized(message = 'You need to sign in to do that.') {
    return new ApiError(401, 'unauthorized', message);
  }
  static forbidden(message = 'You do not have access to that.') {
    return new ApiError(403, 'forbidden', message);
  }
  static notFound(message = 'Not found.') {
    return new ApiError(404, 'not_found', message);
  }
  static conflict(message) {
    return new ApiError(409, 'conflict', message);
  }
  static tooManyRequests(message = 'Too many attempts. Please wait a moment and try again.') {
    return new ApiError(429, 'rate_limited', message);
  }
  static payloadTooLarge(message) {
    return new ApiError(413, 'payload_too_large', message);
  }
  static internal(message = 'Something went wrong on our side. Please try again.') {
    return new ApiError(500, 'internal_error', message);
  }
}

export function isApiError(error) {
  return error instanceof ApiError;
}
