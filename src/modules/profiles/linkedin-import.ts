import { basename } from 'path';
import { parse as parseCsv } from 'csv-parse/sync';
import yauzl from 'yauzl';
import { ParsedResume } from '../../common/schemas/parsed-resume.schema';
import { normalizeMonthOrPresent, normalizeYear } from './date-utils';

const REQUIRED_FILES = ['Profile.csv', 'Positions.csv', 'Education.csv', 'Skills.csv'] as const;
const MAX_ENTRIES = 50;
const MAX_UNCOMPRESSED_BYTES = 10 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 100;

interface CsvRow {
  [key: string]: string;
}

export class LinkedInImportError extends Error {}

export interface LinkedInImportOptions {
  maxEntries?: number;
  maxEntryUncompressedBytes?: number;
  maxTotalUncompressedBytes?: number;
}

export async function parseLinkedInZip(buffer: Buffer, options: LinkedInImportOptions = {}): Promise<ParsedResume> {
  const limits = {
    maxEntries: options.maxEntries ?? MAX_ENTRIES,
    maxEntryUncompressedBytes: options.maxEntryUncompressedBytes ?? MAX_UNCOMPRESSED_BYTES,
    maxTotalUncompressedBytes: options.maxTotalUncompressedBytes ?? MAX_UNCOMPRESSED_BYTES,
  };
  const files = await readZip(buffer, limits);
  for (const required of REQUIRED_FILES) {
    if (!files.has(required)) {
      throw new Error(`LinkedIn export is missing ${required}`);
    }
  }

  const profileRows = parseCsvFile(files.get('Profile.csv')!, 'Profile.csv');
  const positionRows = parseCsvFile(files.get('Positions.csv')!, 'Positions.csv');
  const educationRows = parseCsvFile(files.get('Education.csv')!, 'Education.csv');
  const skillRows = parseCsvFile(files.get('Skills.csv')!, 'Skills.csv');

  const profile = profileRows[0] ?? {};
  const firstName = value(profile, ['First Name', 'FirstName']);
  const lastName = value(profile, ['Last Name', 'LastName']);

  return {
    contact: {
      full_name: `${firstName} ${lastName}`.trim() || 'LinkedIn member',
      email: null,
      phone: null,
      location: value(profile, ['Location', 'Geo Location']) || null,
      links: [],
    },
    headline: value(profile, ['Headline']) || null,
    summary: value(profile, ['Summary', 'About']) || null,
    experiences: positionRows.map((row) => {
      const started = value(row, ['Started On', 'Start Date', 'Started']);
      const finished = value(row, ['Finished On', 'End Date', 'Finished']);
      const start = normalizeMonthOrPresent(started);
      const end = finished ? normalizeMonthOrPresent(finished) : 'present';
      return {
        title: value(row, ['Title', 'Position Title']) || 'Untitled role',
        company: value(row, ['Company Name', 'Company']) || 'Unknown company',
        location: value(row, ['Location']) || null,
        start: start === 'present' ? null : start,
        end: end === 'present' ? 'present' : end,
        bullets: splitBullets(value(row, ['Description'])),
      };
    }),
    education: educationRows.map((row) => ({
      school: value(row, ['School Name', 'School']) || 'Unknown school',
      degree: value(row, ['Degree Name', 'Degree']) || null,
      field: value(row, ['Field of Study', 'Field']) || null,
      start: normalizeYear(value(row, ['Start Date', 'Started On'])),
      end: normalizeYear(value(row, ['End Date', 'Finished On'])),
    })),
    skills: skillRows
      .map((row) => value(row, ['Name', 'Skill', 'Skill Name']))
      .filter(Boolean)
      .map((name) => ({ name, kind: 'hard' as const })),
    certifications: [],
    languages: [],
    total_years_experience: null,
    seniority: null,
  };
}

function parseCsvFile(buffer: Buffer, fileName: string): CsvRow[] {
  try {
    const rows = parseCsv(buffer, { columns: true, skip_empty_lines: true, trim: true }) as CsvRow[];
    return rows.filter((row) => Object.values(row).some((cell) => String(cell).trim() !== ''));
  } catch {
    throw new LinkedInImportError(`${fileName} is malformed`);
  }
}

function value(row: CsvRow, keys: string[]): string {
  for (const key of keys) {
    const found = Object.keys(row).find((candidate) => candidate.trim().toLowerCase() === key.toLowerCase());
    if (found && row[found]) return String(row[found]).trim();
  }
  return '';
}

function splitBullets(value: string): string[] {
  return value.split(/\r?\n|•/).map((item) => item.trim()).filter(Boolean);
}

function readZip(buffer: Buffer, limits: Required<LinkedInImportOptions>): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zipfile) => {
      if (error || !zipfile) {
        const message = error instanceof Error ? error.message : '';
        if (/relative path|unsafe/i.test(message)) {
          reject(new LinkedInImportError('ZIP archive contains an unsafe file path'));
          return;
        }
        reject(new LinkedInImportError('ZIP archive is malformed'));
        return;
      }

      const files = new Map<string, Buffer>();
      let entryCount = 0;
      let totalBytes = 0;

      zipfile.on('entry', (entry: yauzl.Entry) => {
        if (/\/$/.test(entry.fileName)) {
          zipfile.readEntry();
          return;
        }

        const name = basename(entry.fileName);
        if (!name || name.includes('..') || entry.fileName.includes('\\')) {
          reject(new LinkedInImportError('ZIP archive contains an unsafe file path'));
          return;
        }

        entryCount += 1;
        if (entryCount > limits.maxEntries) {
          reject(new LinkedInImportError('ZIP archive contains too many entries'));
          return;
        }
        if (entry.uncompressedSize > limits.maxEntryUncompressedBytes) {
          reject(new LinkedInImportError('ZIP archive entry is too large'));
          return;
        }
        if (totalBytes + entry.uncompressedSize > limits.maxTotalUncompressedBytes) {
          reject(new LinkedInImportError('ZIP archive exceeds the safe import size limit'));
          return;
        }
        if (entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize > MAX_COMPRESSION_RATIO) {
          reject(new Error('ZIP archive compression ratio is unsafe'));
          return;
        }

        zipfile.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            reject(streamError ?? new Error('Could not read ZIP entry'));
            return;
          }
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('end', () => {
            if (!files.has(name)) files.set(name, Buffer.concat(chunks));
            totalBytes += entry.uncompressedSize;
            zipfile.readEntry();
          });
          stream.on('error', reject);
        });
      });

      zipfile.on('end', () => {
        const missing = REQUIRED_FILES.filter((required) => !files.has(required));
        if (missing.length > 0) {
          reject(new LinkedInImportError(`LinkedIn export is missing required files: ${missing.join(', ')}`));
          return;
        }
        resolve(files);
      });
      zipfile.on('error', (streamError: Error) => {
        if (/relative path|unsafe/i.test(streamError.message)) {
          reject(new LinkedInImportError('ZIP archive contains an unsafe file path'));
          return;
        }
        reject(new LinkedInImportError('ZIP archive is malformed'));
      });
      zipfile.readEntry();
    });
  });
}


