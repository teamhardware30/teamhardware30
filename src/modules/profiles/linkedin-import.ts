import { Readable } from 'stream';
import * as yauzl from 'yauzl';
import { parse } from 'csv-parse/sync';
import { ParsedResume } from '../../common/schemas/parsed-resume.schema';

async function streamToString(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

async function readZipEntries(buffer: Buffer): Promise<Map<string, string>> {
  const zip = await yauzl.fromBufferPromise(buffer, { lazyEntries: true, autoClose: true });
  const files = new Map<string, string>();

  for await (const entry of zip.eachEntry()) {
    if (/\/$/.test(entry.fileName)) {
      continue;
    }
    const baseName = entry.fileName.split('/').pop() ?? entry.fileName;
    const stream = await zip.openReadStreamPromise(entry);
    files.set(baseName.toLowerCase(), await streamToString(stream));
  }

  return files;
}

function parseCsv(content: string | undefined): Record<string, string>[] {
  if (!content) {
    return [];
  }
  return parse(content, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true });
}

/**
 * Parses a LinkedIn "Data export" ZIP (Profile.csv, Positions.csv,
 * Education.csv, Skills.csv) into the same shape produced by the LLM CV
 * parser, so it can go through the same ProfilesService.applyParsedResume
 * upsert path — no AI call involved.
 */
export async function parseLinkedInZip(buffer: Buffer): Promise<ParsedResume> {
  const files = await readZipEntries(buffer);

  const [profileRow] = parseCsv(files.get('profile.csv'));
  const positions = parseCsv(files.get('positions.csv'));
  const educationRows = parseCsv(files.get('education.csv'));
  const skillRows = parseCsv(files.get('skills.csv'));

  return {
    headline: profileRow?.Headline?.trim() || null,
    summary: profileRow?.Summary?.trim() || null,
    experiences: positions.map((row) => ({
      company: row['Company Name']?.trim() ?? 'Unknown company',
      title: row.Title?.trim() ?? 'Unknown title',
      location: row.Location?.trim() || null,
      startDate: row['Started On']?.trim() || null,
      endDate: row['Finished On']?.trim() || null,
      current: !row['Finished On']?.trim(),
      description: row.Description?.trim() || null,
    })),
    educations: educationRows.map((row) => ({
      school: row['School Name']?.trim() ?? 'Unknown school',
      degree: row['Degree Name']?.trim() || null,
      fieldOfStudy: row['Field Of Study']?.trim() || null,
      startDate: row['Start Date']?.trim() || null,
      endDate: row['End Date']?.trim() || null,
      description: row.Notes?.trim() || null,
    })),
    skills: skillRows.map((row) => row.Name?.trim()).filter((name): name is string => Boolean(name)),
  };
}
