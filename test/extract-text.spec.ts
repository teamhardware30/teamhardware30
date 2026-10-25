import { describe, it, expect, vi } from 'vitest';
import { extractText } from '../src/modules/profiles/extract-text';
import { buildDocxFixture } from './fixtures/docx-fixture';
import { buildPdfFixture } from './fixtures/pdf-fixture';

// tesseract.js's createWorker downloads language data from a remote CDN by
// default — stub it so the OCR-fallback path stays hermetic and fast in CI.
// vi.mock calls are hoisted above imports by vitest, so this still applies
// before extract-text.ts (imported below) pulls in the real module.
vi.mock('tesseract.js', () => ({
  createWorker: vi.fn(async () => ({
    recognize: vi.fn(async () => ({ data: { text: 'OCR Jane Doe Senior Software Engineer' } })),
    terminate: vi.fn(async () => undefined),
  })),
}));

const PDF_MIME = 'application/pdf';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('extractText', () => {
  it('extracts text and metadata from a plain single-column PDF', async () => {
    const buffer = buildPdfFixture([
      'Jane Doe',
      'Senior Software Engineer',
      'jane@example.com',
      'Summary',
      'Backend engineer with 8 years of experience building distributed',
      'systems in Node.js, TypeScript, and PostgreSQL. Led the payments',
      'platform team at Acme Corp and mentored five junior engineers.',
      'Experience',
      'Senior Software Engineer, Acme Corp, 2021 - Present',
      'Software Engineer, Globex, 2018 - 2020',
    ]);
    const result = await extractText(buffer, PDF_MIME);

    expect(result.text).toContain('Jane Doe');
    expect(result.text).toContain('Senior Software Engineer');
    expect(result.pageCount).toBe(1);
    expect(result.hasImages).toBe(false);
    expect(result.likelyMultiColumn).toBe(false);
    expect(result.isScanned).toBe(false);
    expect(result.hasTables).toBe(false);
    expect(result.ocrApplied).toBe(false);
  });

  it('extracts text from a LinkedIn-downloaded PDF profile', async () => {
    const buffer = buildPdfFixture([
      'Jane Doe',
      'Senior Software Engineer at Acme Corp',
      'Nairobi, Kenya',
      'Summary',
      'Backend engineer focused on distributed systems.',
    ]);
    const result = await extractText(buffer, PDF_MIME);

    expect(result.text).toContain('Senior Software Engineer at Acme Corp');
    expect(result.text).toContain('Backend engineer focused on distributed systems.');
  });

  it('flags a near-empty PDF as scanned and falls back to OCR', async () => {
    const buffer = buildPdfFixture(['Hi']);
    const result = await extractText(buffer, PDF_MIME);
    expect(result.isScanned).toBe(true);
    expect(result.ocrApplied).toBe(true);
    expect(result.text).toContain('OCR Jane Doe');
  });

  it('extracts text and detects tables from a DOCX', async () => {
    const buffer = buildDocxFixture(['Jane Doe', 'Software Engineer with 5 years experience.'], true);
    const result = await extractText(buffer, DOCX_MIME);

    expect(result.text).toContain('Jane Doe');
    expect(result.text).toContain('Software Engineer with 5 years experience.');
    expect(result.hasTables).toBe(true);
  });

  it('reports hasTables=false for a DOCX without a table', async () => {
    const buffer = buildDocxFixture(['Just a paragraph.'], false);
    const result = await extractText(buffer, DOCX_MIME);
    expect(result.hasTables).toBe(false);
  });

  it('enforces PDF page and OCR page safeguards', async () => {
    const buffer = buildPdfFixture(['Hi']);
    await expect(extractText(buffer, PDF_MIME, { maxPages: 0 })).rejects.toThrow('too many pages');
    await expect(extractText(buffer, PDF_MIME, { maxOcrPages: 0 })).rejects.toThrow('at most 0 pages');
  });

  it('rejects unsupported mime types with a friendly error', async () => {
    await expect(extractText(Buffer.from('x'), 'application/zip')).rejects.toThrow('Upload a PDF or DOCX');
  });
});
