import { Readable } from 'stream';
import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

/**
 * In-memory stand-in for S3Client used in e2e tests, so uploads/downloads
 * exercised by ResumeUploadService don't need a real bucket. Only
 * implements the commands the app actually sends.
 */
export function createFakeS3Client() {
  const store = new Map<string, Buffer>();
  const buckets = new Set<string>();

  return {
    store,
    buckets,
    send: async (command: unknown) => {
      if (command instanceof CreateBucketCommand) {
        buckets.add(command.input.Bucket as string);
        return {};
      }
      if (command instanceof PutObjectCommand) {
        const { Bucket, Key, Body } = command.input;
        if (!buckets.has(Bucket as string)) {
          throw new Error(`Fake S3: bucket ${Bucket} does not exist`);
        }
        store.set(Key as string, Buffer.isBuffer(Body) ? Body : Buffer.from(Body as Uint8Array));
        return {};
      }
      if (command instanceof GetObjectCommand) {
        const { Key } = command.input;
        const data = store.get(Key as string);
        if (!data) {
          throw new Error(`Fake S3: no object stored for key ${Key}`);
        }
        return { Body: Readable.from(data) };
      }
      if (command instanceof DeleteObjectCommand) {
        store.delete(command.input.Key as string);
        return {};
      }
      throw new Error(`Fake S3 client does not support command: ${command?.constructor?.name}`);
    },
  };
}
