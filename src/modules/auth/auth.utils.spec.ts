import { describe, expect, it } from 'vitest';
import { safeNext } from './auth.utils';

describe('safeNext', () => {
  it('preserves local paths, including their query and fragment', () => {
    expect(safeNext('/jobs?remote=true#results')).toBe('/jobs?remote=true#results');
    expect(safeNext('/')).toBe('/');
  });

  it('rejects external, protocol-relative, and malformed redirects', () => {
    const unsafeValues: unknown[] = [
      'https://evil.example/phish',
      'http://evil.example/phish',
      'javascript:alert(1)',
      '//evil.example/phish',
      '///evil.example/phish',
      '/\\evil.example/phish',
      '/\nlocation',
      '',
      null,
      undefined,
      ['/profile'],
    ];

    for (const value of unsafeValues) {
      expect(safeNext(value)).toBe('/profile');
    }
  });
});
