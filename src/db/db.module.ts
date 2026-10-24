import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { dbProvider, pgPoolProvider, PG_POOL } from './db.provider';

@Global()
@Module({
  providers: [pgPoolProvider, dbProvider],
  exports: [dbProvider],
})
export class DbModule implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
