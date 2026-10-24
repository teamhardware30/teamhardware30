import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { Request, Response } from 'express';

/**
 * Controllers declare their full-page template with @Render('module/page').
 * When the request carries the HX-Request header, swap in the matching
 * partial (module/partials/page) so Nest's own @Render pipeline renders the
 * HTMX fragment instead, with no change needed in the controller.
 */
@Injectable()
export class HtmxRenderInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    if (req.headers['hx-request']) {
      const originalRender = res.render.bind(res);
      res.render = ((view: string, ...args: unknown[]) =>
        (originalRender as (...a: unknown[]) => void)(toPartialView(view), ...args)) as Response['render'];
    }

    return next.handle();
  }
}

function toPartialView(view: string): string {
  const segments = view.split('/');
  const page = segments.pop();
  return [...segments, 'partials', page].join('/');
}
