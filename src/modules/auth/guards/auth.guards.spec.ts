import { ExecutionContext} from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { RedirectException } from '../../../common/exceptions/redirect.exception';
import { User } from '../../../db/schema';
import { AuthenticatedGuard } from './authenticated.guard';
import { ROLES_KEY, Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';

@Roles('employer')
class EmployerOnlyController {}

function contextFor(req: Request): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

function makeUser(role = 'user'): User {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'user@example.com',
    emailVerifiedAt: new Date(),
    emailVerificationToken: null,
    emailVerificationExpiresAt: null,
    passwordHash: null,
    role: role as User['role'],
    name: 'Test User',
    avatarUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeRolesGuard(requiredRoles: string[] | undefined) {
  const reflector = { getAllAndOverride: vi.fn().mockReturnValue(requiredRoles) };
  return new RolesGuard(reflector as unknown as Reflector);
}

describe('AuthenticatedGuard', () => {
  it('allows an authenticated request', () => {
    const req = { isAuthenticated: () => true } as unknown as Request;
    expect(new AuthenticatedGuard().canActivate(contextFor(req))).toBe(true);
  });

  it('redirects anonymous requests with an encoded local next path', () => {
    const req = { isAuthenticated: () => false, originalUrl: '/jobs?remote=true' } as unknown as Request;
    const activate = () => new AuthenticatedGuard().canActivate(contextFor(req));

    expect(activate).toThrow(RedirectException);
    expect(activate).toThrow(expect.objectContaining({ location: '/login?next=%2Fjobs%3Fremote%3Dtrue' }));
  });

  it('treats a missing Passport authentication method as anonymous', () => {
    const req = { originalUrl: '/profile' } as unknown as Request;
    expect(() => new AuthenticatedGuard().canActivate(contextFor(req))).toThrow(RedirectException);
  });
});

describe('RolesGuard', () => {
  it('supports employer role metadata before the database enum is migrated', () => {
    expect(Reflect.getMetadata(ROLES_KEY, EmployerOnlyController)).toEqual(['employer']);
  });

  it('allows routes without role metadata', () => {
    const req = {} as Request;
    expect(makeRolesGuard(undefined).canActivate(contextFor(req))).toBe(true);
  });

  it('allows the required employer role', () => {
    const req = { user: makeUser('employer') } as unknown as Request;
    expect(makeRolesGuard(['employer']).canActivate(contextFor(req))).toBe(true);
  });

  it.each(['user', 'seeker'])('rejects a %s user from an employer-only route', (role) => {
    const req = { user: makeUser(role) } as unknown as Request;
    expect(() => makeRolesGuard(['employer']).canActivate(contextFor(req))).toThrow(ForbiddenException);
  });

  it('allows admins only when admin is required', () => {
    const adminReq = { user: makeUser('admin') } as unknown as Request;
    const userReq = { user: makeUser('user') } as unknown as Request;

    expect(makeRolesGuard(['admin']).canActivate(contextFor(adminReq))).toBe(true);
    expect(() => makeRolesGuard(['admin']).canActivate(contextFor(userReq))).toThrow(ForbiddenException);
  });

  it('rejects a missing user instead of granting access', () => {
    expect(() => makeRolesGuard(['employer']).canActivate(contextFor({} as Request))).toThrow(ForbiddenException);
  });
});
