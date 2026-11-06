import { S3Client } from '@aws-sdk/client-s3';
import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const S3_CLIENT = Symbol('S3_CLIENT');

export const s3ClientProvider: Provider = {
  provide: S3_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): S3Client => {
    const accessKeyId = config.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = config.get<string>('AWS_SECRET_ACCESS_KEY');
    return new S3Client({
      region: config.get<string>('AWS_REGION') ?? 'us-east-1',
      credentials:
        accessKeyId && secretAccessKey
          ? {
              accessKeyId,
              secretAccessKey,
            }
          : undefined,
      ...(config.get<string>('S3_ENDPOINT') ? { endpoint: config.get<string>('S3_ENDPOINT') } : {}),
      forcePathStyle: config.get<boolean>('S3_FORCE_PATH_STYLE') ?? false,
    });
  },
};
