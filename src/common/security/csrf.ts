import { doubleCsrf } from 'csrf-csrf';
import { Request } from 'express';

export const { doubleCsrfProtection, generateToken } = doubleCsrf({
  getSecret: () => process.env.CSRF_SECRET ?? '',
  cookieName: 'csrf-token',
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
  },
  getTokenFromRequest: (req: Request) => (req.headers['x-csrf-token'] as string) || (req.body as Record<string, string> | undefined)?._csrf,
});
