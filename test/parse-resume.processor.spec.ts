import { Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExtractedDocument } from '../src/modules/profiles/extract-text';
import { extractText } from '../src/modules/profiles/extract-text';
import { parseLinkedInZip } from '../src/modules/profiles/linkedin-import';
import { ParseResumeProcessor } from '../src/modules/profiles/parse-resume.processor';
import { makeParsedResume } from './fixtures/parsed-resume-fixture';

vi.mock('../src/modules/profiles/extract-text', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...(actual as object), extractText: vi.fn() };
});
vi.mock('../src/modules/profiles/linkedin-import', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...(actual as object), parseLinkedInZip: vi.fn() };
});

function extraction(text = 'Jane Doe, Senior Software Engineer'): ExtractedDocument {
  return {
    text,
    pageCount: 1,
    hasImages: false,
    likelyMultiColumn: false,
    isScanned: false,
    hasTables: false,
    ocrApplied: false,
  };
}

function makeProcessor() {
  const profilesService = {
    findResumeById: vi.fn(),
    applyParsedResume: vi.fn(async () => undefined),
    setParseStatus: vi.fn(async () => undefined),
    saveResumeRawText: vi.fn(async () => undefined),
  };
  const resumeUploadService = { download: vi.fn(async () => Buffer.from('file-bytes')) };
  const aiService = { completeJson: vi.fn(async () => makeParsedResume()) };
  const embedProfileQueue = { add: vi.fn(async () => undefined) };
  const processor = new ParseResumeProcessor(
    profilesService as never,
    resumeUploadService as never,
    aiService as never,
    embedProfileQueue as never,
  );
  return { processor, profilesService, resumeUploadService, aiService, embedProfileQueue };
}

function makeJob(data: { profileId: string; resumeId: string }): Job<{ profileId: string; resumeId: string }> {
  return { data } as Job<{ profileId: string; resumeId: string }>;
}

function storedResume(profileId: string, mimeType = 'application/pdf') {
  return { id: 'resume-1', profileId, s3Key: 'resumes/u/1.pdf', mimeType };
}

describe('ParseResumeProcessor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(extractText).mockResolvedValue(extraction());
    vi.mocked(parseLinkedInZip).mockResolvedValue(makeParsedResume());
  });

  it('persists extracted text before AI parsing, applies parsed JSON, and enqueues debounced embedding', async () => {
    const { processor, profilesService, resumeUploadService, aiService, embedProfileQueue } = makeProcessor();
    profilesService.findResumeById.mockResolvedValue(storedResume('profile-1'));

    await processor.process(makeJob({ profileId: 'profile-1', resumeId: 'resume-1' }));

    expect(profilesService.setParseStatus).toHaveBeenCalledWith('profile-1', 'processing');
    expect(resumeUploadService.download).toHaveBeenCalledWith('resumes/u/1.pdf');
    expect(extractText).toHaveBeenCalledWith(expect.any(Buffer), 'application/pdf');
    expect(profilesService.saveResumeRawText).toHaveBeenCalledWith(
      'profile-1',
      'resume-1',
      'Jane Doe, Senior Software Engineer',
    );
    expect(aiService.completeJson).toHaveBeenCalledWith(
      'cv_parse',
      { cv_text: 'Jane Doe, Senior Software Engineer' },
      expect.anything(),
    );
    expect(profilesService.saveResumeRawText.mock.invocationCallOrder[0]).toBeLessThan(
      aiService.completeJson.mock.invocationCallOrder[0],
    );
    expect(profilesService.applyParsedResume).toHaveBeenCalledWith(
      'profile-1',
      expect.objectContaining({ headline: 'Senior Software Engineer' }),
      'resume-1',
    );
    expect(embedProfileQueue.add).toHaveBeenCalledWith(
      'embed',
      { profileId: 'profile-1' },
      expect.objectContaining({ jobId: 'embed-profile-profile-1', delay: 60_000, attempts: 4 }),
    );
  });

  it('routes LinkedIn ZIP through the no-LLM importer and the same persistence path', async () => {
    const { processor, profilesService, aiService, embedProfileQueue } = makeProcessor();
    profilesService.findResumeById.mockResolvedValue(storedResume('profile-2', 'application/zip'));

    await processor.process(makeJob({ profileId: 'profile-2', resumeId: 'resume-1' }));

    expect(parseLinkedInZip).toHaveBeenCalledOnce();
    expect(extractText).not.toHaveBeenCalled();
    expect(aiService.completeJson).not.toHaveBeenCalled();
    expect(profilesService.applyParsedResume).toHaveBeenCalledWith(
      'profile-2',
      expect.objectContaining({ skills: [{ name: 'TypeScript', kind: 'tool' }, { name: 'PostgreSQL', kind: 'tool' }] }),
      'resume-1',
    );
    expect(embedProfileQueue.add).toHaveBeenCalledOnce();
  });

  it('marks a missing resume failed and rethrows so BullMQ can retry', async () => {
    const { processor, profilesService } = makeProcessor();
    profilesService.findResumeById.mockResolvedValue(undefined);

    await expect(processor.process(makeJob({ profileId: 'profile-3', resumeId: 'missing' }))).rejects.toThrow(
      'could not be found',
    );
    expect(profilesService.setParseStatus).toHaveBeenCalledWith(
      'profile-3',
      'failed',
      'The uploaded resume could not be found. Upload it again and retry.',
    );
    expect(profilesService.applyParsedResume).not.toHaveBeenCalled();
  });

  it('saves raw extraction before reporting an unreadable scanned resume', async () => {
    const { processor, profilesService } = makeProcessor();
    profilesService.findResumeById.mockResolvedValue(storedResume('profile-4'));
    vi.mocked(extractText).mockResolvedValueOnce({ ...extraction('   '), isScanned: true });

    await expect(processor.process(makeJob({ profileId: 'profile-4', resumeId: 'resume-1' }))).rejects.toThrow(
      'scanned document',
    );
    expect(profilesService.saveResumeRawText).toHaveBeenCalledWith('profile-4', 'resume-1', '   ');
    expect(profilesService.setParseStatus).toHaveBeenCalledWith(
      'profile-4',
      'failed',
      expect.stringContaining('scanned'),
    );
  });

  it('never exposes raw provider errors in parseError and preserves the original failure', async () => {
    const { processor, profilesService, aiService, embedProfileQueue } = makeProcessor();
    profilesService.findResumeById.mockResolvedValue(storedResume('profile-5'));
    const providerError = new Error('Anthropic 500: secret provider diagnostics');
    aiService.completeJson.mockRejectedValueOnce(providerError);

    await expect(processor.process(makeJob({ profileId: 'profile-5', resumeId: 'resume-1' }))).rejects.toBe(
      providerError,
    );
    const failedCall = (profilesService.setParseStatus.mock.calls as unknown[][]).find((call) => call[1] === 'failed');
    expect(failedCall?.[2]).toBe('We could not parse this resume. Please try again or upload a different file.');
    expect(failedCall?.[2]).not.toContain('secret');
    expect(embedProfileQueue.add).not.toHaveBeenCalled();
  });

  it('does not mask the processing error when the safe status update also fails', async () => {
    const { processor, profilesService } = makeProcessor();
    profilesService.findResumeById.mockResolvedValue(undefined);
    profilesService.setParseStatus.mockImplementation(async () => {
      throw new Error('database unavailable');
    });

    await expect(processor.process(makeJob({ profileId: 'profile-6', resumeId: 'missing' }))).rejects.toThrow(
      'could not be found',
    );
  });
});
