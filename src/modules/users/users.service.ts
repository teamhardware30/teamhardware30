import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt } from 'drizzle-orm';
import { DRIZZLE, Database } from '../../db/db.provider';
import { users, NewUser, User } from '../../db/schema';

@Injectable()
export class UsersService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  findByEmail(email: string): Promise<User | undefined> {
    return this.db.query.users.findFirst({ where: eq(users.email, email) });
  }

  findById(id: string): Promise<User | undefined> {
    return this.db.query.users.findFirst({ where: eq(users.id, id) });
  }

  findByVerificationToken(token: string): Promise<User | undefined> {
    return this.db.query.users.findFirst({
      where: and(eq(users.emailVerificationToken, token), gt(users.emailVerificationExpiresAt, new Date())),
    });
  }

  async create(data: NewUser): Promise<User> {
    const [user] = await this.db.insert(users).values(data).returning();
    return user;
  }

  async update(id: string, data: Partial<NewUser>): Promise<User> {
    const [user] = await this.db
      .update(users)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async markEmailVerified(id: string): Promise<User> {
    return this.update(id, {
      emailVerifiedAt: new Date(),
      emailVerificationToken: null,
      emailVerificationExpiresAt: null,
    });
  }
}
