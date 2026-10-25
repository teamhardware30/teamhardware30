import { describe, expect, it } from 'vitest';
import { LinkedInImportError, parseLinkedInZip } from '../src/modules/profiles/linkedin-import';
import { buildLinkedInZipFixture } from './fixtures/linkedin-zip-fixture';
import { buildZip } from './fixtures/zip-writer';

const PROFILE = 'First Name,Last Name,Headline,Summary\nJane,Doe,Engineer,Backend engineer\n';
const POSITIONS = 'Company Name,Title,Description,Location,Started On,Finished On\nAcme,Engineer,Built APIs,Nairobi,Jan 2021,\n';
const EDUCATION = 'School Name,Start Date,End Date,Degree Name,Field Of Study\nUniversity,2014,2018,BSc,Computer Science\n';
const SKILLS = 'Name\nTypeScript\n';

function zipWithOverrides(overrides: Record<string, string>): Buffer {
  const entries: Record<string, string> = {
    'Profile.csv': PROFILE,
    'Positions.csv': POSITIONS,
    'Education.csv': EDUCATION,
    'Skills.csv': SKILLS,
    ...overrides,
  };
  return buildZip(Object.entries(entries).map(([name, content]) => ({ name, content })));
}

describe('parseLinkedInZip', () => {
  it('maps and normalizes a LinkedIn export into the shared P1 ParsedResume shape', async () => {
    const parsed = await parseLinkedInZip(buildLinkedInZipFixture());

    expect(parsed.contact).toMatchObject({
      full_name: 'Jane Doe',
      location: 'Nairobi, Kenya',
      email: null,
      links: [],
    });
    expect(parsed.headline).toBe('Senior Software Engineer');
    expect(parsed.summary).toBe('Backend engineer focused on distributed systems.');
    expect(parsed.experiences).toHaveLength(2);
    expect(parsed.experiences[0]).toMatchObject({
      company: 'Acme Corp',
      title: 'Senior Software Engineer',
      location: 'Nairobi',
      start: '2021-01',
      end: 'present',
      bullets: ['Led the payments platform team.'],
    });
    expect(parsed.experiences[1]).toMatchObject({
      company: 'Globex',
      title: 'Software Engineer',
      start: '2018-06',
      end: '2020-12',
    });
    expect(parsed.education).toEqual([
      {
        school: 'University of Nairobi',
        degree: 'BSc',
        field: 'Computer Science',
        start: '2014',
        end: '2018',
      },
    ]);
    expect(parsed.skills).toEqual([
      { name: 'TypeScript', kind: 'hard' },
      { name: 'PostgreSQL', kind: 'hard' },
      { name: 'Distributed Systems', kind: 'hard' },
    ]);
    expect(parsed.certifications).toEqual([]);
    expect(parsed.total_years_experience).toBeNull();
  });

  it('normalizes localized LinkedIn month names without an LLM', async () => {
    const parsed = await parseLinkedInZip(
      zipWithOverrides({
        'Positions.csv':
          'Company Name,Title,Started On,Finished On\nAcme,Engineer,févr. 2021,déc. 2022\n',
      }),
    );
    expect(parsed.experiences[0].start).toBe('2021-02');
    expect(parsed.experiences[0].end).toBe('2022-12');
  });

  it('rejects missing required files with a friendly error', async () => {
    await expect(parseLinkedInZip(buildZip([{ name: 'Profile.csv', content: PROFILE }]))).rejects.toThrow(
      /missing required files.*Positions.csv/i,
    );
  });

  it('rejects malformed ZIP and CSV input safely', async () => {
    await expect(parseLinkedInZip(Buffer.from('not a zip'))).rejects.toBeInstanceOf(LinkedInImportError);
    await expect(
      parseLinkedInZip(zipWithOverrides({ 'Positions.csv': 'Company Name,Title\n"unclosed' })),
    ).rejects.toThrow('Positions.csv is malformed');
  });

  it('rejects unsafe paths, excess entries, and uncompressed size overflows', async () => {
    await expect(parseLinkedInZip(zipWithOverrides({ '../Profile.csv': PROFILE }))).rejects.toThrow('unsafe file path');
    await expect(parseLinkedInZip(buildLinkedInZipFixture(), { maxEntries: 2 })).rejects.toThrow('too many entries');
    await expect(parseLinkedInZip(buildLinkedInZipFixture(), { maxEntryUncompressedBytes: 10 })).rejects.toThrow(
      'too large',
    );
    await expect(parseLinkedInZip(buildLinkedInZipFixture(), { maxTotalUncompressedBytes: 10 })).rejects.toThrow(
      'safe import size limit',
    );
  });
});
