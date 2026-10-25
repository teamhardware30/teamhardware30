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

  env.addFilter('timeAgo', (value: Date | string | null | undefined) => {
    if (!value) {
      return '';
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    const weeks = Math.floor(days / 7);
    if (weeks < 5) return `${weeks}w ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
  });

  env.addFilter('money', (min?: number | null, max?: number | null, currency?: string | null, period?: string | null) => {
    if (!min && !max) {
      return '';
    }
    const format = (value: number) => new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(value);
    const range = min && max ? `${format(min)} – ${format(max)}` : format((min ?? max) as number);
    return `${currency ?? ''} ${range}${period ? ` / ${period}` : ''}`.trim();
  });

  env.addFilter('employmentLabel', (value?: string | null) => {
    if (!value) {
      return '';
    }
    return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  });

  env.addFilter('applyMethodLabel', (value?: string | null) => {
    if (value === 'onsite') return 'Apply on Job Copilot';
    if (value === 'email') return 'Apply by email';
    return 'Apply on company site';
  });

  app.set('view engine', 'njk');
  app.set('views', viewsDir);
}
