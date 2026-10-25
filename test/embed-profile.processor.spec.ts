import { Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ProfileEmbeddingSource} from '../src/modules/profiles/embed-profile.processor';
import {
  buildProfileEmbeddingText,
  EmbedProfileProcessor,
  hashProfileEmbeddingText
} from '../src/modules/profiles/embed-profile.processor';

function makeProfile(): ProfileEmbeddingSource {
  return {
    headline: 'Senior Backend Engineer',
    desiredTitles: ['Staff Engineer', 'Backend Lead'],
    embedding: null,
    embeddingTextHash: null,
    embeddingModel: null,
    experiences: Array.from({ length: 4 }, (_, index) => ({
      company: `Company ${index + 1}`,
      title: `Role ${index + 1}`,
      description: index === 0 ? 'Led payment systems.' : null,
    })),
    profileSkills: ['TypeScript', 'PostgreSQL'].map((name) => ({ skill: { name } })),
  };
}

function makeProcessor(profile = makeProfile()) {
  const aiService = {
    embeddingModel: 'voyage-2',
    embeddingEnabled: true,
    embed: vi.fn(async () => [[0.1, 0.2]]),
  };
  const profilesService = {
    findFullProfileById: vi.fn(async () => profile),
    saveProfileEmbedding: vi.fn(async () => undefined),
  };
  const processor = new EmbedProfileProcessor(aiService as never, profilesService as never);
  return { processor, aiService, profilesService, profile };
}

function job(profileId = 'profile-1'): Job<{ profileId: string }> {
  return { data: { profileId } } as Job<{ profileId: string }>;
}

describe('EmbedProfileProcessor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('looks up by profile ID and embeds only headline, desired titles, top skills, and last three roles', async () => {
    const { processor, aiService, profilesService, profile } = makeProcessor();

    await processor.process(job());

    expect(profilesService.findFullProfileById).toHaveBeenCalledWith('profile-1');
    expect(aiService.embed).toHaveBeenCalledOnce();
    const text = ((aiService.embed.mock.calls as unknown[][])[0][0] as string[])[0];
    expect(text).toContain('Headline: Senior Backend Engineer');
    expect(text).toContain('Desired titles: Staff Engineer, Backend Lead');
    expect(text).toContain('Top skills: TypeScript, PostgreSQL');
    expect(text).toContain('Role: Role 1 at Company 1. Led payment systems.');
    expect(text).toContain('Role: Role 2 at Company 2');
    expect(text).toContain('Role: Role 3 at Company 3');
    expect(text).not.toContain('Role 4');
    expect(text).not.toContain('This summary must not be embedded');
    expect(profilesService.saveProfileEmbedding).toHaveBeenCalledWith(
      'profile-1',
      [0.1, 0.2],
      hashProfileEmbeddingText(buildProfileEmbeddingText(profile)),
      'voyage-2',
    );
  });

  it('skips the provider when text hash, model, and existing vector are unchanged', async () => {
    const profile = makeProfile();
    profile.embedding = [0.1, 0.2];
    profile.embeddingTextHash = hashProfileEmbeddingText(buildProfileEmbeddingText(profile));
    profile.embeddingModel = 'voyage-2';
    const { processor, aiService, profilesService } = makeProcessor(profile);

    await processor.process(job());
    expect(aiService.embed).not.toHaveBeenCalled();
    expect(profilesService.saveProfileEmbedding).not.toHaveBeenCalled();
  });

  it('re-embeds unchanged text when the configured model changes', async () => {
    const profile = makeProfile();
    profile.embedding = [0.1, 0.2];
    profile.embeddingTextHash = hashProfileEmbeddingText(buildProfileEmbeddingText(profile));
    profile.embeddingModel = 'older-model';
    const { processor, aiService } = makeProcessor(profile);

    await processor.process(job());
    expect(aiService.embed).toHaveBeenCalledOnce();
  });

  it('rethrows embedding failures so BullMQ retries instead of silently succeeding', async () => {
    const { processor, aiService, profilesService } = makeProcessor();
    const failure = new Error('provider unavailable');
    aiService.embed.mockRejectedValueOnce(failure);

    await expect(processor.process(job())).rejects.toBe(failure);
    expect(profilesService.saveProfileEmbedding).not.toHaveBeenCalled();
  });
});
