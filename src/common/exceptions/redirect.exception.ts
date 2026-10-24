import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Thrown by guards (instead of calling `res.redirect()` directly) when a
 * request should be redirected rather than rejected with an error body.
 * Returning `false` from a guard makes Nest send its own response too,
 * which would collide with a response the guard already sent and crash
 * with ERR_HTTP_HEADERS_SENT — throwing and letting HttpExceptionFilter
 * perform the redirect avoids that.
 */
export class RedirectException extends HttpException {
  constructor(public readonly location: string) {
    super('Redirect', HttpStatus.FOUND);
  }
}
