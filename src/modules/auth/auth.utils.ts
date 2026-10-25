/* eslint-disable no-control-regex */
import { Request } from 'express';

const DEFAULT_NEXT = '/profile';

export function safeNext(next: unknown): string {
  if (
    typeof next !== 'string' ||
    !next.startsWith('/') ||
    next.startsWith('//') ||
    next.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(next)
  ) {
    return DEFAULT_NEXT;
  }

  try {
    const url = new URL(next, 'http://job-copilot.local');
    return url.origin === 'http://job-copilot.local' ? next : DEFAULT_NEXT;
  } catch {
    return DEFAULT_NEXT;
  }
}

export function pushFlash(req: Request, type: 'success' | 'error' | 'info', message: string): void {
  if (!req.session) {
    return;
  }
  req.session.flash = [...(req.session.flash ?? []), { type, message }];
}
