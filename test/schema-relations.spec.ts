import { drizzle } from 'drizzle-orm/node-postgres';
import { describe, expect, it } from 'vitest';
import * as schema from '../src/db/schema';

const db = drizzle({ client: {} as never, schema });

describe('database relations', () => {
  it('resolves the job and resume relations used by the applications list', () => {
    const query = db.query.applications.findMany({ with: { job: true, resume: true } }).toSQL();
    expect(query.sql).toContain('select');
    expect(query.sql).toContain('"jobs"');
    expect(query.sql).toContain('"resumes"');
  });
});
