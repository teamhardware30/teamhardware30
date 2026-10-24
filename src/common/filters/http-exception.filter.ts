import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { ZodValidationException } from '../pipes/zod-validation.pipe';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const status = exception.getStatus();

    if (exception instanceof ZodValidationException) {
      res.status(status).render('errors/validation', {
        fieldErrors: exception.fieldErrors,
      });
      return;
    }

    if (req.path.startsWith('/api/')) {
      res.status(status).json(exception.getResponse());
      return;
    }

    if (status === HttpStatus.NOT_FOUND) {
      res.status(status).render('errors/404');
      return;
    }

    res.status(status).render('errors/error', {
      message: exception.message,
      status,
    });
  }
}
