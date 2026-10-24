import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';

vi.mock('../src/modules/profiles/extract-text', () => ({
  extractText: vi.fn(async () => ({ text: 'Jane Doe, Senior Software Engineer', isScanned: false })),
}));
vi.mock('../src/modules/profiles/linkedin-import', () => ({
  parseLinkedInZip: vi.fn(async () => ({
    headline: 'Senior Software Engineer',
    summary: null,
    experiences: [],
    educations: [],
    skills: ['TypeScript'],
  })),
}));

import { ParseResumeProcessor } from '../src/modules/profiles/parse-resume.processor';
import { extractText } from '../src/modules/profiles/extract-text';
import { parseLinkedInZip } from '../src/modules/profiles/linkedin-import';

function makeProcessor() {
  const profilesService = {
    findResumeById: vi.fn(),
    applyParsedResume: vi.fn(async () => undefined),
    setParseStatus: vi.fn(async () => undefined),
  };
  const resumeUploadService = {
    download: vi.fn(async () => Buffer.from('file-bytes')),
  };
  const aiService = {
    completeJson: vi.fn(async () => ({
      headline: 'Senior Software Engineer',
      summary: 'Backend engineer.',
      experiences: [],
      educations: [],
      skills: ['TypeScript'],
    })),
  };
  const embedProfileQueue = { add: vi.fn(async () => undefined) };

  const processor = new ParseResumeProcessor(
    profilesService as any,
    resumeUploadService as any,
    aiService as any,
    embedProfileQueue as any,
  );

  return { processor, profilesService, resumeUploadService, aiService, embedProfileQueue };
}

function makeJob(data: { profileId: string; resumeId: string }): Job<{ profileId: string; resumeId: string }> {
  return { data } as Job<{ profileId: string; resumeId: string }>;
}

describe('ParseResumeProcessor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extracts text, calls the AI parser, and applies the result for a PDF resume', async () => {
    const { processor, profilesService, resumeUploadService, aiService, embedProfileQueue } = makeProcessor();
    profilesService.findResumeById.mockResolvedValue({ id: 'resume-1', s3Key: 'resumes/u/1.pdf', mimeType: 'application/pdf' });

    await processor.process(makeJob({ profileId: 'profile-1', resumeId: 'resume-1' }));

    expect(resumeUploadService.download).toHaveBeenCalledWith('resumes/u/1.pdf');
    expect(extractText).toHaveBeenCalledWith(expect.any(Buffer), 'application/pdf');
    expect(aiService.completeJson).toHaveBeenCalledWith(
      'cv_parse',
      { resumeText: 'Jane Doe, Senior Software Engineer' },
      expect.anything(),
    );
    expect(profilesService.applyParsedResume).toHaveBeenCalledWith('profile-1', expect.objectContaining({ headline: 'Senior Software Engineer' }));
    expect(embedProfileQueue.add).toHaveBeenCalledWith('embed', { profileId: 'profile-1' });
    expect(profilesService.setParseStatus).not.toHaveBeenCalled();
  });

  it('routes a LinkedIn ZIP export through parseLinkedInZip without calling the AI', async () => {
    const { processor, profilesService, aiService, embedProfileQueue } = makeProcessor();
    profilesService.findResumeById.mockResolvedValue({ id: 'resume-2', s3Key: 'resumes/u/2.zip', mimeType: 'application/zip' });

    await processor.process(makeJob({ profileId: 'profile-2', resumeId: 'resume-2' }));

    expect(parseLinkedInZip).toHaveBeenCalled();
    expect(aiService.completeJson).not.toHaveBeenCalled();
    expect(profilesService.applyParsedResume).toHaveBeenCalledWith('profile-2', expect.objectContaining({ skills: ['TypeScript'] }));
    expect(embedProfileQueue.add).toHaveBeenCalledWith('embed', { profileId: 'profile-2' });
  });

  it('marks parseStatus failed with a friendly message when the resume is missing', async () => {
    const { processor, profilesService } = makeProcessor();
    profilesService.findResumeById.mockResolvedValue(undefined);

    await processor.process(makeJob({ profileId: 'profile-3', resumeId: 'missing' }));

    expect(profilesService.setParseStatus).toHaveBeenCalledWith('profile-3', 'failed', 'Resume not found');
    expect(profilesService.applyParsedResume).not.toHaveBeenCalled();
  });

  it('marks parseStatus failed when no text could be extracted', async () => {
    const { processor, profilesService } = makeProcessor();
    profilesService.findResumeById.mockResolvedValue({ id: 'resume-4', s3Key: 'resumes/u/4.pdf', mimeType: 'application/pdf' });
    vi.mocked(extractText).mockResolvedValueOnce({ text: '   ', isScanned: true });

    await processor.process(makeJob({ profileId: 'profile-4', resumeId: 'resume-4' }));

    expect(profilesService.setParseStatus).toHaveBeenCalledWith(
      'profile-4',
      'failed',
      expect.stringContaining('scanned'),
    );
  });
});
