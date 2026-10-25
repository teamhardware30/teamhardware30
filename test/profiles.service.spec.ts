import { describe, expect, it, vi } from 'vitest';
import {
  Skill} from '../src/db/schema';
import {
  educations,
  experiences,
  profileSkills,
  resumes,
  seekerProfiles,
  skills
} from '../src/db/schema';
import {
  findCanonicalSkill,
  ProfilesService,
  profileEmbeddingJobOptions,
} from '../src/modules/profiles/profiles.service';
import { makeParsedResume } from './fixtures/parsed-resume-fixture';

function canonicalSkill(): Skill {
  return {
    id: 'skill-postgres',
    name: 'PostgreSQL',
    aliases: ['Postgres', 'postgresql'],
    category: 'tool',
    needsReview: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

function makeTransactionDb(catalog: Skill[]) {
  const inserts: { table: unknown; values: unknown }[] = [];
  const updates: { table: unknown; values: unknown }[] = [];
  const deletes: unknown[] = [];
  const createdSkill: Skill = {
    id: 'skill-new',
    name: 'NewSkill',
    aliases: [],
    category: 'hard',
    needsReview: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  const tx = {
    query: { skills: { findMany: vi.fn(async () => catalog) } },
    delete: vi.fn((table: unknown) => ({
      where: vi.fn(async () => {
        deletes.push(table);
      }),
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: unknown) => {
        inserts.push({ table, values });
        if (table === skills) {
          return { returning: vi.fn(async () => [createdSkill]) };
        }
        if (table === profileSkills) {
          return { onConflictDoNothing: vi.fn(async () => undefined) };
        }
        return Promise.resolve();
      }),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((values: unknown) => {
        updates.push({ table, values });
        return { where: vi.fn(async () => undefined) };
      }),
    })),
  };
  const db = {
    transaction: vi.fn((callback: (transaction: typeof tx) => Promise<void>) => callback(tx)),
  };
  return { db, tx, inserts, updates, deletes };
}

describe('ProfilesService parsed-resume persistence', () => {
  it('stores every section and parsedJson in one transaction and preserves canonical aliases', async () => {
    const postgres = canonicalSkill();
    const { db, inserts, updates } = makeTransactionDb([postgres]);
    const service = new ProfilesService(db as never);
    const parsed = makeParsedResume();
    parsed.skills = [
      { name: 'Postgres', kind: 'tool' },
      { name: 'NewSkill', kind: 'hard' },
      { name: 'postgresql', kind: 'tool' },
    ];

    await service.applyParsedResume('profile-1', parsed, 'resume-1');

    expect(db.transaction).toHaveBeenCalledOnce();
    expect(inserts.find((entry) => entry.table === experiences)?.values).toEqual([
      expect.objectContaining({
        profileId: 'profile-1',
        company: 'Acme Corp',
        startDate: '2021-01-01',
        endDate: null,
        current: true,
        description: 'Led the payments platform team.\nImproved service reliability.',
      }),
    ]);
    expect(inserts.find((entry) => entry.table === educations)?.values).toEqual([
      expect.objectContaining({ fieldOfStudy: 'Computer Science', startDate: '2014-01-01', endDate: '2018-01-01' }),
    ]);
    expect(inserts.find((entry) => entry.table === skills)?.values).toEqual({
      name: 'NewSkill',
      category: 'hard',
      needsReview: true,
    });
    expect(inserts.find((entry) => entry.table === profileSkills)?.values).toEqual([
      { profileId: 'profile-1', skillId: 'skill-postgres' },
      { profileId: 'profile-1', skillId: 'skill-new' },
    ]);
    expect(updates.find((entry) => entry.table === resumes)?.values).toEqual({ parsedJson: parsed });
    expect(updates.find((entry) => entry.table === seekerProfiles)?.values).toMatchObject({
      headline: 'Senior Software Engineer',
      location: 'Nairobi, Kenya',
      yearsExperience: 8,
      seniority: 'senior',
      parseStatus: 'done',
      parseError: null,
    });
    expect(findCanonicalSkill('  POSTGRES ', [postgres])).toBe(postgres);
    expect(postgres.needsReview).toBe(false);
  });
});

describe('ProfilesService embedding enqueue semantics', () => {
  it('uses a deterministic 60-second debounce job per profile', async () => {
    const queue = { add: vi.fn(async () => undefined) };
    const service = new ProfilesService({} as never, queue as never);

    await expect(service.scheduleProfileEmbedding('profile-1')).resolves.toBe(true);
    expect(queue.add).toHaveBeenCalledWith(
      'embed',
      { profileId: 'profile-1' },
      profileEmbeddingJobOptions('profile-1'),
    );
    expect(profileEmbeddingJobOptions('profile-1')).toMatchObject({
      jobId: 'embed-profile-profile-1',
      delay: 60_000,
      attempts: 4,
      removeOnComplete: true,
    });
  });

  it('triggers re-embedding after a manual save but does not fail the save when Redis is unavailable', async () => {
    const updated = { id: 'profile-1', headline: 'Updated' };
    const returning = vi.fn(async () => [updated]);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    const db = { update: vi.fn(() => ({ set })) };
    const queue = { add: vi.fn().mockRejectedValue(new Error('Redis unavailable')) };
    const service = new ProfilesService(db as never, queue as never);

    await expect(service.updateProfile('profile-1', { headline: 'Updated' })).resolves.toEqual(updated);
    expect(queue.add).toHaveBeenCalledWith(
      'embed',
      { profileId: 'profile-1' },
      expect.objectContaining({ jobId: 'embed-profile-profile-1' }),
    );
  });

  it('allows saves in isolated/tests contexts without a queue provider', async () => {
    const service = new ProfilesService({} as never);
    await expect(service.scheduleProfileEmbedding('profile-1')).resolves.toBe(false);
  });
});
