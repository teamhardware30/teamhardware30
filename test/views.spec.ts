import { join } from 'path';
import nunjucks from 'nunjucks';
import { beforeAll, describe, expect, it } from 'vitest';

const views = join(process.cwd(), 'views');

beforeAll(() => {
  nunjucks.configure(views, { autoescape: true, noCache: true });
});

describe('Nunjucks components', () => {
  it('compiles every application template', () => {
    expect(() => nunjucks.precompile(views)).not.toThrow();
  });

  it('renders score thresholds accessibly', () => {
    const template = '{% from "components/score_ring.njk" import score_ring %}{{ score_ring(score) }}';
    expect(nunjucks.renderString(template, { score: 59 })).toContain('#64748b');
    expect(nunjucks.renderString(template, { score: 60 })).toContain('#d97706');
    expect(nunjucks.renderString(template, { score: 79 })).toContain('#d97706');
    expect(nunjucks.renderString(template, { score: 80 })).toContain('#166534');
    expect(nunjucks.renderString(template, { score: 80 })).toContain('aria-label="Score 80 out of 100"');
  });

  it('renders labels, submitted values, and field errors', () => {
    const html = nunjucks.renderString(
      '{% from "components/input.njk" import input %}{{ input("title", { label: "Title", value: values.title, error: fieldErrors.title, required: true }) }}',
      { values: { title: '<unsafe>' }, fieldErrors: { title: 'Required' } },
    );
    expect(html).toContain('for="title"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('Required');
    expect(html).toContain('&lt;unsafe&gt;');
    expect(html).not.toContain('value="<unsafe>"');
  });

  it('renders the application shell with navigation and a skip link', () => {
    const html = nunjucks.render('layouts/base.njk', {
      csrfToken: 'token',
      flash: [],
      currentPath: '/jobs',
      user: { name: 'Test User', email: 'test@example.com', role: 'user' },
    });
    expect(html).toContain('Skip to content');
    expect(html).toContain('Matches');
    expect(html).toContain('Applications');
    expect(html).toContain('mobile-navigation');
    expect(html).toContain('Account menu');
  });
});
