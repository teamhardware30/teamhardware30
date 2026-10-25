import 'express-session';
import { User as DbUser } from '../../db/schema';

declare global {
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface User extends DbUser {}
  }
}

declare module 'express-session' {
  interface SessionData {
    flash?: { type: 'success' | 'error' | 'info'; message: string }[];
  }
}
