import { randomUUID } from 'crypto';
import { S3Client} from '@aws-sdk/client-s3';
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { fromBuffer as fileTypeFromBuffer } from 'file-type';
import { S3_CLIENT } from './s3-client.provider';

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
  private readonly bucket: string;

  constructor(
    @Inject(S3_CLIENT) private readonly s3: S3Client,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {
    this.bucket = this.config.get<string>('S3_BUCKET') ?? 'job-copilot-uploads';
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

  async delete(s3Key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: s3Key }));
  }

  async uploadBuffer(buffer: Buffer, userId: string, mimeType: string, fileName: string): Promise<UploadedResume> {
    if (buffer.length > MAX_RESUME_SIZE_BYTES) throw new BadRequestException('File must be 5 MB or smaller');
    const extension = fileName.split('.').pop() || 'pdf';
    const key = `resumes/${userId}/${randomUUID()}.${extension}`;
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buffer, ContentType: mimeType }));
    return { s3Key: key, mimeType, sizeBytes: buffer.length };
  }

  async download(s3Key: string): Promise<Buffer> {
    const response = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: s3Key }));
    if (!response.Body) {
      throw new Error('Stored resume has no readable content');
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response.Body as AsyncIterable<Buffer | Uint8Array | string>) {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += data.length;
      if (size > MAX_RESUME_SIZE_BYTES) {
        throw new Error('Stored resume exceeds the 5 MB processing limit');
      }
      chunks.push(data);
    }
    return Buffer.concat(chunks, size);
  }
}
