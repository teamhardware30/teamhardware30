import { customType } from 'drizzle-orm/pg-core';

/** pgvector column shared by profile and job embeddings (1024 dimensions). */
export const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(1024)';
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    return value
      .slice(1, -1)
      .split(',')
      .filter(Boolean)
      .map(Number);
  },
});

/** PostgreSQL tsvector, used for full-text search columns. */
export const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tsvector';
  },
});
