import { describe, it, expect, vi } from 'vitest';
import { ProfilesController } from '../src/modules/profiles/profiles.controller';

function makeController(resumes: Array<{ id: string }>, added: { id: string }) {
  const profilesService = {
    getOrCreateForUser: vi.fn().mockResolvedValue({ id: 'profile-1' }),
    addResume: vi.fn().mockResolvedValue(added),
    setParseStatus: vi.fn().mockResolvedValue(undefined),
    listResumes: vi.fn().mockResolvedValue(resumes),
  };
  const resumeUploadService = {
    upload: vi.fn().mockResolvedValue({ s3Key: 'resumes/u/1.pdf', mimeType: 'application/pdf', sizeBytes: 10 }),
  };
  const queue = { add: vi.fn().mockResolvedValue(undefined) };
  const controller = new ProfilesController(
    profilesService as never,
    resumeUploadService as never,
    queue as never,
    queue as never
  );
  return { controller, profilesService, queue };
}

const file = {
  originalname: 'cv.pdf',
  mimetype: 'application/pdf',
  size: 10,
  buffer: Buffer.from('%PDF-1.4'),
};

function makeRes() {
  return { render: vi.fn(), status: vi.fn(), redirect: vi.fn() };
}

describe('ProfilesController resume uploads', () => {
  it('queues parsing for the resume that was just uploaded, not the oldest one', async () => {
    const { controller, queue } = makeController([{ id: 'old-resume' }, { id: 'new-resume' }], { id: 'new-resume' });

    await controller.addProfileResume(
      file as never,
      { user: { id: 'user-1' }, headers: { 'hx-request': 'true' } } as never,
      makeRes() as never
    );

    expect(queue.add).toHaveBeenCalledWith('parse', { profileId: 'profile-1', resumeId: 'new-resume' });
  });
});
