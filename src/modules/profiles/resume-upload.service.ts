import { randomUUID } from 'crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { fileTypeFromBuffer } from 'file-type';

export const MAX_RESUME_SIZE_BYTES = 5 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/zip',
]);

export interface UploadedResume {
  s3Key: string;
  mimeType: string;
  sizeBytes: number;
}

@Injectable()
export class ResumeUploadService {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    this.s3 = new S3Client({ region: config.get<string>('AWS_REGION') });
    this.bucket = config.get<string>('S3_BUCKET') ?? 'job-copilot-uploads';
  }

  async upload(file: Express.Multer.File, userId: string): Promise<UploadedResume> {
    if (file.size > MAX_RESUME_SIZE_BYTES) {
      throw new BadRequestException('File must be 5 MB or smaller');
    }

    const detected = await fileTypeFromBuffer(file.buffer);
    const mimeType = detected?.mime ?? file.mimetype;
    if (!detected || !ALLOWED_MIME_TYPES.has(detected.mime)) {
      throw new BadRequestException('File must be a PDF, DOCX, or a ZIP LinkedIn export');
    }

    const extension = detected.ext;
    const key = `resumes/${userId}/${randomUUID()}.${extension}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: mimeType,
      }),
    );

    return { s3Key: key, mimeType, sizeBytes: file.size };
  }

  async download(s3Key: string): Promise<Buffer> {
    const response = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: s3Key }));
    const chunks: Buffer[] = [];
    for await (const chunk of response.Body as AsyncIterable<Buffer>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
}
