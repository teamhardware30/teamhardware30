import { SetMetadata } from '@nestjs/common';
import { User } from '../../../db/schema';

export const ROLES_KEY = 'roles';
export type AuthRole = User['role'] | 'seeker' | 'employer';
export const Roles = (...roles: AuthRole[]) => SetMetadata(ROLES_KEY, roles);
