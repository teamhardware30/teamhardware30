import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { DRIZZLE, Database } from '../../db/db.provider';
import { users } from '../../db/schema';
import { ProfilesService } from '../profiles/profiles.service';
import { S3_CLIENT } from '../profiles/s3-client.provider';

@Injectable()
export class DataRightsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(S3_CLIENT) private readonly s3: S3Client,
    private readonly config: ConfigService,
    private readonly profilesService: ProfilesService,
  ) {}

  async exportAccount(userId: string) {
    const user = await this.db.query.users.findFirst({ where: eq(users.id, userId) });
    const profile = await this.profilesService.getOrCreateForUser(userId);
    const fullProfile = await this.profilesService.findFullProfile(profile.id);
    const resumes = await this.profilesService.listResumes(profile.id);
    return { user: { id: user?.id, email: user?.email, name: user?.name, role: user?.role }, profile: fullProfile, resumes: resumes.map((resume) => ({ id: resume.id, fileName: resume.fileName, sizeBytes: resume.sizeBytes, isPrimary: resume.isPrimary })) };
  }

  async deleteAccount(userId: string): Promise<void> {
    const profile = await this.profilesService.getOrCreateForUser(userId);
    const resumes = await this.profilesService.listResumes(profile.id);
    const bucket = this.config.get<string>('S3_BUCKET') ?? 'job-copilot-uploads';
    await Promise.all(resumes.map((resume) => this.s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: resume.s3Key })).catch(() => undefined)));
    await this.db.delete(users).where(eq(users.id, userId));
  }
}
