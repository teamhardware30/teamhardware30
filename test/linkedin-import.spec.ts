import { describe, it, expect } from 'vitest';
import { parseLinkedInZip } from '../src/modules/profiles/linkedin-import';
import { buildLinkedInZipFixture } from './fixtures/linkedin-zip-fixture';

describe('parseLinkedInZip', () => {
  it('maps a LinkedIn data export into the shared ParsedResume shape', async () => {
    const parsed = await parseLinkedInZip(buildLinkedInZipFixture());

    expect(parsed.headline).toBe('Senior Software Engineer');
    expect(parsed.summary).toBe('Backend engineer focused on distributed systems.');

    expect(parsed.experiences).toHaveLength(2);
    expect(parsed.experiences[0]).toMatchObject({
      company: 'Acme Corp',
      title: 'Senior Software Engineer',
      location: 'Nairobi',
      startDate: 'Jan 2021',
      endDate: null,
      current: true,
    });
    expect(parsed.experiences[1]).toMatchObject({
      company: 'Globex',
      title: 'Software Engineer',
      endDate: 'Dec 2020',
      current: false,
    });

    expect(parsed.educations).toHaveLength(1);
    expect(parsed.educations[0]).toMatchObject({
      school: 'University of Nairobi',
      degree: 'BSc',
      fieldOfStudy: 'Computer Science',
    });

    expect(parsed.skills).toEqual(['TypeScript', 'PostgreSQL', 'Distributed Systems']);
  });
});
