import * as argon2 from 'argon2';

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain);
}

export function verifyPassword(plain: string, stored: string): Promise<boolean> {
  return argon2.verify(stored, plain);
}
