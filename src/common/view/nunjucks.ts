import { Express } from 'express';
import * as nunjucks from 'nunjucks';
import sanitizeHtml from 'sanitize-html';
import { join } from 'path';

export function configureViews(app: Express): void {
  const viewsDir = join(__dirname, '..', '..', '..', 'views');

  const env = nunjucks.configure(viewsDir, {
    express: app,
    autoescape: true,
    watch: process.env.NODE_ENV !== 'production',
    noCache: process.env.NODE_ENV !== 'production',
  });

  env.addFilter('sanitizeHtml', (html: string) =>
    sanitizeHtml(html, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(['h1', 'h2', 'img']),
      allowedAttributes: {
        ...sanitizeHtml.defaults.allowedAttributes,
        img: ['src', 'alt'],
      },
    }),
  );

  app.set('view engine', 'njk');
  app.set('views', viewsDir);
}
