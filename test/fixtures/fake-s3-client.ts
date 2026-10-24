import { Readable } from 'stream';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

/**
 * In-memory stand-in for S3Client used in e2e tests, so uploads/downloads
 * exercised by ResumeUploadService don't need a real bucket. Only
 * implements the two commands the app actually sends.
 */
export function createFakeS3Client() {
  const store = new Map<string, Buffer>();

  return {
    store,
    send: async (command: unknown) => {
      if (command instanceof PutObjectCommand) {
        const { Key, Body } = command.input;
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
      throw new Error(`Fake S3 client does not support command: ${command?.constructor?.name}`);
    },
  };
}
