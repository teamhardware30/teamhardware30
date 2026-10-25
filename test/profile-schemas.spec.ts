import { describe, expect, it } from 'vitest';
import { experienceSchema, preferencesSchema } from '../src/modules/profiles/schemas/profile.schemas';

describe('profile form schemas', () => {
  it('normalizes preferences and requires a desired title', () => {
    const result = preferencesSchema.safeParse({
      desiredTitles: 'Backend Engineer, Backend Engineer, Platform Engineer',
      salaryCurrency: 'kes',
      salaryMin: '100000',
      salaryMax: '200000',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.desiredTitles).toEqual(['Backend Engineer', 'Platform Engineer']);
      expect(result.data.salaryCurrency).toBe('KES');
    }

    const missing = preferencesSchema.safeParse({ desiredTitles: '' });
    expect(missing.success).toBe(false);
    if (!missing.success) expect(missing.error.issues[0].path).toEqual(['desiredTitles']);
  });

  it('rejects inverted salary and experience dates', () => {
    expect(preferencesSchema.safeParse({ desiredTitles: 'Engineer', salaryMin: 20, salaryMax: 10 }).success).toBe(false);
    expect(
      experienceSchema.safeParse({ company: 'Example', title: 'Engineer', startDate: '2025-02', endDate: '2025-01' }).success,
    ).toBe(false);
  });

  it('treats empty optional numbers as undefined', () => {
    const result = preferencesSchema.parse({ desiredTitles: 'Engineer', salaryMin: '', salaryMax: '' });
    expect(result.salaryMin).toBeUndefined();
    expect(result.salaryMax).toBeUndefined();
  });
});
