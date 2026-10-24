import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { ZodValidationException } from '../pipes/zod-validation.pipe';
import { RedirectException } from '../exceptions/redirect.exception';

/**
 * Catches everything, not just HttpException: csrf-csrf's invalid-token
 * error (and anything else thrown from plain Express middleware ahead of
 * Nest's router) is a plain `http-errors` object, not an HttpException, so
 * a `@Catch(HttpException)` filter would miss it and fall through to
 * Nest's default bare-JSON handler.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    if (!(exception instanceof HttpException)) {
      this.logger.error(`Unhandled error on ${req.method} ${req.path}`, exception instanceof Error ? exception.stack : String(exception));
    }

    if (exception instanceof RedirectException) {
      res.redirect(exception.location);
      return;
    }

    if (exception instanceof ZodValidationException) {
      res.status(exception.getStatus()).render('errors/validation', {
        fieldErrors: exception.fieldErrors,
      });
      return;
    }

    const { status, message } = describeError(exception);

    if (req.path.startsWith('/api/')) {
      res.status(status).json(exception instanceof HttpException ? exception.getResponse() : { statusCode: status, message });
      return;
    }

    if (status === HttpStatus.NOT_FOUND) {
      res.status(status).render('errors/404');
      return;
    }

    res.status(status).render('errors/error', { message, status });
  }
}

function describeError(exception: unknown): { status: number; message: string } {
  if (exception instanceof HttpException) {
    return { status: exception.getStatus(), message: exception.message };
  }
  if (isHttpErrorsLike(exception)) {
    return { status: exception.status ?? exception.statusCode ?? 500, message: exception.message };
  }
  return { status: HttpStatus.INTERNAL_SERVER_ERROR, message: 'Something went wrong' };
}

function isHttpErrorsLike(exception: unknown): exception is Error & { status?: number; statusCode?: number } {
  return exception instanceof Error && ('status' in exception || 'statusCode' in exception);
}
