import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export const DRIZZLE = Symbol('DRIZZLE');
export const PG_POOL = Symbol('PG_POOL');

export type Database = NodePgDatabase<typeof schema>;
export type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export const pgPoolProvider: Provider = {
  provide: PG_POOL,
  inject: [ConfigService],
  useFactory: (config: ConfigService): Pool => new Pool({ connectionString: config.get<string>('DATABASE_URL') }),
};

export const dbProvider: Provider = {
  provide: DRIZZLE,
  inject: [PG_POOL],
  useFactory: (pool: Pool): Database => drizzle(pool, { schema }),
};
